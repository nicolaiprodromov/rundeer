from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

import numpy as np

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _resolve_input, _shape_meta


def alpha(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    image = _resolve_input(root, payload.get("image"))
    a = _resolve_input(root, payload.get("alpha"))
    mode = str(payload.get("mode") or "replace")

    if image is None:
        return {"error": "alpha: image input is required"}
    if a is None:
        a = 1.0

    result = uv_ops.set_alpha(image, a, mode=mode)
    if isinstance(result, np.ndarray):
        png = uv_ops.save_image(result, root, "alpha")
        return {
            "path": _relpath(root, png),
            "image": _relpath(root, png),
            **_shape_meta(result),
        }
    return {"color": [float(x) for x in result]}
