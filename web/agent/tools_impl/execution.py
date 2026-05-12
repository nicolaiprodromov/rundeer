"""Graph execution tools (plan / run)."""
from __future__ import annotations

from typing import Any, Dict


def plan_graph_tool(root, *, graph: Dict[str, Any], subset=None) -> Dict[str, Any]:
    from rundeer.web.server import run_plan
    if not isinstance(graph, dict):
        return {"error": "graph must be an object"}
    payload = {"graph": graph}
    if subset:
        payload["subset"] = subset
    try:
        return run_plan(root, payload)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def run_graph_tool(server, *, graph: Dict[str, Any], subset=None, dry_run: bool = False) -> Dict[str, Any]:
    from rundeer.web.server import start_run
    if not isinstance(graph, dict):
        return {"error": "graph must be an object"}
    payload = {"graph": graph, "dryRun": bool(dry_run)}
    if subset:
        payload["subset"] = subset
    try:
        return start_run(server, payload)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
