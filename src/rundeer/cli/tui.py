
from __future__ import annotations

import curses
import os
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from rundeer.core.batch import Job, JobEvent, JobState


STATE_ICON = {
    JobState.QUEUED: "·",
    JobState.UPLOADING: "↑",
    JobState.SUBMITTED: "»",
    JobState.POLLING: "◌",
    JobState.DOWNLOADING: "↓",
    JobState.DONE: "✓",
    JobState.FAILED: "✗",
    JobState.CANCELLED: "-",
}

Color = Tuple[int, int, int]

CRUSH_LOGO_GRADIENT_FROM: Color = (0xFF, 0x60, 0xFF)
CRUSH_LOGO_GRADIENT_TO: Color = (0x6B, 0x50, 0xFF)
GRADIENT_PAIR_START = 16


class PlainReporter:


    def __init__(self, title: str = "rundeer"):
        self.title = title
        self._lock = threading.Lock()

    def __enter__(self):
        print(f"=== {self.title} ===", flush=True)
        return self

    def __exit__(self, *a):
        return False

    def __call__(self, ev: JobEvent) -> None:
        with self._lock:
            icon = STATE_ICON.get(ev.state, "?")
            print(f"  [{ev.job_id:02d}] {icon} {ev.state.value:<12} {ev.message}", flush=True)

    def summary(self, jobs: List[Job], output_dir: Path) -> None:
        done = sum(1 for j in jobs if j.state == JobState.DONE)
        failed = sum(1 for j in jobs if j.state == JobState.FAILED)
        print(f"\nSummary: {done} done, {failed} failed / {len(jobs)} total")
        print(f"Output:  {output_dir}")
        for j in jobs:
            if j.state == JobState.FAILED:
                print(f"  FAIL [{j.id:02d}] {j.error}")


def _load_frames() -> List[str]:
    assets = Path(__file__).resolve().parent / "assets"
    names = ["logo_frame1.txt", "logo.txt", "logo_frame2.txt"]
    frames = []
    for name in names:
        p = assets / name
        if p.exists():
            frames.append(p.read_text(encoding="utf-8"))
    return frames or ["rundeer"]


