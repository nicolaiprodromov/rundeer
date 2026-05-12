"""Tool registry: JSON schemas + dispatch for the agent loop.

Each entry declares:
  * schema: OpenAI/function-calling spec (litellm normalizes across providers)
  * category: 'read' | 'mutate' | 'execute' | 'vision'
  * destructive: bool — gated by inline confirm in the UI
  * needs_graph: bool — receives latest client graph snapshot
  * needs_server: bool — receives the live RundeerWebServer
  * impl: callable(**kwargs) → dict
"""
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
)


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]
    category: str  # 'read' | 'mutate' | 'execute' | 'vision'
    impl: Callable[..., Dict[str, Any]]
    destructive: bool = False
    needs_root: bool = False
    needs_graph: bool = False
    needs_server: bool = False
    needs_snapshot_after: bool = False  # if true, conversation re-requests a snapshot after running

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


# ── File / code reads ──────────────────────────────────────────────────────
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

# ── Docs / brain ──────────────────────────────────────────────────────────
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

# ── Artifacts / runs ──────────────────────────────────────────────────────
LIST_ARTIFACTS = ToolSpec(
    name="list_artifacts",
    description="List recently produced images/videos under .rundeer/outputs and benchmark outputs.",
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

# ── Graph inspect ─────────────────────────────────────────────────────────
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

# ── Graph mutate (patch-emitting) ─────────────────────────────────────────
ADD_NODE = ToolSpec(
    name="add_node",
    description=(
        "Create a node in the user's graph. Returns a graph patch the client "
        "applies live. Valid types include: text-input, number-input, file, "
        "definition, prompt-filter, cmd-image, cmd-video, cmd-edit, cmd-merge, "
        "cmd-extend, run-trigger, preview, reroute, folder-bundle, create-bundle, "
        "sample-bundle, loop-decompose, loop-output, text-join, compress-image, "
        "math-op, text-op."
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

# ── Execution ─────────────────────────────────────────────────────────────
PLAN_GRAPH = ToolSpec(
    name="plan_graph",
    description="Dry-run the user's graph: resolve to a CLI plan without spending API quota.",
    parameters=_obj({
        "subset": {"type": "array", "items": {"type": "string"}, "description": "Optional node ids to plan."},
    }),
    category="execute",
    impl=ti_exec.plan_graph_tool,
    needs_root=True,
    needs_graph=True,
)

RUN_GRAPH = ToolSpec(
    name="run_graph",
    description="Execute the user's graph (will spend API quota — confirms in UI).",
    parameters=_obj({
        "subset": {"type": "array", "items": {"type": "string"}},
        "dry_run": {"type": "boolean"},
    }),
    category="execute",
    impl=ti_exec.run_graph_tool,
    destructive=True,  # gate behind confirm (expensive)
    needs_server=True,
    needs_graph=True,
)

# ── Vision ────────────────────────────────────────────────────────────────
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

# ── Web search ────────────────────────────────────────────────────────────
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


ALL_TOOLS: List[ToolSpec] = [
    READ_FILE, LIST_DIR, SEARCH_FILES, GREP,
    LIST_DOCS, READ_DOC, LIST_BRAINS, GET_BRAIN_MD, LIST_REFERENCES,
    LIST_ARTIFACTS, ARTIFACT_META, LIST_RUNS, GET_RUN,
    LIST_NODES, GET_NODE, LIST_EDGES, GET_SELECTION, VALIDATE_GRAPH,
    ADD_NODE, REMOVE_NODE, CONNECT_NODES, DISCONNECT_NODES, SET_NODE_PROP,
    MOVE_NODE, LAYOUT_AUTO, SELECT_NODES, CLEAR_GRAPH,
    PLAN_GRAPH, RUN_GRAPH,
    VIEW_IMAGE, WEB_SEARCH,
]

TOOLS_BY_NAME: Dict[str, ToolSpec] = {t.name: t for t in ALL_TOOLS}


def build_litellm_tools() -> List[Dict[str, Any]]:
    return [t.schema() for t in ALL_TOOLS]


def invoke_tool(
    name: str,
    arguments: Dict[str, Any],
    *,
    root: Path,
    server: Any,
    graph: Any,
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
    call_args.update(kwargs)
    try:
        return spec.impl(**call_args)
    except TypeError as exc:
        return {"error": f"bad arguments to {name}: {exc}"}
    except PermissionError as exc:
        return {"error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}
