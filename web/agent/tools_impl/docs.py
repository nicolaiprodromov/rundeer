
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from rundeer.core.config import brain_dir

from ..sandbox import SandboxError, assert_readable, resolve_within, safe_rel


DOC_WHITELIST_DIRS = ("docs", "brain", ".github/skills")
DOC_ROOT_FILES = (
    "README.md", "DESIGN.md", "PRODUCT.md", "impeccable.md", "AGENTS.md",
)


def _list_doc_paths(root: Path) -> List[str]:
    out: List[str] = []
    for name in DOC_ROOT_FILES:
        if (root / name).is_file():
            out.append(name)
    for sub in DOC_WHITELIST_DIRS:
        base = root / sub
        if not base.is_dir():
            continue
        for fp in base.rglob("*"):
            if not fp.is_file():
                continue
            if fp.suffix.lower() not in {".md", ".txt", ".rst"}:
                continue
            try:
                out.append(fp.resolve().relative_to(root.resolve()).as_posix())
            except ValueError:
                continue
    return sorted(set(out))


def list_docs_tool(root: Path) -> Dict[str, Any]:
    return {"docs": _list_doc_paths(root)}


def read_doc_tool(root: Path, *, path: str, max_bytes: int = 200_000) -> Dict[str, Any]:
    target = resolve_within(root, path)
    assert_readable(root, target)
    if not target.is_file():
        return {"error": f"not a file: {path}"}
    if target.suffix.lower() not in {".md", ".txt", ".rst"}:
        return {"error": f"not a documentation file: {path}"}
    size = target.stat().st_size
    cap = max(1024, min(int(max_bytes), 400_000))
    text = target.read_text(encoding="utf-8", errors="replace")[:cap]
    return {
        "path": safe_rel(root, target),
        "bytes": min(size, cap),
        "total_bytes": size,
        "truncated": size > cap,
        "content": text,
    }


def list_brains_tool(root: Path) -> Dict[str, Any]:
    bd = brain_dir()
    def _rel(p: Path) -> str:
        try:
            return p.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            return str(p)
    if not bd.is_dir():
        return {"brains": [], "brain_dir": _rel(bd)}
    brains: List[Dict[str, Any]] = []
    for child in sorted(bd.iterdir()):
        if not child.is_dir():
            continue
        name = child.name
        md_candidate = child / f"{name.lower()}.md"
        if not md_candidate.is_file():
            md_candidate = next((p for p in child.glob("*.md")), None)
        ref_dir = child / "Reference"
        ref_count = 0
        if ref_dir.is_dir():
            ref_count = sum(1 for p in ref_dir.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
        brains.append({
            "name": name,
            "md_path": _rel(md_candidate) if md_candidate else None,
            "reference_count": ref_count,
        })
    return {"brains": brains, "brain_dir": _rel(bd)}


def get_brain_md_tool(root: Path, *, name: str, max_bytes: int = 200_000) -> Dict[str, Any]:
    if not name:
        return {"error": "missing brain name"}
    bd = brain_dir()
    target_dir = bd / name
    if not target_dir.is_dir():

        for child in bd.iterdir() if bd.is_dir() else []:
            if child.is_dir() and child.name.lower() == name.lower():
                target_dir = child
                break
    md = None
    if target_dir.is_dir():
        candidate = target_dir / f"{target_dir.name.lower()}.md"
        if candidate.is_file():
            md = candidate
        else:
            md = next((p for p in target_dir.glob("*.md")), None)
    if md is None or not md.is_file():
        return {"error": f"brain markdown not found for: {name}"}


    size = md.stat().st_size
    cap = max(1024, min(int(max_bytes), 400_000))
    text = md.read_text(encoding="utf-8", errors="replace")[:cap]
    try:
        rel = md.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        rel = str(md)
    return {
        "path": rel,
        "brain": target_dir.name,
        "bytes": min(size, cap),
        "total_bytes": size,
        "truncated": size > cap,
        "content": text,
    }


def list_references_tool(root: Path, *, name: str, max_entries: int = 200) -> Dict[str, Any]:
    if not name:
        return {"error": "missing brain name"}
    bd = brain_dir()
    target_dir = None
    if bd.is_dir():
        for child in bd.iterdir():
            if child.is_dir() and child.name.lower() == name.lower():
                target_dir = child
                break
    if target_dir is None:
        return {"error": f"brain not found: {name}"}
    ref_dir = target_dir / "Reference"

    def _rel(p: Path) -> str:
        try:
            return p.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            return str(p)

    if not ref_dir.is_dir():
        return {"references": [], "brain": target_dir.name, "reference_dir": _rel(ref_dir)}
    cap = max(10, min(int(max_entries), 500))
    entries: List[Dict[str, Any]] = []
    for fp in sorted(ref_dir.iterdir()):
        if not fp.is_file():
            continue
        if fp.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".json"}:
            continue
        try:
            size = fp.stat().st_size
        except OSError:
            size = 0
        entries.append({
            "name": fp.name,
            "path": _rel(fp),
            "size": size,
            "kind": "image" if fp.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} else "metadata",
        })
        if len(entries) >= cap:
            break
    return {
        "brain": target_dir.name,
        "reference_dir": _rel(ref_dir),
        "count": len(entries),
        "references": entries,
    }
