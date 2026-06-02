from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, BinaryIO, Dict

from rundeer.core import paths as rpaths
from web.nodes._shared.helpers import relpath

CHUNK = 1 << 20


def _dedupe(dest: Path) -> Path:
    if not dest.exists():
        return dest
    stem, suffix, parent = dest.stem, dest.suffix, dest.parent
    i = 1
    while True:
        cand = parent / f"{stem}_{i}{suffix}"
        if not cand.exists():
            return cand
        i += 1


def _dest(root: Path, name: str) -> Path:
    base = Path(str(name or "")).name.strip()
    if not base:
        raise ValueError("name is required")
    out_dir = rpaths.default_output_dir(root)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = (out_dir / base).resolve()
    if root.resolve() not in dest.parents:
        raise PermissionError("path escapes rundeer project")
    return _dedupe(dest)


def save_drop_stream(root: Path, name: str, reader: BinaryIO, length: int) -> Dict[str, Any]:
    dest = _dest(root, name)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=".~drop")
    written = 0
    try:
        remaining = max(0, int(length))
        while remaining > 0:
            chunk = reader.read(min(CHUNK, remaining))
            if not chunk:
                break
            os.write(fd, chunk)
            written += len(chunk)
            remaining -= len(chunk)
        os.close(fd)
        fd = -1
        os.rename(tmp, str(dest))
    except BaseException:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return {"path": relpath(root, dest), "bytes": written}
