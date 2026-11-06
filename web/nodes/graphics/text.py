from __future__ import annotations

import math
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from rundeer.core.paths import atomic_pil, cache_dir
from rundeer.core.uv_ops import _hash_key
from web.nodes._shared.uv import _parse_hex_color, _relpath

SS = 4
_BOLD = re.compile(r"\*\*(.+?)\*\*")


def _font_dirs() -> List[Path]:
    e = os.environ
    h = Path.home()
    ds = [
        Path(e.get("WINDIR", "C:/Windows")) / "Fonts",
        Path(e.get("LOCALAPPDATA", h / "AppData/Local")) / "Microsoft/Windows/Fonts",
        h / ".fonts",
        h / ".local/share/fonts",
        Path("/usr/share/fonts"),
        Path("/Library/Fonts"),
        h / "Library/Fonts",
    ]
    return [d for d in ds if d.is_dir()]


@lru_cache(maxsize=256)
def _find_font(root: str, name: str) -> str:
    for p in (Path(root) / name, Path(name).expanduser()):
        if p.is_file():
            return str(p.resolve())
    low = Path(name).name.lower()
    for d in _font_dirs():
        for p in d.rglob("*"):
            if p.name.lower() == low and p.is_file():
                return str(p)
    raise ValueError(f"font not found: {name}")


@lru_cache(maxsize=128)
def _font(path: str, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def _f(v: Any, d: float) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _col(v: Any, d: str) -> np.ndarray:
    if isinstance(v, (list, tuple)):
        c = [float(x) for x in v][:4]
        return np.array(c + [1.0] * (4 - len(c)), dtype=np.float32)
    return np.array(_parse_hex_color(str(v or d)), dtype=np.float32)


def _runs(s: str) -> List[Tuple[str, bool]]:
    return [(t, i % 2 == 1) for i, t in enumerate(_BOLD.split(s)) if t]


def _adv(runs, fr, fb, trk: float) -> float:
    return sum((fb if b else fr).getlength(t) / SS + trk * len(t) for t, b in runs)


def _over(dst: np.ndarray, m: np.ndarray, c: np.ndarray) -> None:
    a = m * c[3]
    da = dst[..., 3]
    oa = a + da * (1.0 - a)
    rgb = c[:3] * a[..., None] + dst[..., :3] * (da * (1.0 - a))[..., None]
    dst[..., :3] = np.where(oa[..., None] > 0, rgb / np.maximum(oa, 1e-8)[..., None], 0.0)
    dst[..., 3] = oa


def _mask(W: int, H: int, fn) -> np.ndarray:
    m = Image.new("L", (W * SS, H * SS), 0)
    fn(ImageDraw.Draw(m))
    return np.asarray(m.resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0


def _render(p: Dict[str, Any], fr_p: str, fb_p: str) -> np.ndarray:
    sz = p["size"]
    fr = _font(fr_p, sz)
    Fr, Fb = _font(fr_p, sz * SS), _font(fb_p, sz * SS)
    asc, dsc = fr.getmetrics()
    px, py, trk, gap, sw = p["pad_x"], p["pad_y"], p["tracking"], p["gap"], p["stroke"]
    H = max(1, math.ceil(asc + dsc + 2 * py))
    parts = [_runs(t) for t in p["parts"]] or [[]]
    bws = [math.ceil(_adv(r, Fr, Fb, trk) + 2 * px) for r in parts]
    xs, x = [], 0.0
    for bw in bws:
        xs.append(x)
        x += bw + gap
    W = max(1, math.ceil(sum(bws) + gap * (len(bws) - 1)))
    shp = p["shape"]

    def box(d, fill, outline=None, width=0):
        for x0, bw in zip(xs, bws):
            r = [round(x0 * SS), 0, round((x0 + bw) * SS) - 1, H * SS - 1]
            if shp == "pill":
                d.rounded_rectangle(r, radius=(H * SS - 1) / 2, fill=fill, outline=outline, width=width)
            else:
                d.rectangle(r, fill=fill, outline=outline, width=width)

    def txt(d):
        by = (py + asc) * SS
        for x0, rs in zip(xs, parts):
            cx = x0 + px
            for t, b in rs:
                F = Fb if b else Fr
                if trk:
                    for i, ch in enumerate(t):
                        d.text((cx * SS + F.getlength(t[:i]) + trk * i * SS, by), ch, font=F, fill=255, anchor="ls")
                else:
                    d.text((cx * SS, by), t, font=F, fill=255, anchor="ls")
                cx += F.getlength(t) / SS + trk * len(t)

    out = np.zeros((H, W, 4), dtype=np.float32)
    if shp in ("box", "pill"):
        _over(out, _mask(W, H, lambda d: box(d, 255)), p["bg"])
        if sw > 0:
            _over(out, _mask(W, H, lambda d: box(d, None, 255, max(1, round(sw * SS)))), p["stroke_color"])
    _over(out, _mask(W, H, txt), p["color"])
    return out


def text_image(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    g = payload.get
    raw = " ".join(str(g("text") if g("text") is not None else "").splitlines())
    sep = str(g("split") or "")
    parts = [s.strip() for s in raw.split(sep)] if sep else [raw]
    p = {
        "parts": [s for s in parts if s] if sep else parts,
        "size": max(1.0, _f(g("size"), 64.0)),
        "shape": str(g("shape") or "box"),
        "pad_x": _f(g("pad_x"), 14.0),
        "pad_y": _f(g("pad_y"), 4.0),
        "tracking": _f(g("tracking"), 0.0),
        "gap": _f(g("gap"), 12.0),
        "stroke": max(0.0, _f(g("stroke"), 0.0)),
        "color": _col(g("color"), "#ffffff"),
        "bg": _col(g("bg"), "#4e3c8f"),
        "stroke_color": _col(g("stroke_color"), "#ffffff"),
    }
    fr_p = _find_font(str(root), str(g("font") or "NeueMontreal-Regular.otf"))
    fb_p = _find_font(str(root), str(g("bold_font") or "NeueMontreal-Bold.ttf"))
    key = _hash_key("text", fr_p, fb_p, {k: v.tolist() if isinstance(v, np.ndarray) else v for k, v in p.items()})
    png = cache_dir(root, "graphics") / f"text_{key}.png"
    if png.exists():
        with Image.open(png) as im:
            w, h = im.size
    else:
        arr = _render(p, fr_p, fb_p)
        h, w = arr.shape[:2]
        atomic_pil(Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA"), png)
    rel = _relpath(root, png)
    return {"path": rel, "image": rel, "width": int(w), "height": int(h)}
