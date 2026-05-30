from __future__ import annotations

import asyncio
import json
import logging
import threading
import traceback
from typing import Any, Dict, Optional

import websockets
from websockets.exceptions import ConnectionClosed

from .pty_manager import PtyManager, PtySession, chk_allowed

log = logging.getLogger("rundeer.pty.ws")

PTY_PORT_OFFSET = 2


class PtyWSServer:
    def __init__(self, *, project_root: str, ws_port: int, host: str = "127.0.0.1"):
        self.project_root = str(project_root)
        self.ws_port = ws_port
        self.host = host
        self.mgr = PtyManager()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self._ws_server = None
        self._shutdown_evt: Optional[asyncio.Event] = None
        self._cleanup_task: Optional[asyncio.Task] = None

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

        self.thread = threading.Thread(target=_run, name="rundeer-pty-ws", daemon=True)
        self.thread.start()
        ready.wait(timeout=10)
        if "error" in err_box:
            raise err_box["error"]
        return self.ws_port

    def stop(self):
        self.mgr.cleanup_all()
        if self.loop and self._shutdown_evt:
            try:
                self.loop.call_soon_threadsafe(self._shutdown_evt.set)
            except Exception:
                pass
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)

    async def _serve(self, ready: threading.Event, err_box: Dict[str, Any]):
        try:
            self._ws_server = await websockets.serve(
                self._handler,
                self.host,
                self.ws_port,
                max_size=1 * 1024 * 1024,
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

        self._cleanup_task = asyncio.ensure_future(self._periodic_cleanup())
        ready.set()
        try:
            await self._shutdown_evt.wait()
        finally:
            if self._cleanup_task:
                self._cleanup_task.cancel()
            self._ws_server.close()
            await self._ws_server.wait_closed()

    async def _periodic_cleanup(self):
        while True:
            await asyncio.sleep(60)
            self.mgr.cleanup_stale(max_idle=600)

    async def _handler(self, ws):
        try:
            await self._session(ws)
        except ConnectionClosed:
            pass
        except Exception as exc:
            log.error("pty ws session error: %s\n%s", exc, traceback.format_exc())
            try:
                await ws.send(json.dumps({"type": "error", "msg": str(exc)}))
            except Exception:
                pass

    async def _session(self, ws):
        sess: Optional[PtySession] = None
        sid: Optional[str] = None
        read_task: Optional[asyncio.Task] = None
        allowed_patterns = ""
        yolo = False

        async def send(payload: dict):
            try:
                await ws.send(json.dumps(payload, default=str))
            except (ConnectionClosed, RuntimeError):
                raise

        async def _read_pump(s: PtySession):
            while s.is_alive():
                try:
                    data = await asyncio.wait_for(s.read(), timeout=0.5)
                    await ws.send(json.dumps({"type": "output", "data": data.decode("utf-8", errors="replace")}))
                except asyncio.TimeoutError:
                    continue
                except (ConnectionClosed, RuntimeError):
                    break
                except Exception:
                    break

        async for raw in ws:
            try:
                msg = json.loads(raw) if isinstance(raw, (str, bytes, bytearray)) else {}
            except json.JSONDecodeError:
                await send({"type": "error", "msg": "invalid JSON"})
                continue
            if not isinstance(msg, dict):
                continue

            kind = msg.get("type")

            if kind == "init":
                sid = str(msg.get("session_id") or msg.get("sid") or "default")
                shell = str(msg.get("shell") or "bash")
                cwd = str(msg.get("cwd") or "") or self.project_root
                cols = int(msg.get("cols") or 80)
                rows = int(msg.get("rows") or 24)
                allowed_patterns = str(msg.get("allowed_patterns") or "")
                yolo = bool(msg.get("yolo"))

                existing = self.mgr.get(sid)
                if existing and existing.is_alive():
                    sess = existing
                    sess._loop = self.loop
                    sess.resize(cols, rows)
                    await send({"type": "spawned", "pid": sess.pid, "reconnected": True})
                else:
                    sess = self.mgr.spawn(sid, shell, cwd, self.loop)
                    sess.resize(cols, rows)
                    await send({"type": "spawned", "pid": sess.pid, "reconnected": False})

                if read_task and not read_task.done():
                    read_task.cancel()
                read_task = asyncio.ensure_future(_read_pump(sess))
                continue

            if sess is None:
                await send({"type": "error", "msg": "send init first"})
                continue

            if kind == "input":
                data = msg.get("data", "")
                if isinstance(data, str):
                    sess.write(data.encode("utf-8"))
                continue

            if kind == "resize":
                cols = int(msg.get("cols") or 80)
                rows = int(msg.get("rows") or 24)
                sess.resize(cols, rows)
                continue

            if kind == "command":
                cmd = str(msg.get("cmd") or "").strip()
                if not cmd:
                    continue
                ok, reason = chk_allowed(cmd, allowed_patterns, yolo)
                if not ok:
                    await send({"type": "error", "msg": reason})
                    continue
                sess.write((cmd + "\n").encode("utf-8"))
                continue

            if kind == "clear":
                sess.write(b"\x1b[2J\x1b[H")
                continue

            if kind == "refresh":
                shell = str(msg.get("shell") or sess.shell)
                cwd = str(msg.get("cwd") or "") or self.project_root
                if read_task and not read_task.done():
                    read_task.cancel()
                sess = self.mgr.spawn(sid, shell, cwd, self.loop)
                cols = int(msg.get("cols") or 80)
                rows = int(msg.get("rows") or 24)
                sess.resize(cols, rows)
                await send({"type": "killed"})
                await send({"type": "spawned", "pid": sess.pid, "reconnected": False})
                read_task = asyncio.ensure_future(_read_pump(sess))
                continue

            if kind == "update_filters":
                allowed_patterns = str(msg.get("allowed_patterns") or "")
                yolo = bool(msg.get("yolo"))
                continue

        if read_task and not read_task.done():
            read_task.cancel()


def start_pty_ws_server(project_root: str, web_port: int, host: str = "127.0.0.1") -> PtyWSServer:
    port = web_port + PTY_PORT_OFFSET
    srv = PtyWSServer(project_root=project_root, ws_port=port, host=host)
    srv.start()
    return srv
