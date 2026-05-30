from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from rundeer.core.paths import agent_dir
from web.agent._io import atomic_write
from web.node_defs import get_node_defs

from .profiles import DEFAULT_AGENT_ID, normalize_agent_id


SCHEMA_VERSION = 1
BRAIN_GRAPH_FILENAME = "brain.graph.json"
RUNTIME_FILENAME = "runtime.json"
AUDIT_LOG_FILENAME = "brain.log"

_defs = get_node_defs()
DYNAMIC_SOURCE_TYPES = {"time", "context"}
TEXT_SOURCE_TYPES = {"text-input"}
BUNDLE_PASSTHROUGH_TYPES = {"create-bundle", "folder-bundle", "sample-bundle"}


@dataclass
class ToolOverride:
    enabled: bool = True
    description: Optional[str] = None
    category: Optional[str] = None
    destructive: Optional[bool] = None


@dataclass
class AgentRuntimeConfig:

    system_prompt: str = ""
    settings: Dict[str, Any] = field(default_factory=dict)
    tool_overrides: Optional[Dict[str, ToolOverride]] = None
    warnings: List[str] = field(default_factory=list)
    include_time: Optional[str] = None
    include_graph_context: bool = False
    include_app_context: bool = False
    include_workspace_context: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema": SCHEMA_VERSION,
            "system_prompt": self.system_prompt,
            "settings": dict(self.settings),
            "tool_overrides": None if self.tool_overrides is None else {
                name: {
                    "enabled": ov.enabled,
                    "description": ov.description,
                    "category": ov.category,
                    "destructive": ov.destructive,
                }
                for name, ov in self.tool_overrides.items()
            },
            "warnings": list(self.warnings),
            "compiled_at": time.time(),
            "include_time": self.include_time,
            "include_graph_context": self.include_graph_context,
            "include_app_context": self.include_app_context,
            "include_workspace_context": self.include_workspace_context,
        }