class TuiReporter:


    FRAME_DELAY = 0.14

    def __init__(self, title: str, jobs: List[Job]):
        self.title = title
        self.jobs = jobs
        self.jobs_by_id: Dict[int, Job] = {j.id: j for j in jobs}
        self._log: List[str] = []
        self._log_lock = threading.Lock()
        self._stop = threading.Event()
        self._frames = _load_frames()
        self._frame_idx = 0
        self._stdscr = None
        self._anim_thread: Optional[threading.Thread] = None
        self._cancelled = False
        self._lock = threading.Lock()
        self._gradient_pair_cache: Dict[int, int] = {}
        self._next_gradient_pair = GRADIENT_PAIR_START

    def __enter__(self):
        os.environ.setdefault("TERM", "xterm-truecolor")
        self._stdscr = curses.initscr()
        curses.noecho()
        curses.cbreak()
        curses.curs_set(0)
        self._stdscr.nodelay(True)
        try:
            curses.start_color()
            curses.use_default_colors()
            curses.init_pair(1, curses.COLOR_GREEN, -1)
            curses.init_pair(2, curses.COLOR_RED, -1)
            curses.init_pair(3, curses.COLOR_YELLOW, -1)
            curses.init_pair(4, curses.COLOR_CYAN, -1)
            curses.init_pair(5, curses.COLOR_MAGENTA, -1)
            curses.init_pair(6, curses.COLOR_BLUE, -1)
        except Exception:
            pass
        self._anim_thread = threading.Thread(target=self._animate, daemon=True)
        self._anim_thread.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        if self._anim_thread:
            self._anim_thread.join(timeout=1.0)
        try:
            curses.nocbreak()
            if self._stdscr:
                self._stdscr.keypad(False)
            curses.echo()
            curses.curs_set(1)
            curses.endwin()
        except Exception:
            pass
        return False

    def _state_color(self, state: JobState) -> int:
        try:
            return {
                JobState.DONE: curses.color_pair(1),
                JobState.FAILED: curses.color_pair(2),
                JobState.POLLING: curses.color_pair(3),
                JobState.UPLOADING: curses.color_pair(4),
                JobState.DOWNLOADING: curses.color_pair(5),
                JobState.SUBMITTED: curses.color_pair(6),
            }.get(state, curses.A_DIM)
        except Exception:
            return 0

    def _animate(self) -> None:
        while not self._stop.is_set():
            try:
                self._draw()
            except Exception:
                pass

            try:
                ch = self._stdscr.getch()
                if ch in (ord("q"), ord("Q")):
                    self._cancelled = True
            except Exception:
                pass
            self._frame_idx = (self._frame_idx + 1) % max(1, len(self._frames))
            time.sleep(self.FRAME_DELAY)

    def _draw(self) -> None:
        with self._lock:
            if not self._stdscr:
                return
            h, w = self._stdscr.getmaxyx()
            self._stdscr.erase()


            frame = self._frames[self._frame_idx % len(self._frames)]
            lines = frame.splitlines()
            for row_index, line in enumerate(lines[: max(0, h - 1)]):
                truncated = line[: max(0, w - 1)]
                self._add_gradient_line(row_index, truncated)
            header_h = min(len(lines), max(0, h - 1))

            title_row = header_h
            title = f" rundeer · {self.title} "
            try:
                self._stdscr.addnstr(title_row, 0, title, max(0, w - 1), curses.A_BOLD | curses.A_REVERSE)
            except curses.error:
                pass


            grid_top = title_row + 2
            done = sum(1 for j in self.jobs if j.state == JobState.DONE)
            failed = sum(1 for j in self.jobs if j.state == JobState.FAILED)
            active = len(self.jobs) - done - failed

            rows_available = max(0, h - grid_top - 6)
            for idx, job in enumerate(self.jobs[:rows_available]):
                icon = STATE_ICON.get(job.state, "?")
                elapsed = 0.0
                if job.started_at:
                    end = job.finished_at or time.time()
                    elapsed = end - job.started_at
                bar = self._progress_bar(job.state, 20)
                msg = (job.message or "")[: max(0, w - 60)]
                line = f" [{job.id:02d}] {icon} {job.state.value:<12} {elapsed:6.1f}s {bar}  {msg}"
                try:
                    self._stdscr.addnstr(grid_top + idx, 0, line, max(0, w - 1), self._state_color(job.state))
                except curses.error:
                    pass


            log_top = grid_top + min(rows_available, len(self.jobs)) + 1
            log_lines_avail = max(0, h - log_top - 2)
            with self._log_lock:
                tail = self._log[-log_lines_avail:]
            for i, line in enumerate(tail):
                try:
                    self._stdscr.addnstr(log_top + i, 0, line[: max(0, w - 1)], max(0, w - 1), curses.A_DIM)
                except curses.error:
                    pass


            footer_row = max(0, h - 1)
            cancel_hint = " (cancelling...)" if self._cancelled else ""
            footer = f" {done} done · {active} active · {failed} failed · {len(self.jobs)} total  [q to cancel]{cancel_hint} "
            try:
                self._stdscr.addnstr(footer_row, 0, footer, max(0, w - 1), curses.A_REVERSE)
            except curses.error:
                pass

            self._stdscr.refresh()

    def _progress_bar(self, state: JobState, width: int) -> str:
        terminal = {JobState.DONE, JobState.FAILED, JobState.CANCELLED}
        if state in terminal:
            fill = width if state == JobState.DONE else 0
            return "[" + ("#" * fill).ljust(width) + "]"

        pos = self._frame_idx % width
        body = [" "] * width
        body[pos] = "#"
        return "[" + "".join(body) + "]"

    def _add_gradient_line(self, row: int, line: str) -> None:
        if not line:
            return
        line_width = max(1, len(line) - 1)
        for column, character in enumerate(line):
            if character.isspace():
                continue
            ratio = column / line_width
            color = self._blend_color(CRUSH_LOGO_GRADIENT_FROM, CRUSH_LOGO_GRADIENT_TO, ratio)
            try:
                self._stdscr.addstr(row, column, character, self._gradient_attr(color))
            except curses.error:
                pass

    def _gradient_attr(self, color: Color) -> int:
        try:
            if not curses.has_colors():
                return curses.A_BOLD
            color_count = getattr(curses, "COLORS", 0)
            if color_count >= 256:
                color_index = self._rgb_to_ansi256(color)
            else:
                color_index = self._rgb_to_basic_color(color)
            pair_id = self._gradient_pair_cache.get(color_index)
            if pair_id is None:
                max_pairs = getattr(curses, "COLOR_PAIRS", 0)
                if self._next_gradient_pair >= max_pairs:
                    return curses.A_BOLD
                pair_id = self._next_gradient_pair
                curses.init_pair(pair_id, color_index, -1)
                self._gradient_pair_cache[color_index] = pair_id
                self._next_gradient_pair += 1
            return curses.color_pair(pair_id) | curses.A_BOLD
        except Exception:
            return curses.A_BOLD

    @staticmethod
    def _blend_color(start: Color, end: Color, ratio: float) -> Color:
        clamped = min(1.0, max(0.0, ratio))
        return tuple(
            round(start_value + (end_value - start_value) * clamped)
            for start_value, end_value in zip(start, end)
        )

    @staticmethod
    def _rgb_to_ansi256(color: Color) -> int:
        red, green, blue = color
        if red == green == blue:
            if red < 8:
                return 16
            if red > 248:
                return 231
            return 232 + round(((red - 8) / 247) * 24)
        levels = (0, 95, 135, 175, 215, 255)
        red_index = min(range(6), key=lambda level: abs(levels[level] - red))
        green_index = min(range(6), key=lambda level: abs(levels[level] - green))
        blue_index = min(range(6), key=lambda level: abs(levels[level] - blue))
        return 16 + (36 * red_index) + (6 * green_index) + blue_index

    @staticmethod
    def _rgb_to_basic_color(color: Color) -> int:
        palette = (
            (curses.COLOR_MAGENTA, (255, 0, 255)),
            (curses.COLOR_BLUE, (80, 80, 255)),
            (curses.COLOR_CYAN, (0, 255, 255)),
            (curses.COLOR_WHITE, (255, 255, 255)),
        )
        red, green, blue = color
        return min(
            palette,
            key=lambda item: (item[1][0] - red) ** 2 + (item[1][1] - green) ** 2 + (item[1][2] - blue) ** 2,
        )[0]

    def log(self, msg: str) -> None:
        with self._log_lock:
            self._log.append(msg)

    def __call__(self, ev: JobEvent) -> None:
        self.log(f"[{ev.job_id:02d}] {ev.state.value}: {ev.message}")

    def summary(self, jobs: List[Job], output_dir: Path) -> None:

        done = sum(1 for j in jobs if j.state == JobState.DONE)
        failed = sum(1 for j in jobs if j.state == JobState.FAILED)
        print(f"\nSummary: {done} done, {failed} failed / {len(jobs)} total")
        print(f"Output:  {output_dir}")
        for j in jobs:
            if j.state == JobState.FAILED:
                print(f"  FAIL [{j.id:02d}] {j.error}")

    @property
    def cancelled(self) -> bool:
        return self._cancelled


def pick_reporter(title: str, jobs: List[Job], no_tui: bool) -> object:
    if no_tui or not sys.stdout.isatty():
        return PlainReporter(title)
    try:
        return TuiReporter(title, jobs)
    except Exception:
        return PlainReporter(title)
