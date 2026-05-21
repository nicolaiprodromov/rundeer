
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Dict, List, Optional

from rundeer.core.api import GrokClient
from rundeer.core.batch import BatchRunner, Job, JobState
from rundeer.core.media import download_url, make_video_grid, has_ffmpeg
from rundeer.workflows._common import prepare_style, resolve_output_dir


def _source_to_api_value(source: str) -> str:

    p = Path(source)
    if p.exists():
        raw = p.read_bytes()
        return "data:video/mp4;base64," + base64.b64encode(raw).decode("utf-8")
    return source


def build_jobs(
    *,
    style: str,
    subject: str,
    motion: Optional[str],
    source: str,
    iterations: int,
    model: str,
    duration: int,
    output_dir_arg: Optional[str],
    output_name: str,
) -> Dict[str, Any]:
    if not source:
        raise ValueError("extend requires --source")
    style_dir, prompt = prepare_style(style, subject, motion)
    output_dir = resolve_output_dir(output_dir_arg, style_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    source_val = _source_to_api_value(source)

    jobs: List[Job] = []
    for i in range(1, iterations + 1):
        jobs.append(Job(
            id=i, kind="video",
            params={
                "prompt": prompt,
                "model": model,
                "duration": duration,
                "source": source_val,
            },
            output_path=output_dir / f"{output_name}_ext_{i:02d}.mp4",
        ))
    return {"jobs": jobs, "output_dir": output_dir, "prompt": prompt}


def make_worker(client: GrokClient):
    def worker(job: Job, progress):
        progress(JobState.SUBMITTED, "submitting extend")
        progress(JobState.POLLING, "awaiting generation")
        response = client.extend_video(
            prompt=job.params["prompt"],
            source=job.params["source"],
            model=job.params["model"],
            duration=job.params["duration"],
        )
        url = getattr(response, "url", None)
        if not url:
            raise RuntimeError("no video url in response")
        job.result_url = url
        progress(JobState.DOWNLOADING, "downloading mp4")
        download_url(url, job.output_path)
    return worker


def run(
    *,
    client: GrokClient,
    plan: Dict[str, Any],
    concurrency: int,
    reporter,
    grid: bool,
    grid_options: Optional[Dict[str, Any]] = None,
    grid_only: bool = False,
    output_name: str,
) -> Dict[str, Any]:
    jobs = plan["jobs"]
    runner = BatchRunner(jobs, make_worker(client), concurrency=concurrency, reporter=reporter)
    runner.run()

    grid_path = None
    if grid and has_ffmpeg() and any(j.state == JobState.DONE for j in jobs):
        opts = grid_options or {}
        grid_path = make_video_grid(
            plan["output_dir"], f"{output_name}_ext", len(jobs),
            rows=opts.get("rows"), cols=opts.get("columns"),
        )
        if grid_only and grid_path:
            for j in jobs:
                if j.state == JobState.DONE:
                    try:
                        Path(j.output_path).unlink()
                    except FileNotFoundError:
                        pass
    return {"jobs": jobs, "grid": grid_path, "output_dir": plan["output_dir"]}
