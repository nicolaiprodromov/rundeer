"""Brain graph: the user-editable representation of the agent's "brain".

A *brain graph* is a regular rundeer-style node graph (same `{nodes, edges}`
shape the node-editor uses). Three node types are special, everything else
on the canvas is just the standard palette (string, bundle, preview…):

  • node `agent` (singleton) — the agent itself. Its `brain` input takes
    the compiled brain text; props carry runtime settings (model,
    iteration caps, vision, temperature).
  • node `brain` (singleton) — composes the agent's brain. Its `sections`
    input accepts any number of strings (typically `text-input` nodes
    or `create-bundle`s of them), concatenated in graph order into the
    system prompt. Its `tools` input accepts `tool-flag` nodes (directly
    or via bundles) describing which tools to enable / override.
  • node `tool-flag` — props: tool_name (str), enabled (bool), description
    (override), category (override), destructive (override bool).

On save we *compile* the graph into an `AgentRuntimeConfig` and persist it
next to the graph. The conversation loop reads the runtime config at the
start of every turn, so edits take effect on the next reply without
restarting anything. Style brains (`brain/<Name>/<name>.md`) are
completely independent of this graph — they're a separate concept used by
image commands, not by the chat agent.

Ordering of section / tool children: by the source node's `y` coordinate
(top-to-bottom), then `x`.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .profiles import DEFAULT_AGENT_ID, normalize_agent_id


SCHEMA_VERSION = 1
BRAIN_GRAPH_FILENAME = "brain.graph.json"
RUNTIME_FILENAME = "runtime.json"
AUDIT_LOG_FILENAME = "brain.log"


# Node types the brain graph compiler understands directly. Generic nodes
# (`text-input`, `create-bundle`, …) are traversed via edges rather than by
# type, so they don't need to be listed here.
BRAIN_NODE_TYPES = {
    "agent",
    "brain",
    "tool-flag",
}

# Generic palette node types we recognise when walking the section / tools
# inputs of the brain node.
TEXT_SOURCE_TYPES = {"text-input"}
BUNDLE_PASSTHROUGH_TYPES = {"create-bundle", "folder-bundle", "sample-bundle"}
LEGACY_BRAIN_NODE_TYPES = {
    "agent-settings",
    "system-prompt-root",
    "system-prompt-section",
    "active-brain",
    "brain-source",
    "brain-md-section",
}


@dataclass
class ToolOverride:
    enabled: bool = True
    description: Optional[str] = None
    category: Optional[str] = None  # "read" | "mutate" | "execute" | "vision" | "self_modify"
    destructive: Optional[bool] = None


@dataclass
class AgentRuntimeConfig:
    """Compiled output of a brain graph. Layered on top of AgentSettings."""

    system_prompt: str = ""
    settings: Dict[str, Any] = field(default_factory=dict)
    tool_overrides: Dict[str, ToolOverride] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema": SCHEMA_VERSION,
            "system_prompt": self.system_prompt,
            "settings": dict(self.settings),
            "tool_overrides": {
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
        }


# ── Helpers ────────────────────────────────────────────────────────────────

def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _csv_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [p.strip() for p in value.split(",") if p.strip()]
    return []


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
    """Return source node ids whose edges land on (target_id, target_socket)."""
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


# ── Default seed ───────────────────────────────────────────────────────────

def seed_default_graph(
    *,
    core_prompt: str,
    all_tools: List[Any],
) -> Dict[str, Any]:
    """Build a default brain graph from the current Python-level defaults.

    Layout:

        text-input sections   ─┐
                               ├──► (create-bundle "sections") ──► brain.sections
        text-input sections   ─┘
                                                                  brain.out ──► agent.brain
        tool-flag tool 1      ─┐
        tool-flag tool 2      ─┤
        \u2026                     ├──► (create-bundle "tools")    ──► brain.tools
        tool-flag tool N      ─┘
    """
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []
    nid = 1

    def next_id() -> str:
        nonlocal nid
        out = f"n{nid}"
        nid += 1
        return out

    # Column X positions
    X_SOURCES = 0.0
    X_BUNDLE = 380.0
    X_BRAIN = 760.0
    X_AGENT = 1140.0
    X_PREVIEW = 1140.0

    # Brain (singleton)
    brain_id = next_id()
    nodes[brain_id] = {
        "id": brain_id,
        "type": "brain",
        "x": X_BRAIN,
        "y": 0.0,
        "props": {},
    }

    # Agent (singleton)
    agent_id = next_id()
    nodes[agent_id] = {
        "id": agent_id,
        "type": "agent",
        "x": X_AGENT,
        "y": 0.0,
        "props": {
            "model": "",                 # empty → keep MODEL_NAME from .env
            "max_tool_iterations": 32,
            "max_file_bytes": 200000,
            "max_list_entries": 200,
            "max_web_search_per_turn": 8,
            "vision_enabled": True,
            "temperature": "",            # empty \u2192 provider default
        },
    }
    edges.append({
        "id": f"e{brain_id}-{agent_id}",
        "fromNode": brain_id, "fromSocket": "out",
        "toNode": agent_id, "toSocket": "brain",
    })

    # Preview (standard palette node) showing the compiled brain text.
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

    # Sections bundle: one text-input per section, all gathered by a create-bundle.
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

    # Tools bundle: one tool-flag per tool, gathered by a create-bundle.
    tools_bundle_id = next_id()
    nodes[tools_bundle_id] = {
        "id": tools_bundle_id,
        "type": "create-bundle",
        "x": X_BUNDLE,
        "y": sy + 60.0,
        "props": {"label": "tools"},
    }
    edges.append({
        "id": f"e{tools_bundle_id}-{brain_id}-tools",
        "fromNode": tools_bundle_id, "fromSocket": "out",
        "toNode": brain_id, "toSocket": "tools",
    })

    tool_y = sy + 60.0
    for spec in all_tools:
        tid = next_id()
        nodes[tid] = {
            "id": tid,
            "type": "tool-flag",
            "x": X_SOURCES,
            "y": tool_y,
            "props": {
                "tool_name": spec.name,
                "enabled": True,
                "description": "",       # empty \u2192 use built-in
                "category": "",          # empty \u2192 use built-in
                "destructive": "",       # empty \u2192 use built-in (tri-state: "", "true", "false")
            },
        }
        edges.append({
            "id": f"e{tid}-{tools_bundle_id}",
            "fromNode": tid, "fromSocket": "out",
            "toNode": tools_bundle_id, "toSocket": "items",
        })
        tool_y += 60.0

    return {
        "version": 3,
        "kind": "brain",
        "nodes": nodes,
        "edges": edges,
        "_nextId": nid,
    }


def _slug(text: str) -> str:
    out = []
    for ch in (text or "").lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-") or "section"


def _split_prompt_into_sections(prompt: str) -> List[Tuple[str, str]]:
    """Split a markdown prompt into `(title, body)` chunks by `# heading` lines.

    Content before the first heading becomes a section titled "Intro".
    """
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


# ── Compilation ────────────────────────────────────────────────────────────

def _collect_text_sources(
    graph: Dict[str, Any],
    target_id: str,
    target_socket: str,
    visited: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """Walk back from `(target_id, target_socket)` collecting upstream
    text-producing nodes. Bundles (`create-bundle` / `folder-bundle` /
    `sample-bundle`) are transparently flattened so a Bundle of strings
    behaves the same as connecting the strings directly.
    """
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
            # Recurse through every incoming edge into the bundle.
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


def compile_brain_graph(graph: Dict[str, Any]) -> AgentRuntimeConfig:
    """Turn a brain graph into a runtime config.

    Robust against missing/extra nodes; emits warnings rather than failing.
    """
    cfg = AgentRuntimeConfig()
    if not isinstance(graph, dict):
        cfg.warnings.append("brain graph is empty")
        return cfg

    # Agent (settings) singleton
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
            if props.get(key) not in (None, "", []):
                merged[key] = _as_int(props.get(key), 0)
        if "vision_enabled" in props:
            merged["vision_enabled"] = _as_bool(props.get("vision_enabled"), True)
        temp = _as_float(props.get("temperature"), default=None)
        if temp is not None:
            merged["temperature"] = temp
        cfg.settings = merged

    # Brain singleton
    brain_nodes = _nodes_of(graph, "brain")
    if not brain_nodes:
        # No brain wired \u2192 system_prompt stays empty (Conversation falls back
        # to the built-in CORE_PROMPT) and every tool keeps its built-in
        # behaviour. Done.
        return cfg
    if len(brain_nodes) > 1:
        cfg.warnings.append(f"{len(brain_nodes)} brain nodes found; using the first")
    brain_id = brain_nodes[0].get("id")

    # System prompt: gather text-input nodes wired into brain.sections
    # (transparently flattening any bundles in between).
    section_nodes = _collect_text_sources(graph, brain_id, "sections")
    chunks: List[str] = []
    for node in section_nodes:
        props = node.get("props") or {}
        # Most string-producing nodes (`text-input`, file paths\u2026) keep their
        # raw text in `value`. Fall back to `body`/`text` for forward compat.
        text = props.get("value")
        if text is None:
            text = props.get("body")
        if text is None:
            text = props.get("text")
        text = (str(text) if text is not None else "").strip()
        if text:
            chunks.append(text)
    cfg.system_prompt = ("\n\n".join(chunks)).strip()

    # Tool overrides: gather tool-flag nodes wired (transitively, through
    # bundles) into brain.tools.
    tool_source_nodes = _collect_text_sources(graph, brain_id, "tools")
    seen_names: set = set()
    for node in tool_source_nodes:
        if node.get("type") != "tool-flag":
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
        cfg.tool_overrides[name] = ToolOverride(
            enabled=enabled,
            description=desc,
            category=cat,
            destructive=destructive,
        )

    # Any tool-flag node present in the graph but NOT wired (transitively)
    # into brain.tools is treated as explicitly disabled \u2014 letting users
    # drop a tool simply by detaching its flag.
    wired_ids = {n.get("id") for n in tool_source_nodes if n.get("type") == "tool-flag"}
    for tf in _nodes_of(graph, "tool-flag"):
        if tf.get("id") in wired_ids:
            continue
        props = tf.get("props") or {}
        name = str(props.get("tool_name") or "").strip()
        if not name or name in cfg.tool_overrides:
            continue
        cfg.tool_overrides[name] = ToolOverride(enabled=False)

    return cfg


# ── Persistence ────────────────────────────────────────────────────────────

def brain_dir(root: Path) -> Path:
    return (root / ".rundeer" / "agent").resolve()


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


def _atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".brain-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json(path: Path) -> Optional[Any]:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_brain_graph(root: Path, agent_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Load the saved brain graph for this project, or None if not saved yet."""
    data = _read_json(brain_graph_path(root, agent_id))
    if isinstance(data, dict) and isinstance(data.get("nodes"), dict):
        return data
    return None


