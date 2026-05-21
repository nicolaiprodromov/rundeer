from __future__ import annotations

from pathlib import Path
from typing import Iterable

RUNDEER_DIRNAME = ".rundeer"
DATA_DIRNAME = "data"
DATA_DIRS = ("agent", "benchmark", "cache", "graphs", "logs", "outputs", "runs")
DEFAULT_OUTPUT_DIR = Path(RUNDEER_DIRNAME) / DATA_DIRNAME / "outputs"
DEFAULT_OUTPUT_DIR_STR = DEFAULT_OUTPUT_DIR.as_posix()


def package_root() -> Path:
    return Path(__file__).resolve().parent.parent


def codebase_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / RUNDEER_DIRNAME).is_dir() and (parent / "__init__.py").is_file():
            return parent
    return package_root()


def rundeer_dir(root: Path | str) -> Path:
    return Path(root) / RUNDEER_DIRNAME


def data_dir(root: Path | str) -> Path:
    return rundeer_dir(root) / DATA_DIRNAME


def data_path(root: Path | str, *parts: str) -> Path:
    return data_dir(root).joinpath(*parts)


def config_path(root: Path | str) -> Path:
    return rundeer_dir(root) / "config.json"


def batch_path(root: Path | str) -> Path:
    return rundeer_dir(root) / "batch.json"


def benchmark_config_path(root: Path | str) -> Path:
    return rundeer_dir(root) / "benchmark.json"


def definitions_dir(root: Path | str) -> Path:
    return rundeer_dir(root) / "def"


def presets_dir(root: Path | str) -> Path:
    return rundeer_dir(root) / "presets"


def web_state_path(root: Path | str) -> Path:
    return data_path(root, "web-state.json")


def rate_limit_state_path(root: Path | str) -> Path:
    return data_path(root, "rate_limits.json")


def default_output_dir(root: Path | str) -> Path:
    return data_path(root, "outputs")


def cache_dir(root: Path | str, *parts: str) -> Path:
    return data_path(root, "cache", *parts)


def benchmark_dir(root: Path | str, *parts: str) -> Path:
    return data_path(root, "benchmark", *parts)


def graphs_dir(root: Path | str) -> Path:
    return data_path(root, "graphs")


def runs_dir(root: Path | str) -> Path:
    return data_path(root, "runs")


def logs_dir(root: Path | str, *parts: str) -> Path:
    return data_path(root, "logs", *parts)


def agent_dir(root: Path | str) -> Path:
    return data_path(root, "agent")


def legacy_data_path(root: Path | str, name: str) -> Path:
    return rundeer_dir(root) / name


def data_dirs() -> Iterable[str]:
    return DATA_DIRS
