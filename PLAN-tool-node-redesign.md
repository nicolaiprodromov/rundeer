# PLAN: Tool Node System Redesign

## Problem

The current tool system in the brain graph is built from individual `tool-flag` nodes — one per built-in tool — all wired through a `create-bundle` into the `brain` node's `tools` socket. The default graph seeds **37 `tool-flag` nodes**. Every tool gets its own node with 5 props (`tool_name`, `enabled`, `description` override, `category` override, `destructive` override), even though 99% of the time users only want to toggle tools on/off.

### What's wrong

| Issue | Impact |
|---|---|
| 37 individual tool-flag nodes clutter the brain graph | The graph is visually overwhelming and hard to navigate. Users can't easily see what's going on. |
| All 37 nodes must wire through a single `create-bundle` | Adds unnecessary structural complexity for what is fundamentally a settings list. |
| Users can override built-in tool descriptions, categories, destructive flags | These are internal implementation details. Users shouldn't touch them, and exposing them creates confusion. |
| Adding or removing a built-in tool requires reseeding the graph or manually creating/deleting a node + edge | No automatic sync between the Python `ALL_TOOLS` list and the graph. Stale graphs miss new tools. |
| Each tool-flag node takes up vertical space, creating a giant column | The default brain graph is dominated by a wall of identical-looking tool-flag nodes with no meaningful differentiation. |
| The `seed_default_graph` function generates a massive graph just to represent "all tools enabled" | The default state should be trivially expressible, not a 37-node structure. |
| Tool categories are only visible by opening each tool-flag node's props | No grouping, no visual organization. All 37 look identical in the graph. |

### The broader UX problem

A new user opening the brain graph for the first time sees a sprawling mess of nodes they don't understand. The tool system looks like a wiring puzzle when it should feel like a settings panel. The conceptual model ("the agent has tools, you can turn them on or off") is buried under graph plumbing.

---

## Current Architecture

### Files involved

| File | Role |
|---|---|
| `web/agent/tools.py` | Defines `ToolSpec` for all 37 built-in tools in `ALL_TOOLS`. `effective_specs()` merges overrides with defaults. `build_litellm_tools()` builds the final tool list for LLM calls. |
| `web/agent/brain_graph.py` | `seed_default_graph()` creates 37 tool-flag nodes + create-bundle + edges. `compile_brain_graph()` walks the graph to extract `ToolOverride` dicts. `ToolOverride` dataclass holds per-tool overrides. |
| `web/static/node-editor.js` | `NODE_CATALOG` defines the `tool-flag` node type (line 880). `resolveNode` case `"tool-flag"` (line 7196) outputs the tool config blob. Brain node defined at line 853 with `tools` input socket. |
| `web/agent/conversation.py` | Uses `build_litellm_tools(self.tool_overrides)` to build the tools list for each LLM call. |

### Data flow

```
┌─────────────┐   ┌─────────────┐
│ tool-flag   │──→│             │
│ (read_file) │   │             │
├─────────────┤   │   create    │   ┌──────────┐   ┌─────────┐
│ tool-flag   │──→│   bundle    │──→│  brain   │──→│  agent  │
│ (list_dir)  │   │  (tools)    │   │ (tools)  │   │         │
├─────────────┤   │             │   └──────────┘   └─────────┘
│ ... ×35     │──→│             │
└─────────────┘   └─────────────┘

    37 nodes          1 node           1 node         1 node
```

At graph compile time, `compile_brain_graph()`:
1. Finds the brain node
2. Follows edges from `brain.tools` backward through bundles via `_collect_text_sources`
3. Collects every reachable `tool-flag` node
4. Reads each one's props → builds `ToolOverride(enabled, description, category, destructive)`
5. Stores overrides in `AgentRuntimeConfig.tool_overrides`

At LLM call time, `effective_specs(overrides)`:
1. Iterates `ALL_TOOLS` (the hardcoded 37)
2. Applies any matching override from the graph
3. Filters out disabled tools
4. Returns the final tool list

### The ALL_TOOLS list (37 tools, by category)

| Category | Tools |
|---|---|
| **read** | `read_file`, `list_dir`, `search_files`, `grep` |
| **docs** | `list_docs`, `read_doc`, `list_brains`, `get_brain_md`, `list_references` |
| **artifacts** | `list_artifacts`, `artifact_meta`, `list_runs`, `get_run` |
| **graph_read** | `list_nodes`, `get_node`, `list_edges`, `get_selection`, `validate_graph` |
| **graph_mutate** | `add_node`, `remove_node`, `connect_nodes`, `disconnect_nodes`, `set_node_prop`, `move_node`, `layout_auto`, `select_nodes`, `clear_graph` |
| **execute** | `plan_graph`, `run_graph` |
| **vision** | `view_image` |
| **search** | `web_search` |
| **self_modify** | `read_brain_graph`, `set_system_prompt_section`, `add_system_prompt_section`, `remove_system_prompt_section`, `set_tool_flag`, `set_agent_setting` |

