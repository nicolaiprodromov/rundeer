from __future__ import annotations

import random
from pathlib import Path
from typing import Any, Dict, List

from rundeer.core import paths as rpaths


def _lines(s: str) -> List[str]:
    return [t for t in (l.strip() for l in s.splitlines()) if t and not t.startswith("#")]


def _vocab(root: Path, rel: Any) -> List[str]:
    rel = str(rel or "").strip()
    if not rel:
        return []
    base = rpaths.vocab_dir(root).resolve()
    p = (base / rel).resolve()
    if base not in p.parents:
        raise ValueError(f"pick: file must live under {base.as_posix()}")
    if not p.is_file():
        raise FileNotFoundError(f"pick: vocab file not found: {rel}")
    return _lines(p.read_text(encoding="utf-8"))


def pick(root: Path, p: Dict[str, Any]) -> Dict[str, Any]:
    raw = p.get("list")
    arr = isinstance(raw, list)
    its = [x for x in raw if x not in (None, "")] if arr else _lines(str(raw or ""))
    its += _vocab(root, p.get("file"))
    if not its:
        raise ValueError("pick: no items (set List or File)")
    n = max(1, int(p.get("count") or 1))
    got = random.sample(its, min(n, len(its)))
    if arr:
        return {"value": got if n > 1 else got[0]}
    sep = p.get("sep")
    return {"value": (", " if sep is None else str(sep)).join(str(g) for g in got)}
