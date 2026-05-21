







from __future__ import annotations

import os
import signal
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, List, Tuple



_GRADIENT_FROM = (0xFF, 0x60, 0xFF)
_GRADIENT_TO = (0x6B, 0x50, 0xFF)

_RESET = "\x1b[0m"
_BOLD = "\x1b[1m"
_DIM = "\x1b[2m"

_LOGO_DIR = Path(__file__).resolve().parent.parent / "cli" / "assets"
_LOGO_FILES = ("logo.txt",)


def _supports_ansi() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    return sys.stdout.isatty()


def _blend(start: Tuple[int, int, int], end: Tuple[int, int, int], ratio: float) -> Tuple[int, int, int]:
    r = round(start[0] + (end[0] - start[0]) * ratio)
    g = round(start[1] + (end[1] - start[1]) * ratio)
    b = round(start[2] + (end[2] - start[2]) * ratio)
    return r, g, b


def _gradient_line(line: str, *, fancy: bool) -> str:
    if not fancy or not line.strip():
        return line
    width = max(1, len(line) - 1)
    out: List[str] = []
    for i, ch in enumerate(line):
        if ch == " ":
            out.append(ch)
            continue
        ratio = i / width
        r, g, b = _blend(_GRADIENT_FROM, _GRADIENT_TO, ratio)
        out.append(f"\x1b[38;2;{r};{g};{b}m{ch}")
    out.append(_RESET)
    return "".join(out)


def _load_logo() -> List[str]:
    for name in _LOGO_FILES:
        path = _LOGO_DIR / name
        if path.exists():
            return [ln.rstrip() for ln in path.read_text(encoding="utf-8").splitlines()]
    return ["rundeer"]


_print_lock = threading.Lock()


def _now() -> str:
    return datetime.now().strftime("%H:%M:%S")


def log_line(text: str, *, dim: bool = False) -> None:

    fancy = _supports_ansi()
    stamp = _now()
    if fancy and dim:
        line = f"{_DIM}[{stamp}] {text}{_RESET}"
    elif fancy:
        line = f"{_DIM}[{stamp}]{_RESET} {text}"
    else:
        line = f"[{stamp}] {text}"
    with _print_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def print_banner(*, url: str, project_root: Path) -> None:
    fancy = _supports_ansi()
    logo = _load_logo()
    with _print_lock:
        sys.stdout.write("\n")
        for line in logo:
            sys.stdout.write(_gradient_line(line, fancy=fancy) + "\n")
        sys.stdout.write("\n")
        title = "=== rundeer · web ==="
        sys.stdout.write((f"{_BOLD}{title}{_RESET}\n" if fancy else title + "\n"))
        sys.stdout.write(f"  listening on  {url}\n")
        sys.stdout.write(f"  project       {project_root}\n")
        sys.stdout.write("  ctrl-c to stop\n\n")
        sys.stdout.flush()


def run_console(*, url: str, project_root: Path, server: Any) -> None:






    print_banner(url=url, project_root=project_root)

    stop = threading.Event()

    def _handle_sigint(signum, frame):
        stop.set()

    previous = signal.signal(signal.SIGINT, _handle_sigint)
    try:
        while not stop.is_set():
            stop.wait(timeout=1.0)
    finally:
        signal.signal(signal.SIGINT, previous)
        with _print_lock:
            sys.stdout.write("\nrundeer web: stopped.\n")
            sys.stdout.flush()
