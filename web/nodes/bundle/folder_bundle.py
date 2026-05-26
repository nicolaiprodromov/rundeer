from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from rundeer.core import paths as rpaths
from web.nodes._shared.helpers import IMAGE_EXTS, is_sensitive_file, relpath, safe_project_path


VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
ANIMATED_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".gif", ".webp", ".apng"}
SKIP_DIRS = {
    ".crush",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".vscode",
    "__pycache__",
    "node_modules",
    "target",
}
ALLOWED_DOTFILE_ROOTS = {".rundeer"}


def list_folder(root: Path, query: Dict[str, List[str]]) -> Dict[str, Any]:
    rel = (query.get("path") or [""])[0]
    kind = (query.get("kind") or ["all"])[0]
    recursive = (query.get("recursive") or ["0"])[0] in {"1", "true", "yes"}
    if not rel:
        return {"paths": [], "error": "no path"}
    try:
        target = safe_project_path(root, rel)
    except PermissionError as exc:
        return {"paths": [], "error": str(exc)}
    if not target.exists():
        return {"paths": [], "error": f"path not found: {rel}"}

    if target.is_file() and target.suffix.lower() in ANIMATED_EXTS:
        try:
            fps = float((query.get("fps") or [""])[0] or 0) or None
        except ValueError:
            fps = None
        try:
            modulo = int((query.get("modulo") or [""])[0] or 1)
        except ValueError:
            modulo = 1
        modulo = max(1, modulo)
        try:
            start = int((query.get("start") or [""])[0] or 0) or 0
        except ValueError:
            start = 0
        try:
            end = int((query.get("end") or [""])[0] or 0) or 0
        except ValueError:
            end = 0
        fmt = ((query.get("format") or ["png"])[0] or "png").lower()
        if fmt not in {"png", "jpg", "jpeg", "webp"}:
            fmt = "png"
        return extract_frames(
            root, target, fps=fps, start=start, end=end, fmt=fmt, modulo=modulo,
        )

    if not target.is_dir():
        return {"paths": [], "error": f"not a folder or supported animated file: {rel}"}
    folder = target
    out: List[str] = []
    if recursive:
        candidates = iter_files(folder, root)
    else:
        candidates = (p for p in sorted(folder.iterdir()) if p.is_file() and not skip_file(p, root))
    for path in candidates:
        suffix = path.suffix.lower()
        if kind == "image" and suffix not in IMAGE_EXTS:
            continue
        if kind == "video" and suffix not in VIDEO_EXTS:
            continue
        if kind == "media" and suffix not in IMAGE_EXTS | VIDEO_EXTS:
            continue
        out.append(relpath(root, path))
    out.sort(key=str.lower)

    try:
        start_i = int((query.get("start") or [""])[0] or 0) or 0
    except ValueError:
        start_i = 0
    try:
        end_i = int((query.get("end") or [""])[0] or 0) or 0
    except ValueError:
        end_i = 0
    lo = max(0, start_i - 1) if start_i > 0 else 0
    hi = end_i if end_i > 0 else len(out)
    if lo or hi != len(out):
        out = out[lo:hi]
    try:
        modulo_i = int((query.get("modulo") or [""])[0] or 1)
    except ValueError:
        modulo_i = 1
    modulo_i = max(1, modulo_i)
    if modulo_i > 1:
        out = [path for idx, path in enumerate(out) if idx % modulo_i == 0]
    return {"paths": out, "count": len(out), "source": "folder"}


def extract_frames(
    root: Path,
    video: Path,
    *,
    fps: Optional[float],
    start: int,
    end: int,
    fmt: str,
    modulo: int = 1,
) -> Dict[str, Any]:
    if shutil.which("ffmpeg") is None:
        return {"paths": [], "error": "ffmpeg not found on PATH; install ffmpeg to extract frames"}

    try:
        stat = video.stat()
    except OSError as exc:
        return {"paths": [], "error": f"stat failed: {exc}"}
    import hashlib
    modulo = max(1, int(modulo or 1))
    key_src = f"{video.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{fps}|{start}|{end}|{fmt}|{modulo}"
    key = hashlib.sha1(key_src.encode("utf-8")).hexdigest()[:16]
    cache_root = rpaths.cache_dir(root, "frames")
    out_dir = cache_root / f"{video.stem}-{key}"
    manifest = out_dir / "frames.json"

    if manifest.exists():
        try:
            data = json.loads(manifest.read_text())
            paths = data.get("paths") or []
            if paths and all((root / p).exists() for p in paths):
                return {"paths": paths, "count": len(paths), "source": "frames", "cached": True}
        except Exception:
            pass

    out_dir.mkdir(parents=True, exist_ok=True)

    for child in out_dir.iterdir():
        try:
            child.unlink()
        except OSError:
            pass

    pattern = out_dir / f"frame_%06d.{fmt}"

    start_idx = max(1, start) if start > 0 else 1
    end_idx = end if (end and end >= start_idx) else 0
    count = ((end_idx - start_idx) // modulo + 1) if end_idx > 0 else 0

    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video)]
    vf: List[str] = []
    if fps and fps > 0:
        vf.append(f"fps={fps}")
    select_terms: List[str] = []
    start_zero = start_idx - 1
    if start_idx > 1:
        select_terms.append(f"gte(n\\,{start_zero})")
    if end_idx > 0:
        select_terms.append(f"lte(n\\,{end_idx - 1})")
    if modulo > 1:
        select_terms.append(f"eq(mod(n-{start_zero}\\,{modulo})\\,0)")
    if select_terms:
        select_expr = "*".join(select_terms)
        vf.append(f"select='{select_expr}'")
        vf.append("setpts=N/FRAME_RATE/TB")
    if vf:
        cmd += ["-vf", ",".join(vf), "-vsync", "vfr"]
    if count > 0:
        cmd += ["-frames:v", str(count)]
    if fmt in {"jpg", "jpeg"}:
        cmd += ["-q:v", "2"]
    cmd += [str(pattern)]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", "replace") if exc.stderr else ""
        return {"paths": [], "error": f"ffmpeg failed: {stderr.strip() or exc}"}

    frames = sorted(p for p in out_dir.iterdir() if p.is_file() and p.suffix.lower().lstrip(".") in {"png", "jpg", "jpeg", "webp"})
    paths = [relpath(root, p) for p in frames]
    try:
        manifest.write_text(json.dumps({"paths": paths, "source": str(video)}, indent=2))
    except OSError:
        pass
    return {"paths": paths, "count": len(paths), "source": "frames", "cached": False}


def iter_files(base: Path, root: Path) -> Iterable[Path]:
    for current, dirs, filenames in os.walk(base):
        current_path = Path(current)
        dirs[:] = [name for name in dirs if not skip_dir(current_path / name, root)]
        for filename in sorted(filenames):
            path = current_path / filename
            if path.is_file() and not skip_file(path, root):
                yield path


def skip_dir(path: Path, root: Path) -> bool:
    if path.name in SKIP_DIRS:
        return True
    try:
        rel_parts = path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return False
    blocked = ((".rundeer", "data", "cache"), (".rundeer", "data", "runs"), (".rundeer", "web", "runs"))
    return any(rel_parts[: len(prefix)] == prefix for prefix in blocked)


def skip_file(path: Path, root: Path) -> bool:
    if is_sensitive_file(path, root):
        return True
    try:
        rel_parts = path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return False
    return path.name.startswith(".") and (not rel_parts or rel_parts[0] not in ALLOWED_DOTFILE_ROOTS)
