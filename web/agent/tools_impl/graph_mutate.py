






from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from web.node_defs import node_defs_socket_map

SocketMap = Dict[str, str]


NODE_SOCKETS: Dict[str, Dict[str, SocketMap]] = node_defs_socket_map()


def _patch(op: str, **fields) -> Dict[str, Any]:
    return {"op": op, **fields}


def _norm_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _graph_node(graph: Any, node_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(graph, dict):
        return None
    nodes = graph.get("nodes")
    if not isinstance(nodes, dict):
        return None
    node = nodes.get(node_id)
    return node if isinstance(node, dict) else None


def _base_type(socket_type: str) -> str:
    if socket_type == "image-bundle":
        return "image"
    if socket_type == "video-bundle":
        return "video"
    return socket_type


def _can_connect(from_type: str, to_type: str) -> bool:
    if not from_type or not to_type:
        return False
    if from_type == to_type:
        return True
    if from_type == "run" or to_type == "run":
        return False
    if from_type == "any" or to_type == "any":
        return True
    if _base_type(from_type) == _base_type(to_type):
        return True
    if {from_type, to_type} in ({"vector", "vector-map"}, {"vector-map", "image"}, {"vector", "image"}):
        return True
    if from_type in ("integer", "float") and to_type in ("integer", "float"):
        return True
    return {from_type, to_type} == {"filepath", "text"}


def _resolve_socket(node_type: str, socket: str, direction: str) -> Tuple[Optional[str], Optional[str]]:
    sockets = NODE_SOCKETS.get(node_type, {}).get(direction) or {}
    if not sockets:
        return None, f"{node_type} has no {direction[:-1]} sockets"
    if socket in sockets:
        return socket, None
    wanted = _norm_token(socket)
    normalized_ids = {_norm_token(sid): sid for sid in sockets}
    if wanted in normalized_ids:
        return normalized_ids[wanted], None
    valid = ", ".join(sorted(sockets))
    return None, f"unknown {direction[:-1]} socket '{socket}' for {node_type}; use one of: {valid}"


def _connect_error(graph: Any, from_node: str, from_socket: str, to_node: str, to_socket: str) -> Optional[Dict[str, Any]]:
    source = _graph_node(graph, from_node)
    target = _graph_node(graph, to_node)
    if source is None:
        return {"error": f"unknown from_node: {from_node}"}
    if target is None:
        return {"error": f"unknown to_node: {to_node}"}

    source_type = str(source.get("type") or "")
    target_type = str(target.get("type") or "")
    if source_type not in NODE_SOCKETS:
        return {"error": f"unknown node type for {from_node}: {source_type}"}
    if target_type not in NODE_SOCKETS:
        return {"error": f"unknown node type for {to_node}: {target_type}"}

    resolved_from, from_error = _resolve_socket(source_type, from_socket, "outputs")
    if from_error:
        return {"error": from_error}
    resolved_to, to_error = _resolve_socket(target_type, to_socket, "inputs")
    if to_error:
        return {"error": to_error}

    from_type = NODE_SOCKETS[source_type]["outputs"][resolved_from or from_socket]
    to_type = NODE_SOCKETS[target_type]["inputs"][resolved_to or to_socket]
    if not _can_connect(from_type, to_type):
        return {"error": f"incompatible socket types: {source_type}.{resolved_from} is {from_type}, {target_type}.{resolved_to} is {to_type}"}
    return None


def _resolve_connection(graph: Any, from_node: str, from_socket: str, to_node: str, to_socket: str) -> Tuple[str, str, Optional[Dict[str, Any]]]:
    source = _graph_node(graph, from_node)
    target = _graph_node(graph, to_node)
    if source is None or target is None:
        err = _connect_error(graph, from_node, from_socket, to_node, to_socket)
        return from_socket, to_socket, err
    source_type = str(source.get("type") or "")
    target_type = str(target.get("type") or "")
    resolved_from, from_error = _resolve_socket(source_type, from_socket, "outputs")
    if from_error:
        return from_socket, to_socket, {"error": from_error}
    resolved_to, to_error = _resolve_socket(target_type, to_socket, "inputs")
    if to_error:
        return resolved_from or from_socket, to_socket, {"error": to_error}
    err = _connect_error(graph, from_node, resolved_from or from_socket, to_node, resolved_to or to_socket)
    return resolved_from or from_socket, resolved_to or to_socket, err


def add_node_tool(
    *,
    type: str,
    x: float = 0.0,
    y: float = 0.0,
    props: Optional[Dict[str, Any]] = None,
    node_id: Optional[str] = None,
) -> Dict[str, Any]:
    if not type:
        return {"error": "missing node type"}
    op = _patch("add_node", type=type, x=float(x), y=float(y), props=props or {})
    if node_id:
        op["id"] = node_id
    return {"patch": [op], "summary": f"add {type} @ ({x:.0f},{y:.0f})"}


def remove_node_tool(*, node_id: str) -> Dict[str, Any]:
    if not node_id:
        return {"error": "missing node_id"}
    return {"patch": [_patch("remove_node", id=node_id)], "summary": f"remove {node_id}", "destructive": True}


def connect_nodes_tool(
    *, from_node: str, from_socket: str, to_node: str, to_socket: str, graph: Any = None,
) -> Dict[str, Any]:
    if not (from_node and to_node and from_socket and to_socket):
        return {"error": "from_node, from_socket, to_node, to_socket are required"}
    resolved_from, resolved_to, error = _resolve_connection(graph, from_node, from_socket, to_node, to_socket)
    if error:
        return error

    return {
        "patch": [_patch("add_edge", fromNode=from_node, fromSocket=resolved_from, toNode=to_node, toSocket=resolved_to)],
        "summary": f"connect {from_node}.{resolved_from} → {to_node}.{resolved_to}",
    }


def disconnect_nodes_tool(*, edge_id: Optional[str] = None, from_node: Optional[str] = None, to_node: Optional[str] = None, to_socket: Optional[str] = None) -> Dict[str, Any]:
    if edge_id:
        return {"patch": [_patch("remove_edge", id=edge_id)], "summary": f"disconnect {edge_id}", "destructive": True}
    if to_node and to_socket:


        return {"error": "disconnect by socket requires an edge_id; call list_edges first"}
    return {"error": "provide edge_id"}


def set_node_prop_tool(*, node_id: str, key: str, value: Any) -> Dict[str, Any]:
    if not node_id or not key:
        return {"error": "node_id and key are required"}
    return {
        "patch": [_patch("set_node_props", id=node_id, props={key: value})],
        "summary": f"set {node_id}.{key}",
    }


def move_node_tool(*, node_id: str, x: float, y: float) -> Dict[str, Any]:
    if not node_id:
        return {"error": "missing node_id"}
    return {"patch": [_patch("move_node", id=node_id, x=float(x), y=float(y))], "summary": f"move {node_id}"}


def layout_auto_tool(*, mode: str = "tidy") -> Dict[str, Any]:


    return {"patch": [], "summary": f"auto-layout requested ({mode}) — not yet supported client-side"}


def select_nodes_tool(*, node_ids: List[str]) -> Dict[str, Any]:
    ids = list(node_ids or [])
    return {"patch": [_patch("select", ids=ids)], "summary": f"select {len(ids)} node(s)"}


def clear_graph_tool() -> Dict[str, Any]:
    return {"patch": [_patch("clear_graph")], "summary": "clear entire graph", "destructive": True}
