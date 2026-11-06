from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Dict, List, Tuple

from rundeer.core import paths as rpaths


def _preset(root: Path, name: Any) -> Tuple[str, Dict[str, Any]]:
    nm = str(name or "random").strip().strip("/")
    grp, _, st = nm.rpartition("/")
    base = rpaths.layouts_dir(root).resolve()
    d = (base / grp).resolve()
    if d != base and base not in d.parents:
        raise ValueError(f"layout: preset group escapes {base.as_posix()}")
    fs = sorted(d.glob("*.json"))
    if not fs:
        raise FileNotFoundError(f"layout: no presets in {d.as_posix()}")
    f = random.choice(fs) if st == "random" else d / f"{st}.json"
    if not f.is_file():
        raise FileNotFoundError(f"layout: preset not found: {nm}")
    return f"{grp}/{f.stem}" if grp else f.stem, json.loads(f.read_text(encoding="utf-8"))


def _rows(pr: Dict[str, Any], n: int) -> List[Any]:
    al0 = pr.get("align", "left")
    out: List[Any] = []
    seen = set()
    for r in pr.get("rows", []):
        if r == "gap" or (isinstance(r, dict) and "gap" in r):
            out.append(float(r["gap"]) if isinstance(r, dict) else 1.0)
            continue
        ix, al = (r.get("i", []), r.get("align", al0)) if isinstance(r, dict) else (r, al0)
        ix = [i for i in ix if 0 <= i < n and i not in seen]
        seen.update(ix)
        if ix:
            out.append((ix, al))
    out += [([i], al0) for i in range(n) if i not in seen]
    return out


def layout(root: Path, p: Dict[str, Any]) -> Dict[str, Any]:
    dims = [(float(d[0]), float(d[1])) for d in (p.get("dims") or [])]
    if not dims:
        raise ValueError("layout: dims input is required")
    W, H = (float(v) for v in (p.get("size") or [1080, 1350])[:2])
    m, rg, cg = float(p.get("margin") or 0), float(p.get("row_gap") or 0), float(p.get("col_gap") or 0)
    nm, pr = _preset(root, p.get("preset"))
    rows = _rows(pr, len(dims))
    aw, ah = W - 2 * m, H - 2 * m
    rs = [r for r in rows if isinstance(r, tuple)]
    met = {}
    for ix, _ in rs:
        w = sum(dims[i][0] for i in ix) + cg * (len(ix) - 1)
        h = max(dims[i][1] for i in ix)
        met[id(ix)] = [w, h, min(1.0, aw / w) if w > 0 else 1.0]
    fixed = rg * (len(rs) - 1)
    hs = sum(v[1] * v[2] for v in met.values())
    if hs + fixed > ah and hs > 0:
        g = max(0.05, (ah - fixed) / hs)
        for v in met.values():
            v[2] *= g
        hs = sum(v[1] * v[2] for v in met.values())
    free = max(0.0, ah - hs - fixed)
    gw = sum(r for r in rows if isinstance(r, float))
    va = {"top": 0.0, "center": 0.5, "bottom": 1.0}[pr.get("valign", "top")]
    y = m + (0.0 if gw else free * va)
    pos: List[List[float]] = [[0.0, 0.0, 0.0] for _ in dims]
    scl: List[List[float]] = [[1.0, 1.0, 0.0] for _ in dims]
    first = True
    for r in rows:
        if isinstance(r, float):
            y += free * r / gw
            continue
        ix, al = r
        w, h, s = met[id(ix)]
        if not first:
            y += rg
        first = False
        rw, rh = w * s, h * s
        x = {"left": m, "center": (W - rw) / 2, "right": W - m - rw}[al]
        for i in ix:
            bw, bh = dims[i][0] * s, dims[i][1] * s
            top = y + (rh - bh) / 2
            pos[i] = [round(x), round(H - top - bh), 0.0]
            scl[i] = [round(s, 4), round(s, 4), 0.0]
            x += bw + cg * s
        y += rh
    return {"positions": pos, "scales": scl, "preset": nm}
