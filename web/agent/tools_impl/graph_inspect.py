
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _ensure_graph(graph: Any) -> Dict[str, Any]:
    if not isinstance(graph, dict):
        return {"nodes": {}, "edges": []}
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    return {
        "nodes": nodes if isinstance(nodes, dict) else {},
        "edges": edges if isinstance(edges, list) else [],
    }


def _summary(node: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": node.get("id"),
        "type": node.get("type"),
        "x": node.get("x"),
        "y": node.get("y"),
        "collapsed": bool(node.get("collapsed")),
        "lastRunStatus": node.get("lastRunStatus"),
    }


def list_nodes_tool(graph: Any, *, type_filter: Optional[str] = None) -> Dict[str, Any]:
    g = _ensure_graph(graph)
    nodes = list(g["nodes"].values())
    if type_filter:
        nodes = [n for n in nodes if n.get("type") == type_filter]
    nodes.sort(key=lambda n: (n.get("y") or 0, n.get("x") or 0))
    return {"count": len(nodes), "nodes": [_summary(n) for n in nodes]}


def get_node_tool(graph: Any, *, node_id: str, include_result: bool = False) -> Dict[str, Any]:
    g = _ensure_graph(graph)
    node = g["nodes"].get(node_id)
    if not node:
        return {"error": f"unknown node: {node_id}"}
    out = {
        "id": node.get("id"),
        "type": node.get("type"),
        "x": node.get("x"), "y": node.get("y"),
        "width": node.get("width"),
        "collapsed": bool(node.get("collapsed")),
        "props": node.get("props") or {},
        "lastRunStatus": node.get("lastRunStatus"),
    }
    if include_result:
        out["lastResult"] = node.get("lastResult")

    incoming, outgoing = [], []
    for edge in g["edges"]:
        if edge.get("toNode") == node_id:
            incoming.append({"id": edge.get("id"), "fromNode": edge.get("fromNode"), "fromSocket": edge.get("fromSocket"), "toSocket": edge.get("toSocket")})
        if edge.get("fromNode") == node_id:
            outgoing.append({"id": edge.get("id"), "toNode": edge.get("toNode"), "fromSocket": edge.get("fromSocket"), "toSocket": edge.get("toSocket")})
    out["incoming"] = incoming
    out["outgoing"] = outgoing
    return out


def list_edges_tool(graph: Any) -> Dict[str, Any]:
    g = _ensure_graph(graph)
    return {"count": len(g["edges"]), "edges": g["edges"]}


def get_selection_tool(graph: Any) -> Dict[str, Any]:
    sel = []
    if isinstance(graph, dict):
        sel = list(graph.get("selection") or [])
    return {"selection": sel}


def validate_graph_tool(graph: Any) -> Dict[str, Any]:
    g = _ensure_graph(graph)
    issues: List[Dict[str, Any]] = []
    node_ids = set(g["nodes"].keys())

    for edge in g["edges"]:
        if edge.get("fromNode") not in node_ids or edge.get("toNode") not in node_ids:
            issues.append({"severity": "error", "kind": "orphan-edge", "edge": edge.get("id")})

    has_trigger = any(n.get("type") == "run-trigger" for n in g["nodes"].values())
    if g["nodes"] and not has_trigger:
        issues.append({"severity": "warning", "kind": "no-trigger", "message": "graph has nodes but no run-trigger"})
    return {"issue_count": len(issues), "issues": issues, "node_count": len(g["nodes"]), "edge_count": len(g["edges"])}
