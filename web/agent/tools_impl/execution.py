"""Graph execution tools (plan / run)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


COMMAND_TYPES = {"cmd-image", "cmd-video", "cmd-edit", "cmd-merge", "cmd-extend"}


def _patch(op: str, **fields: Any) -> Dict[str, Any]:
    return {"op": op, **fields}


def _id_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (list, tuple, set)):
        out: List[str] = []
        for item in value:
            text = str(item).strip()
            if text:
                out.append(text)
        return out
    return []


def _node_type(graph: Dict[str, Any], node_id: str) -> str:
    node = (graph.get("nodes") or {}).get(node_id)
    return str(node.get("type") or "") if isinstance(node, dict) else ""


def _connected_trigger_ids(graph: Dict[str, Any]) -> List[str]:
    nodes = graph.get("nodes") if isinstance(graph.get("nodes"), dict) else {}
    edges = graph.get("edges") if isinstance(graph.get("edges"), list) else []
    trigger_ids: List[str] = []
    for node_id, node in nodes.items():
        if not isinstance(node, dict) or node.get("type") != "run-trigger":
            continue
        if any(
            edge.get("fromNode") == node_id
            and edge.get("fromSocket") == "run"
            and _node_type(graph, str(edge.get("toNode") or "")) in COMMAND_TYPES
            for edge in edges
            if isinstance(edge, dict)
        ):
            trigger_ids.append(str(node_id))
    return trigger_ids


def _execution_patch(*, graph: Dict[str, Any], subset: Any = None, dry_run: bool = False, trigger_node: Optional[str] = None) -> Dict[str, Any]:
    if not isinstance(graph, dict):
        return {"error": "graph must be an object"}
    nodes = graph.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        return {"error": "graph is empty"}

    subset_ids = _id_list(subset)
    trigger_id = str(trigger_node or "").strip()
    if trigger_id:
        if _node_type(graph, trigger_id) != "run-trigger":
            return {"error": f"trigger_node is not a run-trigger: {trigger_id}"}
        return {
            "patch": [_patch("run_trigger", id=trigger_id, dryRun=bool(dry_run))],
            "summary": f"{'dry-run' if dry_run else 'run'} trigger {trigger_id} in browser",
        }

    subset_triggers = [node_id for node_id in subset_ids if _node_type(graph, node_id) == "run-trigger"]
    if len(subset_triggers) == 1:
        trigger_id = subset_triggers[0]
        return {
            "patch": [_patch("run_trigger", id=trigger_id, dryRun=bool(dry_run))],
            "summary": f"{'dry-run' if dry_run else 'run'} trigger {trigger_id} in browser",
        }

    if not subset_ids:
        connected_triggers = _connected_trigger_ids(graph)
        if len(connected_triggers) == 1:
            trigger_id = connected_triggers[0]
            return {
                "patch": [_patch("run_trigger", id=trigger_id, dryRun=bool(dry_run))],
                "summary": f"{'dry-run' if dry_run else 'run'} trigger {trigger_id} in browser",
            }

    op = _patch("run_graph", dryRun=bool(dry_run))
    if subset_ids:
        op["subset"] = subset_ids
    return {
        "patch": [op],
        "summary": f"{'dry-run' if dry_run else 'run'} graph in browser",
    }


def plan_graph_tool(root, *, graph: Dict[str, Any], subset=None, trigger_node: Optional[str] = None) -> Dict[str, Any]:
    return _execution_patch(graph=graph, subset=subset, dry_run=True, trigger_node=trigger_node)


def run_graph_tool(server, *, graph: Dict[str, Any], subset=None, dry_run: bool = False, trigger_node: Optional[str] = None) -> Dict[str, Any]:
    return _execution_patch(graph=graph, subset=subset, dry_run=dry_run, trigger_node=trigger_node)
