from __future__ import annotations

import asyncio
import fcntl
import fnmatch
import os
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import threading
import time
from typing import Any, Dict, Optional, Tuple


class PtySession:
    def __init__(self, sid: str, shell: str = "bash", cwd: str = ""):
        self.sid = sid
        self.shell = shell
        self.cwd = cwd or None
        self.master_fd: Optional[int] = None
        self.pid: Optional[int] = None
        self._reader: Optional[threading.Thread] = None
        self._alive = False
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.created_at = time.time()
        self.last_activity = time.time()

    def spawn(self, loop: asyncio.AbstractEventLoop) -> int:
        self._loop = loop
        master, slave = pty.openpty()
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        shell_path = self.shell
        for candidate in [f"/usr/bin/{self.shell}", f"/bin/{self.shell}"]:
            if os.path.isfile(candidate):
                shell_path = candidate
                break
        proc = subprocess.Popen(
            [shell_path, "-l"],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            start_new_session=True,
            cwd=self.cwd,
            env=env,
        )
        os.close(slave)
        self.master_fd = master
        self.pid = proc.pid
        self._alive = True
        flags = fcntl.fcntl(master, fcntl.F_GETFL)
        fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        self._reader = threading.Thread(target=self._read_loop, daemon=True, name=f"pty-read-{self.sid}")
        self._reader.start()
        return proc.pid

    def _read_loop(self):
        fd = self.master_fd
        while self._alive and fd is not None:
            try:
                r, _, _ = select.select([fd], [], [], 0.1)
                if r:
                    data = os.read(fd, 4096)
                    if not data:
                        break
                    self.last_activity = time.time()
                    if self._loop and not self._loop.is_closed():
                        self._loop.call_soon_threadsafe(self._queue.put_nowait, data)
            except (OSError, ValueError):
                break
        self._alive = False

    def write(self, data: bytes):
        if self.master_fd is not None and self._alive:
            try:
                os.write(self.master_fd, data)
                self.last_activity = time.time()
            except OSError:
                self._alive = False

    def resize(self, cols: int, rows: int):
        if self.master_fd is not None and self._alive:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def is_alive(self) -> bool:
        if not self._alive:
            return False
        if self.pid:
            try:
                os.kill(self.pid, 0)
                return True
            except OSError:
                self._alive = False
                return False
        return False

    def kill(self):
        self._alive = False
        if self.pid:
            try:
                os.killpg(os.getpgid(self.pid), signal.SIGTERM)
            except (OSError, ProcessLookupError):
                pass
            try:
                os.kill(self.pid, signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

    async def read(self) -> bytes:
        return await self._queue.get()

    def drain(self) -> list[bytes]:
        chunks: list[bytes] = []
        while not self._queue.empty():
            try:
                chunks.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        return chunks


class PtyManager:
    def __init__(self):
        self._sessions: Dict[str, PtySession] = {}
        self._lock = threading.Lock()

    def spawn(self, sid: str, shell: str, cwd: str, loop: asyncio.AbstractEventLoop) -> PtySession:
        with self._lock:
            old = self._sessions.get(sid)
            if old:
                old.kill()
            sess = PtySession(sid, shell=shell, cwd=cwd)
            sess.spawn(loop)
            self._sessions[sid] = sess
            return sess

    def get(self, sid: str) -> Optional[PtySession]:
        return self._sessions.get(sid)

    def kill(self, sid: str):
        with self._lock:
            sess = self._sessions.pop(sid, None)
            if sess:
                sess.kill()

    def cleanup_all(self):
        with self._lock:
            for sess in self._sessions.values():
                sess.kill()
            self._sessions.clear()

    def cleanup_stale(self, max_idle: float = 600):
        now = time.time()
        stale = []
        with self._lock:
            for sid, sess in self._sessions.items():
                if now - sess.last_activity > max_idle and not sess.is_alive():
                    stale.append(sid)
            for sid in stale:
                s = self._sessions.pop(sid, None)
                if s:
                    s.kill()

    def active_sessions(self) -> list[dict]:
        out = []
        for sid, sess in self._sessions.items():
            out.append({
                "id": sid,
                "pid": sess.pid,
                "shell": sess.shell,
                "alive": sess.is_alive(),
                "created": sess.created_at,
                "last_activity": sess.last_activity,
            })
        return out


def chk_allowed(cmd: str, patterns_str: str, yolo: bool) -> Tuple[bool, str]:
    if yolo:
        return True, ""
    raw = (patterns_str or "").strip()
    if not raw:
        return False, "No allowed patterns configured and YOLO is off"
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    if not lines:
        return False, "No allowed patterns configured and YOLO is off"
    cmd_stripped = cmd.strip()
    for pat in lines:
        try:
            if re.fullmatch(pat, cmd_stripped):
                return True, ""
        except re.error:
            if fnmatch.fnmatch(cmd_stripped, pat):
                return True, ""
    return False, f"Command blocked: '{cmd_stripped}' does not match any allowed pattern"
