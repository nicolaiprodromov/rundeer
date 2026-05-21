
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from rundeer.core.api import GrokClient
from rundeer.core.batch import BatchRunner, Job, JobState
from rundeer.core.config import resolve_references
from rundeer.core.media import download_url, make_video_grid, has_ffmpeg
from rundeer.workflows._common import (
    encode_paths,
    prepare_style,
    resolve_output_dir,
)


def build_jobs(
    *,
    style: str,
    subject: str,
    motion: Optional[str],
    inputs: Optional[List[Path]] = None,
    references: Optional[List[int]] = None,
    iterations: int,
    aspect_ratio: str,
    model: str,
    duration: int,
    resolution: str,
    start_frame: Optional[Path],
    pad_reference: bool,
    ref_quality: int,
    output_dir_arg: Optional[str],
    output_name: str,
    cache_dir: Optional[Path],
) -> Dict[str, Any]:
    style_dir, prompt = prepare_style(style, subject, motion)
    output_dir = resolve_output_dir(output_dir_arg, style_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    inputs = list(inputs or [])
    references = list(references or [])
    style_ref_paths = resolve_references(style_dir, references)
    all_ref_paths = inputs + style_ref_paths
    ref_uris = encode_paths(all_ref_paths, aspect_ratio, pad_reference, ref_quality, cache_dir)

    start_uri = None
    if start_frame:
        start_uri = encode_paths([Path(start_frame)], aspect_ratio, pad_reference, ref_quality, cache_dir)[0]

    jobs: List[Job] = []
    for i in range(1, iterations + 1):
        jobs.append(Job(
            id=i,
            kind="video",
            params={
                "prompt": prompt,
                "model": model,
                "duration": duration,
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
                "image": start_uri,
                "reference_images": ref_uris or None,
            },
            output_path=output_dir / f"{output_name}_{i:02d}.mp4",
        ))
    return {
        "jobs": jobs,
        "output_dir": output_dir,
        "prompt": prompt,
        "input_count": len(inputs),
        "ref_count": len(style_ref_paths),
        "has_start_frame": start_uri is not None,
    }


def make_worker(client: GrokClient):
    def worker(job: Job, progress):
        progress(JobState.SUBMITTED, "submitting video request")
        progress(JobState.POLLING, "awaiting generation")
        response = client.generate_video(
            prompt=job.params["prompt"],
            model=job.params["model"],
            duration=job.params["duration"],
            aspect_ratio=job.params["aspect_ratio"],
            resolution=job.params["resolution"],
            image=job.params.get("image"),
            reference_images=job.params.get("reference_images"),
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
    if grid and any(j.state == JobState.DONE for j in jobs):
        if has_ffmpeg():
            opts = grid_options or {}
            grid_path = make_video_grid(
                plan["output_dir"], output_name, len(jobs),
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