def _requires_reseed(graph: Dict[str, Any]) -> bool:
    nodes = graph.get("nodes") or {}
    types = {str(n.get("type") or "") for n in nodes.values() if isinstance(n, dict)}
    if types & LEGACY_BRAIN_NODE_TYPES:
        return True
    return not {"agent", "brain"}.issubset(types)


def save_brain_graph(root: Path, graph: Dict[str, Any], agent_id: Optional[str] = None) -> AgentRuntimeConfig:
    """Persist the brain graph and its compiled runtime config.

    Returns the compiled `AgentRuntimeConfig` so callers can hand it back
    in the HTTP response without recompiling.
    """
    if not isinstance(graph, dict):
        raise ValueError("brain graph must be an object")
    resolved_agent_id = normalize_agent_id(agent_id)
    graph = dict(graph)
    graph["kind"] = "brain"
    graph["schema"] = SCHEMA_VERSION
    graph["agent_id"] = resolved_agent_id

    _atomic_write(brain_graph_path(root, resolved_agent_id), json.dumps(graph, ensure_ascii=False, indent=2, default=str))
    compiled = compile_brain_graph(graph)
    _atomic_write(runtime_path(root, resolved_agent_id), json.dumps(compiled.to_dict(), ensure_ascii=False, indent=2, default=str))

    try:
        with audit_log_path(root, resolved_agent_id).open("a", encoding="utf-8") as fh:
            ts = time.strftime("%Y-%m-%dT%H:%M:%S")
            fh.write(f"{ts}\tsaved\tprompt_chars={len(compiled.system_prompt)}\ttools={len(compiled.tool_overrides)}\n")
    except OSError:
        pass
    return compiled


