from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict

from rundeer.core.config import load_project_env
from rundeer.core.models import provider_model, resolve_llm_api_key
from rundeer.core.paths import config_path
from web.config.settings_manager import get_cached_settings, load_settings_yaml


DEFAULT_AGENT_PORT_OFFSET = 1


@dataclass
class AgentSettings:
    enabled: bool = True
    model: str = ""
    ws_host: str = "127.0.0.1"
    ws_port: int = 0
    max_turns: int = 4000
    max_tokens: int = 99999999
    max_tool_iterations: int = 32
    max_file_bytes: int = 200_000
    max_list_entries: int = 200
    max_web_search_per_turn: int = 8
    vision_enabled: bool = True
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_safe_dict(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "model": self.model,
            "max_turns": self.max_turns,
            "max_tokens": self.max_tokens,
            "max_tool_iterations": self.max_tool_iterations,
            "max_file_bytes": self.max_file_bytes,
            "max_list_entries": self.max_list_entries,
            "max_web_search_per_turn": self.max_web_search_per_turn,
            "vision_enabled": self.vision_enabled,
            "api_key_present": bool(resolve_llm_api_key(self.model)),
        }


def _read_config_json(root: Path) -> Dict[str, Any]:
    path = config_path(root)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _read_yaml_agent(root: Path) -> Dict[str, Any]:
    data = get_cached_settings(root)
    if not isinstance(data, dict):
        data = load_settings_yaml(root)
    agent = data.get("settings", {}).get("Agent", {})
    return agent if isinstance(agent, dict) else {}


def get_agent_settings(root: Path) -> AgentSettings:
    load_project_env(root)
    cfg = _read_config_json(root)
    agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}
    yaml_agent = _read_yaml_agent(root)

    model = provider_model(str(yaml_agent.get("Provider") or ""))

    enabled_raw = agent_cfg.get("enabled", True)
    if isinstance(enabled_raw, str):
        enabled = enabled_raw.lower() in {"1", "true", "yes", "on"}
    else:
        enabled = bool(enabled_raw)

    return AgentSettings(
        enabled=enabled,
        model=model,
        ws_host=str(agent_cfg.get("ws_host") or "127.0.0.1"),
        ws_port=int(os.environ.get("AGENT_PORT") or agent_cfg.get("ws_port") or 0),
        max_turns=int(yaml_agent.get("Max_turns") or agent_cfg.get("max_turns") or 4000),
        max_tokens=int(yaml_agent.get("Max_tokens") or agent_cfg.get("max_tokens") or 99999999),
        max_tool_iterations=int(agent_cfg.get("max_tool_iterations") or 32),
        max_file_bytes=int(agent_cfg.get("max_file_bytes") or 200_000),
        max_list_entries=int(agent_cfg.get("max_list_entries") or 200),
        max_web_search_per_turn=int(agent_cfg.get("max_web_search_per_turn") or 8),
        vision_enabled=bool(agent_cfg.get("vision_enabled", True)),
        extra={k: v for k, v in agent_cfg.items() if k not in {
            "enabled", "model", "ws_host", "ws_port",
            "max_tool_iterations", "max_file_bytes", "max_list_entries",
            "max_web_search_per_turn", "vision_enabled", "max_turns", "max_tokens",
        }},
    )


def resolve_ws_port(settings: AgentSettings, web_port: int) -> int:
    if settings.ws_port > 0:
        return settings.ws_port
    return web_port + DEFAULT_AGENT_PORT_OFFSET
