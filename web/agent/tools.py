from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .tools_impl import (
    artifacts as ti_artifacts,
    code_reads as ti_reads,
    docs as ti_docs,
    execution as ti_exec,
    graph_inspect as ti_inspect,
    graph_mutate as ti_mutate,
    vision as ti_vision,
    web_search as ti_web,
    brain_mutate as ti_brain,
)


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]
    category: str
    impl: Callable[..., Dict[str, Any]]
    destructive: bool = False
    needs_root: bool = False
    needs_graph: bool = False
    needs_server: bool = False
    needs_snapshot_after: bool = False

    def schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


def _obj(properties: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }



READ_FILE = ToolSpec(
    name="read_file",
    description=(
        "Read a UTF-8 text file from the rundeer project (sandboxed, "
        "max ~200 KB per call). Use for code, JSON, markdown, configs. "
        "Refuses .env and other sensitive files."
    ),
    parameters=_obj({
        "path": {"type": "string", "description": "Project-relative path."},
        "max_bytes": {"type": "integer", "minimum": 1024, "maximum": 500_000},
        "offset": {"type": "integer", "minimum": 0},
    }, required=["path"]),
    category="read",
    impl=ti_reads.read_file_tool,
    needs_root=True,
)

LIST_DIR = ToolSpec(
    name="list_dir",
    description="List one level of a directory in the project (skips noisy folders).",
    parameters=_obj({
        "path": {"type": "string"},
        "max_entries": {"type": "integer", "minimum": 10, "maximum": 500},
    }),
    category="read",
    impl=ti_reads.list_dir_tool,
    needs_root=True,
)

SEARCH_FILES = ToolSpec(
    name="search_files",
    description="Find files whose path contains a substring (case-insensitive).",
    parameters=_obj({
        "query": {"type": "string"},
        "kind": {"type": "string", "enum": ["all", "code", "doc", "config"]},
        "max_results": {"type": "integer", "minimum": 5, "maximum": 200},
    }, required=["query"]),
    category="read",
    impl=ti_reads.search_files_tool,
    needs_root=True,
)

GREP = ToolSpec(
    name="grep",
    description="Substring search across project files (line-level results).",
    parameters=_obj({
        "pattern": {"type": "string"},
        "path": {"type": "string", "description": "Optional file or subdir to scope the search."},
        "case_sensitive": {"type": "boolean"},
        "max_matches": {"type": "integer", "minimum": 5, "maximum": 200},
    }, required=["pattern"]),
    category="read",
    impl=ti_reads.grep_tool,
    needs_root=True,
)


LIST_DOCS = ToolSpec(
    name="list_docs",
    description="List all project documentation files (README, DESIGN, PRODUCT, docs/, brain/, skills).",
    parameters=_obj({}),
    category="read",
    impl=ti_docs.list_docs_tool,
    needs_root=True,
)

READ_DOC = ToolSpec(
    name="read_doc",
    description="Read a markdown/text documentation file from the project.",
    parameters=_obj({
        "path": {"type": "string"},
        "max_bytes": {"type": "integer"},
    }, required=["path"]),
    category="read",
    impl=ti_docs.read_doc_tool,
    needs_root=True,
)

LIST_BRAINS = ToolSpec(
    name="list_brains",
    description="List available style 'brains' (Moebius, Goya, etc.) with reference image counts.",
    parameters=_obj({}),
    category="read",
    impl=ti_docs.list_brains_tool,
    needs_root=True,
)

GET_BRAIN_MD = ToolSpec(
    name="get_brain_md",
    description="Read the markdown style guide for a named brain (e.g. 'Moebius').",
    parameters=_obj({
        "name": {"type": "string"},
        "max_bytes": {"type": "integer"},
    }, required=["name"]),
    category="read",
    impl=ti_docs.get_brain_md_tool,
    needs_root=True,
)

LIST_REFERENCES = ToolSpec(
    name="list_references",
    description="List reference images attached to a brain.",
    parameters=_obj({
        "name": {"type": "string"},
        "max_entries": {"type": "integer"},
    }, required=["name"]),
    category="read",
    impl=ti_docs.list_references_tool,
    needs_root=True,
)


