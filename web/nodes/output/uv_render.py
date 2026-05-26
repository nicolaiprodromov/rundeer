from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _safe_path, _shape_meta


def render(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    pixel_in = payload.get("pixel")
    uv_in = payload.get("uv")
    if not pixel_in:
        raise ValueError("render: 'pixel' input is required")
    if not uv_in:
        raise ValueError("render: 'uv' input is required")
    pixel_path = _safe_path(root, str(pixel_in)) if isinstance(pixel_in, str) else _safe_path(root, str(pixel_in.get("path") or ""))
    uv_path = _safe_path(root, str(uv_in)) if isinstance(uv_in, str) else _safe_path(root, str(uv_in.get("path") or ""))

    pixel = uv_ops.load_image_rgba(pixel_path)
    uv_map = uv_ops.load_map(uv_path)
    if uv_map.ndim != 3 or uv_map.shape[-1] < 2:
        raise ValueError("render: 'uv' input must be a 2-channel UV map")

    interp = str(payload.get("interp") or "bilinear")
    extension = str(payload.get("extension") or "clamp")
    out = uv_ops.sample(pixel, uv_map, interp=interp, extension=extension)
    png = uv_ops.save_image(out, root, "render")
    return {
        "path": _relpath(root, png),
        **_shape_meta(out),
    }
