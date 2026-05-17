"""rundeer - batch-first CLI for the Grok Imagine API.

Usage:
    rundeer [--help] [--version] [--config=<path>] <command> [<args>...]
    rundeer image    [options]
    rundeer video    [options]
    rundeer edit     [options]
    rundeer extend   [options]
    rundeer merge    [options]
    rundeer batch    [options]
    rundeer web      [options]
    rundeer benchmark <type> [options]

Commands:
    image     Text-to-image generation (optionally with style references).
    video    Text-to-video or image-to-video generation.
    edit     Edit an existing image or video (--type=image|video).
    extend   Extend an existing video clip.
    merge    Multi-image composition (up to 5 input images).
    batch    Run a sequence of configs from a batch file.
    web      Start the local rundeer web console.
    benchmark Run a research benchmark (e.g. `benchmark position`).

Top-level options:
    --config=<path>   Path to a JSON config file (uses .rundeer/config.json in CWD
                      by default). May also be placed after the subcommand name.

Run `rundeer <command> --help` for command-specific options.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from docopt import docopt

from rundeer import __version__
from rundeer.core.api import GrokClient
from rundeer.scaffold.bootstrap import ensure_rundeer_dir
from rundeer.core.config import (
    load_project_env,
    load_config,
    parse_inputs,
    parse_references,
    resolve_config_path,
    resolve_subject,
)
from rundeer.cli.tui import PlainReporter, TuiReporter, pick_reporter


START_FRAME_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


COMMON_OPTS = """
Common options:
    -h --help                  Show help for this command.
    --config=<path>            Path to JSON config file.
    --style=<name>             Style folder name (e.g. Moebius). [default from config]
    --subject=<text>           Subject string. [default from config]
    --iterations=<n>           Number of items to generate. [default from config]
    --aspect-ratio=<ratio>     Aspect ratio (e.g. 1:1, 16:9, 9:16).
    --model=<name>             Model name. [default depends on command]
    --output-dir=<path>        Output directory.
    --output-name=<name>       Base output file name.
    --grid                     Build a grid from the batch.
    --no-grid                  Disable grid.
    --concurrency=<n>          Parallel workers.
    --no-tui                   Disable curses TUI; use plain output.
    --dry-run                  Print the resolved plan and exit without API calls.
    --verbose                  Verbose debug logging (prompts, params, paths).
"""

IMAGE_USAGE = """rundeer image - text-to-image batch.

Usage:
    image [options]

Options:
    --input=<paths>            Comma-separated image paths to use as references
                               (in addition to, or instead of, style-folder refs).
    --reference=<ids>          Comma-separated style-reference indices (max 5).
    --resolution=<r>           Output image resolution: 1k or 2k.
    --pad-reference            Enable reference aspect-ratio padding.
    --no-pad-reference         Disable reference aspect-ratio padding.
    --ref-quality=<q>          JPEG quality for references (1-100).
""" + COMMON_OPTS

VIDEO_USAGE = """rundeer video - text-to-video or image-to-video batch.

Usage:
    video [options]

Options:
    --motion=<text>            Motion/camera description (fills [motion] placeholder).
    --duration=<s>             Clip duration in seconds.
    --resolution=<r>           Resolution (480p|720p|1080p).
    --start-frame=<path>       Local image to use as exact first frame (image-to-video).
    --input=<paths>            Comma-separated image paths to use as style references
                               (in addition to, or instead of, style-folder refs).
    --reference=<ids>          Style/character reference indices (max 5).
    --pad-reference            Enable reference aspect-ratio padding.
    --no-pad-reference         Disable reference aspect-ratio padding.
    --ref-quality=<q>          JPEG quality for references (1-100).
""" + COMMON_OPTS

EDIT_USAGE = """rundeer edit - edit an image or video.

Usage:
    edit [options]