LIST_ARTIFACTS = ToolSpec(
    name="list_artifacts",
    description="List recently produced images/videos under .rundeer/data/outputs and benchmark outputs.",
    parameters=_obj({
        "extra_dirs": {"type": "array", "items": {"type": "string"}},
        "max_results": {"type": "integer"},
    }),
    category="read",
    impl=ti_artifacts.list_artifacts_tool,
    needs_root=True,
)

ARTIFACT_META = ToolSpec(
    name="artifact_meta",
    description="Get rich metadata for a single artifact (dims, size, mtime).",
    parameters=_obj({"path": {"type": "string"}}, required=["path"]),
    category="read",
    impl=ti_artifacts.artifact_meta_tool,
    needs_root=True,
)

LIST_RUNS = ToolSpec(
    name="list_runs",
    description="List recent rundeer runs known to this server (newest first).",
    parameters=_obj({}),
    category="read",
    impl=ti_artifacts.list_runs_tool,
    needs_server=True,
)

GET_RUN = ToolSpec(
    name="get_run",
    description="Get the status + tail of stdout for a specific run id.",
    parameters=_obj({"run_id": {"type": "string"}}, required=["run_id"]),
    category="read",
    impl=ti_artifacts.get_run_tool,
    needs_server=True,
)


LIST_NODES = ToolSpec(
    name="list_nodes",
    description="List nodes currently in the user's graph (from latest snapshot).",
    parameters=_obj({
        "type_filter": {"type": "string", "description": "Optional node type to filter (e.g. 'cmd-image')."},
    }),
    category="read",
    impl=ti_inspect.list_nodes_tool,
    needs_graph=True,
)

GET_NODE = ToolSpec(
    name="get_node",
    description="Inspect a single node including props and connected edges.",
    parameters=_obj({
        "node_id": {"type": "string"},
        "include_result": {"type": "boolean"},
    }, required=["node_id"]),
    category="read",
    impl=ti_inspect.get_node_tool,
    needs_graph=True,
)

LIST_EDGES = ToolSpec(
    name="list_edges",
    description="List all edges (connections) in the user's graph.",
    parameters=_obj({}),
    category="read",
    impl=ti_inspect.list_edges_tool,
    needs_graph=True,
)

GET_SELECTION = ToolSpec(
    name="get_selection",
    description="Get the user's current node selection.",
    parameters=_obj({}),
    category="read",
    impl=ti_inspect.get_selection_tool,
    needs_graph=True,
)

VALIDATE_GRAPH = ToolSpec(
    name="validate_graph",
    description="Check the graph for common issues (orphan edges, missing trigger).",
    parameters=_obj({}),
    category="read",
    impl=ti_inspect.validate_graph_tool,
    needs_graph=True,
)


ADD_NODE = ToolSpec(
    name="add_node",
    description=(
        "Create a node in the user's graph. Returns a graph patch the client "
        "applies live. Valid types include: text-input, number-input, file, "
        "definition, prompt, prompt-filter, cmd-image, cmd-video, cmd-edit, cmd-merge, "
        "cmd-extend, run-trigger, preview, reroute, folder-bundle, create-bundle, "
        "sample-bundle, loop-decompose, loop-output, text-join, compress-image, "
        "blur-image, crop-media, resize-media, canvas, coordinate, mapping, vector-op, "
        "mix, uv-render, math-op, text-op, random."
    ),
    parameters=_obj({
        "type": {"type": "string"},
        "x": {"type": "number"},
        "y": {"type": "number"},
        "props": {"type": "object", "additionalProperties": True},
        "node_id": {"type": "string", "description": "Optional client-side id hint."},
    }, required=["type"]),
    category="mutate",
    impl=ti_mutate.add_node_tool,
    needs_snapshot_after=True,
)

REMOVE_NODE = ToolSpec(
    name="remove_node",
    description="Delete a node from the user's graph (destructive — confirms in UI).",
    parameters=_obj({"node_id": {"type": "string"}}, required=["node_id"]),
    category="mutate",
    impl=ti_mutate.remove_node_tool,
    destructive=True,
    needs_snapshot_after=True,
)

