"""Rundeer agent: chat-driven graph builder, debugger, and explorer.

Lean LiteLLM-based agent loop, streaming over WebSocket to the N panel.
"""
from __future__ import annotations

from .config import AgentSettings, get_agent_settings  # noqa: F401