Options:
    --type=<kind>              image or video. [default: image]
    --input=<paths>            Comma-separated input image paths (1-5).
                               Falls back to the `input` field in the config.
    --motion=<text>            Motion description (video edits only).
    --duration=<s>             Video duration (video edits only).
    --resolution=<r>           Output resolution: 1k|2k (image) or 480p|720p|1080p (video).
    --reference=<ids>          Style reference indices (total with inputs <=5).
    --pad-reference            Enable aspect-ratio padding.
    --no-pad-reference         Disable aspect-ratio padding.
    --ref-quality=<q>          JPEG quality for images (1-100).
""" + COMMON_OPTS

EXTEND_USAGE = """rundeer extend - extend an existing video.

Usage:
    extend [options]

Options:
    --source=<url|path>        Video URL or local file to continue (required).
    --motion=<text>            Continuation motion description.
    --duration=<s>             Extension duration in seconds.
""" + COMMON_OPTS

MERGE_USAGE = """rundeer merge - multi-image composition.

Usage:
    merge [options]

Options:
    --input=<paths>            1-5 input images to compose. Falls back to the
                               `input` field in the config.
    --resolution=<r>           Output image resolution: 1k or 2k.
    --pad-reference            Enable aspect-ratio padding.
    --no-pad-reference         Disable aspect-ratio padding.
    --ref-quality=<q>          JPEG quality for inputs (1-100).
