from __future__ import annotations

from pathlib import Path
from typing import Any, Dict
from urllib.parse import unquote

import numpy as np

from rundeer.core import uv_ops


def _safe_path(root: Path, rel: str) -> Path:
    raw = unquote(rel or "")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = root / raw
    path = candidate.resolve()
    resolved_root = root.resolve()
    if path != resolved_root and resolved_root not in path.parents:
        raise PermissionError("path escapes rundeer project")
    return path


def _relpath(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def _resolve_input(root: Path, value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, dict):
        if "path" in value and value["path"]:
            return uv_ops.load_map(_safe_path(root, str(value["path"])))
        if "scalar" in value:
            return float(value["scalar"])
        if "color" in value:
            return [float(x if x is not None else 0.0) for x in value["color"]]
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, (list, tuple)):
        return [float(x if x is not None else 0.0) for x in value]
    if isinstance(value, str):
        if value.startswith("#"):
            return _parse_hex_color(value)
        return uv_ops.load_map(_safe_path(root, value))
    return value


def _parse_hex_color(hex_str: str) -> list:
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 6:
        h += "ff"
    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0
    a = int(h[6:8], 16) / 255.0
    return [r, g, b, a]


def _shape_meta(arr: np.ndarray) -> Dict[str, int]:
    if arr.ndim >= 2:
        return {"width": int(arr.shape[1]), "height": int(arr.shape[0])}
    return {"width": 1, "height": 1}



