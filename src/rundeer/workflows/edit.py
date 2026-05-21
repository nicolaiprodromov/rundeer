
from __future__ import annotations

import base64
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from rundeer.core.api import GrokClient
from rundeer.core.batch import BatchRunner, Job, JobState
from rundeer.core.config import resolve_references
from rundeer.core.media import download_and_save_image, download_url, make_image_grid, make_video_grid, has_ffmpeg
from rundeer.core.media import encode_image
from rundeer.workflows._common import (
    EDIT_ROLE_SUFFIX_MULTI,
    EDIT_ROLE_SUFFIX_SINGLE,
    encode_paths,
    prepare_style,
    resolve_output_dir,
)
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}


def _is_video_path(p: Path) -> bool:
    return p.suffix.lower() in VIDEO_EXTS


def _video_path_to_data_uri(p: Path) -> str:
    raw = p.read_bytes()
    return "data:video/mp4;base64," + base64.b64encode(raw).decode("utf-8")


def build_jobs(
    *,
    type_: str,
    style: str,
    subject: str,
    motion: Optional[str],
    inputs: List[Path],
    references: List[int],
    iterations: int,
    aspect_ratio: str,
    model: Optional[str],
    image_resolution: Optional[str] = None,
    duration: int,
    resolution: str,
    pad_reference: bool,
    ref_quality: int,
    output_dir_arg: Optional[str],
    output_name: str,
    cache_dir: Optional[Path],
    chain: bool = False,
    chain_compose: bool = False,
    chain_threshold: int = 12,
    chain_override: int = 50,
    chain_dilate: int = 6,
    chain_feather: int = 8,
    chain_min_region: int = 64,
) -> Dict[str, Any]:
    if not inputs:
        raise ValueError("edit requires at least one --input image")

    style_dir, prompt = prepare_style(style, subject, motion)
    output_dir = resolve_output_dir(output_dir_arg, style_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    ref_paths = resolve_references(style_dir, references)




    video_edit = type_ == "video" and any(_is_video_path(p) for p in inputs)
    if video_edit:
        if len(inputs) != 1:
            raise ValueError("edit --type=video with a video input requires exactly one --input file")
        if not _is_video_path(inputs[0]):
            raise ValueError("edit --type=video input must be an .mp4 (or .mov/.m4v/.webm)")
        if ref_paths:
            print(
                "note: ignoring style references for video editing "
                "(xAI video API: edit-video cannot be combined with reference images)",
                file=sys.stderr,
            )
            ref_paths = []
        video_uri = _video_path_to_data_uri(inputs[0])
        input_uris: List[str] = []
        ref_uris: List[str] = []
    else:
        total = len(inputs) + len(ref_paths)
        if total > 5:
            raise ValueError(f"edit total images ({total}) exceeds Grok 5-image cap; reduce inputs or references")

        input_uris = encode_paths(inputs, aspect_ratio, pad_reference, ref_quality, cache_dir)
        ref_uris = encode_paths(ref_paths, aspect_ratio, pad_reference, ref_quality, cache_dir)
        video_uri = None

    jobs: List[Job] = []

    if type_ == "image":
        model = model or "grok-imagine-image"
        all_uris = input_uris + ref_uris
        if len(input_uris) == 1 and not ref_uris:
            suffix = EDIT_ROLE_SUFFIX_SINGLE
        elif ref_uris:
            suffix = EDIT_ROLE_SUFFIX_MULTI
        else:
            suffix = ""
        full_prompt = prompt + suffix

        for i in range(1, iterations + 1):
            jobs.append(Job(
                id=i, kind="image",
                params={
                    "prompt": full_prompt,
                    "model": model,
                    "aspect_ratio": aspect_ratio,
                    "image_urls": all_uris,
                    "resolution": image_resolution or None,
                },
                output_path=output_dir / f"{output_name}_{i:02d}.png",
            ))
    elif type_ == "video":
        model = model or "grok-imagine-video"
        if video_edit:


            for i in range(1, iterations + 1):
                jobs.append(Job(
                    id=i, kind="video",
                    params={
                        "prompt": prompt,
                        "model": model,
                        "video_url": video_uri,
                    },
                    output_path=output_dir / f"{output_name}_{i:02d}.mp4",
                ))
        else:

            start_uri = input_uris[0]
            extra_refs = input_uris[1:] + ref_uris
            for i in range(1, iterations + 1):
                jobs.append(Job(
                    id=i, kind="video",
                    params={
                        "prompt": prompt,
                        "model": model,
                        "duration": duration,
                        "aspect_ratio": aspect_ratio,
                        "resolution": resolution,
                        "image": start_uri,
                        "reference_images": extra_refs or None,
                    },
                    output_path=output_dir / f"{output_name}_{i:02d}.mp4",
                ))
    else:
        raise ValueError(f"unknown edit type: {type_}")

    return {
        "jobs": jobs,
        "output_dir": output_dir,
        "input_count": len(inputs),
        "ref_count": len(ref_paths),
        "type": type_,
        "chain": bool(chain),

        "chain_ctx": {
            "aspect_ratio": aspect_ratio,
            "pad_reference": pad_reference,
            "ref_quality": ref_quality,
            "cache_dir": cache_dir,
            "video_edit": bool(video_edit),
            "ref_uris": list(ref_uris),
            "original_input": Path(inputs[0]) if inputs else None,
            "compose": bool(chain_compose) and type_ == "image",
            "compose_threshold": int(chain_threshold),
            "compose_override": int(chain_override),
            "compose_dilate": int(chain_dilate),
            "compose_feather": int(chain_feather),
            "compose_min_region": int(chain_min_region),
        },
    }


def make_worker(client: GrokClient, type_: str):
    if type_ == "image":
        def worker(job: Job, progress):
            progress(JobState.SUBMITTED, "calling edit API")
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

    def worker(job: Job, progress):
        progress(JobState.SUBMITTED, "submitting video edit")
        progress(JobState.POLLING, "awaiting generation")
        if job.params.get("video_url"):
            response = client.generate_video(
                prompt=job.params["prompt"],
                model=job.params["model"],
                video_url=job.params["video_url"],
            )
        else:
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


def _run_chained(client: GrokClient, plan: Dict[str, Any], reporter) -> None:







    jobs = plan["jobs"]
    ctx = plan.get("chain_ctx", {}) or {}
    base_worker = make_worker(client, plan["type"])
    is_video_edit = bool(ctx.get("video_edit"))
    aspect_ratio = ctx.get("aspect_ratio", "1:1")
    pad = bool(ctx.get("pad_reference", True))
    quality = int(ctx.get("ref_quality", 85))
    cache_dir = ctx.get("cache_dir")
    ref_uris = list(ctx.get("ref_uris") or [])
    compose = bool(ctx.get("compose"))
    compose_threshold = int(ctx.get("compose_threshold", 12))
    compose_override = int(ctx.get("compose_override", 50))
    compose_dilate = int(ctx.get("compose_dilate", 6))
    compose_feather = int(ctx.get("compose_feather", 8))
    compose_min_region = int(ctx.get("compose_min_region", 64))
    original_input: Optional[Path] = ctx.get("original_input")

    if compose:


        from rundeer.core.diff_compose import composite_edit
    else:
        composite_edit = None





    frozen_state: Dict[str, Any] = {"mask": None}

    def chained_worker(job: Job, progress) -> None:



        idx = jobs.index(job)
        if idx > 0:
            prev = jobs[idx - 1]
            prev_path = Path(prev.output_path)
            if plan["type"] == "image":
                new_uri = encode_image(prev_path, aspect_ratio,
                                       pad=pad, quality=quality, cache_dir=cache_dir)
                job.params["image_urls"] = [new_uri] + ref_uris
            elif is_video_edit:
                job.params["video_url"] = _video_path_to_data_uri(prev_path)
            else:




                new_uri = encode_image(prev_path, aspect_ratio,
                                       pad=pad, quality=quality, cache_dir=cache_dir)
                job.params["image"] = new_uri
        base_worker(job, progress)




        if compose and composite_edit is not None and plan["type"] == "image":
            raw_path = Path(job.output_path)
            if idx == 0:
                prev_compose = original_input
            else:
                prev_compose = Path(jobs[idx - 1].output_path)
            if prev_compose is not None and prev_compose.exists() and raw_path.exists():
                progress(JobState.DOWNLOADING, "diff-composing")
                tmp = raw_path.with_suffix(".tmp.png")
                try:
                    raw_path.replace(tmp)
                    info = composite_edit(
                        prev_compose, tmp, raw_path,
                        threshold=compose_threshold,
                        override_threshold=compose_override,
                        dilate=compose_dilate,
                        feather=compose_feather,
                        min_region_area=compose_min_region,
                        frozen_mask=frozen_state["mask"],
                    )
                    frozen_state["mask"] = info.get("frozen_mask")
                except Exception:
                    if tmp.exists() and not raw_path.exists():
                        tmp.replace(raw_path)
                    raise
                finally:
                    tmp.unlink(missing_ok=True)

    runner = BatchRunner(jobs, chained_worker, concurrency=1, reporter=reporter)
    runner.run()


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
    if plan.get("chain"):
        _run_chained(client, plan, reporter)
    else:
        runner = BatchRunner(jobs, make_worker(client, plan["type"]), concurrency=concurrency, reporter=reporter)
        runner.run()

    grid_path = None
    if grid and any(j.state == JobState.DONE for j in jobs):
        opts = grid_options or {}
        if plan["type"] == "image":
            grid_path = make_image_grid(
                plan["output_dir"], output_name, len(jobs),
                rows=opts.get("rows"), cols=opts.get("columns"),
                padding=int(opts.get("padding", 0)),
                bg_color=opts.get("bg_color", "#000000"),
            )
        elif has_ffmpeg():
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
