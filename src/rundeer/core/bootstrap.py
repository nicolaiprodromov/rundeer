from __future__ import annotations

from pathlib import Path

from rundeer.core.paths import DATA_DIRS, PERSIST_DIRS, codebase_root, data_dir, rundeer_dir


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
        import shutil
        shutil.copy2(src, dest)


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
    for name in PERSIST_DIRS:
        (root / name).mkdir(parents=True, exist_ok=True)
    target_data = data_dir(cwd)
    target_data.mkdir(parents=True, exist_ok=True)
    for name in DATA_DIRS:
        (target_data / name).mkdir(parents=True, exist_ok=True)
    return root


def clear_data(cwd: Path | None = None) -> None:
    import shutil
    shutil.rmtree(data_dir(cwd or Path.cwd()), ignore_errors=True)