""" + COMMON_OPTS


def _tri_bool(args: Dict[str, Any], on: str, off: str, default: bool) -> bool:
    if args.get(on):
        return True
    if args.get(off):
        return False
    return default


def _resolve_common(args: Dict[str, Any], config: Dict[str, Any], *, video: bool = False) -> Dict[str, Any]:
    video_cfg = config.get("video", {}) if video else {}
    project_root = _project_root(config)

    def pick(key_cli: str, key_cfg: str, default: Any) -> Any:
        val = args.get(key_cli)
        if val is not None:
            return val
        # For video mode, the `video` sub-config takes precedence over top-level.
        if video and key_cfg in video_cfg:
            return video_cfg[key_cfg]
        return config.get(key_cfg, default)

    # Output dir resolution: CLI > config > <cwd>/.rundeer/outputs.
    # Relative values are resolved against CWD.
    raw_output = args.get("--output-dir") or (video_cfg.get("output_dir") if video else None) or config.get("output_dir")
    if raw_output:
        op = Path(raw_output)
        output_dir = str(op if op.is_absolute() else project_root / op)
    else:
        output_dir = str(project_root / ".rundeer" / "outputs")

    rate_limits = config.get("rate_limits") or {}

    out = {
        "style":        pick("--style", "style", "Moebius"),
        "subject":      resolve_subject(pick("--subject", "subject", "rundeer"), project_root),
        "iterations":   int(pick("--iterations", "iterations", 5)),
        "aspect_ratio": pick("--aspect-ratio", "aspect_ratio", "16:9" if video else "1:1"),
        "model":        pick("--model", "model", "grok-imagine-video" if video else "grok-imagine-image"),
        "output_dir":   output_dir,
        "output_name":  pick("--output-name", "output_name", "output"),
        "concurrency":  int(pick("--concurrency", "concurrency", 1 if video else 10) or (1 if video else 10)),
        "grid":         _tri_bool(args, "--grid", "--no-grid", config.get("grid", False)),
        "grid_options": config.get("grid_options") or {},
        "grid_only":    bool(config.get("grid_only", False)),
        "chain":        bool(config.get("chain", False)),
        "chain_compose":   bool(config.get("chain_compose", False)),
        "chain_threshold": int(config.get("chain_threshold", 12)),
        "chain_override":  int(config.get("chain_override", 50)),
        "chain_dilate":    int(config.get("chain_dilate", 6)),
        "chain_feather":   int(config.get("chain_feather", 8)),
        "chain_min_region": int(config.get("chain_min_region", 64)),
        "no_tui":       bool(args.get("--no-tui")),
        "dry_run":      bool(args.get("--dry-run")),
        "verbose":      bool(args.get("--verbose")),
        "project_root": str(project_root),
        "definitions":  config.get("definitions") or {},
        "rate_limits":  rate_limits,
    }
    if rate_limits.get("enabled") and rate_limits.get("per_second"):
        out["concurrency"] = max(1, min(out["concurrency"], int(rate_limits["per_second"])))
    if out["verbose"]:
        import os
        os.environ["RUNDEER_VERBOSE"] = "1"
    return out


def _print_plan(title: str, plan: Dict[str, Any], common: Dict[str, Any]) -> None:
    print(f"\n== {title} (dry-run) ==")
    print(f"Style:        {common['style']}")
    print(f"Subject:      {common['subject']}")
    print(f"Iterations:   {common['iterations']}")
    print(f"Aspect ratio: {common['aspect_ratio']}")
    print(f"Model:        {common['model']}")
    print(f"Output dir:   {plan['output_dir']}")
    print(f"Concurrency:  {common['concurrency']}")
    print(f"Grid:         {common['grid']}")
    defs = common.get("definitions") or {}
    if defs:
        print(f"Definitions:  {defs}")
        try:
            from rundeer.core.config import resolve_definitions
            jobs = plan.get("jobs", [])
            if jobs:
                sample = jobs[0].params.get("prompt")
                if isinstance(sample, str):
                    resolved = resolve_definitions(sample, defs, common.get("project_root"))
                    print(f"Sample prompt (resolved): {resolved}")
        except Exception as e:
            print(f"Definitions preview failed: {e}")
    jobs = plan["jobs"]
    print(f"Jobs: {len(jobs)}")
    for j in jobs[:5]:
        print(f"  [{j.id:02d}] -> {j.output_path}")
    if len(jobs) > 5:
        print(f"  ... (+{len(jobs) - 5} more)")


def _execute(title: str, plan: Dict[str, Any], common: Dict[str, Any], module, client: GrokClient) -> int:
    if common["dry_run"]:
        _print_plan(title, plan, common)
        if common.get("verbose"):
            import sys as _sys
            from rundeer.core.batch import _summarize_params
            print(f"\n[verbose] project_root: {common.get('project_root')}", file=_sys.stderr)
            for j in plan.get("jobs", [])[:3]:
                print(
                    f"[verbose] job {j.id} params: "
                    f"{_summarize_params({k: v for k, v in j.params.items() if not k.startswith('_')})}",
                    file=_sys.stderr,
                )
        return 0

    # Attach definition substitution context to each job so the BatchRunner
    # can resolve "@name" references in the prompt at execution time. Each
    # job pops these from its params, so workers never see them.
    defs = common.get("definitions") or {}
    if defs:
        for j in plan.get("jobs", []):
            j.params["_definitions"] = defs
            j.params["_project_root"] = common.get("project_root")

    if common.get("verbose"):
        import sys as _sys
        from rundeer.core.batch import _summarize_params
        print(f"[verbose] definitions: {defs}", file=_sys.stderr)
        print(f"[verbose] project_root: {common.get('project_root')}", file=_sys.stderr)
        print(f"[verbose] {len(plan.get('jobs', []))} jobs queued", file=_sys.stderr)
        for j in plan.get("jobs", [])[:3]:
            print(
                f"[verbose] job {j.id} unresolved params: "
                f"{_summarize_params({k: v for k, v in j.params.items() if not k.startswith('_')})}",
                file=_sys.stderr,
            )

    rate_text = _format_rate_limits(common.get("rate_limits") or {})
    if rate_text:
        print(f"Rate limit: {rate_text}")

    reporter = pick_reporter(title, plan["jobs"], common["no_tui"])
    with reporter:
        result = module.run(
            client=client,
            plan=plan,
            concurrency=common["concurrency"],
            reporter=reporter,
            grid=common["grid"],
            grid_options=common.get("grid_options") or {},
            grid_only=common.get("grid_only", False),
            output_name=common["output_name"],
        )
    reporter.summary(result["jobs"], result["output_dir"])
    if result.get("grid"):
        print(f"Grid:    {result['grid']}")
    failed = sum(1 for j in result["jobs"] if j.state.value == "failed")
    return 0 if failed == 0 else 1


def _load_cfg(args: Dict[str, Any]) -> Dict[str, Any]:
    project_root = Path.cwd()
    load_project_env(project_root)
    cfg_path = resolve_config_path(args.get("--config"))
    cfg = load_config(cfg_path)
    # Project root is always the current working directory (where .rundeer/ lives).
    cfg["__project_root__"] = str(project_root)
    return cfg


def _project_root(cfg: Dict[str, Any]) -> Path:
    return Path(cfg.get("__project_root__", str(Path.cwd())))


def _format_rate_limits(rate_limits: Dict[str, Any]) -> str:
    if not rate_limits.get("enabled"):
        return ""
    labels = (
        ("per_second", "/s"),
        ("per_minute", "/min"),
        ("per_hour", "/hour"),
        ("per_day", "/day"),
    )
    parts = [f"{int(rate_limits[key])}{suffix}" for key, suffix in labels if rate_limits.get(key)]
    return ", ".join(parts)


def _make_client(common: Dict[str, Any]) -> GrokClient:
    root = Path(common["project_root"])
    return GrokClient(
        rate_limits=common.get("rate_limits") or {},
        rate_limit_state_path=root / ".rundeer" / "rate_limits.json",
    )


def _make_client_for_config(cfg: Dict[str, Any]) -> GrokClient:
    root = _project_root(cfg)
    return GrokClient(
        rate_limits=cfg.get("rate_limits") or {},
        rate_limit_state_path=root / ".rundeer" / "rate_limits.json",
    )


def cmd_image(argv: List[str]) -> int:
    args = docopt(IMAGE_USAGE, argv=argv)
    cfg = _load_cfg(args)
    common = _resolve_common(args, cfg, video=False)

    from rundeer.workflows import image_gen
    cache_dir = Path(common["project_root"]) / ".rundeer" / "cache"

    inputs = parse_inputs(args.get("--input"), cfg)
    references = parse_references(args.get("--reference"), cfg)
    resolution = args.get("--resolution") or cfg.get("image_resolution") or None
    pad_ref = _tri_bool(args, "--pad-reference", "--no-pad-reference", cfg.get("pad_reference", True))
    ref_quality = int(args.get("--ref-quality") or cfg.get("ref_quality", 85))

    plan = image_gen.build_jobs(
        style=common["style"], subject=common["subject"],
        inputs=inputs, references=references, iterations=common["iterations"],
        aspect_ratio=common["aspect_ratio"], model=common["model"],
        resolution=resolution,
        pad_reference=pad_ref, ref_quality=ref_quality,
        output_dir_arg=common["output_dir"], output_name=common["output_name"],
        cache_dir=cache_dir,
    )
    client = _make_client(common) if not common["dry_run"] else None
    return _execute("image", plan, common, image_gen, client)


def cmd_video(argv: List[str]) -> int:
    args = docopt(VIDEO_USAGE, argv=argv)
    cfg = _load_cfg(args)
    common = _resolve_common(args, cfg, video=True)

    from rundeer.workflows import video_gen
    cache_dir = Path(common["project_root"]) / ".rundeer" / "cache"

    inputs = parse_inputs(args.get("--input"), cfg)
    references = parse_references(args.get("--reference"), cfg)
    pad_ref = _tri_bool(args, "--pad-reference", "--no-pad-reference", cfg.get("pad_reference", True))
    ref_quality = int(args.get("--ref-quality") or cfg.get("ref_quality", 85))
    video_cfg = cfg.get("video", {})
    duration = int(args.get("--duration") or video_cfg.get("duration", 6))
    resolution = args.get("--resolution") or video_cfg.get("resolution", "720p")
    motion = args.get("--motion") or cfg.get("motion")
    start_frame = args.get("--start-frame")
    if start_frame:
        sf = Path(start_frame).expanduser()
        if not sf.exists():
            print(f"error: start frame not found: {sf}", file=sys.stderr)
            return 2
        if sf.suffix.lower() not in START_FRAME_IMAGE_EXTS:
            allowed = ", ".join(sorted(START_FRAME_IMAGE_EXTS))
            print(f"error: --start-frame must be an image file ({allowed}); got: {sf}", file=sys.stderr)
            return 2
        start_frame = sf
        # xAI video API forbids combining image_url with reference_image_urls.
        if references or inputs:
            print(
                "note: ignoring style references and --input because --start-frame was provided "
                "(xAI video API: image-to-video and reference-to-video are mutually exclusive)",
                file=sys.stderr,
            )
            references = []
            inputs = []

    plan = video_gen.build_jobs(
        style=common["style"], subject=common["subject"], motion=motion,
        inputs=inputs, references=references, iterations=common["iterations"],
        aspect_ratio=common["aspect_ratio"], model=common["model"],
        duration=duration, resolution=resolution,
        start_frame=start_frame,
        pad_reference=pad_ref, ref_quality=ref_quality,
        output_dir_arg=common["output_dir"], output_name=common["output_name"],
        cache_dir=cache_dir,
    )
    client = _make_client(common) if not common["dry_run"] else None
    return _execute("video", plan, common, video_gen, client)


def cmd_edit(argv: List[str]) -> int:
    args = docopt(EDIT_USAGE, argv=argv)
    cfg = _load_cfg(args)
    type_ = args.get("--type") or "image"
    common = _resolve_common(args, cfg, video=(type_ == "video"))

    from rundeer.workflows import edit as edit_mod
    cache_dir = Path(common["project_root"]) / ".rundeer" / "cache"

    inputs = parse_inputs(args.get("--input"), cfg)
    references = parse_references(args.get("--reference"), cfg)
    pad_ref = _tri_bool(args, "--pad-reference", "--no-pad-reference", cfg.get("pad_reference", True))
    ref_quality = int(args.get("--ref-quality") or cfg.get("ref_quality", 85))
    video_cfg = cfg.get("video", {})
    duration = int(args.get("--duration") or video_cfg.get("duration", 6))
    motion = args.get("--motion") or cfg.get("motion")

    raw_resolution = args.get("--resolution") or cfg.get("resolution")
    if type_ == "image":
        image_resolution = raw_resolution or cfg.get("image_resolution") or None
        video_resolution = video_cfg.get("resolution", "720p")
    else:
        image_resolution = None
        video_resolution = raw_resolution or video_cfg.get("resolution", "720p")

    plan = edit_mod.build_jobs(
        type_=type_,
        style=common["style"], subject=common["subject"], motion=motion,
        inputs=inputs, references=references,
        iterations=common["iterations"],
        aspect_ratio=common["aspect_ratio"],
        model=args.get("--model"),
        image_resolution=image_resolution,
        duration=duration, resolution=video_resolution,
        pad_reference=pad_ref, ref_quality=ref_quality,
        output_dir_arg=common["output_dir"], output_name=common["output_name"],
        cache_dir=cache_dir,
        chain=common["chain"],
        chain_compose=common["chain_compose"],
        chain_threshold=common["chain_threshold"],
        chain_override=common["chain_override"],
        chain_dilate=common["chain_dilate"],
        chain_feather=common["chain_feather"],
        chain_min_region=common["chain_min_region"],
    )
    if common["chain"] and common["concurrency"] != 1:
        # Chained edits feed each iteration's output into the next, so they
        # must run sequentially.
        common["concurrency"] = 1
    client = _make_client(common) if not common["dry_run"] else None
    return _execute(f"edit/{type_}", plan, common, edit_mod, client)


def cmd_extend(argv: List[str]) -> int:
    args = docopt(EXTEND_USAGE, argv=argv)
    cfg = _load_cfg(args)
    common = _resolve_common(args, cfg, video=True)

    from rundeer.workflows import extend as extend_mod
    video_cfg = cfg.get("video", {})
    duration = int(args.get("--duration") or video_cfg.get("duration", 6))
    motion = args.get("--motion") or cfg.get("motion")
    source = args.get("--source")
    if not source:
        print("error: --source is required", file=sys.stderr)
        return 2

    plan = extend_mod.build_jobs(
        style=common["style"], subject=common["subject"], motion=motion,
        source=source, iterations=common["iterations"],
        model=common["model"], duration=duration,
        output_dir_arg=common["output_dir"], output_name=common["output_name"],
    )
    client = _make_client(common) if not common["dry_run"] else None
    return _execute("extend", plan, common, extend_mod, client)


def cmd_merge(argv: List[str]) -> int:
    args = docopt(MERGE_USAGE, argv=argv)
    cfg = _load_cfg(args)
    common = _resolve_common(args, cfg, video=False)

    from rundeer.workflows import merge as merge_mod
    cache_dir = Path(common["project_root"]) / ".rundeer" / "cache"

    inputs = parse_inputs(args.get("--input"), cfg)
    resolution = args.get("--resolution") or cfg.get("image_resolution") or None
    pad_ref = _tri_bool(args, "--pad-reference", "--no-pad-reference", cfg.get("pad_reference", True))
    ref_quality = int(args.get("--ref-quality") or cfg.get("ref_quality", 85))

    plan = merge_mod.build_jobs(
        style=common["style"], subject=common["subject"],
        inputs=inputs, iterations=common["iterations"],
        aspect_ratio=common["aspect_ratio"], model=common["model"],
        resolution=resolution,
        pad_reference=pad_ref, ref_quality=ref_quality,
        output_dir_arg=common["output_dir"], output_name=common["output_name"],
        cache_dir=cache_dir,
    )
    client = _make_client(common) if not common["dry_run"] else None
    return _execute("merge", plan, common, merge_mod, client)


BENCHMARK_USAGE = """rundeer benchmark - research benchmarks for image models.