---

## Design Goals

1. **Replace the 37-node + bundle pattern** with something that is trivially understandable at a glance.
2. **Built-in tools are not editable.** Users cannot override description, category, or destructive flags of built-in tools. They can only toggle them on/off.
3. **The default state ("all tools enabled") should require zero wiring.** If there's no tool configuration in the graph, all built-in tools are enabled.
4. **The system should automatically pick up new tools** when the Python `ALL_TOOLS` list grows, without requiring graph reseeding.
5. **Keep the graph-native approach.** Tools are still configured via a node in the brain graph, not a separate settings panel. This maintains the visual programming paradigm.
6. **Future-proof for user-created tools** (out of scope now, but the design shouldn't block it).

---

## Proposed Design: The "Toolbox" Node

### Concept

Replace the 37 `tool-flag` nodes + `create-bundle` with a **single "Toolbox" node**. This node:

- Is a built-in node type (`toolbox`) in the "Agent Brain" category
- Displays all built-in tools grouped by category, each with a toggle (checkbox)
- Outputs the combined tool configuration to `brain.tools`
- Does NOT expose description/category/destructive overrides — those are internal
- Reads the current tool list from the server (via `/api/tools`) so it auto-updates when `ALL_TOOLS` changes

### Visual Design

```
┌─────────────────────────────────────┐
│  ⚙  Toolbox                    [●] │
├─────────────────────────────────────┤
│                                     │
│  ▾ Read                      (4/4)  │
│    ☑ read_file                      │
│    ☑ list_dir                       │
│    ☑ search_files                   │
│    ☑ grep                           │
│                                     │
│  ▾ Docs                      (5/5)  │
│    ☑ list_docs                      │
│    ☑ read_doc                       │
│    ☑ list_brains                    │
│    ☑ get_brain_md                   │
│    ☑ list_references                │
│                                     │
│  ▸ Artifacts                 (4/4)  │
│  ▸ Graph Read                (5/5)  │
│  ▸ Graph Mutate              (9/9)  │
│  ▸ Execute                   (2/2)  │
│  ▸ Vision                    (1/1)  │
│  ▸ Search                    (1/1)  │
│  ▸ Self Modify               (6/6)  │
│                                     │
│  Master: ☑ All (37/37)             │
│                                     │
├──────────────────────────[out: ●]───┤
│  Tool Config                        │
└─────────────────────────────────────┘
```

### Node behavior

- **Category groups** are collapsible panels. Each category header shows `(enabled/total)` count.
- **Master toggle** at the bottom: "All" checkbox toggles every tool at once.
- **Category-level toggle**: clicking the category name toggles all tools in that category.
- **Individual toggles**: each tool has a checkbox.
- **No wiring needed per-tool** — it's all contained in one node.
- **Output**: the `out` socket emits the tool override configuration (same shape as today's compiled result).
- **Default state**: all checkboxes on. A fresh toolbox node means "use all tools."
- **The node is resizable** so users can expand it to see more categories at once, or collapse it small.

### How the toolbox node knows the tool list

The toolbox node does not hardcode the 37 tools. Instead:

1. On app startup, the frontend fetches `GET /api/tools` which returns the full tool list with categories from `ALL_TOOLS`.
2. The toolbox node renders its categories and checkboxes from this server-provided list.
3. The node's `props` only store the **delta from default** — i.e., which tools have been toggled off. A fresh toolbox with no props changes means "all enabled."
4. If a new tool appears in `ALL_TOOLS` that the saved graph doesn't mention, it defaults to enabled.

### Props storage

The toolbox node stores a minimal props object:

```json
{
  "disabled_tools": "clear_graph,run_graph"
}
```

Only the names of tools the user has explicitly disabled (comma-separated string). Everything not in the list is enabled. This is:
- Compact (no 37-element blob)
- Forward-compatible (new tools auto-enable)
- Backward-compatible (old graphs without a toolbox node → all tools enabled, which is the current default behavior)

### Brain graph wiring (after redesign)

```
┌────────────┐                ┌──────────┐   ┌─────────┐
│  text-input │──→ bundle ──→│  brain   │──→│  agent  │
│  text-input │──→           │          │   │         │
└────────────┘               │          │   └─────────┘
                              │          │
┌────────────┐               │          │
│  toolbox   │──────────────→│ (tools)  │
│            │               └──────────┘
└────────────┘

   1 node                      1 node       1 node
```

Down from 37 + 1 bundle + 37 edges = **75 graph elements** to **1 node + 1 edge = 2 graph elements**.

---

## Implementation Plan

### Phase 1: Backend — Tool List API

**Goal**: Expose the built-in tool list so the frontend can render the toolbox without hardcoding.

#### Step 1.1: Add `GET /api/tools` endpoint

**File**: `web/server.py`

Returns the built-in tool list grouped by category:

```json
{
  "tools": [
    {
      "name": "read_file",
      "description": "Read a file from the workspace",
      "category": "read",
      "destructive": false
    }
  ],
  "categories": [
    { "id": "read", "label": "Read", "tools": ["read_file", "list_dir", "search_files", "grep"] },
    { "id": "docs", "label": "Docs", "tools": ["list_docs", "read_doc", ...] }
  ]
}
```

Sources the data from `ALL_TOOLS` in `web/agent/tools.py`. Read-only, no auth needed.

### Phase 2: Frontend — Toolbox Node Type

**Goal**: Implement the `toolbox` node type in the node editor.

#### Step 2.1: Add `toolbox` to NODE_CATALOG

**File**: `web/static/node-editor.js`

Add to the "Agent Brain" category (alongside brain, agent, tool-flag, time, context):

```js
{
  type: "toolbox", label: "Toolbox",
  desc: "Built-in tool toggles. All tools are enabled by default — toggle off tools you want to disable.",
  defaultWidth: 320,
  defaultHeight: 400,
  resizable: true,
  inputs: [],
  outputs: [{ id: "out", label: "Tools", type: "any" }],
  props: [
    { id: "disabled_tools", label: "Disabled Tools", kind: "hidden", default: "" },
  ],
}
```

The `disabled_tools` prop is a comma-separated string of disabled tool names, stored in the graph JSON. The UI rendering is handled by custom build logic (not the standard prop controls).

#### Step 2.2: Custom node body rendering for toolbox

**File**: `web/static/node-editor.js`

In `buildNodeFields` (or a new `buildToolboxBody` helper):

1. Fetch the tool list from a cached copy of `/api/tools` response (fetched once at startup, stored in a module-level variable).
2. Render category groups as collapsible panels with checkbox rows.
3. Master toggle row at the bottom.
4. On checkbox change → update the `disabled_tools` prop → trigger graph save.

#### Step 2.3: Resolver for toolbox node

**File**: `web/static/node-editor.js` (in `resolveNode`)

Add `case "toolbox"`:

```js
case "toolbox": {
  const disabledStr = String(props.disabled_tools || "");
  const disabledSet = new Set(
    disabledStr.split(",").map(s => s.trim()).filter(Boolean)
  );
  const overrides = {};
  for (const name of disabledSet) {
    overrides[name] = { enabled: false };
  }
  outputs.out = overrides;
  break;
}
```

This outputs a dict of tool overrides that `compile_brain_graph` can consume.

#### Step 2.4: Toolbox node styles

**File**: `web/static/css/nodes.css`

Styles for the toolbox node body: category panels, checkbox rows, master toggle, enabled/total counters. Follow the existing collapsible panel patterns used by other nodes.

### Phase 3: Backend — Compile Toolbox Nodes

**Goal**: Teach `compile_brain_graph` to understand the new `toolbox` node type.

#### Step 3.1: Update `compile_brain_graph`

**File**: `web/agent/brain_graph.py`

In the tool collection section (currently lines 548–574), add handling for `toolbox` nodes alongside `tool-flag`:

When `_collect_text_sources` returns a node with `type == "toolbox"`:
- Read `props.disabled_tools` (comma-separated string)
- For each disabled tool name, add `ToolOverride(enabled=False)` to `cfg.tool_overrides`
- Tools not mentioned are left with no override → default enabled

This coexists with the existing `tool-flag` handling so both old and new graphs work.

#### Step 3.2: Add `toolbox` to `BRAIN_NODE_TYPES`

**File**: `web/agent/brain_graph.py`

Add `"toolbox"` to the `BRAIN_NODE_TYPES` set (line 25).

### Phase 4: Update Default Graph Seeding

**Goal**: New agent graphs use a single toolbox node instead of 37 tool-flag nodes.

#### Step 4.1: Rewrite `seed_default_graph`

**File**: `web/agent/brain_graph.py`

Replace the tool-flag node generation loop (lines 297–332: creates tools bundle + 37 tool-flag nodes + 38 edges) with:

```python
toolbox_id = next_id()
nodes[toolbox_id] = {
    "id": toolbox_id,
    "type": "toolbox",
    "x": X_SOURCES,
    "y": tool_y,
    "props": {
        "disabled_tools": "",
    },
}
edges.append({
    "id": f"e{toolbox_id}-{brain_id}-tools",
    "fromNode": toolbox_id, "fromSocket": "out",
    "toNode": brain_id, "toSocket": "tools",
})
```

One node. One edge. The `all_tools` parameter to `seed_default_graph` is no longer needed (the toolbox doesn't need to enumerate tools at seed time — it reads them from the API at render time).

#### Step 4.2: Handle existing graphs

Old graphs with `tool-flag` nodes continue to work — `compile_brain_graph` handles both types. No forced reseed. Users can manually replace their tool-flag wall with a single toolbox node when ready.

When a graph IS reseeded (user deletes their brain graph, or creates a new agent), it gets the clean toolbox-based layout.

### Phase 5: Deprecate tool-flag for Built-in Tools

**Goal**: Remove the ability to create new tool-flag nodes from the palette, while keeping existing ones functional.

#### Step 5.1: Hide tool-flag from palette

**File**: `web/static/node-editor.js`

Mark the `tool-flag` node definition with a `hidden: true` flag or move it out of NODE_CATALOG's visible entries. The node type still resolves (existing graphs work), but it doesn't appear in the "Add Node" palette or search.

The `tool-flag` type remains in the codebase for:
1. Backward compatibility with existing saved graphs
2. Future use for user-defined custom tools (out of scope now)

#### Step 5.2: Optional — migration hint in UI

When an old graph with tool-flag nodes is loaded, show a subtle banner or toast:

> "This graph uses the legacy tool-flag system. Add a Toolbox node and remove the old tool-flag nodes for a cleaner setup."

This is optional polish — not blocking.

### Phase 6: Validation

1. **Python syntax**: `python3 -m compileall -q src web rundeer.py __init__.py`
2. **CLI smoke test**: `python3 rundeer.py --help`
3. **Web command smoke test**: `python3 rundeer.py web --help`
4. **JS syntax check**: `rg --files -g '*.js' -g '*.mjs' | xargs -r -n 1 node --check`
5. **New graph seeding**: Create a new agent → verify graph has toolbox node, not 37 tool-flags
6. **Toolbox toggling**: Open brain graph → expand toolbox → toggle tools on/off → verify agent tool list changes
7. **Backward compat**: Load an old graph with tool-flag nodes → verify it still compiles correctly
8. **Playwright test**: Full web UI test of toolbox interaction

---

## Files Touched (Complete List)

| File | Action | Phase |
|---|---|---|
| `web/server.py` | Add `GET /api/tools` endpoint | 1 |
| `web/static/node-editor.js` | Add `toolbox` to NODE_CATALOG, custom body renderer, resolver case, hide `tool-flag` from palette | 2, 5 |
| `web/agent/brain_graph.py` | Add `toolbox` to BRAIN_NODE_TYPES, handle in `compile_brain_graph`, rewrite `seed_default_graph` | 3, 4 |
| `web/static/css/nodes.css` | Styles for toolbox node body (category panels, toggles, master toggle) | 2 |

---

## What This Does NOT Cover (Future Work)

- **User-created custom tools**: The `tool-flag` node type is preserved for future use as a way to define custom tools. A future plan will cover how users can write tool implementations, register them, and wire them into the brain graph via individual tool-flag nodes.
- **Tool presets**: Pre-configured toolbox profiles ("minimal", "full", "read-only") — could be added as toolbox presets later.
- **Per-tool parameter tuning**: Some tools have runtime parameters (like `max_file_bytes` for `read_file`). These are currently on the agent node. The toolbox could eventually surface per-tool parameter overrides, but that's out of scope.

---

## Design Decisions & Rationale

**Why a single toolbox node instead of category-based "tool pack" nodes?** Category packs (one node per category) would reduce 37 nodes to ~9 but still require wiring 9 nodes through a bundle. The toolbox collapses everything into 1 node, which matches the mental model: "the agent has a toolbox." Categories are visual groups inside the node, not separate graph entities.

**Why not move tool config out of the graph entirely (into a settings panel)?** The graph is Rundeer's core interaction model. Keeping tools in the graph means they're visible, connectible, and part of the same visual workspace. A settings panel hides configuration and breaks the "everything is a node" principle. The toolbox node is a bridge — it's a node, but it behaves like a compact settings panel.

**Why store `disabled_tools` (negative list) instead of `enabled_tools` (positive list)?** The default is "all enabled." Storing only what's disabled means:
- Fresh nodes have empty props (minimal)
- New tools added to ALL_TOOLS are automatically enabled without graph migration
- The common case (all tools on) requires zero storage

**Why keep tool-flag nodes working for backward compat?** Existing saved brain graphs shouldn't break. The `compile_brain_graph` function handles both old (`tool-flag`) and new (`toolbox`) approaches. Users migrate at their own pace.

**Why hide tool-flag from the palette instead of deleting it?** The node type will be reused for user-defined custom tools in the future. Hiding it from the palette prevents users from creating new ones for built-in tools while preserving the code path for future use.