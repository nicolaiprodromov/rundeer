"""Graph mutation tools.

These do NOT mutate server state directly. Each function returns a list of
patch ops the client will apply against its own graph state. The conversation
loop forwards the patch ops to the client as a `graph_patch` event before
returning the tool result to the model.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


SocketMap = Dict[str, str]


NODE_SOCKETS: Dict[str, Dict[str, SocketMap]] = {
    "text-input": {"inputs": {}, "outputs": {"out": "text"}},
    "number-input": {"inputs": {}, "outputs": {"out": "number"}},
    "boolean-input": {"inputs": {}, "outputs": {"out": "boolean"}},
    "file": {"inputs": {}, "outputs": {"out": "any"}},
    "text-join": {"inputs": {"a": "any", "b": "any"}, "outputs": {"out": "text"}},
    "compress-image": {"inputs": {"in": "any", "instructions": "text"}, "outputs": {"out": "any"}},
    "math-op": {"inputs": {"a": "number", "b": "number"}, "outputs": {"out": "number"}},
    "text-op": {"inputs": {"a": "any", "b": "any"}, "outputs": {"out": "text"}},
    "reroute": {"inputs": {"in": "any"}, "outputs": {"out": "any"}},
    "prompt-filter": {"inputs": {"prompt": "text", "instructions": "text", "input": "image"}, "outputs": {"out": "text"}},
    "definition": {"inputs": {"args": "text"}, "outputs": {"out": "text"}},
    "cmd-image": {"inputs": {"trigger": "run", "subject": "text", "input": "image"}, "outputs": {"out": "image"}},
    "cmd-video": {"inputs": {"trigger": "run", "subject": "text", "motion": "text", "start_frame": "image", "input": "image"}, "outputs": {"out": "video"}},
    "cmd-edit": {"inputs": {"trigger": "run", "input": "image", "subject": "text", "motion": "text"}, "outputs": {"out": "any"}},
    "cmd-merge": {"inputs": {"trigger": "run", "input": "image", "subject": "text"}, "outputs": {"out": "image"}},
    "cmd-extend": {"inputs": {"trigger": "run", "source": "video", "subject": "text", "motion": "text"}, "outputs": {"out": "video"}},
    "folder-bundle": {"inputs": {}, "outputs": {"out": "any"}},
    "create-bundle": {"inputs": {"items": "any"}, "outputs": {"out": "any"}},
    "sample-bundle": {"inputs": {"bundle": "any"}, "outputs": {"out": "any", "count": "number"}},
    "loop-decompose": {"inputs": {"bundle": "any"}, "outputs": {"item": "any", "index": "number", "count": "number"}},
    "loop-output": {"inputs": {"item": "any"}, "outputs": {"out": "any"}},
    "run-trigger": {"inputs": {}, "outputs": {"run": "run"}},
    "preview": {"inputs": {"in": "any"}, "outputs": {"out": "any"}},
}


NODE_SOCKET_ALIASES: Dict[Tuple[str, str], Dict[str, str]] = {
    ("cmd-image", "inputs"): {"run": "trigger", "prompt": "subject", "text": "subject", "description": "subject", "references": "input", "reference": "input"},
    ("cmd-video", "inputs"): {"run": "trigger", "prompt": "subject", "text": "subject", "description": "subject", "image": "start_frame", "startframe": "start_frame", "start": "start_frame", "references": "input", "reference": "input"},
    ("cmd-edit", "inputs"): {"run": "trigger", "prompt": "subject", "text": "subject", "description": "subject", "instructions": "subject", "images": "input", "references": "input"},
    ("cmd-merge", "inputs"): {"run": "trigger", "prompt": "subject", "text": "subject", "description": "subject", "images": "input", "references": "input"},
    ("cmd-extend", "inputs"): {"run": "trigger", "prompt": "subject", "text": "subject", "description": "subject", "clip": "source", "video": "source"},
    ("preview", "inputs"): {"input": "in", "image": "in", "video": "in", "text": "in", "value": "in", "preview": "in"},
    ("text-input", "outputs"): {"value": "out", "text": "out", "string": "out", "output": "out"},
    ("number-input", "outputs"): {"value": "out", "number": "out", "output": "out"},
    ("boolean-input", "outputs"): {"value": "out", "boolean": "out", "output": "out"},
    ("create-bundle", "inputs"): {"item": "items", "input": "items"},
    ("run-trigger", "outputs"): {"out": "run", "output": "run", "trigger": "run"},
}


GLOBAL_SINGLE_OUTPUT_ALIASES = {"out", "output", "result", "value", "image", "video", "text", "string", "bundle", "file", "path"}
GLOBAL_SINGLE_INPUT_ALIASES = {"in", "input", "value", "item", "image", "video", "text", "string", "bundle", "file", "path"}


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
    return {from_type, to_type} == {"filepath", "text"}


def _resolve_socket(node_type: str, socket: str, direction: str) -> Tuple[Optional[str], Optional[str]]:
    sockets = NODE_SOCKETS.get(node_type, {}).get(direction) or {}
    if not sockets:
        return None, f"{node_type} has no {direction[:-1]} sockets"
    if socket in sockets:
        return socket, None

    wanted = _norm_token(socket)
    normalized_ids = {_norm_token(socket_id): socket_id for socket_id in sockets}
    if wanted in normalized_ids:
        return normalized_ids[wanted], None

    aliases = NODE_SOCKET_ALIASES.get((node_type, direction), {})
    if wanted in aliases and aliases[wanted] in sockets:
        return aliases[wanted], None

    if len(sockets) == 1:
        only_id, only_type = next(iter(sockets.items()))
        aliases_for_single = GLOBAL_SINGLE_OUTPUT_ALIASES if direction == "outputs" else GLOBAL_SINGLE_INPUT_ALIASES
        if wanted in aliases_for_single or wanted == _norm_token(only_type):
            return only_id, None

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
    # NOTE: op name must match web/static/node-editor.js `applyAgentPatchOp`.
    return {
        "patch": [_patch("add_edge", fromNode=from_node, fromSocket=resolved_from, toNode=to_node, toSocket=resolved_to)],
        "summary": f"connect {from_node}.{resolved_from} → {to_node}.{resolved_to}",
    }


def disconnect_nodes_tool(*, edge_id: Optional[str] = None, from_node: Optional[str] = None, to_node: Optional[str] = None, to_socket: Optional[str] = None) -> Dict[str, Any]:
    if edge_id:
        return {"patch": [_patch("remove_edge", id=edge_id)], "summary": f"disconnect {edge_id}", "destructive": True}
    if to_node and to_socket:
        # Client handler currently keys remove_edge off `id`; without an edge id
        # we surface a clear error rather than silently dropping the op.
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
    # No client-side handler yet; surface as a no-op summary so the model
    # doesn't think layout silently succeeded.
    return {"patch": [], "summary": f"auto-layout requested ({mode}) — not yet supported client-side"}


def select_nodes_tool(*, node_ids: List[str]) -> Dict[str, Any]:
    ids = list(node_ids or [])
    return {"patch": [_patch("select", ids=ids)], "summary": f"select {len(ids)} node(s)"}


def clear_graph_tool() -> Dict[str, Any]:
    return {"patch": [_patch("clear_graph")], "summary": "clear entire graph", "destructive": True}
