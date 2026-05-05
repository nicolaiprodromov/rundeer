"""Bootstrap ./.rundeer/ in CWD on first run. The .rundeer folder is always
expected in the current working directory (never in parent dirs)."""
from __future__ import annotations

import json
from pathlib import Path


DEFAULT_BENCHMARK = {
    "position": {
        "width": 1024,
        "height": 1024,
        "aspect_ratio": "1:1",
        "resolution": "1k",
        "model": "grok-imagine-image",
        "iterations": 1,
        "background": "#FFFFFF",
        "score_weights": {
            "ssim": 0.15,
            "position": 0.40,
            "size": 0.10,
            "iou": 0.25,
            "color": 0.10
        },
        "cases": [
            {
                "name": "black_square_center",
                "shape": {
                    "type": "rectangle",
                    "color": "#000000",
                    "size": [120, 120],
                    "position": [512, 512],
                },
            },
            {
                "name": "red_circle_top_left",
                "shape": {
                    "type": "circle",
                    "color": "#FF0000",
                    "size": 200,
                    "position": [256, 256],
                },
            },
            {
                "name": "blue_triangle_bottom_right",
                "shape": {
                    "type": "triangle",
                    "color": "#0000FF",
                    "size": 220,
                    "position": [768, 768],
                },
            },
            {
                "name": "three_corners",
                "shapes": [
                    {"type": "circle",    "color": "#FF0000", "size": 160, "position": [200, 200]},
                    {"type": "rectangle", "color": "#00AA00", "size": [180, 180], "position": [824, 200]},
                    {"type": "triangle",  "color": "#0000FF", "size": 200, "position": [512, 824]},
                ],
            },
        ],
        "_schema": {
            "width":          "Reference image width in pixels.",
            "height":         "Reference image height in pixels.",
            "aspect_ratio":   "Aspect ratio sent to the image API (e.g. 1:1, 16:9).",
            "resolution":     "Resolution sent to the image API (1k or 2k).",
            "model":          "Image model to benchmark.",
            "iterations":     "Generations per case (each scored independently).",
            "background":     "Default background hex (per-case override allowed).",
            "score_weights":  "Relative weights for ssim, position, size, iou, color (need not sum to 1).",
            "cases":          "List of {name, shape:{...} OR shapes:[{...}], [background]}.",
            "shape.type":     "rectangle | square | circle | ellipse | triangle.",
            "shape.color":    "Fill color as #RRGGBB hex.",
            "shape.size":     "int (square/circle diameter/triangle width) or [w,h].",
            "shape.position": "[cx, cy] center pivot in pixel coordinates.",
        },
    }
}


DEFAULT_POSITION_TEMPLATE = """\
Minimalist technical diagram. Pure flat {background_color_name} ({background_hex}) background filling the entire {width}x{height} canvas.

Exactly {shape_count} solid geometric shape(s), and nothing else:
{shapes_list}

Coordinate system: (0, 0) is the top-left corner; the x-axis grows rightward; the y-axis grows downward; the canvas is exactly {width} pixels wide and {height} pixels tall. The CENTER of each shape is its geometric centroid and must sit on the specified pixel coordinate.

Hard constraints:
- The image must be exactly {width} pixels wide and {height} pixels tall.
- The background must be 100% pure {background_color_name} ({background_hex}); every non-shape pixel must be exactly this color.
- Every shape must be solid, fully filled, with sharp crisp edges, no gradient, no shading, no outline, no glow, no shadow.
- Each shape's center (centroid) must be placed precisely at the pixel coordinate given for that shape.
- No text, no labels, no rulers, no grid, no axes, no reflections, no borders, no frame, no watermark, and no other shapes beyond those listed above.
- Style: clean vector graphic, like an SVG diagram exported as PNG.
"""


