from __future__ import annotations

from typing import Any, Dict, List, Tuple


def _node_signature(node: Dict[str, Any]) -> Tuple[Any, ...]:
    return (
        node.get("type"),
        round(float(node.get("x") or 0), 1),
        round(float(node.get("y") or 0), 1),
        tuple(sorted((node.get("props") or {}).items(), key=lambda kv: kv[0]))[:8],
    )


def _edges_set(graph: Dict[str, Any]) -> set:
    edges = graph.get("edges") if isinstance(graph, dict) else []
    if not isinstance(edges, list):
        return set()
    out = set()
    for e in edges:
        if not isinstance(e, dict):
            continue
        out.add((e.get("fromNode"), e.get("fromSocket"), e.get("toNode"), e.get("toSocket")))
    return out


def diff_graphs(prev: Any, curr: Any) -> Dict[str, Any]:





    p_nodes = (prev or {}).get("nodes") if isinstance(prev, dict) else {}
    c_nodes = (curr or {}).get("nodes") if isinstance(curr, dict) else {}
    p_nodes = p_nodes if isinstance(p_nodes, dict) else {}
    c_nodes = c_nodes if isinstance(c_nodes, dict) else {}

    p_ids = set(p_nodes.keys())
    c_ids = set(c_nodes.keys())

    added = sorted(c_ids - p_ids)
    removed = sorted(p_ids - c_ids)
    modified: List[Dict[str, Any]] = []
    for nid in sorted(p_ids & c_ids):
        ps, cs = _node_signature(p_nodes[nid]), _node_signature(c_nodes[nid])
        if ps != cs:

            changes: List[str] = []
            if (p_nodes[nid].get("type") != c_nodes[nid].get("type")):
                changes.append("type")
            if (round(float(p_nodes[nid].get("x") or 0), 1) != round(float(c_nodes[nid].get("x") or 0), 1)) or \
               (round(float(p_nodes[nid].get("y") or 0), 1) != round(float(c_nodes[nid].get("y") or 0), 1)):
                changes.append("position")
            p_props = p_nodes[nid].get("props") or {}
            c_props = c_nodes[nid].get("props") or {}
            prop_keys = set(p_props.keys()) | set(c_props.keys())
            changed_props = [k for k in prop_keys if p_props.get(k) != c_props.get(k)]
            if changed_props:
                changes.append("props:" + ",".join(sorted(changed_props)[:6]))
            modified.append({"id": nid, "type": c_nodes[nid].get("type"), "changes": changes})

    p_edges = _edges_set(prev or {})
    c_edges = _edges_set(curr or {})
    added_edges = sorted(c_edges - p_edges)
    removed_edges = sorted(p_edges - c_edges)

    return {
        "added_nodes": [{"id": nid, "type": c_nodes[nid].get("type")} for nid in added],
        "removed_nodes": [{"id": nid, "type": p_nodes[nid].get("type")} for nid in removed],
        "modified_nodes": modified,
        "added_edges": [
            {"fromNode": a, "fromSocket": b, "toNode": c, "toSocket": d}
            for (a, b, c, d) in added_edges
        ],
        "removed_edges": [
            {"fromNode": a, "fromSocket": b, "toNode": c, "toSocket": d}
            for (a, b, c, d) in removed_edges
        ],
    }


def has_changes(diff: Dict[str, Any]) -> bool:
    return any(diff.get(k) for k in ("added_nodes", "removed_nodes", "modified_nodes", "added_edges", "removed_edges"))


def format_diff_note(diff: Dict[str, Any]) -> str:

    lines: List[str] = ["[user edited graph between turns]"]
    if diff["added_nodes"]:
        lines.append("  added: " + ", ".join(f"{n['id']}({n['type']})" for n in diff["added_nodes"][:8]))
    if diff["removed_nodes"]:
        lines.append("  removed: " + ", ".join(f"{n['id']}({n['type']})" for n in diff["removed_nodes"][:8]))
    if diff["modified_nodes"]:
        parts = []
        for n in diff["modified_nodes"][:8]:
            parts.append(f"{n['id']}({n['type']})[{'+'.join(n['changes'])}]")
        lines.append("  modified: " + ", ".join(parts))
    if diff["added_edges"]:
        lines.append("  +" + str(len(diff["added_edges"])) + " edge(s)")
    if diff["removed_edges"]:
        lines.append("  -" + str(len(diff["removed_edges"])) + " edge(s)")
    return "\n".join(lines)
