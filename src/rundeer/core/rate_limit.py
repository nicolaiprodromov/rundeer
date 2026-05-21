
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

try:
    import fcntl
except ImportError:
    fcntl = None

from rundeer.core.config import normalize_rate_limits


WINDOWS = (
    ("per_second", 1.0),
    ("per_minute", 60.0),
    ("per_hour", 3600.0),
    ("per_day", 86400.0),
)


class RateLimiter:







    def __init__(
        self,
        limits: Optional[Dict[str, Any]] = None,
        *,
        state_path: Optional[Path | str] = None,
        clock: Callable[[], float] = time.time,
        sleeper: Callable[[float], None] = time.sleep,
        safety_seconds: float = 0.25,
    ):
        self.limits = normalize_rate_limits(limits or {})
        self.enabled = bool(self.limits.get("enabled")) and any(
            self.limits.get(key) for key, _seconds in WINDOWS
        )
        self.state_path = Path(state_path) if state_path else None
        self.clock = clock
        self.sleeper = sleeper
        self.safety_seconds = max(0.0, float(safety_seconds))
        self._lock = threading.Lock()
        self._events: List[float] = []

    def acquire(self, *, cost: int = 1) -> None:
        if not self.enabled:
            return
        for _ in range(max(1, int(cost))):
            self._acquire_one()

    def _acquire_one(self) -> None:
        while True:
            wait = self._try_acquire_one()
            if wait <= 0:
                return
            self.sleeper(wait)

    def _try_acquire_one(self) -> float:
        if self.state_path:
            return self._try_acquire_one_persistent()
        with self._lock:
            wait, events = self._evaluate(self._events)
            if wait <= 0:
                self._events = events
            return wait

    def _try_acquire_one_persistent(self) -> float:
        assert self.state_path is not None
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.state_path.with_suffix(self.state_path.suffix + ".lock")
        with self._lock:
            with lock_path.open("a+", encoding="utf-8") as lock_file:
                if fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    events = self._read_events()
                    wait, events = self._evaluate(events)
                    if wait <= 0:
                        self._write_events(events)
                    return wait
                finally:
                    if fcntl is not None:
                        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _evaluate(self, events: List[float]) -> tuple[float, List[float]]:
        now = self.clock()
        max_window = max(seconds for _key, seconds in WINDOWS)
        events = [stamp for stamp in events if now - stamp < max_window]

        waits: List[float] = []
        for key, seconds in WINDOWS:
            limit = self.limits.get(key)
            if not limit:
                continue
            in_window = [stamp for stamp in events if now - stamp < seconds]
            if len(in_window) >= int(limit):
                waits.append((min(in_window) + seconds + self.safety_seconds) - now)

        if waits:
            return max(0.001, max(waits)), events
        events.append(now)
        return 0.0, events

    def _read_events(self) -> List[float]:
        assert self.state_path is not None
        if not self.state_path.exists():
            return []
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        raw = data.get("requests", []) if isinstance(data, dict) else []
        return [float(item) for item in raw if isinstance(item, (int, float))]

    def _write_events(self, events: List[float]) -> None:
        assert self.state_path is not None
        payload = json.dumps({"requests": events}, separators=(",", ":"))
        tmp = self.state_path.with_suffix(self.state_path.suffix + f".{os.getpid()}.tmp")
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(self.state_path)