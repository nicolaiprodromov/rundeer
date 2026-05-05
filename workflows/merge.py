"""Multi-image merge/compose workflow (images only)."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from rundeer.core.api import GrokClient
from rundeer.core.batch import BatchRunner, Job, JobState
from rundeer.core.media import download_and_save_image, make_image_grid
from rundeer.workflows._common import (
    MERGE_SUFFIX,
    encode_paths,
    prepare_style,
    resolve_output_dir,
)


def build_jobs(
    *,
    style: str,
    subject: str,
    inputs: List[Path],
    iterations: int,
    aspect_ratio: str,
    model: str,
    resolution: Optional[str] = None,
    pad_reference: bool,
    ref_quality: int,
    output_dir_arg: Optional[str],
    output_name: str,
    cache_dir: Optional[Path],
) -> Dict[str, Any]:
    if not inputs:
        raise ValueError("merge requires --input with at least one image")
    if len(inputs) > 5:
        raise ValueError(f"merge supports up to 5 images (got {len(inputs)})")

    style_dir, prompt = prepare_style(style, subject)
    output_dir = resolve_output_dir(output_dir_arg, style_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    uris = encode_paths(inputs, aspect_ratio, pad_reference, ref_quality, cache_dir)
    full_prompt = prompt + MERGE_SUFFIX

    jobs: List[Job] = []
    for i in range(1, iterations + 1):
        jobs.append(Job(
            id=i, kind="image",
            params={
                "prompt": full_prompt,
                "model": model,
                "aspect_ratio": aspect_ratio,
                "image_urls": uris,
                "resolution": resolution or None,
            },
            output_path=output_dir / f"{output_name}_{i:02d}.png",
        ))
    return {"jobs": jobs, "output_dir": output_dir, "input_count": len(inputs)}


def make_worker(client: GrokClient):
    def worker(job: Job, progress):
        progress(JobState.SUBMITTED, "calling merge API")
        responses = client.generate_image(
            prompt=job.params["prompt"],
            model=job.params["model"],
            n=1,
            aspect_ratio=job.params["aspect_ratio"],
            image_urls=job.params["image_urls"],
            resolution=job.params.get("resolution"),
        )
        if not responses:
            raise RuntimeError("empty response")
        url = responses[0].url
        job.result_url = url
        progress(JobState.DOWNLOADING, "saving png")
        download_and_save_image(url, job.output_path)
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
        opts = grid_options or {}
        grid_path = make_image_grid(
            plan["output_dir"], output_name, len(jobs),
            rows=opts.get("rows"), cols=opts.get("columns"),
            padding=int(opts.get("padding", 0)),
            bg_color=opts.get("bg_color", "#000000"),
        )
        if grid_only and grid_path:
            for j in jobs:
                if j.state == JobState.DONE:
                    try:
                        Path(j.output_path).unlink()
                    except FileNotFoundError:
                        pass
    return {"jobs": jobs, "grid": grid_path, "output_dir": plan["output_dir"]}
