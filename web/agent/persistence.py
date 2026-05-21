from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from rundeer.core.paths import agent_dir as project_agent_dir


SCHEMA_VERSION = 1
DEFAULT_AGENT_ID = "default"


def agent_dir(root: Path) -> Path:
    return project_agent_dir(root).resolve()


def _index_path(root: Path) -> Path:
    return agent_dir(root) / "_index.json"


def _conv_path(root: Path, conv_id: str) -> Path:
    return agent_dir(root) / f"{conv_id}.json"


def _safe_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]


def _agent_id(value: Any) -> str:
    raw = str(value or DEFAULT_AGENT_ID).strip() or DEFAULT_AGENT_ID
    return raw if raw else DEFAULT_AGENT_ID


def _atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".conv-", suffix=".json", dir=str(path.parent))
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


def new_conversation(root: Path, *, model: str, title: str = "New conversation", agent_id: str = DEFAULT_AGENT_ID) -> Dict[str, Any]:
    conv_id = _safe_id()
    now = time.time()
    record = {
        "schema": SCHEMA_VERSION,
        "id": conv_id,
        "agent_id": _agent_id(agent_id),
        "title": title,
        "model": model,
        "created_at": now,
        "updated_at": now,
        "messages": [],
        "events": [],
    }
    save_conversation(root, record)
    return record


def load_conversation(root: Path, conv_id: str) -> Optional[Dict[str, Any]]:
    path = _conv_path(root, conv_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_conversation(root: Path, conv: Dict[str, Any]) -> None:
    conv["agent_id"] = _agent_id(conv.get("agent_id"))
    conv["updated_at"] = time.time()
    path = _conv_path(root, conv["id"])
    _atomic_write(path, json.dumps(conv, ensure_ascii=False, indent=2, default=str))
    _update_index(root, conv)


def delete_conversation(root: Path, conv_id: str) -> bool:
    path = _conv_path(root, conv_id)
    existed = path.is_file()
    try:
        if existed:
            path.unlink()
    except OSError:
        pass
    idx = _read_index(root)
    idx = [c for c in idx if c.get("id") != conv_id]
    _write_index(root, idx)
    return existed


def _read_index(root: Path) -> List[Dict[str, Any]]:
    path = _index_path(root)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _write_index(root: Path, index: List[Dict[str, Any]]) -> None:
    _atomic_write(_index_path(root), json.dumps(index, ensure_ascii=False, indent=2, default=str))


def _update_index(root: Path, conv: Dict[str, Any]) -> None:
    idx = _read_index(root)
    out = [c for c in idx if c.get("id") != conv["id"]]
    out.insert(0, {
        "id": conv["id"],
        "agent_id": _agent_id(conv.get("agent_id")),
        "title": conv.get("title") or "Untitled",
        "model": conv.get("model"),
        "created_at": conv.get("created_at"),
        "updated_at": conv.get("updated_at"),
        "message_count": sum(1 for m in conv.get("messages", []) if m.get("role") in {"user", "assistant"}),
    })
    _write_index(root, out[:200])


def list_conversations(root: Path, *, limit: int = 50, agent_id: Optional[str] = None) -> List[Dict[str, Any]]:
    idx = _read_index(root)
    if agent_id is not None:
        wanted = _agent_id(agent_id)
        idx = [c for c in idx if _agent_id(c.get("agent_id")) == wanted]
    idx.sort(key=lambda c: c.get("updated_at") or 0, reverse=True)
    return idx[:max(1, int(limit))]