def load_runtime_config(root: Path, agent_id: Optional[str] = None) -> AgentRuntimeConfig:
    """Read the compiled runtime config, recompiling on the fly if missing."""
    data = _read_json(runtime_path(root, agent_id))
    if isinstance(data, dict):
        return _runtime_from_dict(data)
    # Fallback: try compiling from the saved graph.
    graph = load_brain_graph(root, agent_id)
    if graph is not None:
        return compile_brain_graph(graph)
    return AgentRuntimeConfig()


def _runtime_from_dict(data: Dict[str, Any]) -> AgentRuntimeConfig:
    cfg = AgentRuntimeConfig(
        system_prompt=str(data.get("system_prompt") or ""),
        settings=dict(data.get("settings") or {}),
        warnings=list(data.get("warnings") or []),
    )
    for name, ov in (data.get("tool_overrides") or {}).items():
        if not isinstance(ov, dict):
            continue
        cfg.tool_overrides[name] = ToolOverride(
            enabled=_as_bool(ov.get("enabled"), True),
            description=(ov.get("description") or None),
            category=(ov.get("category") or None),
            destructive=(None if ov.get("destructive") is None else _as_bool(ov.get("destructive"))),
        )
    return cfg


# ── Seeding helper (uses the live code as input) ──────────────────────────

def build_default_graph(root: Path) -> Dict[str, Any]:
    """Build a seeded brain graph from current code defaults."""
    from .system_prompt import CORE_PROMPT
    from .tools import ALL_TOOLS

    return seed_default_graph(
        core_prompt=CORE_PROMPT,
        all_tools=list(ALL_TOOLS),
    )


def load_or_seed_brain_graph(root: Path, agent_id: Optional[str] = None) -> Dict[str, Any]:
    existing = load_brain_graph(root, agent_id)
    if existing is not None and not _requires_reseed(existing):
        return existing
    graph = build_default_graph(root)
    graph["agent_id"] = normalize_agent_id(agent_id)
    return graph