CONNECT_NODES = ToolSpec(
    name="connect_nodes",
    description=(
        "Connect a source node's output socket to a target node's input socket. "
        "Use actual socket ids: most value outputs are 'out', cmd-image/cmd-video run input is 'trigger', "
        "cmd-* prompt input is 'subject', preview input is 'in'. Common label guesses are normalized when unambiguous."
    ),
    parameters=_obj({
        "from_node": {"type": "string"},
        "from_socket": {"type": "string"},
        "to_node": {"type": "string"},
        "to_socket": {"type": "string"},
    }, required=["from_node", "from_socket", "to_node", "to_socket"]),
    category="mutate",
    impl=ti_mutate.connect_nodes_tool,
    needs_graph=True,
    needs_snapshot_after=True,
)

DISCONNECT_NODES = ToolSpec(
    name="disconnect_nodes",
    description="Disconnect an edge by id, or by destination (to_node + to_socket).",
    parameters=_obj({
        "edge_id": {"type": "string"},
        "from_node": {"type": "string"},
        "to_node": {"type": "string"},
        "to_socket": {"type": "string"},
    }),
    category="mutate",
    impl=ti_mutate.disconnect_nodes_tool,
    destructive=True,
    needs_snapshot_after=True,
)

SET_NODE_PROP = ToolSpec(
    name="set_node_prop",
    description="Set a single property on a node (e.g. style, subject, iterations).",
    parameters=_obj({
        "node_id": {"type": "string"},
        "key": {"type": "string"},
        "value": {},
    }, required=["node_id", "key", "value"]),
    category="mutate",
    impl=ti_mutate.set_node_prop_tool,
    needs_snapshot_after=True,
)

MOVE_NODE = ToolSpec(
    name="move_node",
    description="Move a node to new canvas coordinates.",
    parameters=_obj({
        "node_id": {"type": "string"},
        "x": {"type": "number"},
        "y": {"type": "number"},
    }, required=["node_id", "x", "y"]),
    category="mutate",
    impl=ti_mutate.move_node_tool,
    needs_snapshot_after=True,
)

LAYOUT_AUTO = ToolSpec(
    name="layout_auto",
    description="Auto-arrange the graph (tidy left-to-right layout by default).",
    parameters=_obj({"mode": {"type": "string", "enum": ["tidy", "compact"]}}),
    category="mutate",
    impl=ti_mutate.layout_auto_tool,
    needs_snapshot_after=True,
)

SELECT_NODES = ToolSpec(
    name="select_nodes",
    description="Set the user's node selection.",
    parameters=_obj({
        "node_ids": {"type": "array", "items": {"type": "string"}},
    }, required=["node_ids"]),
    category="mutate",
    impl=ti_mutate.select_nodes_tool,
)

CLEAR_GRAPH = ToolSpec(
    name="clear_graph",
    description="Wipe the entire graph (destructive — confirms in UI).",
    parameters=_obj({}),
    category="mutate",
    impl=ti_mutate.clear_graph_tool,
    destructive=True,
    needs_snapshot_after=True,
)


PLAN_GRAPH = ToolSpec(
    name="plan_graph",
    description=(
        "Dry-run the user's current browser graph without spending API quota. "
        "Uses the same graph runner as the Run Graph button; pass trigger_node to dry-run a connected run-trigger subgraph."
    ),
    parameters=_obj({
        "subset": {"type": "array", "items": {"type": "string"}, "description": "Optional node ids to plan."},
        "trigger_node": {"type": "string", "description": "Optional run-trigger node id to dry-run exactly like pressing its Run button."},
    }),
    category="execute",
    impl=ti_exec.plan_graph_tool,
    needs_root=True,
    needs_graph=True,
)

RUN_GRAPH = ToolSpec(
    name="run_graph",
    description=(
        "Execute the user's current browser graph using the same runner as the Run Graph button. "
        "Pass trigger_node to run exactly like pressing a connected run-trigger node's Run button. "
        "This may spend API quota and confirms in UI."
    ),
    parameters=_obj({
        "subset": {"type": "array", "items": {"type": "string"}},
        "dry_run": {"type": "boolean"},
        "trigger_node": {"type": "string", "description": "Optional run-trigger node id to run exactly like pressing its Run button."},
    }),
    category="execute",
    impl=ti_exec.run_graph_tool,
    destructive=True,
    needs_server=True,
    needs_graph=True,
)


