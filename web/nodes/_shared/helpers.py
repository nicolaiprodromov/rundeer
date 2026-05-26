from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
IMAGE_COMPRESS_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
VIDEO_COMPRESS_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def relpath(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def is_sensitive_file(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    name = path.name.lower()
    return name == ".env" or name.startswith(".env.")


def safe_project_path(root: Path, rel: str) -> Path:
    raw = unquote(rel or "")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = root / raw
    path = candidate.resolve()
    resolved_root = root.resolve()
    if path != resolved_root and resolved_root not in path.parents:
        raise PermissionError("path escapes rundeer project")
    if is_sensitive_file(path, resolved_root):
        raise PermissionError("file is not available through the web console")
    return path


def _coerce_vector2(value: Any, default: Tuple[float, float]) -> Tuple[int, int]:
    if value is None or value == "":
        return int(round(default[0])), int(round(default[1]))
    if isinstance(value, dict):
        if "x" in value or "y" in value:
            return _coerce_vector2([value.get("x", default[0]), value.get("y", default[1])], default)
        if "color" in value:
            return _coerce_vector2(value.get("color"), default)
        if "value" in value:
            return _coerce_vector2(value.get("value"), default)
    if isinstance(value, (int, float)):
        n = float(value)
        return int(round(n)), int(round(n))
    if isinstance(value, (list, tuple)):
        nums: List[float] = []
        for item in value:
            try:
                nums.append(float(item))
            except (TypeError, ValueError):
                continue
        if len(nums) >= 2:
            return int(round(nums[0])), int(round(nums[1]))
        if len(nums) == 1:
            return int(round(nums[0])), int(round(nums[0]))
        return int(round(default[0])), int(round(default[1]))
    text = str(value).strip().strip("[]()")
    text = text.replace("\u00d7", "x").replace("X", "x").replace("x", ",")
    parts = [part for part in re.split(r"[\s,]+", text) if part]
    return _coerce_vector2(parts, default)


def _coerce_vector2_list(value: Any, count: int) -> List[Tuple[int, int]]:
    if value is None or value == "":
        return [(0, 0) for _ in range(count)]
    if isinstance(value, list):
        if not value:
            return [(0, 0) for _ in range(count)]
        if all(not isinstance(item, (list, tuple, dict)) for item in value):
            return [_coerce_vector2(value, (0, 0))]
        return [_coerce_vector2(item, (0, 0)) for item in value]
    return [_coerce_vector2(value, (0, 0))]


def _payload_paths(value: Any) -> List[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def _media_result(root: Path, path: Path, *, width: Optional[int] = None, height: Optional[int] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"path": relpath(root, path), "bytes": path.stat().st_size}
    if width is not None:
        out["width"] = int(width)
    if height is not None:
        out["height"] = int(height)
    if path.suffix.lower() in IMAGE_COMPRESS_EXTS:
        try:
            from PIL import Image
            with Image.open(path) as im:
                out["width"], out["height"] = im.size
        except Exception:
            pass
    return out