Usage:
    benchmark <type> [options]

Benchmark types:
    position    Score how accurately the model places a shape at a known
                pixel position on a white background (SSIM vs ground truth).

Options:
    -h --help                  Show this help.
    --config=<path>            Path to JSON config file (rundeer config).
    --benchmark-config=<path>  Path to benchmark.json (default: .rundeer/benchmark.json in CWD).
    --template=<path>          Override prompt template path.
    --dry-run                  Render references and print prompts; no API calls.
    --no-tui                   Disable TUI (no-op; benchmark always uses plain output).
"""


def cmd_benchmark(argv: List[str]) -> int:
    args = docopt(BENCHMARK_USAGE, argv=argv)
    btype = args.get("<type>")
    if btype != "position":
        print(f"error: unknown benchmark type: {btype!r} (supported: position)", file=sys.stderr)
        return 2

    cfg = _load_cfg(args)
    project_root = _project_root(cfg)

    bench_path_arg = args.get("--benchmark-config")
    if bench_path_arg:
        bp = Path(bench_path_arg)
        if not bp.is_absolute():
            bp = Path.cwd() / bp
    else:
        bp = project_root / ".rundeer" / "benchmark.json"
    if not bp.exists():
        print(f"error: benchmark config not found: {bp}", file=sys.stderr)
        print("hint: re-run rundeer once in this directory to bootstrap .rundeer/", file=sys.stderr)
        return 2

    try:
        benchmark_cfg = json.loads(bp.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"error: invalid benchmark.json: {e}", file=sys.stderr)
        return 2

    template_path_arg = args.get("--template")
    if template_path_arg:
        tp = Path(template_path_arg)
        if not tp.is_absolute():
            tp = Path.cwd() / tp
    else:
        tp = project_root / ".rundeer" / "benchmark" / "position" / "position.md"
    if not tp.exists():
        print(f"error: prompt template not found: {tp}", file=sys.stderr)
        return 2
    template = tp.read_text(encoding="utf-8")

    from rundeer.workflows import benchmark as bench_mod

    dry_run = bool(args.get("--dry-run"))
    client = None if dry_run else _make_client_for_config(cfg)
    return bench_mod.run_position_benchmark(
        project_root=project_root,
        config=cfg,
        benchmark_cfg=benchmark_cfg,
        template=template,
        client=client,
        dry_run=dry_run,
    )


BATCH_USAGE = """rundeer batch - run a sequence of configs from a batch file.

