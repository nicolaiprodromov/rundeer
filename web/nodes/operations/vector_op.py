from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _resolve_input, _shape_meta


def vector(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    a = _resolve_input(root, payload.get("a"))
    b = _resolve_input(root, payload.get("b"))
    op = str(payload.get("op") or "add")
    scalar = payload.get("scalar")
    scalar_v: Optional[float] = float(scalar) if scalar is not None and scalar != "" else None
    arr = uv_ops.vector_op(a, b, op, scalar=scalar_v)
    npy, png = uv_ops.save_map(arr, root, f"vec_{op}")
    result: Dict[str, Any] = {
        "path": _relpath(root, npy),
        "preview": _relpath(root, png),
        "image": _relpath(root, png),
        **_shape_meta(arr),
    }

    if arr.ndim >= 3 and arr.shape[0] == 1 and arr.shape[1] == 1:
        result["value"] = arr[0, 0].tolist()
    return result
