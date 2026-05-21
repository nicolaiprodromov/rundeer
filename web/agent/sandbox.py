from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable


SENSITIVE_NAMES = {".env"}
SENSITIVE_PREFIXES = (
    ".git/",
    ".rundeer/data/agent/",
    ".rundeer/.rate_limit_state",
)

SENSITIVE_NAME_PREFIXES = (".env.",)


class SandboxError(PermissionError):
    pass


def resolve_within(root: Path, rel: str) -> Path:





    if rel is None or str(rel).strip() == "":
        raise SandboxError("empty path")
    root_resolved = root.resolve()
    candidate = Path(str(rel)).expanduser()
    if not candidate.is_absolute():
        candidate = root_resolved / candidate
    resolved = candidate.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise SandboxError(f"path escapes project root: {rel}")
    return resolved


def assert_readable(root: Path, path: Path) -> None:

    root_resolved = root.resolve()
    try:
        rel = path.resolve().relative_to(root_resolved).as_posix()
    except ValueError as exc:
        raise SandboxError("path is outside project root") from exc
    name = path.name.lower()
    if name in SENSITIVE_NAMES:
        raise SandboxError(f"file is sensitive and cannot be read: {rel}")
    for prefix in SENSITIVE_NAME_PREFIXES:
        if name.startswith(prefix):
            raise SandboxError(f"file is sensitive and cannot be read: {rel}")
    rel_lower = rel.lower()
    for prefix in SENSITIVE_PREFIXES:
        if rel_lower == prefix.rstrip("/") or rel_lower.startswith(prefix):
            raise SandboxError(f"path is restricted: {rel}")


def safe_rel(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def iter_dir_filtered(path: Path, *, skip_dirs: Iterable[str] = ()) -> Iterable[Path]:

    skips = set(skip_dirs)
    try:
        entries = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except (PermissionError, OSError):
        return
    for entry in entries:
        if entry.is_dir() and entry.name in skips:
            continue
        yield entry