def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _as_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _nodes_of(graph: Dict[str, Any], node_type: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for node in (graph.get("nodes") or {}).values():
        if isinstance(node, dict) and node.get("type") == node_type and not _node_is_muted(node):
            out.append(node)
    return out


def _node_is_muted(node: Optional[Dict[str, Any]]) -> bool:
    return bool(node and node.get("muted"))


def _node_id_is_muted(graph: Dict[str, Any], node_id: Any) -> bool:
    node = (graph.get("nodes") or {}).get(node_id)
    return _node_is_muted(node if isinstance(node, dict) else None)


def _sorted_by_position(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def key(n: Dict[str, Any]) -> Tuple[float, float, str]:
        try:
            y = float(n.get("y") or 0)
        except (TypeError, ValueError):
            y = 0.0
        try:
            x = float(n.get("x") or 0)
        except (TypeError, ValueError):
            x = 0.0
        return (y, x, str(n.get("id") or ""))

    return sorted(nodes, key=key)


def _connected_inputs(graph: Dict[str, Any], target_id: str, target_socket: str) -> List[str]:

    if _node_id_is_muted(graph, target_id):
        return []
    out = []
    for edge in graph.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        if edge.get("toNode") == target_id and edge.get("toSocket") == target_socket:
            src = edge.get("fromNode")
            if isinstance(src, str) and not _node_id_is_muted(graph, src):
                out.append(src)
    return out




def seed_default_graph(
    *,
    core_prompt: str,
    all_tools: List[Any],
) -> Dict[str, Any]:













    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []
    nid = 1

    def next_id() -> str:
        nonlocal nid
        out = f"n{nid}"
        nid += 1
        return out


    X_SOURCES = 0.0
    X_BUNDLE = 380.0
    X_BRAIN = 760.0
    X_AGENT = 1140.0
    X_PREVIEW = 1140.0


    brain_id = next_id()
    nodes[brain_id] = {
        "id": brain_id,
        "type": "brain",
        "x": X_BRAIN,
        "y": 0.0,
        "props": {},
    }


    agent_id = next_id()
    nodes[agent_id] = {
        "id": agent_id,
        "type": "agent",
        "x": X_AGENT,
        "y": 0.0,
        "props": {
            "model": "",
            "max_tool_iterations": 32,
            "max_file_bytes": 200000,
            "max_list_entries": 200,
            "max_web_search_per_turn": 8,
            "vision_enabled": True,
            "temperature": "",
        },
    }
    edges.append({
        "id": f"e{brain_id}-{agent_id}",
        "fromNode": brain_id, "fromSocket": "out",
        "toNode": agent_id, "toSocket": "brain",
    })


    preview_id = next_id()
    nodes[preview_id] = {
        "id": preview_id,
        "type": "preview",
        "x": X_PREVIEW,
        "y": 320.0,
        "props": {},
        "width": 320,
        "height": 260,
    }
    edges.append({
        "id": f"e{brain_id}-{preview_id}",
        "fromNode": brain_id, "fromSocket": "out",
        "toNode": preview_id, "toSocket": "in",
    })


    sections = _split_prompt_into_sections(core_prompt)
    sections_bundle_id = next_id()
    nodes[sections_bundle_id] = {
        "id": sections_bundle_id,
        "type": "create-bundle",
        "x": X_BUNDLE,
        "y": -120.0,
        "props": {"label": "sections"},
    }
    edges.append({
        "id": f"e{sections_bundle_id}-{brain_id}-sec",
        "fromNode": sections_bundle_id, "fromSocket": "out",
        "toNode": brain_id, "toSocket": "sections",
    })

    sy = -120.0
    for title, body in sections:
        sid = next_id()
        text = f"# {title}\n\n{body}".rstrip() if title else body
        nodes[sid] = {
            "id": sid,
            "type": "text-input",
            "x": X_SOURCES,
            "y": sy,
            "props": {"value": text},
        }
        edges.append({
            "id": f"e{sid}-{sections_bundle_id}",
            "fromNode": sid, "fromSocket": "out",
            "toNode": sections_bundle_id, "toSocket": "items",
        })
        sy += 220.0


    toolbox_id = next_id()
    nodes[toolbox_id] = {
        "id": toolbox_id,
        "type": "toolbox",
        "x": X_SOURCES,
        "y": sy + 60.0,
        "width": 320,
        "props": {
            "disabled_tools": "",
        },
    }
    edges.append({
        "id": f"e{toolbox_id}-{brain_id}-tools",
        "fromNode": toolbox_id, "fromSocket": "out",
        "toNode": brain_id, "toSocket": "tools",
    })

    return {
        "version": 3,
        "kind": "brain",
        "nodes": nodes,
        "edges": edges,
        "_nextId": nid,
    }


def _split_prompt_into_sections(prompt: str) -> List[Tuple[str, str]]:




    lines = (prompt or "").splitlines()
    sections: List[Tuple[str, List[str]]] = []
    current_title = "Intro"
    current_body: List[str] = []

    for line in lines:
        m = line.strip()
        if m.startswith("# ") and len(m) > 2:
            if current_body or current_title != "Intro":
                sections.append((current_title, current_body))
            current_title = m[2:].strip()
            current_body = []
        else:
            current_body.append(line)
    sections.append((current_title, current_body))

    out: List[Tuple[str, str]] = []
    for title, body in sections:
        text = "\n".join(body).strip()
        if not text and title == "Intro" and len(out) == 0:
            continue
        out.append((title, text))
    return out




def _collect_text_sources(
    graph: Dict[str, Any],
    target_id: str,
    target_socket: str,
    visited: Optional[set] = None,
) -> List[Dict[str, Any]]:





    if visited is None:
        visited = set()
    out: List[Dict[str, Any]] = []
    src_ids = _connected_inputs(graph, target_id, target_socket)
    src_nodes = [
        (graph.get("nodes") or {}).get(sid) for sid in src_ids
    ]
    src_nodes = [n for n in src_nodes if isinstance(n, dict)]
    src_nodes = [n for n in src_nodes if not _node_is_muted(n)]
    src_nodes = _sorted_by_position(src_nodes)
    for node in src_nodes:
        nid = node.get("id")
        if not nid or nid in visited:
            continue
        visited.add(nid)
        t = node.get("type")
        if t in BUNDLE_PASSTHROUGH_TYPES:

            for edge in graph.get("edges") or []:
                if not isinstance(edge, dict):
                    continue
                src = edge.get("fromNode")
                if edge.get("toNode") == nid and not _node_id_is_muted(graph, src):
                    sock = edge.get("toSocket") or "items"
                    out.extend(_collect_text_sources(graph, nid, sock, visited))
        else:
            out.append(node)
    return out


def _detect_dynamic_sources(
    graph: Dict[str, Any],
    brain_id: str,
) -> Dict[str, Any]:
    reaching: set = set()
    queue: List[Tuple[str, str]] = [(brain_id, "sections")]
    edges = graph.get("edges") or []
    nodes_map = graph.get("nodes") or {}
    while queue:
        tid, tsock = queue.pop(0)
        for edge in edges:
            if not isinstance(edge, dict):
                continue
            if edge.get("toNode") == tid and edge.get("toSocket") == tsock:
                src = edge.get("fromNode")
                if src and src not in reaching:
                    reaching.add(src)
                    node = nodes_map.get(src)
                    if isinstance(node, dict) and node.get("type") in BUNDLE_PASSTHROUGH_TYPES:
                        queue.append((src, "items"))

    flags: Dict[str, Any] = {
        "include_time": None,
        "include_graph_context": False,
        "include_app_context": False,
        "include_workspace_context": False,
    }

    for nid in reaching:
        node = nodes_map.get(nid)
        if not isinstance(node, dict) or _node_is_muted(node):
            continue
        t = node.get("type")
        if t == "time":
            props = node.get("props") or {}
            flags["include_time"] = str(props.get("format") or "iso")
        elif t == "context":
            for edge in edges:
                if not isinstance(edge, dict):
                    continue
                if edge.get("fromNode") != nid:
                    continue
                to_node = edge.get("toNode")
                from_socket = edge.get("fromSocket")
                if to_node == brain_id or to_node in reaching:
                    if from_socket == "graph_context":
                        flags["include_graph_context"] = True
                    elif from_socket == "app_context":
                        flags["include_app_context"] = True
                    elif from_socket == "workspace_context":
                        flags["include_workspace_context"] = True

    return flags


def compile_brain_graph(graph: Dict[str, Any]) -> AgentRuntimeConfig:




    cfg = AgentRuntimeConfig()
    if not isinstance(graph, dict):
        cfg.warnings.append("brain graph is empty")
        return cfg


    agent_nodes = _nodes_of(graph, "agent")
    if agent_nodes:
        if len(agent_nodes) > 1:
            cfg.warnings.append(f"{len(agent_nodes)} agent nodes found; using the first")
        props = agent_nodes[0].get("props") or {}
        merged: Dict[str, Any] = {}
        model = str(props.get("model") or "").strip()
        if model:
            merged["model"] = model
        for key in ("max_tool_iterations", "max_file_bytes", "max_list_entries", "max_web_search_per_turn"):
            v = props.get(key)
            if v not in (None, "", []):
                try:
                    merged[key] = int(v)
                except (TypeError, ValueError):
                    pass
        if "vision_enabled" in props:
            merged["vision_enabled"] = _as_bool(props.get("vision_enabled"), True)
        temp = _as_float(props.get("temperature"), default=None)
        if temp is not None:
            merged["temperature"] = temp
        cfg.settings = merged


    brain_nodes = _nodes_of(graph, "brain")
    if not brain_nodes:



        return cfg
    if len(brain_nodes) > 1:
        cfg.warnings.append(f"{len(brain_nodes)} brain nodes found; using the first")
    brain_id = brain_nodes[0].get("id")



    dynamic = _detect_dynamic_sources(graph, brain_id)
    cfg.include_time = dynamic.get("include_time")
    cfg.include_graph_context = dynamic.get("include_graph_context", False)
    cfg.include_app_context = dynamic.get("include_app_context", False)
    cfg.include_workspace_context = dynamic.get("include_workspace_context", False)

    section_nodes = _collect_text_sources(graph, brain_id, "sections")
    chunks: List[str] = []
    for node in section_nodes:
        if node.get("type") in DYNAMIC_SOURCE_TYPES:
            continue
        props = node.get("props") or {}
        text = props.get("value")
        if text is None:
            text = props.get("body")
        if text is None:
            text = props.get("text")
        text = (str(text) if text is not None else "").strip()
        if text:
            chunks.append(text)
    cfg.system_prompt = ("\n\n".join(chunks)).strip()



    tool_source_nodes = _collect_text_sources(graph, brain_id, "tools")
    if tool_source_nodes:
        overrides: Dict[str, ToolOverride] = {}
        seen_names: set = set()
        for node in tool_source_nodes:
            ntype = node.get("type")
            if ntype == "toolbox":
                props = node.get("props") or {}
                disabled_raw = str(props.get("disabled_tools") or "")
                for dname in disabled_raw.split(","):
                    dname = dname.strip()
                    if dname and dname not in seen_names:
                        seen_names.add(dname)
                        overrides[dname] = ToolOverride(enabled=False)
                continue
            if ntype != "tool-flag":
                continue
            props = node.get("props") or {}
            name = str(props.get("tool_name") or "").strip()
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            enabled = _as_bool(props.get("enabled"), True)
            desc = str(props.get("description") or "").strip() or None
            cat = str(props.get("category") or "").strip() or None
            destructive_raw = props.get("destructive")
            destructive: Optional[bool]
            if isinstance(destructive_raw, str) and destructive_raw.strip() == "":
                destructive = None
            elif destructive_raw is None:
                destructive = None
            else:
                destructive = _as_bool(destructive_raw, False)
            overrides[name] = ToolOverride(
                enabled=enabled,
                description=desc,
                category=cat,
                destructive=destructive,
            )
        cfg.tool_overrides = overrides




    return cfg




def brain_dir(root: Path) -> Path:
    return agent_dir(root).resolve()


def _agent_brain_dir(root: Path, agent_id: Optional[str] = None) -> Path:
    resolved = normalize_agent_id(agent_id)
    if resolved == DEFAULT_AGENT_ID:
        return brain_dir(root)
    return brain_dir(root) / "agents" / resolved


def brain_graph_path(root: Path, agent_id: Optional[str] = None) -> Path:
    return _agent_brain_dir(root, agent_id) / BRAIN_GRAPH_FILENAME


def runtime_path(root: Path, agent_id: Optional[str] = None) -> Path:
    return _agent_brain_dir(root, agent_id) / RUNTIME_FILENAME


def audit_log_path(root: Path, agent_id: Optional[str] = None) -> Path:
    return _agent_brain_dir(root, agent_id) / AUDIT_LOG_FILENAME


def _read_json(path: Path) -> Optional[Any]:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_brain_graph(root: Path, agent_id: Optional[str] = None) -> Optional[Dict[str, Any]]:

    data = _read_json(brain_graph_path(root, agent_id))
    if isinstance(data, dict) and isinstance(data.get("nodes"), dict):
        return data
    return None


def save_brain_graph(root: Path, graph: Dict[str, Any], agent_id: Optional[str] = None) -> AgentRuntimeConfig:





    if not isinstance(graph, dict):
        raise ValueError("brain graph must be an object")
    resolved_agent_id = normalize_agent_id(agent_id)
    graph = dict(graph)
    graph["kind"] = "brain"
    graph["schema"] = SCHEMA_VERSION
    graph["agent_id"] = resolved_agent_id

    atomic_write(brain_graph_path(root, resolved_agent_id), json.dumps(graph, ensure_ascii=False, indent=2, default=str))
    compiled = compile_brain_graph(graph)
    atomic_write(runtime_path(root, resolved_agent_id), json.dumps(compiled.to_dict(), ensure_ascii=False, indent=2, default=str))

    try:
        with audit_log_path(root, resolved_agent_id).open("a", encoding="utf-8") as fh:
            ts = time.strftime("%Y-%m-%dT%H:%M:%S")
            fh.write(f"{ts}\tsaved\tprompt_chars={len(compiled.system_prompt)}\ttools={0 if compiled.tool_overrides is None else len(compiled.tool_overrides)}\n")
    except OSError:
        pass
    return compiled


def load_runtime_config(root: Path, agent_id: Optional[str] = None) -> AgentRuntimeConfig:

    graph = load_brain_graph(root, agent_id)
    if graph is not None:
        return compile_brain_graph(graph)

    data = _read_json(runtime_path(root, agent_id))
    if isinstance(data, dict):
        return _runtime_from_dict(data)

    return AgentRuntimeConfig()


def _runtime_from_dict(data: Dict[str, Any]) -> AgentRuntimeConfig:
    cfg = AgentRuntimeConfig(
        system_prompt=str(data.get("system_prompt") or ""),
        settings=dict(data.get("settings") or {}),
        warnings=list(data.get("warnings") or []),
        include_time=data.get("include_time"),
        include_graph_context=bool(data.get("include_graph_context")),
        include_app_context=bool(data.get("include_app_context")),
        include_workspace_context=bool(data.get("include_workspace_context")),
    )
    raw_overrides = data.get("tool_overrides")
    if isinstance(raw_overrides, dict):
        overrides: Dict[str, ToolOverride] = {}
        for name, ov in raw_overrides.items():
            if not isinstance(ov, dict):
                continue
            overrides[name] = ToolOverride(
                enabled=_as_bool(ov.get("enabled"), True),
                description=(ov.get("description") or None),
                category=(ov.get("category") or None),
                destructive=(None if ov.get("destructive") is None else _as_bool(ov.get("destructive"))),
            )
        cfg.tool_overrides = overrides
    return cfg




def build_default_graph(root: Path) -> Dict[str, Any]:

    from .system_prompt import CORE_PROMPT
    from .tools import ALL_TOOLS

    return seed_default_graph(
        core_prompt=CORE_PROMPT,
        all_tools=list(ALL_TOOLS),
    )


def load_or_seed_brain_graph(root: Path, agent_id: Optional[str] = None) -> Dict[str, Any]:
    existing = load_brain_graph(root, agent_id)
    if existing is not None:
        nodes = existing.get("nodes") or {}
        types = {str(n.get("type") or "") for n in nodes.values() if isinstance(n, dict)}
        if {"agent", "brain"}.issubset(types):
            return existing
    graph = build_default_graph(root)
    graph["agent_id"] = normalize_agent_id(agent_id)
    return graph
