"""Self-modify tools: emit patches against the agent brain graph.

Every tool here returns a dict of shape::

    {"patch_target": "brain", "patch": [ops], "summary": "human text"}

The conversation loop forwards the patch via a ``brain_graph_patch`` event so
the frontend applies it to the brain canvas, then echoes back a snapshot.
The conversation will reload the compiled runtime so subsequent steps in the
same turn observe the edits.

These tools intentionally do NOT write to disk directly — the brain canvas
in the UI is the source of truth during a session, and the websocket
snapshot pipeline persists via ``save_brain_graph`` on the next snapshot
acknowledgement (or on explicit Save).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from ..brain_graph import build_default_graph, load_brain_graph


def _load(root: Path, agent_id: str = "default") -> Dict[str, Any]:
    graph = load_brain_graph(root, agent_id=agent_id)
    if graph is None:
        graph = build_default_graph(root)
        graph["agent_id"] = agent_id
    return graph


def _next_id(graph: Dict[str, Any], prefix: str) -> str:
    nodes = graph.get("nodes") or {}
    n = int(graph.get("_nextId") or 1)
    while True:
        nid = f"{prefix}_{n}"
        if nid not in nodes:
            return nid
        n += 1


def _find_node(graph: Dict[str, Any], *, type_: Optional[str] = None, id_: Optional[str] = None) -> Optional[Dict[str, Any]]:
    for nid, node in (graph.get("nodes") or {}).items():
        if id_ is not None and nid == id_:
            return node
        if type_ is not None and node.get("type") == type_ and id_ is None:
            return node
    return None


def _ok(patch: List[Dict[str, Any]], summary: str, **extra: Any) -> Dict[str, Any]:
    out = {"patch_target": "brain", "patch": patch, "summary": summary}
    out.update(extra)
    return out


def _brain_section_targets(graph: Dict[str, Any]) -> Dict[str, Any]:
    """Return the brain node and the node we should attach new section
    text-input nodes to (the bundle wired into brain.sections, if any;
    otherwise the brain node itself)."""
    brain = _find_node(graph, type_="brain")
    if brain is None:
        return {"brain": None, "target": None, "socket": None}
    target_id = None
    target_socket = "sections"
    for edge in graph.get("edges") or []:
        if edge.get("toNode") == brain["id"] and edge.get("toSocket") == "sections":
            target_id = edge.get("fromNode")
            break
    if target_id:
        target_node = (graph.get("nodes") or {}).get(target_id)
        if target_node and target_node.get("type") == "create-bundle":
            return {"brain": brain, "target": target_node, "socket": "items"}
    return {"brain": brain, "target": brain, "socket": target_socket}


# ── Read ──────────────────────────────────────────────────────────────────

def read_brain_graph(*, root: Path, agent_id: str = "default") -> Dict[str, Any]:
    g = _load(root, agent_id=agent_id)
    nodes = g.get("nodes") or {}
    sections: List[Dict[str, Any]] = []
    tools: List[Dict[str, Any]] = []
    settings: Dict[str, Any] = {}
    for nid, n in nodes.items():
        t = n.get("type")
        props = n.get("props") or {}
        if t == "text-input":
            sections.append({"id": nid, "preview": (str(props.get("value") or ""))[:120]})
        elif t == "tool-flag":
            tools.append({
                "id": nid,
                "tool_name": props.get("tool_name"),
                "enabled": bool(props.get("enabled", True)),
                "description": props.get("description") or "",
                "category": props.get("category") or "",
                "destructive": props.get("destructive"),
            })
        elif t == "agent":
            settings = dict(props)
    return {
        "sections": sections,
        "tools": tools,
        "settings": settings,
    }


# ── System prompt sections (generic text-input nodes wired into brain) ────

def set_system_prompt_section(*, root: Path, section_id: str, body: str, agent_id: str = "default") -> Dict[str, Any]:
    g = _load(root, agent_id=agent_id)
    node = (g.get("nodes") or {}).get(section_id)
    if not node or node.get("type") != "text-input":
        return {"error": f"no text-input section node with id '{section_id}'"}
    props = dict(node.get("props") or {})
    props["value"] = str(body or "")
    return _ok(
        [{"op": "set_props", "id": section_id, "props": props}],
        f"updated brain section '{section_id}'",
    )


def add_system_prompt_section(*, root: Path, body: str, agent_id: str = "default") -> Dict[str, Any]:
    g = _load(root, agent_id=agent_id)
    tgt = _brain_section_targets(g)
    brain = tgt["brain"]
    if brain is None:
        return {"error": "no brain node in brain graph"}
    target = tgt["target"]
    socket = tgt["socket"]
    new_id = _next_id(g, "section")
    y = 0
    for n in (g.get("nodes") or {}).values():
        if n.get("type") == "text-input":
            y = max(y, int(n.get("y") or 0) + 220)
    node = {
        "id": new_id,
        "type": "text-input",
        "x": 0,
        "y": y,
        "props": {"value": str(body or "")},
    }
    edge = {
        "id": f"e_{new_id}",
        "fromNode": new_id,
        "fromSocket": "out",
        "toNode": target["id"],
        "toSocket": socket,
    }
    return _ok(
        [{"op": "add_node", "node": node}, {"op": "add_edge", "edge": edge}],
        f"added brain section ({len(body)} chars)",
    )


def remove_system_prompt_section(*, root: Path, section_id: str, agent_id: str = "default") -> Dict[str, Any]:
    g = _load(root, agent_id=agent_id)
    node = (g.get("nodes") or {}).get(section_id)
    if not node or node.get("type") != "text-input":
        return {"error": f"no text-input section node with id '{section_id}'"}
    return _ok(
        [{"op": "remove_node", "id": section_id}],
        f"removed brain section '{section_id}'",
    )


# ── Tool flags ────────────────────────────────────────────────────────────

def set_tool_flag(
    *, root: Path,
    tool_name: str,
    enabled: Optional[bool] = None,
    description: Optional[str] = None,
    category: Optional[str] = None,
    destructive: Optional[bool] = None,
    agent_id: str = "default",
) -> Dict[str, Any]:
    g = _load(root, agent_id=agent_id)
    target: Optional[Dict[str, Any]] = None
    for n in (g.get("nodes") or {}).values():
        if n.get("type") == "tool-flag" and (n.get("props") or {}).get("tool_name") == tool_name:
            target = n
            break
    if target is None:
        return {"error": f"no tool-flag node for tool '{tool_name}' in brain graph"}
    props = dict(target.get("props") or {})
    if enabled is not None:
        props["enabled"] = bool(enabled)
    if description is not None:
        props["description"] = str(description)
    if category is not None:
        props["category"] = str(category)
    if destructive is not None:
        props["destructive"] = bool(destructive)
    return _ok(
        [{"op": "set_props", "id": target["id"], "props": props}],
        f"updated tool '{tool_name}' (enabled={props.get('enabled')})",
    )


# ── Agent settings ────────────────────────────────────────────────────────

ALLOWED_SETTINGS_KEYS = {
    "model", "temperature", "max_tool_iterations", "max_web_search_per_turn",
    "max_file_bytes", "max_list_entries", "vision_enabled",
}


def set_agent_setting(*, root: Path, key: str, value: Any, agent_id: str = "default") -> Dict[str, Any]:
    if key not in ALLOWED_SETTINGS_KEYS:
        return {"error": f"setting '{key}' is not editable (allowed: {sorted(ALLOWED_SETTINGS_KEYS)})"}
    g = _load(root, agent_id=agent_id)
    node = _find_node(g, type_="agent")
    if node is None:
        return {"error": "no agent node in brain graph"}
    props = dict(node.get("props") or {})
    props[key] = value
    return _ok(
        [{"op": "set_props", "id": node["id"], "props": props}],
        f"set agent setting {key} = {value!r}",
    )
