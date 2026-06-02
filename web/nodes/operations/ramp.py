from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import numpy as np

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _resolve_input, _shape_meta, _parse_hex_color


def ramp(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    fac = _resolve_input(root, payload.get("fac"))
    raw: List[Dict[str, Any]] = payload.get("stops") or []
    interp = str(payload.get("interp") or "linear")
    if len(raw) < 2:
        raw = [{"pos": 0.0, "color": "#000000"}, {"pos": 1.0, "color": "#ffffff"}]
    positions = [float(s.get("pos", 0.0)) for s in raw]
    colors = [_parse_hex_color(str(s.get("color", "#000000")))[:3] for s in raw]
    arr = uv_ops.color_ramp(fac, positions, colors, interp)
    if isinstance(arr, np.ndarray) and arr.ndim >= 2 and (arr.shape[0] > 1 or arr.shape[1] > 1):
        png = uv_ops.save_image(arr, root, f"ramp_{interp}")
        return {
            "path": _relpath(root, png),
            "image": _relpath(root, png),
            **_shape_meta(arr),
        }
    return {"color": [float(x) for x in np.atleast_1d(arr).ravel()[:3]]}