Usage:
    batch [options]

Options:
    -h --help                Show this help.
    --batch-file=<path>      Path to batch JSON file (default: .rundeer/batch.json in CWD).
    --no-tui                 Disable curses TUI; use plain output.
    --dry-run                Print each plan without making API calls.
"""


WEB_USAGE = """rundeer web - local browser console.

Usage:
    web [options]

Options:
    -h --help            Show this help.
    --host=<host>        Host interface. [default: 127.0.0.1]
    --port=<port>        Port to bind. Use 0 for a free port. [default: 8787]
    --open               Open the console in the default browser.
    --agent-port=<port>  WebSocket port for the chat agent. [default: 0]
    --no-agent           Disable the in-browser agent chat.
"""


def _argv_has_option(argv: List[str], name: str) -> bool:
    return any(item == name or item.startswith(f"{name}=") for item in argv)


def _env_int(name: str) -> Optional[int]:
    raw = os.environ.get(name)
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def cmd_web(argv: List[str]) -> int:
    args = docopt(WEB_USAGE, argv=argv)
    from rundeer.web.server import serve

    project_root = Path.cwd()
    load_project_env(project_root)

    port = int(args.get("--port") or 8787)
    if not _argv_has_option(argv, "--port"):
        port = _env_int("PORT") or port

    agent_port_raw = args.get("--agent-port")
    try:
        agent_port = int(agent_port_raw) if agent_port_raw not in (None, "", "0") else None
    except (TypeError, ValueError):
        agent_port = None
    if agent_port is None and not _argv_has_option(argv, "--agent-port"):
        agent_port = _env_int("AGENT_PORT")

    return serve(
        host=args.get("--host") or "127.0.0.1",
        port=port,
        project_root=project_root,
        open_browser=bool(args.get("--open")),
        enable_agent=not bool(args.get("--no-agent")),
        agent_port=agent_port,
    )


def cmd_batch(argv: List[str]) -> int:
    args = docopt(BATCH_USAGE, argv=argv)
    batch_file_arg = args.get("--batch-file")

    if batch_file_arg:
        batch_path = Path(batch_file_arg)
        if not batch_path.is_absolute():
            batch_path = Path.cwd() / batch_path
    else:
        batch_path = Path.cwd() / ".rundeer" / "batch.json"
        if not batch_path.exists():
            print("error: no batch file found (expected .rundeer/batch.json in CWD)", file=sys.stderr)
            return 2

    if not batch_path.exists():
        print(f"error: batch file not found: {batch_path}", file=sys.stderr)
        return 2

    batch_data = json.loads(batch_path.read_text(encoding="utf-8"))
    sleep_secs = float(batch_data.get("sleep", 0))
    entries = [e for e in batch_data.get("batch", []) if e]

    if not entries:
        print("batch: nothing to run (batch list is empty)")
        return 0

    # Project root is always CWD (where .rundeer/ lives).
    project_root = Path.cwd()

    total = len(entries)
    failed = 0

    for i, entry in enumerate(entries):
        if isinstance(entry, dict):
            config_path = entry.get("config", "")
            command = entry.get("command", "image")
        else:
            config_path = str(entry)
            command = "image"

        if not config_path:
            continue

        cp = Path(config_path)
        if not cp.is_absolute():
            cp = project_root / cp

        print(f"\n[batch {i + 1}/{total}] {command} --config={cp}")

        if command not in COMMANDS:
            print(f"error: unknown command '{command}' in batch entry {i + 1}", file=sys.stderr)
            failed += 1
            continue

        sub_argv = [f"--config={cp}"]
        if args.get("--no-tui"):
            sub_argv.append("--no-tui")
        if args.get("--dry-run"):
            sub_argv.append("--dry-run")

        try:
            rc = COMMANDS[command](sub_argv)
        except (FileNotFoundError, ValueError) as e:
            print(f"error: {e}", file=sys.stderr)
            rc = 1

        if rc != 0:
            failed += 1

        if i < total - 1 and sleep_secs > 0 and not args.get("--dry-run"):
            print(f"sleeping {sleep_secs:.0f}s...")
            time.sleep(sleep_secs)

    print(f"\nbatch done: {total - failed}/{total} succeeded")
    return 0 if failed == 0 else 1


COMMANDS = {
    "image": cmd_image,
    "video": cmd_video,
    "edit": cmd_edit,
    "extend": cmd_extend,
    "merge": cmd_merge,
    "batch": cmd_batch,
    "web": cmd_web,
    "benchmark": cmd_benchmark,
}


def _hoist_top_level_config(argv: List[str]) -> List[str]:
    """Extract leading --config / --verbose flags (before the subcommand) and
    move them after the subcommand so docopt on each command can see them.

    Recognizes:  --config=<path> | --config <path> | -c <path> | --verbose
    Unknown tokens before the subcommand are left in place; the first known
    command name stops the scan.
    """
    out: List[str] = []
    hoisted: List[str] = []
    i = 0
    saw_command = False
    while i < len(argv):
        tok = argv[i]
        if not saw_command and tok in COMMANDS:
            saw_command = True
            out.append(tok)
            i += 1
            continue
        if not saw_command and tok == "--verbose":
            hoisted.append(tok)
            i += 1
            continue
        if not saw_command and (tok == "--config" or tok == "-c"):
            if i + 1 >= len(argv):
                # let docopt raise a sensible error downstream
                out.append(tok)
                i += 1
                continue
            hoisted.extend(["--config", argv[i + 1]])
            i += 2
            continue
        if not saw_command and tok.startswith("--config="):
            hoisted.append(tok)
            i += 1
            continue
        out.append(tok)
        i += 1

    if not hoisted:
        return out
    # Insert hoisted flags right after the subcommand (if any), otherwise
    # leave them at the front so docopt reports a clean error.
    if saw_command:
        cmd_idx = next(i for i, t in enumerate(out) if t in COMMANDS)
        return out[: cmd_idx + 1] + hoisted + out[cmd_idx + 1 :]
    return hoisted + out


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    # Handle top-level --version / --help before docopt chokes on subcommand args
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] in ("-v", "--version"):
        print(f"rundeer {__version__}")
        return 0

    # Allow --config to appear *before* the subcommand:
    #   rundeer --config path/to/cfg.json image ...
    # Pull it out and forward it to the subcommand parser.
    argv = _hoist_top_level_config(argv)

    # Auto-bootstrap .rundeer/ in CWD if it doesn't exist.
    try:
        if resolve_config_path(None) is None:
            ensure_rundeer_dir()
    except Exception as e:
        print(f"warning: could not create .rundeer/: {e}", file=sys.stderr)

    cmd = argv[0]
    rest = argv[1:]
    if cmd not in COMMANDS:
        print(f"unknown command: {cmd}\n\n{__doc__}", file=sys.stderr)
        return 2
    try:
        return COMMANDS[cmd](rest)
    except (FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