VIEW_IMAGE = ToolSpec(
    name="view_image",
    description=(
        "Load a project image (artifact, reference, or user-provided file) so "
        "you can actually see it. The image is attached to your next turn as "
        "a vision input. Use this to inspect generated outputs, references, "
        "or any image in the workspace."
    ),
    parameters=_obj({
        "path": {"type": "string"},
        "max_bytes": {"type": "integer"},
    }, required=["path"]),
    category="vision",
    impl=ti_vision.view_image_tool,
    needs_root=True,
)


WEB_SEARCH = ToolSpec(
    name="web_search",
    description="Search the public web for prompt research, references, or docs.",
    parameters=_obj({
        "query": {"type": "string"},
        "max_results": {"type": "integer", "minimum": 1, "maximum": 12},
    }, required=["query"]),
    category="read",
    impl=ti_web.web_search_tool,
)









READ_BRAIN_GRAPH = ToolSpec(
    name="read_brain_graph",
    description=(
        "Read the current agent brain graph: system-prompt sections, tool "
        "enable flags, agent settings, active brain, and brain-md overrides. "
        "Call this BEFORE any self-modify tool so you know the section IDs."
    ),
    parameters=_obj({}),
    category="self_modify",
    impl=ti_brain.read_brain_graph,
    needs_root=True,
)

SET_SYSTEM_PROMPT_SECTION = ToolSpec(
    name="set_system_prompt_section",
    description=(
        "Rewrite the body of an existing brain section (a text-input node "
        "wired into the brain) in the agent brain graph. Affects the "
        "agent's next turn."
    ),
    parameters=_obj({
        "section_id": {"type": "string", "description": "Node id from read_brain_graph."},
        "body": {"type": "string", "description": "New markdown body for the section."},
    }, required=["section_id", "body"]),
    category="self_modify",
    impl=ti_brain.set_system_prompt_section,
    destructive=True,
    needs_root=True,
    needs_snapshot_after=True,
)

ADD_SYSTEM_PROMPT_SECTION = ToolSpec(
    name="add_system_prompt_section",
    description="Append a brand-new section (a text-input node) to the agent brain.",
    parameters=_obj({
        "body": {"type": "string"},
    }, required=["body"]),
    category="self_modify",
    impl=ti_brain.add_system_prompt_section,
    destructive=True,
    needs_root=True,
    needs_snapshot_after=True,
)

REMOVE_SYSTEM_PROMPT_SECTION = ToolSpec(
    name="remove_system_prompt_section",
    description="Remove a section from the agent system prompt.",
    parameters=_obj({
        "section_id": {"type": "string"},
    }, required=["section_id"]),
    category="self_modify",
    impl=ti_brain.remove_system_prompt_section,
    destructive=True,
    needs_root=True,
    needs_snapshot_after=True,
)

SET_TOOL_FLAG = ToolSpec(
    name="set_tool_flag",
    description=(
        "Enable or disable a tool, or override its description/category/"
        "destructive flag, on the agent brain graph. Disabling a tool hides "
        "it from the model's tool list on the next turn."
    ),
    parameters=_obj({
        "tool_name": {"type": "string"},
        "enabled": {"type": "boolean"},
        "description": {"type": "string"},
        "category": {"type": "string"},
        "destructive": {"type": "boolean"},
    }, required=["tool_name"]),
    category="self_modify",
    impl=ti_brain.set_tool_flag,
    destructive=True,
    needs_root=True,
    needs_snapshot_after=True,
)

SET_AGENT_SETTING = ToolSpec(
    name="set_agent_setting",
    description=(
        "Set an agent setting in the brain graph (model, temperature, "
        "max_tool_iterations, max_web_search_per_turn, max_file_bytes, "
        "max_list_entries, vision_enabled)."
    ),
    parameters=_obj({
        "key": {"type": "string"},
        "value": {"description": "Setting value (string, number, or bool)."},
    }, required=["key", "value"]),
    category="self_modify",
    impl=ti_brain.set_agent_setting,
    destructive=True,
    needs_root=True,
    needs_snapshot_after=True,
)


