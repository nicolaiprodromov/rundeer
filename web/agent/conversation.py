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
from .profiles import DEFAULT_AGENT_ID, normalize_agent_id
from .diff import diff_graphs, format_diff_note, has_changes
from .system_prompt import build_system_prompt
from .tools import (
    TOOLS_BY_NAME,
    build_litellm_tools,
    effective_spec,
    effective_specs,
    enabled_tool_names,
    invoke_tool,
    is_tool_enabled,
)



PATCH_EMITTING_CATEGORIES = {"mutate"}



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
    server: Any
    record: Dict[str, Any]
    agent_id: str = DEFAULT_AGENT_ID
    messages: List[Dict[str, Any]] = field(default_factory=list)
    snapshot: Dict[str, Any] = field(default_factory=lambda: {"nodes": {}, "edges": []})
    last_seen_snapshot: Dict[str, Any] = field(default_factory=lambda: {"nodes": {}, "edges": []})
    brain_snapshot: Dict[str, Any] = field(default_factory=lambda: {"nodes": {}, "edges": []})
    pending_confirm: Optional[PendingConfirm] = None
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    web_search_count: int = 0
    _pending_vision: List[Dict[str, Any]] = field(default_factory=list)
    _snapshot_version: int = 0
    _snapshot_waiters: List[asyncio.Future] = field(default_factory=list)
    _brain_snapshot_version: int = 0
    _brain_snapshot_waiters: List[asyncio.Future] = field(default_factory=list)
    _persist_task: Optional[asyncio.Task] = None
    _runtime: Any = None
    _effective_settings: Optional[AgentSettings] = None


    @classmethod
    def from_record(cls, settings: AgentSettings, root: Path, server: Any, record: Dict[str, Any], agent_id: Optional[str] = None) -> "Conversation":
        resolved_agent_id = normalize_agent_id(agent_id or record.get("agent_id"))
        record["agent_id"] = resolved_agent_id
        conv = cls(settings=settings, root=root, server=server, record=record, agent_id=resolved_agent_id)
        conv.messages = list(record.get("messages") or [])
        return conv

    def update_snapshot(self, snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:






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


    def update_brain_snapshot(self, snapshot: Optional[Dict[str, Any]]) -> None:
        if not isinstance(snapshot, dict):
            return
        self.brain_snapshot = {
            "nodes": snapshot.get("nodes") or {},
            "edges": snapshot.get("edges") or [],
        }
        self._brain_snapshot_version += 1
        waiters = self._brain_snapshot_waiters
        self._brain_snapshot_waiters = []
        for fut in waiters:
            if not fut.done():
                fut.set_result(self._brain_snapshot_version)

        self._runtime = None
        self._effective_settings = None

    async def _wait_for_brain_snapshot_after(self, version: int, *, timeout: float = 0.6) -> bool:
        if self._brain_snapshot_version > version:
            return True
        fut = asyncio.get_running_loop().create_future()
        self._brain_snapshot_waiters.append(fut)
        try:
            await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            try:
                self._brain_snapshot_waiters.remove(fut)
            except ValueError:
                pass
            return False
        return True


    def _load_runtime(self) -> None:

        from .brain_graph import AgentRuntimeConfig, load_runtime_config
        try:
            self._runtime = load_runtime_config(self.root, agent_id=self.agent_id)
        except Exception:
            self._runtime = AgentRuntimeConfig()
        self._effective_settings = self._merge_settings(self._runtime)

    def _merge_settings(self, runtime: Any) -> AgentSettings:

        if runtime is None:
            return self.settings
        overrides: Dict[str, Any] = dict(getattr(runtime, "settings", {}) or {})
        if not overrides:
            return self.settings
        merged = AgentSettings(
            enabled=self.settings.enabled,
            model=str(overrides.get("model") or self.settings.model),
            api_key=self.settings.api_key,
            base_url=self.settings.base_url,
            ws_host=self.settings.ws_host,
            ws_port=self.settings.ws_port,
            max_tool_iterations=int(overrides.get("max_tool_iterations") or self.settings.max_tool_iterations),
            max_file_bytes=int(overrides.get("max_file_bytes") or self.settings.max_file_bytes),
            max_list_entries=int(overrides.get("max_list_entries") or self.settings.max_list_entries),
            max_web_search_per_turn=int(overrides.get("max_web_search_per_turn") or self.settings.max_web_search_per_turn),
            vision_enabled=bool(overrides.get("vision_enabled", self.settings.vision_enabled)),
            extra=dict(self.settings.extra),
        )
        if "temperature" in overrides:
            try:
                merged.extra["temperature"] = float(overrides["temperature"])
            except (TypeError, ValueError):
                pass
        return merged

    @property
    def runtime(self) -> Any:
        return self._runtime

    @property
    def tool_overrides(self) -> Any:
        return getattr(self._runtime, "tool_overrides", {}) if self._runtime else {}

    @property
    def effective_settings(self) -> AgentSettings:
        return self._effective_settings or self.settings


    def _persist(self) -> None:







        self.record["messages"] = self.messages
        self.record["agent_id"] = self.agent_id
        from .persistence import save_conversation


        snapshot = dict(self.record)
        snapshot["messages"] = list(self.messages)

        def _do_write() -> None:
            try:
                save_conversation(self.root, snapshot)
            except Exception:
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
                except Exception:
                    pass
            await loop.run_in_executor(None, _do_write)

        self._persist_task = loop.create_task(_write_after_previous())

    async def _flush_persist(self) -> None:
        task = self._persist_task
        if task is None or task.done():
            return
        try:
            await task
        except Exception:
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


    async def run_turn(self, user_text: str, attached_images: Optional[List[str]] = None) -> AsyncIterator[Dict[str, Any]]:

        self.cancel_event.clear()
        self.web_search_count = 0

        self._load_runtime()



        diff = self.update_snapshot(self.snapshot)
        user_content: List[Dict[str, Any]] = []
        if diff is not None:
            user_content.append({"type": "text", "text": format_diff_note(diff)})
            yield evt("graph_diff_note", diff=diff)
        snap_note = self._snapshot_note()
        if snap_note:
            user_content.append({"type": "text", "text": snap_note})
        user_content.append({"type": "text", "text": user_text or ""})

        for url in attached_images or []:
            user_content.append({"type": "image_url", "image_url": {"url": url}})



        if all(b.get("type") == "text" for b in user_content):
            self.messages.append({"role": "user", "content": "\n\n".join(b["text"] for b in user_content if b.get("text"))})
        else:
            self.messages.append({"role": "user", "content": user_content})
        if not self.record.get("title") or self.record.get("title") == "New conversation":
            self.record["title"] = (user_text or "").strip().splitlines()[0][:80] or "Untitled"
        self.mark_snapshot_seen()
        self._persist()

        yield evt("message_start", role="user")


        system_msg = {"role": "system", "content": build_system_prompt(
            self.root,
            project_name=self.root.name,
            runtime=self._runtime,
            enabled_tool_names=enabled_tool_names(self.tool_overrides),
        )}

        for iteration in range(self.effective_settings.max_tool_iterations):
            if self.cancel_event.is_set():
                yield evt("cancelled")
                return

            try:
                async for event in self._llm_step(system_msg):
                    yield event
            except CancelledTurn:
                yield evt("cancelled")
                return
            except Exception as exc:
                yield evt("error", message=f"{type(exc).__name__}: {exc}")
                return

            last = self.messages[-1]
            tool_calls = last.get("tool_calls") if isinstance(last, dict) else None
            if not tool_calls:


                await self._flush_persist()
                yield evt("done", iteration=iteration)
                return


            for tc in tool_calls:
                if self.cancel_event.is_set():
                    yield evt("cancelled")
                    return
                async for event in self._handle_tool_call(tc):
                    yield event

        yield evt("error", message=f"agent exceeded {self.effective_settings.max_tool_iterations} tool iterations")


    async def _llm_step(self, system_msg: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        msg_id = uuid.uuid4().hex[:10]
        yield evt("message_start", role="assistant", id=msg_id)

        settings = self.effective_settings
        if not settings.model:
            yield evt("error", message="MODEL_NAME is not set in .env")
            raise RuntimeError("MODEL_NAME is not set in .env")
        call_kwargs: Dict[str, Any] = {
            "model": settings.model,
            "messages": [system_msg, *self._messages_for_llm()],
            "tools": build_litellm_tools(self.tool_overrides),
            "tool_choice": "auto",
            "stream": True,
        }
        if settings.api_key:
            call_kwargs["api_key"] = settings.api_key
        if settings.base_url:
            call_kwargs["api_base"] = settings.base_url




        if "/" not in settings.model and settings.base_url:
            call_kwargs["custom_llm_provider"] = "openai"
        temp = settings.extra.get("temperature") if settings.extra else None
        if isinstance(temp, (int, float)):
            call_kwargs["temperature"] = float(temp)

        try:
            stream = await litellm.acompletion(**call_kwargs)
        except Exception as exc:
            yield evt("error", message=f"llm call failed: {exc}")
            raise

        accumulated_text = ""
        accumulated_reasoning = ""

        tool_calls_acc: Dict[int, Dict[str, Any]] = {}
        finish_reason: Optional[str] = None


        try:
            async for chunk in stream:
                if self.cancel_event.is_set():
                    try:
                        close = getattr(stream, "aclose", None) or getattr(stream, "close", None)
                        if close is not None:
                            res = close()
                            if asyncio.iscoroutine(res):
                                await res
                    except Exception:
                        pass
                    raise CancelledTurn()
                try:
                    choice = chunk.choices[0]
                except (AttributeError, IndexError):
                    continue
                delta = getattr(choice, "delta", None)
                if delta is None:
                    continue


                reasoning = _delta_text(delta, "reasoning_content", "reasoning", "thinking")
                if reasoning:
                    accumulated_reasoning += reasoning
                    yield evt("reasoning", id=msg_id, delta=reasoning)

                text = _delta_text(delta, "content")
                if text:
                    accumulated_text += text
                    yield evt("token", id=msg_id, delta=text)

                tcs = _delta_field(delta, "tool_calls")
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
        except Exception as exc:
            yield evt("error", message=f"stream error: {exc}")

            if accumulated_text or tool_calls_acc:
                pass
            else:
                raise


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
        if accumulated_reasoning:
            assistant_msg["_reasoning"] = accumulated_reasoning
        if tool_calls_final:
            assistant_msg["tool_calls"] = tool_calls_final
        self.messages.append(assistant_msg)
        self._persist()

        yield evt("message_end", role="assistant", id=msg_id, finish_reason=finish_reason, tool_call_count=len(tool_calls_final))


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



        base = TOOLS_BY_NAME.get(name)
        spec = effective_spec(name, self.tool_overrides) if base is not None else None
        disabled = base is not None and spec is None
        yield evt(
            "tool_call",
            id=call_id,
            name=name,
            arguments=args,
            category=(spec.category if spec else (base.category if base else "unknown")),
            destructive=bool(spec and spec.destructive),
        )

        if base is None:
            result = {"error": f"unknown tool: {name}"}
        elif disabled:
            result = {"error": f"tool '{name}' is disabled by the brain graph"}
            yield evt("tool_result", id=call_id, name=name, status="error", result=result)
            self._append_tool_result(call_id, name, result)
            return
        else:

            if spec.destructive:



                fut: asyncio.Future = asyncio.get_running_loop().create_future()
                self.pending_confirm = PendingConfirm(fut=fut, tool_name=name, arguments=args)
                yield evt("confirm_request", id=call_id, tool=name, arguments=args, summary=_confirm_summary(name, args), category=spec.category)
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


            if name == "web_search":
                if self.web_search_count >= self.effective_settings.max_web_search_per_turn:
                    result = {"error": f"web_search rate limit exceeded ({self.effective_settings.max_web_search_per_turn}/turn)"}
                    yield evt("tool_result", id=call_id, name=name, status="error", result=result)
                    self._append_tool_result(call_id, name, result)
                    return
                self.web_search_count += 1

            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: invoke_tool(name, args, root=self.root, server=self.server, graph=self.snapshot, agent_id=self.agent_id),
            )




        if isinstance(result, dict) and isinstance(result.get("patch"), list):
            patch_target = result.get("patch_target") or ("brain" if (spec and spec.category == "self_modify") else "workflow")
            if patch_target == "brain":
                before = self._brain_snapshot_version
                yield evt(
                    "brain_graph_patch",
                    id=call_id, name=name,
                    ops=result["patch"], summary=result.get("summary"),
                )
                if result["patch"]:
                    await self._wait_for_brain_snapshot_after(before)


                self._load_runtime()
                yield evt("brain_compiled", summary=_brain_compiled_summary(self._runtime))
            else:
                before_patch_snapshot = self._snapshot_version
                yield evt("graph_patch", id=call_id, name=name, ops=result["patch"], summary=result.get("summary"))
                if result["patch"]:
                    await self._wait_for_snapshot_after(before_patch_snapshot)



        if isinstance(result, dict) and result.get("_attach_vision") and result.get("data_url"):
            self._pending_vision.append({
                "type": "image_url",
                "image_url": {"url": result["data_url"]},
            })



            light = {k: v for k, v in result.items() if k not in {"data_url", "_attach_vision"}}
            light["vision_attached"] = True
            result = light

            self._queue_vision_inject()


        result_for_model = _truncate_for_model(result)
        yield evt("tool_result", id=call_id, name=name, status="ok" if not result.get("error") else "error", result=result_for_model)
        self._append_tool_result(call_id, name, result_for_model)

    def _queue_vision_inject(self) -> None:

        if not self._pending_vision:
            return








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

        if self._pending_vision:
            self._queue_vision_inject()






    def _snapshot_note(self) -> Optional[str]:

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

        out = []
        for m in self.messages:
            if not isinstance(m, dict) or not m.get("role"):
                continue
            role = m.get("role")
            if role in {"system", "user"}:
                out.append({"role": role, "content": m.get("content") or ""})
            elif role == "assistant":
                clean: Dict[str, Any] = {"role": "assistant", "content": m.get("content")}
                if m.get("tool_calls"):
                    clean["tool_calls"] = m.get("tool_calls")
                out.append(clean)
            elif role == "tool":
                out.append({
                    "role": "tool",
                    "tool_call_id": m.get("tool_call_id") or "",
                    "name": m.get("name") or "",
                    "content": m.get("content") or "",
                })
        return out


class CancelledTurn(Exception):
    pass


_SENTINEL = object()


def _delta_text(delta: Any, *names: str) -> str:
    for name in names:
        value = _delta_field(delta, name)
        if isinstance(value, str) and value:
            return value
    return ""


def _delta_field(delta: Any, name: str) -> Any:
    value = getattr(delta, name, _SENTINEL)
    if value is _SENTINEL and isinstance(delta, dict):
        value = delta.get(name, _SENTINEL)
    return None if value is _SENTINEL else value


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

    if tool == "set_tool_flag":
        return f"change tool '{args.get('tool_name')}' (enabled={args.get('enabled')})"
    if tool == "set_agent_setting":
        return f"set agent setting {args.get('key')} = {args.get('value')!r}"
    if tool == "set_system_prompt_section":
        return f"rewrite brain section '{args.get('section_id') or args.get('id')}'"
    if tool == "add_system_prompt_section":
        body = str(args.get('body') or '')
        return f"add new brain section ({len(body)} chars)"
    if tool == "remove_system_prompt_section":
        return f"remove brain section '{args.get('section_id') or args.get('id')}'"
    return f"run {tool}"


def _brain_compiled_summary(runtime: Any) -> Dict[str, Any]:
    if runtime is None:
        return {"prompt_chars": 0, "tools_enabled": 0}
    return {
        "prompt_chars": len(getattr(runtime, "system_prompt", "") or ""),
        "tools_enabled": sum(1 for ov in (getattr(runtime, "tool_overrides", {}) or {}).values() if getattr(ov, "enabled", True)),
    }


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
