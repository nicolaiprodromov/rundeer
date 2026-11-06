from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from PIL import Image

from rundeer.core.paths import atomic_pil, cache_dir
from rundeer.core.uv_ops import _hash_key
from web.nodes._shared.uv import _relpath
from web.nodes.graphics.text import _col

_P = (
    "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 "
    "221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 "
    "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 "
    "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 "
    "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 "
    "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 "
    "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 "
    "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 "
    "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 "
    "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 "
    "114131 311141 411131 211412 211214 211232 2331112"
).split()


def _code128b(s: str) -> List[int]:
    vs = [ord(c) - 32 for c in s if 32 <= ord(c) < 128]
    if not vs:
        raise ValueError("barcode: text has no encodable characters")
    ck = (104 + sum(i * v for i, v in enumerate(vs, 1))) % 103
    bits: List[int] = []
    for v in [104, *vs, ck, 106]:
        for j, w in enumerate(_P[v]):
            bits += [1 - j % 2] * int(w)
    return bits


def barcode(root: Path, p: Dict[str, Any]) -> Dict[str, Any]:
    g = p.get
    txt = str(g("text") if g("text") is not None else "").strip()
    bar = max(1, int(float(g("bar") or 3)))
    h = max(1, int(float(g("height") or 160)))
    q = max(0, int(float(g("quiet") if g("quiet") is not None else 10)))
    fg, bg = _col(g("color"), "#000000"), _col(g("bg"), "#ffffff")
    lum = lambda c: float(c[:3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
    if g("dark_bars", True) not in (False, "false", 0) and lum(fg) > lum(bg):
        fg, bg = bg, fg
    key = _hash_key("barcode", txt, bar, h, q, fg.tolist(), bg.tolist())
    png = cache_dir(root, "graphics") / f"barcode_{key}.png"
    if not png.exists():
        row = np.array([0] * q + _code128b(txt) + [0] * q, dtype=np.float32)
        m = np.repeat(row, bar)[None, :, None]
        arr = bg[None, None, :] * (1 - m) + fg[None, None, :] * m
        arr = np.repeat(arr, h, axis=0)
        atomic_pil(Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA"), png)
    with Image.open(png) as im:
        w, hh = im.size
    rel = _relpath(root, png)
    return {"path": rel, "image": rel, "width": int(w), "height": int(hh)}
