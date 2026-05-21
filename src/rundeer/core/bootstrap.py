from __future__ import annotations

import shutil
from pathlib import Path

from rundeer.core.paths import DATA_DIRS, codebase_root, data_dir, legacy_data_path, rundeer_dir

TEXT_SUFFIXES = {".csv", ".css", ".html", ".js", ".json", ".log", ".md", ".py", ".txt"}
LEGACY_DATA_REPLACEMENTS = tuple(
    (f".rundeer/{name}", f".rundeer/data/{name}") for name in DATA_DIRS
) + (
    (".rundeer/web-state.json", ".rundeer/data/web-state.json"),
    (".rundeer/rate_limits.json", ".rundeer/data/rate_limits.json"),
)


def template_rundeer_dir() -> Path:
    return codebase_root() / ".rundeer"


def _copy_missing(src: Path, dest: Path) -> None:
    if src.is_dir():
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            _copy_missing(child, dest / child.name)
        return
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


def _merge_tree(src: Path, dest: Path) -> None:
    if src.is_dir():
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            _merge_tree(child, dest / child.name)
        try:
            src.rmdir()
        except OSError:
            pass
        return
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
    else:
        src.unlink()


def _rewrite_legacy_data_refs(root: Path) -> None:
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        updated = text
        for old, new in LEGACY_DATA_REPLACEMENTS:
            updated = updated.replace(old, new)
        if updated != text:
            path.write_text(updated, encoding="utf-8")


def migrate_data_dirs(cwd: Path | None = None) -> Path:
    cwd = cwd or Path.cwd()
    root = rundeer_dir(cwd)
    target_data = data_dir(cwd)
    target_data.mkdir(parents=True, exist_ok=True)
    for name in DATA_DIRS:
        legacy = legacy_data_path(cwd, name)
        target = target_data / name
        if legacy.exists() and legacy.resolve() != target.resolve():
            _merge_tree(legacy, target)
        target.mkdir(parents=True, exist_ok=True)
    for filename in ("web-state.json", "rate_limits.json"):
        legacy_file = root / filename
        target_file = target_data / filename
        if legacy_file.exists() and legacy_file.resolve() != target_file.resolve():
            _merge_tree(legacy_file, target_file)
    _rewrite_legacy_data_refs(root)
    return root


def ensure_rundeer_dir(cwd: Path | None = None) -> Path:
    cwd = cwd or Path.cwd()
    root = rundeer_dir(cwd)
    template = template_rundeer_dir()
    root.mkdir(parents=True, exist_ok=True)
    try:
        same = template.resolve() == root.resolve()
    except OSError:
        same = False
    if template.is_dir() and not same:
        _copy_missing(template, root)
    migrate_data_dirs(cwd)
    return root