ALL_TOOLS: List[ToolSpec] = [
    READ_FILE, LIST_DIR, SEARCH_FILES, GREP,
    LIST_DOCS, READ_DOC, LIST_BRAINS, GET_BRAIN_MD, LIST_REFERENCES,
    LIST_ARTIFACTS, ARTIFACT_META, LIST_RUNS, GET_RUN,
    LIST_NODES, GET_NODE, LIST_EDGES, GET_SELECTION, VALIDATE_GRAPH,
    ADD_NODE, REMOVE_NODE, CONNECT_NODES, DISCONNECT_NODES, SET_NODE_PROP,
    MOVE_NODE, LAYOUT_AUTO, SELECT_NODES, CLEAR_GRAPH,
    PLAN_GRAPH, RUN_GRAPH,
    VIEW_IMAGE, WEB_SEARCH,

    READ_BRAIN_GRAPH, SET_SYSTEM_PROMPT_SECTION, ADD_SYSTEM_PROMPT_SECTION,
    REMOVE_SYSTEM_PROMPT_SECTION, SET_TOOL_FLAG, SET_AGENT_SETTING,
]

TOOLS_BY_NAME: Dict[str, ToolSpec] = {t.name: t for t in ALL_TOOLS}


def _resolve_overrides(overrides: Any) -> Dict[str, Any]:

    out: Dict[str, Any] = {}
    if not overrides:
        return out
    items = overrides.items() if hasattr(overrides, "items") else []
    for name, ov in items:
        if ov is None:
            continue
        if hasattr(ov, "enabled"):
            out[name] = {
                "enabled": bool(getattr(ov, "enabled", True)),
                "description": getattr(ov, "description", None),
                "category": getattr(ov, "category", None),
                "destructive": getattr(ov, "destructive", None),
            }
        elif isinstance(ov, dict):
            out[name] = ov
    return out


def effective_specs(overrides: Any = None) -> List[ToolSpec]:

    ovs = _resolve_overrides(overrides)
    out: List[ToolSpec] = []
    for spec in ALL_TOOLS:
        ov = ovs.get(spec.name)
        if ov is None:
            out.append(spec)
            continue
        if ov.get("enabled") is False:
            continue
        desc = ov.get("description") or None
        cat = ov.get("category") or None
        destr = ov.get("destructive")
        if not desc and not cat and destr is None:
            out.append(spec)
            continue
        out.append(ToolSpec(
            name=spec.name,
            description=desc or spec.description,
            parameters=spec.parameters,
            category=cat or spec.category,
            impl=spec.impl,
            destructive=bool(destr) if destr is not None else spec.destructive,
            needs_root=spec.needs_root,
            needs_graph=spec.needs_graph,
            needs_server=spec.needs_server,
            needs_snapshot_after=spec.needs_snapshot_after,
        ))
    return out


def build_litellm_tools(overrides: Any = None) -> List[Dict[str, Any]]:
    return [t.schema() for t in effective_specs(overrides)]


def enabled_tool_names(overrides: Any = None) -> List[str]:
    return [t.name for t in effective_specs(overrides)]


def is_tool_enabled(name: str, overrides: Any = None) -> bool:
    return any(t.name == name for t in effective_specs(overrides))


def effective_spec(name: str, overrides: Any = None) -> Optional[ToolSpec]:
    for t in effective_specs(overrides):
        if t.name == name:
            return t
    return None


def invoke_tool(
    name: str,
    arguments: Dict[str, Any],
    *,
    root: Path,
    server: Any,
    graph: Any,
    agent_id: str = "default",
) -> Dict[str, Any]:
    spec = TOOLS_BY_NAME.get(name)
    if spec is None:
        return {"error": f"unknown tool: {name}"}
    kwargs = dict(arguments or {})
    call_args: Dict[str, Any] = {}
    if spec.needs_root:
        call_args["root"] = root
    if spec.needs_server:
        call_args["server"] = server
    if spec.needs_graph:
        call_args["graph"] = graph
    if spec.category == "self_modify":
        call_args["agent_id"] = agent_id
    call_args.update(kwargs)
    try:
        return spec.impl(**call_args)
    except TypeError as exc:
        return {"error": f"bad arguments to {name}: {exc}"}
    except PermissionError as exc:
        return {"error": str(exc)}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}
