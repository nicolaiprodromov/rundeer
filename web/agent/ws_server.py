from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict, Optional

import websockets
from websockets.exceptions import ConnectionClosed

from .config import AgentSettings, resolve_ws_port
from .conversation import Conversation, evt
from .persistence import (
    delete_conversation,
    list_conversations,
    load_conversation,
    new_conversation,
)
from .profiles import (
    create_agent_profile,
    delete_agent_profile,
    get_active_agent_profile,
    list_agent_profiles,
    normalize_agent_id,
    rename_agent_profile,
    set_active_agent,
)


log = logging.getLogger("rundeer.agent.ws")


class AgentWSServer:
    def __init__(self, *, server: Any, settings: AgentSettings, ws_port: int, host: str = "127.0.0.1") -> None:
        self.server = server
        self.settings = settings
        self.ws_port = ws_port
        self.host = host
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self._ws_server = None
        self._shutdown_evt: Optional[asyncio.Event] = None


    def start(self) -> int:
        ready = threading.Event()
        err_box: Dict[str, Any] = {}

        def _run():
            loop = asyncio.new_event_loop()
            self.loop = loop
            asyncio.set_event_loop(loop)
            self._shutdown_evt = asyncio.Event()
            try:
                loop.run_until_complete(self._serve(ready, err_box))
            except Exception as exc:
                err_box["error"] = exc
                ready.set()
            finally:
                try:
                    loop.run_until_complete(loop.shutdown_asyncgens())
                except Exception:
                    pass
                loop.close()

        self.thread = threading.Thread(target=_run, name="rundeer-agent-ws", daemon=True)
        self.thread.start()
        ready.wait(timeout=10)
        if "error" in err_box:
            raise err_box["error"]
        return self.ws_port

    def stop(self) -> None:
        if self.loop is None or self._shutdown_evt is None:
            return
        try:
            self.loop.call_soon_threadsafe(self._shutdown_evt.set)
        except Exception:
            pass
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)


    async def _serve(self, ready: threading.Event, err_box: Dict[str, Any]) -> None:
        try:
            self._ws_server = await websockets.serve(
                self._handler,
                self.host,
                self.ws_port,
                max_size=8 * 1024 * 1024,
                ping_interval=20,
                ping_timeout=20,
            )
        except Exception as exc:
            err_box["error"] = exc
            ready.set()
            return

        try:
            for sock in self._ws_server.sockets or []:
                self.ws_port = sock.getsockname()[1]
                break
        except Exception:
            pass
        ready.set()
        try:
            await self._shutdown_evt.wait()
        finally:
            self._ws_server.close()
            await self._ws_server.wait_closed()

    async def _handler(self, ws) -> None:
        try:
            await self._session(ws)
        except ConnectionClosed:
            pass
        except Exception as exc:
            log.error("agent ws session crashed: %s\n%s", exc, traceback.format_exc())
            try:
                await ws.send(json.dumps(evt("error", message=f"server error: {exc}")))
            except Exception:
                pass

    async def _session(self, ws) -> None:
        root: Path = self.server.project_root
        conv: Optional[Conversation] = None
        turn_task: Optional[asyncio.Task] = None
        active_agent = get_active_agent_profile(root, model=self.settings.model)
        current_agent_id = str(active_agent.get("id") or "default")

        def agent_model() -> str:
            return str(active_agent.get("model") or self.settings.model)

        async def send(payload: Dict[str, Any]) -> None:
            try:
                await ws.send(json.dumps(payload, default=str))
            except (ConnectionClosed, RuntimeError):
                raise


        await send(evt(
            "ready",
            settings=self.settings.to_safe_dict(),
            agent=active_agent,
            agents=list_agent_profiles(root, model=self.settings.model),
            ws_port=self.ws_port,
            project=str(root),
        ))

        async for raw in ws:
            try:
                msg = json.loads(raw) if isinstance(raw, (str, bytes, bytearray)) else {}
            except json.JSONDecodeError:
                await send(evt("error", message="invalid JSON"))
                continue
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")

            if kind == "ping":
                await send(evt("pong"))
                continue

            if kind == "list_conversations":
                await send(evt("conversation_list", items=list_conversations(root, agent_id=current_agent_id)))
                continue

            if kind == "list_agents":
                await send(evt(
                    "agent_list",
                    items=list_agent_profiles(root, model=self.settings.model),
                    active_id=current_agent_id,
                ))
                continue

            if kind == "select_agent":
                if turn_task is not None and not turn_task.done():
                    await send(evt("error", message="cancel the current turn before switching agents"))
                    continue
                try:
                    active_agent = set_active_agent(root, msg.get("id"), model=self.settings.model)
                except (KeyError, ValueError) as exc:
                    await send(evt("error", message=f"agent select failed: {exc}"))
                    continue
                current_agent_id = str(active_agent.get("id") or "default")
                conv = None
                await send(evt("agent_selected", agent=active_agent))
                await send(evt("agent_list", items=list_agent_profiles(root, model=self.settings.model), active_id=current_agent_id))
                await send(evt("conversation_list", items=list_conversations(root, agent_id=current_agent_id)))
                continue

            if kind == "create_agent":
                if turn_task is not None and not turn_task.done():
                    await send(evt("error", message="cancel the current turn before creating an agent"))
                    continue
                try:
                    active_agent = create_agent_profile(root, name=msg.get("name") or "New agent", model=self.settings.model)
                except (KeyError, ValueError) as exc:
                    await send(evt("error", message=f"agent create failed: {exc}"))
                    continue
                current_agent_id = str(active_agent.get("id") or "default")
                conv = None
                await send(evt("agent_selected", agent=active_agent))
                await send(evt("agent_list", items=list_agent_profiles(root, model=self.settings.model), active_id=current_agent_id))
                await send(evt("conversation_list", items=[]))
                continue

            if kind == "rename_agent":
                try:
                    profile = rename_agent_profile(root, msg.get("id") or current_agent_id, name=msg.get("name") or "", model=self.settings.model)
                except (KeyError, ValueError) as exc:
                    await send(evt("error", message=f"agent rename failed: {exc}"))
                    continue
                if profile.get("id") == current_agent_id:
                    active_agent = profile
                    await send(evt("agent_selected", agent=active_agent))
                await send(evt("agent_list", items=list_agent_profiles(root, model=self.settings.model), active_id=current_agent_id))
                continue

            if kind == "delete_agent":
                if turn_task is not None and not turn_task.done():
                    await send(evt("error", message="cancel the current turn before deleting an agent"))
                    continue
                try:
                    active_agent = delete_agent_profile(root, msg.get("id"), model=self.settings.model)
                except (KeyError, ValueError) as exc:
                    await send(evt("error", message=f"agent delete failed: {exc}"))
                    continue
                current_agent_id = str(active_agent.get("id") or "default")
                conv = None
                await send(evt("agent_selected", agent=active_agent))
                await send(evt("agent_list", items=list_agent_profiles(root, model=self.settings.model), active_id=current_agent_id))
                await send(evt("conversation_list", items=list_conversations(root, agent_id=current_agent_id)))
                continue

            if kind == "new_conversation":
                rec = new_conversation(root, model=agent_model(), title=msg.get("title") or "New conversation", agent_id=current_agent_id)
                conv = Conversation.from_record(self.settings, root, self.server, rec, agent_id=current_agent_id)
                await send(evt("conversation_loaded", conversation=_conv_summary(rec), events_replay=[]))
                continue

            if kind == "load_conversation":
                cid = msg.get("id")
                rec = load_conversation(root, cid or "")
                if rec is None:
                    await send(evt("error", message=f"no such conversation: {cid}"))
                    continue
                try:
                    current_agent_id = normalize_agent_id(rec.get("agent_id") or current_agent_id)
                    active_agent = set_active_agent(root, current_agent_id, model=self.settings.model)
                except (KeyError, ValueError):
                    current_agent_id = str(active_agent.get("id") or "default")
                    rec["agent_id"] = current_agent_id
                conv = Conversation.from_record(self.settings, root, self.server, rec, agent_id=current_agent_id)
                await send(evt("conversation_loaded", conversation=_conv_summary(rec), events_replay=_replay_events(rec)))
                continue

            if kind == "delete_conversation":
                delete_conversation(root, msg.get("id") or "")
                await send(evt("conversation_list", items=list_conversations(root, agent_id=current_agent_id)))
                continue

            if kind == "graph_snapshot":
                if conv is None:
                    continue
                conv.update_snapshot(msg.get("graph") or {})

                continue

            if kind == "brain_graph_snapshot":
                if conv is None:
                    continue
                graph = msg.get("graph") or {}
                conv.update_brain_snapshot(graph)

                if msg.get("persist", True):
                    try:
                        from .brain_graph import save_brain_graph
                        save_brain_graph(root, graph, agent_id=current_agent_id)
                    except Exception as exc:
                        await send(evt("brain_error", message=str(exc)))
                continue

            if kind == "confirm_response":
                if conv is None:
                    continue
                conv.resolve_confirm({
                    "approved": bool(msg.get("approved")),
                    "call_id": msg.get("call_id"),
                })
                continue

            if kind == "cancel":
                if conv is not None:
                    conv.cancel()
                if turn_task is not None and not turn_task.done():
                    turn_task.cancel()
                continue

            if kind == "user_message":
                if turn_task is not None and not turn_task.done():



                    try:
                        await asyncio.wait_for(asyncio.shield(turn_task), timeout=0.2)
                    except (asyncio.TimeoutError, asyncio.CancelledError):
                        pass
                    if turn_task is not None and not turn_task.done():
                        await send(evt("error", message="a turn is already running; cancel first"))
                        continue
                if conv is None:
                    rec = new_conversation(root, model=agent_model(), agent_id=current_agent_id)
                    conv = Conversation.from_record(self.settings, root, self.server, rec, agent_id=current_agent_id)
                    await send(evt("conversation_loaded", conversation=_conv_summary(rec), events_replay=[]))
                if isinstance(msg.get("graph"), dict):
                    conv.update_snapshot(msg["graph"])
                text = str(msg.get("text") or "")
                images = msg.get("images") or []
                if not isinstance(images, list):
                    images = []
                images = [str(u) for u in images if isinstance(u, str) and u.startswith(("data:", "http://", "https://", "/api/"))]

                async def _run_turn():
                    try:
                        async for event in conv.run_turn(text, attached_images=images):
                            await send(event)
                    except asyncio.CancelledError:
                        await send(evt("cancelled"))
                    except Exception as exc:
                        log.error("turn crashed: %s\n%s", exc, traceback.format_exc())
                        await send(evt("error", message=f"turn crashed: {exc}"))

                turn_task = asyncio.create_task(_run_turn())
                continue

            await send(evt("error", message=f"unknown message type: {kind}"))


