
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..sandbox import (
    SandboxError,
    assert_readable,
    iter_dir_filtered,
    resolve_within,
    safe_rel,
)


DEFAULT_SKIP_DIRS = {
    ".git", ".venv", "node_modules", "__pycache__", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", "target", ".vscode", ".crush",
}

TEXTUAL_EXTS = {
    ".md", ".txt", ".json", ".py", ".csv", ".log", ".toml", ".yaml",
    ".yml", ".ini", ".cfg", ".js", ".ts", ".tsx", ".jsx", ".css",
    ".html", ".xml", ".rst", ".sh", ".env.example",
}


def read_file_tool(
    root: Path,
    *,
    path: str,
    max_bytes: int = 200_000,
    offset: int = 0,
) -> Dict[str, Any]:

    target = resolve_within(root, path)
    assert_readable(root, target)
    if not target.is_file():
        return {"error": f"not a file: {path}"}
    suffix = target.suffix.lower()
    if suffix and suffix not in TEXTUAL_EXTS:

        return {
            "error": f"refusing to read binary/unknown file type: {suffix}",
            "hint": "use view_image for images or list_artifacts for media",
        }
    size = target.stat().st_size
    cap = max(1024, min(int(max_bytes), 500_000))
    offset = max(0, int(offset))
    with target.open("rb") as fh:
        if offset:
            fh.seek(offset)
        data = fh.read(cap)
    truncated = (offset + len(data)) < size
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
        truncated = True
    return {
        "path": safe_rel(root, target),
        "bytes": len(data),
        "total_bytes": size,
        "offset": offset,
        "truncated": truncated,
        "content": text,
    }


def list_dir_tool(
    root: Path,
    *,
    path: str = "",
    max_entries: int = 200,
) -> Dict[str, Any]:

    target = resolve_within(root, path or ".")
    if not target.is_dir():
        return {"error": f"not a directory: {path}"}
    entries: List[Dict[str, Any]] = []
    cap = max(10, min(int(max_entries), 500))
    for child in iter_dir_filtered(target, skip_dirs=DEFAULT_SKIP_DIRS):
        try:
            assert_readable(root, child)
        except SandboxError:
            continue
        try:
            stat = child.stat()
        except OSError:
            continue
        entries.append({
            "name": child.name,
            "path": safe_rel(root, child),
            "kind": "dir" if child.is_dir() else "file",
            "size": stat.st_size if child.is_file() else None,
            "mtime": stat.st_mtime,
        })
        if len(entries) >= cap:
            break
    return {"path": safe_rel(root, target), "count": len(entries), "entries": entries}


def search_files_tool(
    root: Path,
    *,
    query: str,
    kind: str = "all",
    max_results: int = 80,
) -> Dict[str, Any]:

    q = (query or "").strip().lower()
    if not q:
        return {"error": "empty query"}
    cap = max(5, min(int(max_results), 200))
    matches: List[Dict[str, Any]] = []
    for cur_root, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in DEFAULT_SKIP_DIRS]
        for fname in files:
            full = Path(cur_root) / fname
            try:
                rel = full.resolve().relative_to(root.resolve()).as_posix()
            except ValueError:
                continue
            try:
                assert_readable(root, full)
            except SandboxError:
                continue
            if q not in rel.lower():
                continue
            suffix = full.suffix.lower()
            if kind == "code" and suffix not in {".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".html"}:
                continue
            if kind == "doc" and suffix not in {".md", ".rst", ".txt"}:
                continue
            if kind == "config" and suffix not in {".json", ".toml", ".yaml", ".yml", ".ini"}:
                continue
            try:
                size = full.stat().st_size
            except OSError:
                size = 0
            matches.append({"path": rel, "size": size, "suffix": suffix})
            if len(matches) >= cap:
                break
        if len(matches) >= cap:
            break
    matches.sort(key=lambda m: m["path"])
    return {"query": q, "kind": kind, "count": len(matches), "matches": matches}


def grep_tool(
    root: Path,
    *,
    pattern: str,
    path: str = "",
    max_matches: int = 60,
    case_sensitive: bool = False,
) -> Dict[str, Any]:

    needle = pattern or ""
    if not needle:
        return {"error": "empty pattern"}
    needle_cmp = needle if case_sensitive else needle.lower()
    cap = max(5, min(int(max_matches), 200))
    base = resolve_within(root, path) if path else root.resolve()
    if base.is_file():
        files_iter = [base]
        walk_root = None
    else:
        files_iter = None
        walk_root = base
    matches: List[Dict[str, Any]] = []

    def scan(fp: Path) -> None:
        try:
            assert_readable(root, fp)
        except SandboxError:
            return
        suffix = fp.suffix.lower()
        if suffix and suffix not in TEXTUAL_EXTS:
            return
        try:
            with fp.open("r", encoding="utf-8", errors="replace") as fh:
                for i, line in enumerate(fh, start=1):
                    cmp = line if case_sensitive else line.lower()
                    if needle_cmp in cmp:
                        matches.append({
                            "path": safe_rel(root, fp),
                            "line": i,
                            "text": line.rstrip("\n")[:300],
                        })
                        if len(matches) >= cap:
                            return
        except OSError:
            return

    if files_iter is not None:
        for fp in files_iter:
            scan(fp)
    else:
        for cur_root, dirs, files in os.walk(walk_root):
            dirs[:] = [d for d in dirs if d not in DEFAULT_SKIP_DIRS]
            for fname in files:
                scan(Path(cur_root) / fname)
                if len(matches) >= cap:
                    break
            if len(matches) >= cap:
                break
    return {
        "pattern": needle,
        "case_sensitive": case_sensitive,
        "count": len(matches),
        "matches": matches,
    }
