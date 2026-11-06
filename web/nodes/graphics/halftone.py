from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict

import numpy as np
from PIL import Image, ImageFilter

from rundeer.core import uv_ops
from web.nodes._shared.uv import _relpath, _resolve_input, _shape_meta


def _lum(a: np.ndarray) -> np.ndarray:
    if a.ndim == 2:
        return a
    if a.shape[-1] >= 3:
        return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    return a[..., 0]


def halftone(root: Path, p: Dict[str, Any]) -> Dict[str, Any]:
    img = _resolve_input(root, p.get("image"))
    if not isinstance(img, np.ndarray) or img.ndim < 2:
        raise ValueError("halftone: image input is required")
    cell = max(2.0, float(p.get("cell") or 12))
    th = math.radians(float(p.get("angle") or 0))
    shp = str(p.get("shape") or "dot")
    soft = max(0.0, float(p.get("soft") or 0))
    gain = float(p.get("gain") if p.get("gain") not in (None, "") else 1)
    gam = max(0.05, float(p.get("gamma") if p.get("gamma") not in (None, "") else 1))
    d = np.clip(_lum(img), 0, 1)
    if not p.get("invert"):
        d = 1 - d
    h, w = d.shape
    bl = Image.fromarray((d * 255 + 0.5).astype(np.uint8), "L").filter(ImageFilter.BoxBlur(cell / 2))
    d = np.asarray(bl, dtype=np.float32) / 255.0
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    c, s = math.cos(th), math.sin(th)
    u, v = (xx * c + yy * s) / cell, (-xx * s + yy * c) / cell
    cu, cv = np.floor(u) + 0.5, np.floor(v) + 0.5
    px = np.clip(np.rint((cu * c - cv * s) * cell), 0, w - 1).astype(np.int32)
    py = np.clip(np.rint((cu * s + cv * c) * cell), 0, h - 1).astype(np.int32)
    k = np.clip(d[py, px] ** gam * gain, 0, 1)
    fu, fv = u - cu, v - cv
    if shp == "line":
        e = k / 2 - np.abs(fv)
    elif shp == "square":
        e = np.sqrt(k) / 2 - np.maximum(np.abs(fu), np.abs(fv))
    else:
        e = np.sqrt(k / math.pi) - np.hypot(fu, fv)
    aa = max(1.0 / cell, soft * 0.5)
    m = np.where(k > 0.001, np.clip(e / aa + 0.5, 0, 1), 0).astype(np.float32)
    png = uv_ops.save_image(m[..., None], root, f"halftone_{shp}")
    rel = _relpath(root, png)
    return {"path": rel, "image": rel, **_shape_meta(m)}