def _conv_summary(rec: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": rec.get("id"),
        "agent_id": rec.get("agent_id") or "default",
        "title": rec.get("title"),
        "model": rec.get("model"),
        "created_at": rec.get("created_at"),
        "updated_at": rec.get("updated_at"),
        "message_count": sum(1 for m in rec.get("messages") or [] if m.get("role") in {"user", "assistant"}),
    }


def _replay_events(rec: Dict[str, Any]) -> list:

    out = []
    for m in rec.get("messages") or []:
        role = m.get("role")
        if role == "user":
            content = m.get("content")
            if isinstance(content, list):
                text_parts = [b.get("text") for b in content if isinstance(b, dict) and b.get("type") == "text"]
                images = [b.get("image_url", {}).get("url") for b in content if isinstance(b, dict) and b.get("type") == "image_url"]
                out.append(evt("replay_user", text="\n".join(t for t in text_parts if t), images=[u for u in images if u]))
            else:
                out.append(evt("replay_user", text=content or "", images=[]))
        elif role == "assistant":
            out.append(evt(
                "replay_assistant",
                text=m.get("content") or "",
                reasoning=m.get("_reasoning") or "",
                tool_calls=m.get("tool_calls") or [],
            ))
        elif role == "tool":
            try:
                result = json.loads(m.get("content") or "{}")
            except json.JSONDecodeError:
                result = {"raw": (m.get("content") or "")[:400]}
            out.append(evt("replay_tool_result", name=m.get("name"), id=m.get("tool_call_id"), result=result))
    return out


def start_agent_ws_server(server: Any, *, web_port: int, settings: Optional[AgentSettings] = None) -> Optional[AgentWSServer]:

    from .config import get_agent_settings
    settings = settings or get_agent_settings(server.project_root)
    if not settings.enabled:
        return None
    port = resolve_ws_port(settings, web_port)
    handle = AgentWSServer(server=server, settings=settings, ws_port=port, host=settings.ws_host)
    handle.start()
    return handle
