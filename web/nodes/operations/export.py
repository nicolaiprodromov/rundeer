from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict

from rundeer.core import paths as rpaths
from rundeer.core.paths import atomic_pil, atomic_wb
from web.nodes._shared.helpers import relpath, safe_project_path

IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def export_node(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    mode = str(payload.get("mode") or "").strip().lower()
    if mode == "text":
        return _exp_text(root, payload)
    if mode == "file":
        return _exp_file(root, payload)
    if mode == "files":
        return _exp_files(root, payload)
    if mode == "sequence":
        return _exp_seq(root, payload)
    raise ValueError(f"unknown export mode: {mode or '(none)'}")


def _dest(root: Path, name: Any) -> Path:
    rel = str(name or "").strip()
    if not rel:
        raise ValueError("name is required")
    out = safe_project_path(root, rpaths.default_output_dir(root).joinpath(rel).as_posix())
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def _crf(payload: Dict[str, Any]) -> int:
    try:
        c = int(payload.get("crf") if payload.get("crf") is not None else 18)
    except (TypeError, ValueError):
        c = 18
    return max(0, min(51, c))


def _exp_text(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    txt = str(payload.get("text") or "")
    dest = _dest(root, payload.get("name"))
    if not dest.suffix:
        dest = dest.with_suffix(".txt")
    atomic_wb(dest, txt.encode("utf-8"))
    return {"path": relpath(root, dest), "bytes": dest.stat().st_size}


def _exp_file(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    rel = str(payload.get("path") or "").strip()
    if not rel:
        raise ValueError("path is required")
    src = safe_project_path(root, rel)
    if not src.is_file():
        raise FileNotFoundError(rel)
    dest = _dest(root, payload.get("name"))
    as_type = str(payload.get("asType") or "").strip().lower()
    if as_type == "video":
        return _save_video(root, src, dest, _crf(payload))
    return _save_image(root, src, dest)


def _exp_files(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("paths") or []
    if not isinstance(raw, list) or not raw:
        raise ValueError("paths is required (non-empty list)")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    stem = Path(name).stem
    ext = Path(name).suffix
    as_type = str(payload.get("asType") or "").strip().lower()
    crf = _crf(payload)
    out = []
    i = 0
    for rel in raw:
        rel_s = str(rel or "").strip()
        if not rel_s:
            continue
        src = safe_project_path(root, rel_s)
        if not src.is_file():
            continue
        dest = _dest(root, f"{stem}_{i:03d}{ext}")
        r = _save_video(root, src, dest, crf) if as_type == "video" else _save_image(root, src, dest)
        if isinstance(r, dict) and r.get("error"):
            return r
        out.append(r["path"])
        i += 1
    return {"paths": out, "count": len(out)}


def _exp_seq(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    if shutil.which("ffmpeg") is None:
        return {"error": "ffmpeg not found on PATH; install ffmpeg to assemble bundles"}
    from PIL import Image

    raw = payload.get("paths") or []
    if not isinstance(raw, list) or not raw:
        raise ValueError("paths is required (non-empty list)")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    fps = float(payload.get("fps") or 0)
    if fps <= 0:
        raise ValueError("fps must be > 0 for sequence export")
    fmt = str(payload.get("fmt") or "mp4").strip().lower()
    crf = _crf(payload)
    try:
        loop = int(payload.get("loop") or 0)
    except (TypeError, ValueError):
        loop = 0

    key = hashlib.sha1(("|".join(str(p) for p in raw) + "|" + name).encode("utf-8")).hexdigest()[:16]
    stage = rpaths.cache_dir(root, "export_stage", key)
    if stage.exists():
        shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True, exist_ok=True)

    n = 0
    for rel in raw:
        rel_s = str(rel or "").strip()
        if not rel_s:
            continue
        src = safe_project_path(root, rel_s)
        if not src.is_file():
            continue
        n += 1
        frame = stage / f"f_{n:06d}.png"
        if src.suffix.lower() == ".png":
            shutil.copyfile(src, frame)
        else:
            with Image.open(src) as im:
                im.load()
                if im.mode in ("P", "LA"):
                    im = im.convert("RGBA")
                im.save(frame, format="PNG")
    if n == 0:
        shutil.rmtree(stage, ignore_errors=True)
        raise ValueError("no valid frames to assemble")

    ext = ".mp4" if fmt == "mp4" else ".gif"
    dest = _dest(root, name).with_suffix(ext)
    pattern = str(stage / "f_%06d.png")
    if fmt == "mp4":
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", str(fps), "-i", pattern,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf),
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-movflags", "+faststart", str(dest),
        ]
    else:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", str(fps), "-i", pattern,
            "-vf", "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            "-loop", str(loop), str(dest),
        ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    shutil.rmtree(stage, ignore_errors=True)
    if proc.returncode != 0:
        return {"error": f"ffmpeg failed: {(proc.stderr or '').strip()[:400]}"}
    return {"path": relpath(root, dest), "bytes": dest.stat().st_size, "frames": n}


def _save_image(root: Path, src: Path, dest: Path) -> Dict[str, Any]:
    from PIL import Image

    ext = dest.suffix.lower()
    if ext not in IMG_EXTS:
        raise ValueError(f"unsupported image extension: {ext or '(none)'}")
    with Image.open(src) as im:
        im.load()
        if im.mode in ("P", "LA"):
            im = im.convert("RGBA")
        save_kwargs: Dict[str, Any] = {}
        if ext in (".jpg", ".jpeg"):
            if im.mode in ("RGBA", "LA"):
                im = im.convert("RGB")
            save_kwargs = {"quality": 95, "optimize": True, "progressive": True}
            fmt = "JPEG"
        elif ext == ".webp":
            save_kwargs = {"quality": 95, "method": 6}
            fmt = "WEBP"
        elif ext == ".gif":
            fmt = "GIF"
        else:
            save_kwargs = {"optimize": True}
            fmt = "PNG"
        atomic_pil(im, dest, format=fmt, **save_kwargs)
    return {"path": relpath(root, dest), "bytes": dest.stat().st_size}


def _save_video(root: Path, src: Path, dest: Path, crf: int) -> Dict[str, Any]:
    ext = dest.suffix.lower()
    if ext != ".mp4":
        raise ValueError("video export supports .mp4 only")
    if src.suffix.lower() == ".mp4":
        atomic_wb(dest, src.read_bytes())
        return {"path": relpath(root, dest), "bytes": dest.stat().st_size}
    if shutil.which("ffmpeg") is None:
        return {"error": "ffmpeg not found on PATH; install ffmpeg to export video"}
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf),
        "-movflags", "+faststart", str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        return {"error": f"ffmpeg failed: {(proc.stderr or '').strip()[:400]}"}
    return {"path": relpath(root, dest), "bytes": dest.stat().st_size}