DEFAULT_CONFIG = {
    "style": "Moebius",
    "subject": "rundeer",
    "motion": None,

    "input": None,

    "output": {
        "dir": ".rundeer/outputs",
        "name": "output"
    },

    "batch": {
        "iterations": 5,
        "concurrency": None,
        "grid": False
    },

    "references": {
        "ids": [],
        "pad": True,
        "quality": 85
    },

    "image": {
        "model": "grok-imagine-image",
        "aspect_ratio": "1:1"
    },

    "video": {
        "model": "grok-imagine-video",
        "aspect_ratio": "16:9",
        "duration": 6,
        "resolution": "720p",
        "concurrency": 1,
        "output_dir": None
    },

    "rate_limits": {
        "enabled": False,
        "per_second": None,
        "per_minute": None,
        "per_hour": None,
        "per_day": None
    },

    "web": {
        "artifact_view": "grid",
        "artifact_size": "md",
        "dock_expanded": False,
        "output_open_on_run": True,
        "output_panel_open": True,
        "files_panel_open": True,
        "artifacts_panel_open": True
    },

    "_schema": {
        "style":             "Folder name under rundeer/brain/ (e.g. 'Moebius', 'Goya').",
        "subject":           "Subject text; fills [subject] in the style prompt.",
        "motion":            "Motion/camera description; fills [motion] (video/extend only). null = unset.",
        "input":             "Default input path(s) for edit/merge. Comma- or space-separated; null = unset.",
        "output.dir":        "Output directory. Relative paths resolve against CWD (where .rundeer/ lives).",
        "output.name":       "Base filename; outputs become <name>_01.png, <name>_02.png, ...",
        "batch.iterations":  "Number of images/videos to generate per run.",
        "batch.concurrency": "Parallel workers (null = default: 10 image, 1 video).",
        "batch.grid":        "Assemble a grid of all outputs (images always; videos require ffmpeg).",
        "references.ids":    "Style reference indices from brain/<style>/Reference/ (max 5). Ignored for video when --start-frame is set.",
        "references.pad":    "Pad references to the target aspect ratio (true/false).",
        "references.quality":"JPEG quality for encoded references (1-100).",
        "image.model":       "Image model: grok-imagine-image or grok-imagine-image-pro.",
        "image.aspect_ratio":"Image aspect: 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 9:19.5, 19.5:9, 9:20, 20:9, 1:2, 2:1.",
        "video.model":       "Video model: grok-imagine-video.",
        "video.aspect_ratio":"Video aspect ratio (same choices as image).",
        "video.duration":    "Seconds (1-15).",
        "video.resolution":  "480p or 720p.",
        "video.concurrency": "Video-specific parallel workers override.",
        "video.output_dir":  "Video-specific output dir override; null = inherit output.dir.",
        "rate_limits.enabled":    "Enable API request rate limiting.",
        "rate_limits.per_second": "Maximum API requests per second. null/0 = unlimited.",
        "rate_limits.per_minute": "Maximum API requests per minute. null/0 = unlimited.",
        "rate_limits.per_hour":   "Maximum API requests per hour. null/0 = unlimited.",
        "rate_limits.per_day":    "Maximum API requests per day. null/0 = unlimited.",
        "web.artifact_view":      "Default web artifact browser view: grid or tree.",
        "web.artifact_size":      "Default artifact tile size: sm, md, or lg.",
        "web.dock_expanded":      "Open the artifact dock in expanded mode by default.",
        "web.output_open_on_run": "Expand Output when a web run starts.",
        "web.output_panel_open":  "Show the Output section on web load.",
        "web.files_panel_open":   "Show the Files section on web load.",
        "web.artifacts_panel_open":"Show the Artifacts section on web load.",
        "__cli_only__":      "Runtime-only flags: --config <path>, --start-frame <path> (image-to-video), --source <url|path> (extend), --input <paths> (edit/merge, 1-5), --dry-run, --no-tui."
    }
}


def skill_template_path() -> Path:
    return Path(__file__).resolve().parent / "skill_template" / "SKILL.md"


def ensure_rundeer_dir(cwd: Path | None = None) -> Path:
    """Create ./.rundeer/ (with config, skill, outputs, logs, cache) in CWD.
    Idempotent. Always creates in current working directory."""
    cwd = cwd or Path.cwd()
    root = cwd / ".rundeer"
    (root / "skill").mkdir(parents=True, exist_ok=True)
    (root / "outputs").mkdir(parents=True, exist_ok=True)
    (root / "logs").mkdir(parents=True, exist_ok=True)
    (root / "cache").mkdir(parents=True, exist_ok=True)
    (root / "benchmark" / "position").mkdir(parents=True, exist_ok=True)
    (root / "logs" / "benchmark" / "position").mkdir(parents=True, exist_ok=True)

    config_file = root / "config.json"
    if not config_file.exists():
        config_file.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")

    benchmark_file = root / "benchmark.json"
    if not benchmark_file.exists():
        benchmark_file.write_text(json.dumps(DEFAULT_BENCHMARK, indent=2), encoding="utf-8")

    position_template = root / "benchmark" / "position" / "position.md"
    if not position_template.exists():
        position_template.write_text(DEFAULT_POSITION_TEMPLATE, encoding="utf-8")

    skill_target = root / "skill" / "SKILL.md"
    if not skill_target.exists():
        src = skill_template_path()
        if src.exists():
            skill_target.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

    return root
