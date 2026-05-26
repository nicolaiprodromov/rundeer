from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import numpy as np

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _resolve_input, _shape_meta


def mapping(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    uv = _resolve_input(root, payload.get("uv"))
    if uv is None or not isinstance(uv, np.ndarray):
        raise ValueError("mapping: 'uv' input is required")
    arr = uv_ops.mapping(
        uv,
        location=(float(payload.get("location_x") or 0.0), float(payload.get("location_y") or 0.0)),
        rotation=float(payload.get("rotation") or 0.0),
        scale=(float(payload.get("scale_x") or 1.0), float(payload.get("scale_y") or 1.0)),
        pivot=(float(payload.get("pivot_x") or 0.5), float(payload.get("pivot_y") or 0.5)),
    )
    npy, png = uv_ops.save_map(arr, root, "map")
    return {
        "path": _relpath(root, npy),
        "preview": _relpath(root, png),
        "image": _relpath(root, png),
        **_shape_meta(arr),
    }
