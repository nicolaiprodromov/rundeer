"""Async conversation loop powering the rundeer agent.

Design:
  - One `Conversation` per WS connection.
  - Tools call into `web.agent.tools` (sandboxed).
  - Graph mutations are emitted as `graph_patch` events; the client applies
    them and echoes back a fresh snapshot so the next turn sees reality.
  - Destructive / expensive tools require a `confirm_response` from the client
    before executing.
  - Vision: when `view_image` returns a data URL, we attach it as a vision
    input on the *next* user-role message so the model can actually see it.
  - User edits between turns are diffed and injected as a terse system note.

This file uses an `asyncio.Queue[Event]` per turn so events stream out to the
WebSocket in order; the WS server drains the queue while the loop pushes.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import litellm

from .config import AgentSettings
from .diff import diff_graphs, format_diff_note, has_changes
from .system_prompt import build_system_prompt
from .tools import TOOLS_BY_NAME, build_litellm_tools, invoke_tool


# Tools the client is expected to apply (patch ops) before continuing.
PATCH_EMITTING_CATEGORIES = {"mutate"}


# ── Event helpers ─────────────────────────────────────────────────────────
def evt(kind: str, **fields: Any) -> Dict[str, Any]:
    return {"type": kind, "ts": time.time(), **fields}


@dataclass
class PendingConfirm:
    fut: asyncio.Future
    tool_name: str
    arguments: Dict[str, Any]


@dataclass
class Conversation:
    settings: AgentSettings
    root: Path
    server: Any  # RundeerWebServer
    record: Dict[str, Any]  # persisted record (see persistence.py)
    messages: List[Dict[str, Any]] = field(default_factory=list)
    snapshot: Dict[str, Any] = field(default_factory=lambda: {"nodes": {}, "edges": []})
    last_seen_snapshot: Dict[str, Any] = field(default_factory=lambda: {"nodes": {}, "edges": []})
    pending_confirm: Optional[PendingConfirm] = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    web_search_count: int = 0
    _pending_vision: List[Dict[str, Any]] = field(default_factory=list)
    _snapshot_version: int = 0
    _snapshot_waiters: List[asyncio.Future] = field(default_factory=list)
    _persist_task: Optional[asyncio.Task] = None

    # ── Lifecycle ─────────────────────────────────────────────────────────
    @classmethod
    def from_record(cls, settings: AgentSettings, root: Path, server: Any, record: Dict[str, Any]) -> "Conversation":
        conv = cls(settings=settings, root=root, server=server, record=record)
        conv.messages = list(record.get("messages") or [])
        return conv

    def update_snapshot(self, snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Replace the snapshot. Returns a diff *if* the user appears to have edited.

        The diff is only injected when there are changes since the last
        snapshot the model already saw (`last_seen_snapshot`). Returns None
        if no meaningful change.
        """
        if not isinstance(snapshot, dict):
            return None
        self.snapshot = {
            "nodes": snapshot.get("nodes") or {},
            "edges": snapshot.get("edges") or [],
            "selection": snapshot.get("selection") or [],
        }
        self._snapshot_version += 1
        waiters = self._snapshot_waiters
        self._snapshot_waiters = []
        for fut in waiters:
            if not fut.done():
                fut.set_result(self._snapshot_version)
        diff = diff_graphs(self.last_seen_snapshot, self.snapshot)
        return diff if has_changes(diff) else None

    def mark_snapshot_seen(self) -> None:
        # Deep-ish copy of just the parts we diff on.
        self.last_seen_snapshot = {
            "nodes": dict(self.snapshot.get("nodes") or {}),
            "edges": list(self.snapshot.get("edges") or []),
        }

    def cancel(self) -> None:
        self.cancel_event.set()
        if self.pending_confirm is not None and not self.pending_confirm.fut.done():
            self.pending_confirm.fut.set_result({"approved": False, "cancelled": True})

    def resolve_confirm(self, payload: Dict[str, Any]) -> bool:
        pc = self.pending_confirm
        if pc is None or pc.fut.done():
            return False
        pc.fut.set_result(payload or {"approved": False})
        return True

    # ── Persistence helpers ───────────────────────────────────────────────
    def _persist(self) -> None:
        """Snapshot the record and write it to disk.

        We hop to a default executor when an event loop is running so the
        JSON serialize + atomic rename never blocks token forwarding on the
        asyncio loop thread. When called outside a running loop (tests,
        sync paths) we fall back to a direct write.
        """
        self.record["messages"] = self.messages
        from .persistence import save_conversation
        # Take a shallow copy of the record so concurrent mutations during
        # the executor write don't trip serialization mid-flight.
        snapshot = dict(self.record)
        snapshot["messages"] = list(self.messages)

        def _do_write() -> None:
            try:
                save_conversation(self.root, snapshot)
            except Exception:  # noqa: BLE001
                pass

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            _do_write()
            return
        previous = self._persist_task

        async def _write_after_previous() -> None:
            if previous is not None:
                try:
                    await previous
                except Exception:  # noqa: BLE001
                    pass
            await loop.run_in_executor(None, _do_write)

        self._persist_task = loop.create_task(_write_after_previous())

    async def _flush_persist(self) -> None:
        task = self._persist_task
        if task is None or task.done():
            return
        try:
            await task
        except Exception:  # noqa: BLE001
            pass

    async def _wait_for_snapshot_after(self, version: int, *, timeout: float = 0.6) -> bool:
        if self._snapshot_version > version:
            self.mark_snapshot_seen()
            return True
        fut = asyncio.get_running_loop().create_future()
        self._snapshot_waiters.append(fut)
        try:
            await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            try:
                self._snapshot_waiters.remove(fut)
            except ValueError:
                pass
            return False
        self.mark_snapshot_seen()
        return True

    # ── Main turn ─────────────────────────────────────────────────────────
    async def run_turn(self, user_text: str, attached_images: Optional[List[str]] = None) -> AsyncIterator[Dict[str, Any]]:
        """Run one user turn. Yields events for the WS to forward."""
        self.cancel_event.clear()
        self.web_search_count = 0

        # Build user message — optionally include an injected user-edit diff,
        # client-attached images, and the latest snapshot summary.
        diff = self.update_snapshot(self.snapshot)
        user_content: List[Dict[str, Any]] = []
        if diff is not None:
            user_content.append({"type": "text", "text": format_diff_note(diff)})
            yield evt("graph_diff_note", diff=diff)
        snap_note = self._snapshot_note()
        if snap_note:
            user_content.append({"type": "text", "text": snap_note})
        user_content.append({"type": "text", "text": user_text or ""})
        # Attach images the user sent with this message.
        for url in attached_images or []:
            user_content.append({"type": "image_url", "image_url": {"url": url}})

        # When there are no images and no extra blocks, collapse to a plain string
        # so providers without multimodal parts (none currently) stay happy.
        if all(b.get("type") == "text" for b in user_content):
            self.messages.append({"role": "user", "content": "\n\n".join(b["text"] for b in user_content if b.get("text"))})
        else:
            self.messages.append({"role": "user", "content": user_content})
        if not self.record.get("title") or self.record.get("title") == "New conversation":
            self.record["title"] = (user_text or "").strip().splitlines()[0][:80] or "Untitled"
        self.mark_snapshot_seen()
        self._persist()

        yield evt("message_start", role="user")

        # System prompt (regenerated per turn to reflect current brains)
        system_msg = {"role": "system", "content": build_system_prompt(self.root, project_name=self.root.name)}

        for iteration in range(self.settings.max_tool_iterations):
            if self.cancel_event.is_set():
                yield evt("cancelled")
                return

            try:
                async for event in self._llm_step(system_msg):
                    yield event
            except CancelledTurn:
                yield evt("cancelled")
                return
            except Exception as exc:  # noqa: BLE001
                yield evt("error", message=f"{type(exc).__name__}: {exc}")
                return

            last = self.messages[-1]
            tool_calls = last.get("tool_calls") if isinstance(last, dict) else None
            if not tool_calls:
                # Finished. _llm_step already persisted the final assistant
                # message; no need to write again.
                await self._flush_persist()
                yield evt("done", iteration=iteration)
                return

            # Execute each tool call.
            for tc in tool_calls:
                if self.cancel_event.is_set():
                    yield evt("cancelled")
                    return
                async for event in self._handle_tool_call(tc):
                    yield event

        yield evt("error", message=f"agent exceeded {self.settings.max_tool_iterations} tool iterations")

    # ── LLM step (streaming) ──────────────────────────────────────────────
    async def _llm_step(self, system_msg: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        msg_id = uuid.uuid4().hex[:10]
        yield evt("message_start", role="assistant", id=msg_id)

        call_kwargs: Dict[str, Any] = {
            "model": self.settings.model,
            "messages": [system_msg, *self._messages_for_llm()],
            "tools": build_litellm_tools(),
            "tool_choice": "auto",
            "stream": True,
        }
        if self.settings.api_key:
            call_kwargs["api_key"] = self.settings.api_key
        if self.settings.base_url:
            call_kwargs["api_base"] = self.settings.base_url
        if self.settings.fallback_models:
            call_kwargs["fallbacks"] = list(self.settings.fallback_models)

        try:
            stream = await litellm.acompletion(**call_kwargs)
        except Exception as exc:  # noqa: BLE001
            yield evt("error", message=f"llm call failed: {exc}")
            raise

        accumulated_text = ""
        # Tool calls assembled across deltas: index → {id, name, arguments_str}
        tool_calls_acc: Dict[int, Dict[str, Any]] = {}
        finish_reason: Optional[str] = None

        # acompletion(stream=True) returns an async iterator (CustomStreamWrapper).
        try:
            async for chunk in stream:
                if self.cancel_event.is_set():
                    try:
                        close = getattr(stream, "aclose", None) or getattr(stream, "close", None)
                        if close is not None:
                            res = close()
                            if asyncio.iscoroutine(res):
                                await res
                    except Exception:  # noqa: BLE001
                        pass
                    raise CancelledTurn()
                try:
                    choice = chunk.choices[0]
                except (AttributeError, IndexError):
                    continue
                delta = getattr(choice, "delta", None)
                if delta is None:
                    continue
                # Text delta
                text = getattr(delta, "content", None)
                if text:
                    accumulated_text += text
                    yield evt("token", id=msg_id, delta=text)
                # Tool-call deltas
                tcs = getattr(delta, "tool_calls", None)
                if tcs:
                    for tc in tcs:
                        idx = getattr(tc, "index", 0) or 0
                        slot = tool_calls_acc.setdefault(idx, {"id": None, "name": "", "arguments": ""})
                        if getattr(tc, "id", None):
                            slot["id"] = tc.id
                        fn = getattr(tc, "function", None)
                        if fn is not None:
                            if getattr(fn, "name", None):
                                slot["name"] += fn.name
                            if getattr(fn, "arguments", None):
                                slot["arguments"] += fn.arguments
                finish_reason = getattr(choice, "finish_reason", finish_reason)
        except CancelledTurn:
            raise
        except Exception as exc:  # noqa: BLE001
            yield evt("error", message=f"stream error: {exc}")
            # Persist whatever we accumulated so the convo isn't lost.
            if accumulated_text or tool_calls_acc:
                pass
            else:
                raise

        # Build assistant message
        tool_calls_final = []
        for idx in sorted(tool_calls_acc.keys()):
            tc = tool_calls_acc[idx]
            if not tc["name"]:
                continue
            tool_calls_final.append({
                "id": tc["id"] or f"call_{uuid.uuid4().hex[:10]}",
                "type": "function",
                "function": {"name": tc["name"], "arguments": tc["arguments"] or "{}"},
            })

        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": accumulated_text or None}
        if tool_calls_final:
            assistant_msg["tool_calls"] = tool_calls_final
        self.messages.append(assistant_msg)
        self._persist()

        yield evt("message_end", role="assistant", id=msg_id, finish_reason=finish_reason, tool_call_count=len(tool_calls_final))

    # ── Tool dispatch ─────────────────────────────────────────────────────
    async def _handle_tool_call(self, tc: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        call_id = tc.get("id")
        fn = tc.get("function") or {}
        name = fn.get("name") or ""
        raw_args = fn.get("arguments") or "{}"
        try:
            args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args or {})
            if not isinstance(args, dict):
                args = {}
        except json.JSONDecodeError:
            args = {}

        spec = TOOLS_BY_NAME.get(name)
        yield evt("tool_call", id=call_id, name=name, arguments=args, category=(spec.category if spec else "unknown"), destructive=bool(spec and spec.destructive))

        if spec is None:
            result = {"error": f"unknown tool: {name}"}
        else:
            # Confirm gate for destructive / expensive tools.
            if spec.destructive:
                # Create the future BEFORE yielding so a fast client that
                # replies synchronously after seeing the confirm_request can
                # resolve it without racing.
                fut: asyncio.Future = asyncio.get_running_loop().create_future()
                self.pending_confirm = PendingConfirm(fut=fut, tool_name=name, arguments=args)
                yield evt("confirm_request", id=call_id, tool=name, arguments=args, summary=_confirm_summary(name, args))
                try:
                    approval = await fut
                finally:
                    self.pending_confirm = None
                if self.cancel_event.is_set():
                    raise CancelledTurn()
                if not approval.get("approved"):
                    result = {"error": "user denied this operation", "denied": True}
                    yield evt("tool_result", id=call_id, name=name, status="denied", result=result)
                    self._append_tool_result(call_id, name, result)
                    return

            # Rate-limit web search.
            if name == "web_search":
                if self.web_search_count >= self.settings.max_web_search_per_turn:
                    result = {"error": f"web_search rate limit exceeded ({self.settings.max_web_search_per_turn}/turn)"}
                    yield evt("tool_result", id=call_id, name=name, status="error", result=result)
                    self._append_tool_result(call_id, name, result)
                    return
                self.web_search_count += 1

            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: invoke_tool(name, args, root=self.root, server=self.server, graph=self.snapshot),
            )

        # If the tool emitted a graph patch, forward it to the client.
        if isinstance(result, dict) and isinstance(result.get("patch"), list):
            before_patch_snapshot = self._snapshot_version
            yield evt("graph_patch", id=call_id, name=name, ops=result["patch"], summary=result.get("summary"))
            if result["patch"]:
                await self._wait_for_snapshot_after(before_patch_snapshot)

        # Vision attachment: when view_image returns a data URL, queue it for
        # the next user-role injection so the model actually sees the image.
        if isinstance(result, dict) and result.get("_attach_vision") and result.get("data_url"):
            self._pending_vision.append({
                "type": "image_url",
                "image_url": {"url": result["data_url"]},
            })
            # Inject as a follow-up user message so the next assistant turn
            # has the image in context. We don't put the giant data URL into
            # tool_result that comes back to the model.
            light = {k: v for k, v in result.items() if k not in {"data_url", "_attach_vision"}}
            light["vision_attached"] = True
            result = light
            # Queue a user-role injection right after the tool result.
            self._queue_vision_inject()

        # Truncate huge tool results for transport / token economy.
        result_for_model = _truncate_for_model(result)
        yield evt("tool_result", id=call_id, name=name, status="ok" if not result.get("error") else "error", result=result_for_model)
        self._append_tool_result(call_id, name, result_for_model)

    def _queue_vision_inject(self) -> None:
        """Push the queued image into the message history so the next LLM step sees it."""
        if not self._pending_vision:
            return
        # We add a *user* message AFTER the upcoming tool result so the model
        # alternation stays valid. We do this lazily right before the next
        # llm_step by appending here — but that would put images before the
        # tool result. So instead we defer: append now as 'user' with the
        # image content; the next llm call will include it.
        # However: the next item to be appended is the tool_result. Order
        # in messages becomes: ..., assistant(tool_calls), tool(result), user(image+note).
        # The model treats the user image as a fresh signal. This is OK.
        content = list(self._pending_vision)
        content.insert(0, {"type": "text", "text": "(image attached from view_image — please use it to inform your next response)"})
        self.messages.append({"role": "user", "content": content})
        self._pending_vision = []

    def _append_tool_result(self, call_id: Optional[str], name: str, result: Dict[str, Any]) -> None:
        self.messages.append({
            "role": "tool",
            "tool_call_id": call_id or "",
            "name": name,
            "content": json.dumps(result, ensure_ascii=False, default=str)[:32_000],
        })
        # If we queued a vision injection during this tool call, append it after the tool result.
        if self._pending_vision:
            self._queue_vision_inject()
        # Intentionally no _persist() here: tool results land on disk together
        # with the next assistant message at the end of the next _llm_step.
        # Persisting per tool result added one synchronous JSON write per
        # tool call on the asyncio loop thread, blocking token forwarding
        # and making the agent feel sluggish.

    def _snapshot_note(self) -> Optional[str]:
        """Short summary of the current graph attached to user turns."""
        g = self.snapshot or {}
        nodes = g.get("nodes") or {}
        edges = g.get("edges") or []
        if not nodes and not edges:
            return "[graph is currently empty]"
        types: Dict[str, int] = {}
        for n in nodes.values():
            t = n.get("type") or "?"
            types[t] = types.get(t, 0) + 1
        type_summary = ", ".join(f"{c}× {t}" for t, c in sorted(types.items(), key=lambda kv: (-kv[1], kv[0]))[:10])
        sel = g.get("selection") or []
        sel_note = f"  selection: {', '.join(sel[:6])}" if sel else ""
        return f"[graph snapshot: {len(nodes)} nodes ({type_summary}), {len(edges)} edges]{sel_note}"

    def _messages_for_llm(self) -> List[Dict[str, Any]]:
        # Drop any malformed messages defensively.
        out = []
        for m in self.messages:
            if isinstance(m, dict) and m.get("role"):
                out.append(m)
        return out


