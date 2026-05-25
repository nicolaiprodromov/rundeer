from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict

from rundeer.core import paths as rpaths
from web.backends._helpers import IMAGE_COMPRESS_EXTS, VIDEO_COMPRESS_EXTS, relpath, safe_project_path


def blur_image(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    rel = str(payload.get("path") or "").strip()
    if not rel:
        raise ValueError("path is required")
    try:
        radius = float(payload.get("radius") if payload.get("radius") is not None else 4)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"radius must be a number: {exc}") from exc
    if radius < 0:
        radius = 0.0
    radius = min(radius, 500.0)

    src = safe_project_path(root, rel)
    if not src.is_file():
        raise FileNotFoundError(rel)

    ext = src.suffix.lower()
    if ext in VIDEO_COMPRESS_EXTS:
        return _blur_video(root, src, radius)
    if ext not in IMAGE_COMPRESS_EXTS:
        raise ValueError(f"unsupported media extension: {ext or '(none)'}")
    return _blur_image(root, src, radius)


def _blur_image(root: Path, src: Path, radius: float) -> Dict[str, Any]:
    from PIL import Image, ImageFilter

    ext = src.suffix.lower()
    cache_dir = rpaths.cache_dir(root, "blurred")
    cache_dir.mkdir(parents=True, exist_ok=True)

    r_tag = f"{radius:.2f}".rstrip("0").rstrip(".") or "0"
    r_tag = r_tag.replace(".", "p")

    out_ext = ext if ext in (".png", ".jpg", ".jpeg", ".webp") else ".png"
    dest = cache_dir / f"{src.stem}_blur{r_tag}{out_ext}"

    with Image.open(src) as im:
        im.load()
        if im.mode in ("P", "LA"):
            im = im.convert("RGBA")
        blurred = im.filter(ImageFilter.GaussianBlur(radius=radius))
        save_kwargs: Dict[str, Any] = {}
        if out_ext in (".jpg", ".jpeg"):
            if blurred.mode in ("RGBA", "LA"):
                blurred = blurred.convert("RGB")
            save_kwargs = {"quality": 95, "optimize": True, "progressive": True}
            fmt = "JPEG"
        elif out_ext == ".webp":
            save_kwargs = {"quality": 95, "method": 6}
            fmt = "WEBP"
        else:
            save_kwargs = {"optimize": True}
            fmt = "PNG"
        blurred.save(dest, format=fmt, **save_kwargs)

    return {
        "path": relpath(root, dest),
        "bytes": dest.stat().st_size,
        "radius": radius,
    }


def _blur_video(root: Path, src: Path, radius: float) -> Dict[str, Any]:
    if shutil.which("ffmpeg") is None:
        return {"error": "ffmpeg not found on PATH; install ffmpeg to blur videos"}

    cache_dir = rpaths.cache_dir(root, "blurred")
    cache_dir.mkdir(parents=True, exist_ok=True)

    r_tag = f"{radius:.2f}".rstrip("0").rstrip(".") or "0"
    r_tag = r_tag.replace(".", "p")
    dest = cache_dir / f"{src.stem}_blur{r_tag}.mp4"

    sigma = max(0.0, radius)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src),
        "-vf", f"gblur=sigma={sigma}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(dest),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        return {"error": f"ffmpeg invocation failed: {exc}"}
    if proc.returncode != 0:
        return {"error": f"ffmpeg failed: {(proc.stderr or '').strip()[:400]}"}

    return {
        "path": relpath(root, dest),
        "bytes": dest.stat().st_size,
        "radius": radius,
    }
