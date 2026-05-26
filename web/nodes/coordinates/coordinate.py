from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _shape_meta


def coordinate(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    width = int(payload.get("width") or 1024)
    height = int(payload.get("height") or 1024)
    dpi = int(payload.get("dpi") or 72)
    space = str(payload.get("space") or "uv")
    arr = uv_ops.coordinate(width, height, dpi=dpi, space=space)
    npy, png = uv_ops.save_map(arr, root, "coord")
    return {
        "path": _relpath(root, npy),
        "preview": _relpath(root, png),
        "image": _relpath(root, png),
        **_shape_meta(arr),
    }