class CancelledTurn(Exception):
    pass


_SENTINEL = object()


def _confirm_summary(tool: str, args: Dict[str, Any]) -> str:
    if tool == "remove_node":
        return f"delete node {args.get('node_id')}"
    if tool == "clear_graph":
        return "clear the entire graph"
    if tool == "run_graph":
        subset = args.get("subset")
        if subset:
            return f"run subset: {', '.join(subset)}"
        return "run the full graph (will spend API quota)"
    if tool == "disconnect_nodes":
        return f"disconnect edge {args.get('edge_id') or args.get('to_node', '?')}.{args.get('to_socket', '?')}"
    return f"run {tool}"


def _truncate_for_model(value: Any, *, depth: int = 0, max_str: int = 4000, max_list: int = 60) -> Any:
    if depth > 6:
        return "<truncated>"
    if isinstance(value, str):
        if len(value) > max_str:
            return value[:max_str] + f"…<+{len(value) - max_str} chars>"
        return value
    if isinstance(value, list):
        if len(value) > max_list:
            return [_truncate_for_model(v, depth=depth + 1) for v in value[:max_list]] + [f"…<+{len(value) - max_list} items>"]
        return [_truncate_for_model(v, depth=depth + 1) for v in value]
    if isinstance(value, dict):
        return {k: _truncate_for_model(v, depth=depth + 1) for k, v in value.items()}
    return value
