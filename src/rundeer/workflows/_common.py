
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from rundeer.core.api import GrokClient
from rundeer.core.batch import BatchRunner, Job, JobState, _HardError
from rundeer.core.media import (
    download_and_save_image,
    download_url,
    encode_image,
    make_image_grid,
    make_video_grid,
    has_ffmpeg,
)
from rundeer.core.config import (
    fill_prompt,
    load_prompt,
    parse_inputs,
    parse_references,
    resolve_references,
    resolve_style_dir,
)


STYLE_REF_SUFFIX = (
    " THE REFERENCE IMAGES ARE STRICTLY STYLE REFERENCES ONLY;"
    " IGNORE ALL ELEMENTS IN THE REFERENCE IMAGES EXCEPT THE ARTISTIC STYLE"
)

EDIT_ROLE_SUFFIX_SINGLE = (
    " Image 1 is the subject to edit; apply the prompt as a direct edit to it."
)

EDIT_ROLE_SUFFIX_MULTI = (
    " Image 1 is the subject to edit. Images 2..N are STYLE REFERENCES ONLY —"
    " ignore their content, match only their artistic style."
)

MERGE_SUFFIX = (
    " Combine the provided images into a single composition as described."
)


def resolve_output_dir(output_dir_arg: Optional[str], style_dir: Path) -> Path:
    if output_dir_arg:
        p = Path(output_dir_arg)
        return p if p.is_absolute() else Path.cwd() / p
    return style_dir / "outputs"


def prepare_style(style: str, subject: str, motion: Optional[str] = None) -> tuple[Path, str]:
    style_dir = resolve_style_dir(style)
    template = load_prompt(style_dir, style)
    prompt = fill_prompt(template, subject, motion)
    if not prompt or not prompt.strip():
        raise ValueError(
            "Resolved prompt is empty. Provide a subject (and/or a non-empty "
            f"style template at {style_dir / (style.lower() + '.md')})."
        )
    return style_dir, prompt


def encode_paths(
    paths: List[Path],
    aspect_ratio: str,
    pad: bool,
    quality: int,
    cache_dir: Optional[Path],
) -> List[str]:
    return [encode_image(p, aspect_ratio, pad=pad, quality=quality, cache_dir=cache_dir) for p in paths]
