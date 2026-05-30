from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import numpy as np

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _resolve_input, _shape_meta


def mix(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    factor = _resolve_input(root, payload.get("factor"))
    a = _resolve_input(root, payload.get("a"))
    b = _resolve_input(root, payload.get("b"))
    mode = str(payload.get("mode") or "mix")
    clamp = bool(payload.get("clamp") if payload.get("clamp") is not None else True)

    if factor is None:
        factor = 0.5
    if a is None:
        a = [0.0, 0.0, 0.0, 1.0]
    if b is None:
        b = [1.0, 1.0, 1.0, 1.0]

    result = uv_ops.mix(factor, a, b, mode=mode, clamp_factor=clamp)
    if isinstance(result, np.ndarray):
        png = uv_ops.save_image(result, root, f"mix_{mode}")
        return {
            "path": _relpath(root, png),
            **_shape_meta(result),
        }

    return {"color": [float(x) for x in result]}
