from __future__ import annotations

import copy
import threading
from pathlib import Path
from typing import Any, Dict

import yaml


_settings_lock = threading.Lock()
_settings_cache: Dict[str, Any] | None = None

DEFAULT_SETTINGS: Dict[str, Any] = {
    "settings": {
        "Agent": {
            "Provider": "grok_raw/sxs-claude-opus-4-8/Default",
            "Max_turns": 4000,
            "Max_tokens": 99999999,
        },
        "UI": {
            "Header": {
                "title": "rundeer",
                "version": "0.3.5",
                "menu": "compact",
                "workspace": False,
                "reverse": True,
            },
            "Tree": {
                "Canvas": {
                    "cell_size": 30,
                    "thickness": 1,
                    "opacity": 0.5,
                    "selection_color": "oklch(13.5% 0.006 80)",
                },
                "Node Menu": {
                    "position": "left",
                },
                "Palette": {
                    "width": 200,
                    "height": 400,
                    "x_pos": 0,
                    "y_pos": 0,
                    "conv_display": False,
                    "fullscreen": False,
                },
            },
            "Explore": {
                "ignore_patterns": "*.env,*.env.example,__pycache__/,.git/,.venv/,venv/",
            },
        },
        "Nodes": {
            "Categories": {
                "Primitives": "oklch(53.5% 0.3 250)",
                "Operations": "oklch(55% 0.2 140)",
                "Layout": "oklch(50% 0.2 300)",
                "Prompt": "oklch(60% 0.25 60)",
                "Grok Imagine": "oklch(100% 1 7)",
                "Bundle": "oklch(55% 0.2 180)",
                "Loop": "oklch(50% 0.2 330)",
                "Triggers": "oklch(55% 0.25 90)",
                "Coordinates": "oklch(50% 0.2 210)",
                "Output": "oklch(55% 0.25 25)",
                "Agent Brain": "oklch(50% 0.2 350)",
                "Terminal": "oklch(45% 0.12 160)",
            },
            "Links": {
                "interpolation": "bezier",
                "thickness": 2,
            },
        },
        "Shortcuts": {
            "runGraph": "Mod+Enter",
            "addNodeMenu": "Shift+A",
            "renameNode": "F2",
            "grabNodes": "G",
            "scaleNodes": "S",
            "placeReroute": "E",
            "muteNodes": "M",
            "togglePalette": "T",
            "openRuns": "R",
            "toggleAgentPanel": "N",
            "toggleRunLog": "P",
            "cutSelection": "Mod+X",
            "deleteSelection": "Delete",
            "selectAll": "A",
            "duplicateSelection": "Shift+D",
            "frameAll": "Home",
            "fitView": "Shift+C",
            "autoConnect": "F",
            "hideNodes": "H",
            "previewSelected": "Alt+P",
            "previewPrevious": "ArrowLeft",
            "previewNext": "ArrowRight",
            "previewZoomIn": "ArrowUp",
            "previewZoomOut": "ArrowDown",
            "saveGraph": "Mod+S",
            "loadGraphJson": "Mod+O",
        },
    }
}


def _yaml_path(root: Path) -> Path:
    from rundeer.core.paths import settings_yaml_path
    return settings_yaml_path(root)


def load_settings_yaml(root: Path) -> Dict[str, Any]:
    global _settings_cache
    with _settings_lock:
        path = _yaml_path(root)
        if not path.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                yaml.dump(DEFAULT_SETTINGS, default_flow_style=False, sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )
            _settings_cache = copy.deepcopy(DEFAULT_SETTINGS)
            return copy.deepcopy(DEFAULT_SETTINGS)
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            data = None
        if not isinstance(data, dict):
            data = copy.deepcopy(DEFAULT_SETTINGS)
        _settings_cache = copy.deepcopy(data)
        return copy.deepcopy(data)


def save_settings_yaml(root: Path, data: Dict[str, Any]) -> Dict[str, Any]:
    global _settings_cache
    with _settings_lock:
        path = _yaml_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.dump(data, default_flow_style=False, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        _settings_cache = copy.deepcopy(data)
        return copy.deepcopy(data)


def _deep_set(obj: Dict, key_path: str, value: Any) -> None:
    keys = key_path.split(".")
    for k in keys[:-1]:
        if not isinstance(obj.get(k), dict):
            obj[k] = {}
        obj = obj[k]
    obj[keys[-1]] = value


def _deep_get(obj: Dict, key_path: str, default: Any = None) -> Any:
    keys = key_path.split(".")
    for k in keys:
        if not isinstance(obj, dict):
            return default
        obj = obj.get(k, default)
    return obj


def merge_settings_yaml(root: Path, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = load_settings_yaml(root)
    if "path" in patch and "value" in patch:
        _deep_set(current, patch["path"], patch["value"])
    elif isinstance(patch, dict):
        _recursive_merge(current, patch)
    return save_settings_yaml(root, current)


def _recursive_merge(base: Dict, overlay: Dict) -> None:
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _recursive_merge(base[k], v)
        else:
            base[k] = v


def get_cached_settings(root: Path) -> Dict[str, Any]:
    if _settings_cache is not None:
        return copy.deepcopy(_settings_cache)
    return load_settings_yaml(root)


def invalidate_cache() -> None:
    global _settings_cache
    with _settings_lock:
        _settings_cache = None
