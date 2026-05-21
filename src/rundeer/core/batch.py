
from __future__ import annotations

import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


def _verbose() -> bool:
    return os.environ.get("RUNDEER_VERBOSE") == "1"


def _vlog(msg: str) -> None:
    if _verbose():
        print(f"[verbose] {msg}", file=sys.stderr, flush=True)


def _summarize_params(params: Dict[str, Any], max_str: int = 400) -> Dict[str, Any]:


    out: Dict[str, Any] = {}
    for k, v in params.items():
        if isinstance(v, str):
            if v.startswith("data:") or len(v) > max_str:
                out[k] = f"<{len(v)} chars: {v[:60]}...>"
            else:
                out[k] = v
        elif isinstance(v, list):
            shortened: List[Any] = []
            for item in v:
                if isinstance(item, str) and (item.startswith("data:") or len(item) > max_str):
                    shortened.append(f"<{len(item)} chars: {item[:40]}...>")
                else:
                    shortened.append(item)
            out[k] = shortened
        else:
            out[k] = v
    return out


class JobState(str, Enum):
    QUEUED = "queued"
    UPLOADING = "uploading"
    SUBMITTED = "submitted"
    POLLING = "polling"
    DOWNLOADING = "downloading"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class Job:
    id: int
    kind: str
    params: Dict[str, Any]
    output_path: Path
    state: JobState = JobState.QUEUED
    message: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0
    error: Optional[str] = None
    result_url: Optional[str] = None


@dataclass
class JobEvent:
    job_id: int
    state: JobState
    message: str = ""
    timestamp: float = field(default_factory=time.time)


Reporter = Callable[[JobEvent], None]


class BatchRunner:
    def __init__(
        self,
        jobs: List[Job],
        worker: Callable[[Job, Callable[[JobState, str], None]], None],
        concurrency: int = 1,
        reporter: Optional[Reporter] = None,
        max_retries: int = 2,
    ):
        self.jobs = jobs
        self.worker = worker
        self.concurrency = max(1, concurrency)
        self.reporter = reporter or (lambda ev: None)
        self.max_retries = max_retries
        self._cancel = threading.Event()
        self._lock = threading.Lock()

    def cancel(self) -> None:
        self._cancel.set()

    def is_cancelled(self) -> bool:
        return self._cancel.is_set()

    def _emit(self, job: Job, state: JobState, msg: str = "") -> None:
        with self._lock:
            job.state = state
            job.message = msg
        self.reporter(JobEvent(job.id, state, msg))

    def _run_job(self, job: Job) -> None:
        if self._cancel.is_set():
            self._emit(job, JobState.CANCELLED, "cancelled before start")
            return
        job.started_at = time.time()




        defs = job.params.pop("_definitions", None)
        proj_root = job.params.pop("_project_root", None)
        if defs:
            try:
                from rundeer.core.config import resolve_definitions
                for k in ("prompt",):
                    v = job.params.get(k)
                    if isinstance(v, str):
                        before = v
                        job.params[k] = resolve_definitions(v, defs, proj_root)
                        if _verbose() and job.params[k] != before:
                            _vlog(
                                f"job {job.id}: resolved @-refs in {k!r}\n"
                                f"  before: {before}\n"
                                f"  after:  {job.params[k]}"
                            )
            except Exception as e:
                self._emit(job, JobState.FAILED, f"definition error: {e}")
                job.error = str(e)
                job.finished_at = time.time()
                return

        if _verbose():
            _vlog(f"job {job.id} params: {_summarize_params(job.params)}")

        def progress(state: JobState, msg: str = "") -> None:
            self._emit(job, state, msg)

        attempt = 0
        while True:
            try:
                self.worker(job, progress)
                job.finished_at = time.time()
                self._emit(job, JobState.DONE, f"{job.output_path.name}")
                return
            except _HardError as e:
                job.finished_at = time.time()
                job.error = str(e)
                self._emit(job, JobState.FAILED, str(e))
                return
            except Exception as e:
                attempt += 1
                if attempt > self.max_retries:
                    job.finished_at = time.time()
                    job.error = str(e)
                    self._emit(job, JobState.FAILED, str(e))
                    return
                backoff = 2 ** attempt
                self._emit(job, JobState.QUEUED, f"retry {attempt}/{self.max_retries} in {backoff}s: {e}")
                time.sleep(backoff)

    def run(self) -> List[Job]:
        with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
            futures = [pool.submit(self._run_job, j) for j in self.jobs]
            for f in futures:
                f.result()
        return self.jobs


class _HardError(Exception):
    pass


def hard_fail(msg: str) -> _HardError:
    return _HardError(msg)
