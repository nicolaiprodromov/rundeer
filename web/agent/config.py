"""Agent runtime settings sourced from .env + .rundeer/config.json."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from rundeer.core.config import load_project_env


DEFAULT_AGENT_PORT_OFFSET = 1


@dataclass
class AgentSettings:
    enabled: bool = True
    model: str = ""
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    ws_host: str = "127.0.0.1"
    ws_port: int = 0  # 0 → derived from web port
    max_tool_iterations: int = 32
    max_file_bytes: int = 200_000
    max_list_entries: int = 200
    max_web_search_per_turn: int = 8
    vision_enabled: bool = True
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_safe_dict(self) -> Dict[str, Any]:
        d = {
            "enabled": self.enabled,
            "model": self.model,
            "base_url": self.base_url,
            "max_tool_iterations": self.max_tool_iterations,
            "max_file_bytes": self.max_file_bytes,
            "max_list_entries": self.max_list_entries,
            "max_web_search_per_turn": self.max_web_search_per_turn,
            "vision_enabled": self.vision_enabled,
            "api_key_present": bool(self.api_key),
        }
        return d


def _read_config_json(root: Path) -> Dict[str, Any]:
    path = root / ".rundeer" / "config.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def get_agent_settings(root: Path) -> AgentSettings:
    """Resolve agent settings for a project root.

    Precedence: env > .rundeer/config.json["agent"] > defaults.
    """
    load_project_env(root)
    cfg = _read_config_json(root)
    agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}

    # Strict, no fallbacks: .env is the single source of truth.
    api_key = os.environ.get("MODEL_API_KEY") or ""
    base_url = os.environ.get("BASE_URL") or None
    model = (os.environ.get("MODEL_NAME") or "").strip()

    enabled_raw = agent_cfg.get("enabled", True)
    if isinstance(enabled_raw, str):
        enabled = enabled_raw.lower() in {"1", "true", "yes", "on"}
    else:
        enabled = bool(enabled_raw)

    return AgentSettings(
        enabled=enabled,
        model=model,
        api_key=api_key or None,
        base_url=str(base_url) if base_url else None,
        ws_host=str(agent_cfg.get("ws_host") or "127.0.0.1"),
        ws_port=int(os.environ.get("AGENT_PORT") or agent_cfg.get("ws_port") or 0),
        max_tool_iterations=int(agent_cfg.get("max_tool_iterations") or 32),
        max_file_bytes=int(agent_cfg.get("max_file_bytes") or 200_000),
        max_list_entries=int(agent_cfg.get("max_list_entries") or 200),
        max_web_search_per_turn=int(agent_cfg.get("max_web_search_per_turn") or 8),
        vision_enabled=bool(agent_cfg.get("vision_enabled", True)),
        extra={k: v for k, v in agent_cfg.items() if k not in {
            "enabled", "model", "base_url", "ws_host", "ws_port",
            "max_tool_iterations", "max_file_bytes", "max_list_entries",
            "max_web_search_per_turn", "vision_enabled",
        }},
    )


def resolve_ws_port(settings: AgentSettings, web_port: int) -> int:
    if settings.ws_port > 0:
        return settings.ws_port
    return web_port + DEFAULT_AGENT_PORT_OFFSET
