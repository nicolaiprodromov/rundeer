from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _resolve_input, _shape_meta


def sensor_noise(root: Path, p: Dict[str, Any]) -> Dict[str, Any]:
    img = _resolve_input(root, p.get("image"))
    if img is None:
        return {"error": "image input is required"}
    amt = _resolve_input(root, p.get("amount"))
    out = uv_ops.sensor_noise(
        img,
        0.2 if amt is None else amt,
        int(p.get("grain") or 1),
        bool(p.get("mono", True)),
        int(p.get("seed") or 0),
    )
    png = uv_ops.save_image(out, root, "snoise")
    rel = _relpath(root, png)
    return {"path": rel, "image": rel, **_shape_meta(out)}
