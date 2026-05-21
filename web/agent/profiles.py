from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from rundeer.core.paths import agent_dir


SCHEMA_VERSION = 1
DEFAULT_AGENT_ID = "default"
REGISTRY_FILENAME = "agents.json"


def _agent_root(root: Path) -> Path:
    return agent_dir(root).resolve()


def _registry_path(root: Path) -> Path:
    return _agent_root(root) / REGISTRY_FILENAME


def normalize_agent_id(agent_id: Optional[str]) -> str:
    raw = str(agent_id or DEFAULT_AGENT_ID).strip() or DEFAULT_AGENT_ID
    if raw == DEFAULT_AGENT_ID:
        return DEFAULT_AGENT_ID
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", raw):
        raise ValueError("invalid agent id")
    return raw


def _slug(text: str) -> str:
    out: List[str] = []
    for ch in (text or "agent").lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")[:40] or "agent"


def _safe_new_id(name: str) -> str:
    return normalize_agent_id(f"{_slug(name)}-{uuid.uuid4().hex[:6]}")


def _atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".agents-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _default_profile(*, model: str = "") -> Dict[str, Any]:
    now = time.time()
    return {
        "id": DEFAULT_AGENT_ID,
        "name": "Default",
        "model": model or "",
        "created_at": now,
        "updated_at": now,
    }


def _read_registry(root: Path, *, model: str = "") -> Dict[str, Any]:
    path = _registry_path(root)
    data: Any = None
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = None
    if isinstance(data, list):
        data = {"schema": SCHEMA_VERSION, "active_id": DEFAULT_AGENT_ID, "agents": data}
    if not isinstance(data, dict):
        data = {"schema": SCHEMA_VERSION, "active_id": DEFAULT_AGENT_ID, "agents": []}
    agents = data.get("agents") if isinstance(data.get("agents"), list) else []
    cleaned: List[Dict[str, Any]] = []
    seen = set()
    for item in agents:
        if not isinstance(item, dict):
            continue
        try:
            agent_id = normalize_agent_id(item.get("id"))
        except ValueError:
            continue
        if agent_id in seen:
            continue
        seen.add(agent_id)
        cleaned.append({
            "id": agent_id,
            "name": str(item.get("name") or ("Default" if agent_id == DEFAULT_AGENT_ID else agent_id)),
            "model": str(item.get("model") or model or ""),
            "created_at": item.get("created_at") or time.time(),
            "updated_at": item.get("updated_at") or item.get("created_at") or time.time(),
        })
    if DEFAULT_AGENT_ID not in seen:
        cleaned.insert(0, _default_profile(model=model))
    cleaned.sort(key=lambda a: (a.get("id") != DEFAULT_AGENT_ID, str(a.get("name") or "").lower()))
    active_id = data.get("active_id")
    try:
        active_id = normalize_agent_id(active_id)
    except ValueError:
        active_id = DEFAULT_AGENT_ID
    if active_id not in {a["id"] for a in cleaned}:
        active_id = DEFAULT_AGENT_ID
    return {"schema": SCHEMA_VERSION, "active_id": active_id, "agents": cleaned}


def _write_registry(root: Path, registry: Dict[str, Any]) -> None:
    _atomic_write(_registry_path(root), json.dumps(registry, ensure_ascii=False, indent=2, default=str))


def ensure_agent_registry(root: Path, *, model: str = "") -> Dict[str, Any]:
    registry = _read_registry(root, model=model)
    _write_registry(root, registry)
    return registry


def list_agent_profiles(root: Path, *, model: str = "") -> List[Dict[str, Any]]:
    return list(ensure_agent_registry(root, model=model).get("agents") or [])


def active_agent_id(root: Path, *, model: str = "") -> str:
    return str(ensure_agent_registry(root, model=model).get("active_id") or DEFAULT_AGENT_ID)


def get_agent_profile(root: Path, agent_id: Optional[str], *, model: str = "") -> Dict[str, Any]:
    wanted = normalize_agent_id(agent_id)
    registry = ensure_agent_registry(root, model=model)
    for item in registry.get("agents") or []:
        if item.get("id") == wanted:
            return dict(item)
    raise KeyError(wanted)


def get_active_agent_profile(root: Path, *, model: str = "") -> Dict[str, Any]:
    return get_agent_profile(root, active_agent_id(root, model=model), model=model)


def set_active_agent(root: Path, agent_id: Optional[str], *, model: str = "") -> Dict[str, Any]:
    wanted = normalize_agent_id(agent_id)
    registry = ensure_agent_registry(root, model=model)
    if wanted not in {a.get("id") for a in registry.get("agents") or []}:
        raise KeyError(wanted)
    registry["active_id"] = wanted
    _write_registry(root, registry)
    return get_agent_profile(root, wanted, model=model)


def create_agent_profile(root: Path, *, name: str = "New agent", model: str = "") -> Dict[str, Any]:
    registry = ensure_agent_registry(root, model=model)
    now = time.time()
    profile = {
        "id": _safe_new_id(name),
        "name": str(name or "New agent").strip() or "New agent",
        "model": model or "",
        "created_at": now,
        "updated_at": now,
    }
    registry.setdefault("agents", []).append(profile)
    registry["active_id"] = profile["id"]
    _write_registry(root, registry)
    return dict(profile)


def rename_agent_profile(root: Path, agent_id: Optional[str], *, name: str, model: str = "") -> Dict[str, Any]:
    wanted = normalize_agent_id(agent_id)
    new_name = str(name or "").strip()
    if not new_name:
        raise ValueError("agent name cannot be empty")
    registry = ensure_agent_registry(root, model=model)
    for item in registry.get("agents") or []:
        if item.get("id") == wanted:
            item["name"] = new_name
            item["updated_at"] = time.time()
            _write_registry(root, registry)
            return dict(item)
    raise KeyError(wanted)


def delete_agent_profile(root: Path, agent_id: Optional[str], *, model: str = "") -> Dict[str, Any]:
    wanted = normalize_agent_id(agent_id)
    if wanted == DEFAULT_AGENT_ID:
        raise ValueError("default agent cannot be deleted")
    registry = ensure_agent_registry(root, model=model)
    before = list(registry.get("agents") or [])
    after = [item for item in before if item.get("id") != wanted]
    if len(after) == len(before):
        raise KeyError(wanted)
    registry["agents"] = after
    if registry.get("active_id") == wanted:
        registry["active_id"] = DEFAULT_AGENT_ID
    _write_registry(root, registry)
    try:
        shutil.rmtree(_agent_root(root) / "agents" / wanted)
    except OSError:
        pass
    return get_agent_profile(root, registry.get("active_id"), model=model)