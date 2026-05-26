from __future__ import annotations

import shutil
import subprocess
import time
import zipfile
from pathlib import Path
from typing import Any, Dict

from rundeer.core import paths as rpaths
from web.nodes._shared.helpers import IMAGE_COMPRESS_EXTS, VIDEO_COMPRESS_EXTS, relpath, safe_project_path


def compress_image(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    from PIL import Image

    rel = str(payload.get("path") or "").strip()
    if not rel:
        raise ValueError("path is required")
    quality = int(payload.get("quality") or 75)
    quality = max(1, min(100, quality))
    max_dim = payload.get("max_dimension")
    max_dim = int(max_dim) if max_dim else 0

    src = safe_project_path(root, rel)
    if not src.is_file():
        raise FileNotFoundError(rel)

    cache_dir = rpaths.cache_dir(root, "compressed")
    cache_dir.mkdir(parents=True, exist_ok=True)

    suffix = ".jpg" if quality < 95 else src.suffix.lower()
    if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        suffix = ".jpg"
    dest_name = f"{src.stem}_q{quality}{('_' + str(max_dim)) if max_dim else ''}{suffix}"
    dest = cache_dir / dest_name

    original_bytes = src.stat().st_size

    with Image.open(src) as im:
        im.load()
        if max_dim and (im.width > max_dim or im.height > max_dim):
            im.thumbnail((max_dim, max_dim), Image.LANCZOS)
        save_kwargs: Dict[str, Any] = {}
        if suffix in (".jpg", ".jpeg"):
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGB")
            save_kwargs = {"quality": quality, "optimize": True, "progressive": True}
            fmt = "JPEG"
        elif suffix == ".webp":
            save_kwargs = {"quality": quality, "method": 6}
            fmt = "WEBP"
        else:
            save_kwargs = {"optimize": True}
            fmt = "PNG"
        im.save(dest, format=fmt, **save_kwargs)

    return {
        "path": relpath(root, dest),
        "bytes": dest.stat().st_size,
        "originalBytes": original_bytes,
    }


def compress_dispatch(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    kind = str(payload.get("kind") or "auto").strip().lower()
    if kind == "bundle":
        return _compress_bundle(root, payload)
    rel = str(payload.get("path") or "").strip()
    if not rel:
        raise ValueError("path is required")
    ext = Path(rel).suffix.lower()
    if kind == "auto":
        if ext in IMAGE_COMPRESS_EXTS:
            return compress_image(root, payload)
        if ext in VIDEO_COMPRESS_EXTS:
            return _compress_video(root, payload)
        return compress_image(root, payload)
    if kind == "image":
        return compress_image(root, payload)
    if kind == "video":
        return _compress_video(root, payload)
    raise ValueError(f"unknown compress kind: {kind}")


def _compress_video(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    if shutil.which("ffmpeg") is None:
        return {"error": "ffmpeg not found on PATH; install ffmpeg to compress videos"}
    rel = str(payload.get("path") or "").strip()
    src = safe_project_path(root, rel)
    if not src.is_file():
        raise FileNotFoundError(rel)
    quality = int(payload.get("quality") or 75)
    quality = max(1, min(100, quality))

    crf = int(round(51 - (quality / 100.0) * 33))
    max_dim = int(payload.get("max_dimension") or 0)

    cache_dir = rpaths.cache_dir(root, "compressed")
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest_name = f"{src.stem}_q{quality}{('_' + str(max_dim)) if max_dim else ''}.mp4"
    dest = cache_dir / dest_name

    original_bytes = src.stat().st_size
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src),
        "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
    ]
    if max_dim:
        cmd[-1:-1] = ["-vf", f"scale='if(gt(iw,ih),min({max_dim},iw),-2)':'if(gt(iw,ih),-2,min({max_dim},ih))'"]
    cmd.append(str(dest))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        return {"error": f"ffmpeg invocation failed: {exc}"}
    if proc.returncode != 0:
        return {"error": f"ffmpeg failed: {(proc.stderr or '').strip()[:400]}"}
    return {
        "path": relpath(root, dest),
        "bytes": dest.stat().st_size,
        "originalBytes": original_bytes,
    }


def _compress_bundle(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    paths = payload.get("paths") or []
    if not isinstance(paths, list) or not paths:
        raise ValueError("paths is required (non-empty list)")
    out_dir_rel = str(payload.get("output_dir") or ".rundeer/data/cache/compressed").strip()
    out_dir = safe_project_path(root, out_dir_rel) if out_dir_rel else rpaths.cache_dir(root, "compressed")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = str(payload.get("name") or f"bundle_{stamp}.zip").strip()
    if not name.lower().endswith(".zip"):
        name += ".zip"
    dest = out_dir / name
    total_in = 0
    seen: set[str] = set()
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for rel in paths:
            rel_s = str(rel or "").strip()
            if not rel_s:
                continue
            src = safe_project_path(root, rel_s)
            if not src.is_file():
                continue
            arc_base = Path(rel_s).name
            arc = arc_base
            i = 1
            while arc in seen:
                arc = f"{Path(arc_base).stem}_{i}{Path(arc_base).suffix}"
                i += 1
            seen.add(arc)
            total_in += src.stat().st_size
            zf.write(src, arcname=arc)
    return {
        "path": relpath(root, dest),
        "bytes": dest.stat().st_size,
        "originalBytes": total_in,
        "items": len(seen),
    }
