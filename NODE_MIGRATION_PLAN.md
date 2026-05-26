# Node System Migration Plan

Three workstreams to finish the modularization. No fallbacks, no legacy shims, no half-measures.

---

## Workstream 1 — Extract Node-Specific Code from `node-editor.js`

The 9,776-line monolith has ~850 lines of hardcoded type-awareness. Two mechanisms eliminate it:

### 1A. Add `traits` to YAML configs

A new top-level `traits` list in each YAML config declares behavioral roles. The engine reads these from the loaded defs instead of hardcoded `Set` constants.

**Traits to define:**

| Trait | Meaning | Replaces |
|---|---|---|
| `command` | Runs a CLI generation command | `COMMAND_TYPES` (line 586) |
| `preview` | Shows media/text preview panel | `PREVIEW_TYPES` (line 580) |
| `heavy` | Skip in lite-resolve, use cached result | Inline check (lines 6763–6767) |
| `liveUpdate` | Stash result even in lite mode | `LIVE_UPDATE_TYPES` (line 581) |
| `producesBundle` | Output is always a bundle | Part of `outputProducesBundle` (lines 129–168) |
| `terminal` | Always treated as a graph terminal | `coordinate` check in `runGraph` (line 6628) |

**YAML changes (add `traits` to these files):**

| File | Traits |
|---|---|
| `grok-imagine/cmd-image.yaml` | `[command, heavy]` |
| `grok-imagine/cmd-video.yaml` | `[command, heavy]` |
| `grok-imagine/cmd-edit.yaml` | `[command, heavy]` |
| `grok-imagine/cmd-merge.yaml` | `[command, heavy]` |
| `grok-imagine/cmd-extend.yaml` | `[command, heavy]` |
| `output/preview.yaml` | `[preview]` |
| `primitives/file.yaml` | `[preview]` |
| `output/uv-render.yaml` | `[preview, terminal]` |
| `coordinates/coordinate.yaml` | `[preview, terminal]` |
| `output/canvas.yaml` | `[preview]` |
| `vector/mix.yaml` | `[liveUpdate]` |
| `operations/compress-image.yaml` | `[heavy]` |
| `prompt/prompt.yaml` | `[heavy]` |
| `prompt/prompt-filter.yaml` | `[heavy]` |
| `loop/loop-output.yaml` | `[heavy, producesBundle]` |
| `bundle/folder-bundle.yaml` | `[producesBundle]` |
| `bundle/create-bundle.yaml` | `[producesBundle]` |

**Python changes — `web/node_defs.py`:**

`_parse_one()` already passes through unknown top-level keys. Verify that `traits` from YAML lands in the parsed dict sent to the frontend via `/api/node-defs`. If it doesn't, add `traits` to the parsed output alongside `src`, `api`, etc.

**JS changes — `node-editor.js`:**

In `loadYamlNodeDefs()` (line 9572), after populating `NODE_BY_TYPE`, build trait sets dynamically:

```js
const PREVIEW_TYPES = new Set();
const COMMAND_TYPES = new Set();
const HEAVY_TYPES = new Set();
const LIVE_UPDATE_TYPES = new Set();
const BUNDLE_TYPES = new Set();
const TERMINAL_TYPES = new Set();

// inside loadYamlNodeDefs, after NODE_BY_TYPE is populated:
for (const [type, def] of Object.entries(NODE_BY_TYPE)) {
  for (const t of def.traits || []) {
    if (t === "preview") PREVIEW_TYPES.add(type);
    if (t === "command") COMMAND_TYPES.add(type);
    if (t === "heavy") HEAVY_TYPES.add(type);
    if (t === "liveUpdate") LIVE_UPDATE_TYPES.add(type);
    if (t === "producesBundle") BUNDLE_TYPES.add(type);
    if (t === "terminal") TERMINAL_TYPES.add(type);
  }
}
```

Delete the hardcoded `const PREVIEW_TYPES = new Set([...])` block at lines 580–586 entirely. Replace usages:

| Old code | New code |
|---|---|
| `COMMAND_TYPES.has(node.type)` at lines 149, 570, 6763 | Same — now populated from YAML |
| `PREVIEW_TYPES.has(node.type)` at lines 1891, 1908 | Same — now populated from YAML |
| Inline heavy check at lines 6763–6767 | `HEAVY_TYPES.has(node.type)` |
| `LIVE_UPDATE_TYPES.has(node.type)` at line 6872 | Same — now populated from YAML |
| `n.type === "loop-output"` / `"folder-bundle"` / `"create-bundle"` in `outputProducesBundle` | `BUNDLE_TYPES.has(n.type)` for the always-true cases |

Keep `LEGACY_PREVIEW_TYPES` and `LEGACY_FILE_TYPES` — these handle old saved graphs and will die naturally.

### 1B. Expand the JS node file pattern to support hooks

Currently every node JS file registers only a compute function:

```js
window.RundeerNodeResolvers["type"] = async function(node, inputs, outputs, props, helpers) { ... };
```

Expand this to register an **object** with optional hooks:

```js
window.RundeerNodes["type"] = {
  resolve: async function(node, inputs, outputs, props, helpers) { ... },

  // Optional hooks — only implement what the node needs:
  buildNode(id, node, def, helpers) { ... },     // complete DOM override
  buildBody(id, node, helpers) { ... },           // replaces props section
  buildFooter(id, node, helpers) { ... },         // appends after standard body
  isInputVisible(node, sock) { ... },             // socket visibility
  onEdgeChange(nodeId, socket, helpers) { ... },  // post-connection hook
  resizeMin(node, def) { ... },                   // custom resize constraints
};
```

**Backward-compatible dispatch in `node-editor.js`:**

```js
const reg = window.RundeerNodes[node.type];
const resolver = typeof reg === "function" ? reg : reg?.resolve;
```

This way nodes that only need compute still work with `{ resolve: fn }`, and nodes that need UI hooks declare them alongside.

**Migration of resolver dispatch — `resolveNode()` (line 6852):**

```js
// old
const _extResolver = (window.RundeerNodeResolvers || {})[node.type];
if (_extResolver) await _extResolver(node, inputs, outputs, props, helpers);

// new
const _reg = (window.RundeerNodes || {})[node.type];
const _resolver = typeof _reg === "function" ? _reg : _reg?.resolve;
if (_resolver) await _resolver(node, inputs, outputs, props, helpers);
```

**Rename `window.RundeerNodeResolvers` → `window.RundeerNodes` across all 42 JS files.** Each file changes from:

```js
(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["type"] = async function(...) { ... };
```

to:

```js
(window.RundeerNodes = window.RundeerNodes || {})["type"] = { resolve: async function(...) { ... } };
```

### 1C. Move type-specific UI code into per-node JS files

With the hook system in place, move each piece of hardcoded UI out of `node-editor.js` and into the node's own JS file.

#### Reroute — `web/nodes/layout/reroute.js`

Move `buildRerouteNodeElement` (lines 1703–1735) + `buildRerouteSocket` (lines 1737–1756) into `reroute.js` as a `buildNode` hook. The `node-editor.js` check at line 1762 becomes:

```js
const reg = (window.RundeerNodes || {})[node.type];
if (reg?.buildNode) return reg.buildNode(id, node, def, uiHelpers);
```

Remove `buildRerouteNodeElement` and `buildRerouteSocket` from `node-editor.js`.

**~55 lines moved out.**

#### Toolbox — `web/nodes/agent-brain/toolbox.js`

Move `buildToolboxBody` (lines 420–577) + `ensureToolboxCache` (lines 409–418) into `toolbox.js` as a `buildBody` hook. The check at line 1869 becomes:

```js
if (reg?.buildBody) {
  body.appendChild(reg.buildBody(id, node, uiHelpers));
} else if ((def.props || []).length > 0) {
  body.appendChild(buildNodeFields(id, node, def));
}
```

Remove `buildToolboxBody` and `ensureToolboxCache` from `node-editor.js`.

**~170 lines moved out.**

#### Run Trigger — `web/nodes/triggers/run-trigger.js`

Move `buildRunTriggerButton` (lines 6451–6469) into `run-trigger.js` as a `buildFooter` hook. The check at line 1913 becomes:

```js
if (reg?.buildFooter) body.appendChild(reg.buildFooter(id, node, uiHelpers));
```

Remove `buildRunTriggerButton` from `node-editor.js`.

**~20 lines moved out.**

#### Pause — `web/nodes/triggers/pause.js`

Move `buildPauseNodeButton` (lines 6475–6495) + `isPauseNodeResumeReady` (lines 6471–6473) into `pause.js` as a `buildFooter` hook.

Remove from `node-editor.js`.

**~25 lines moved out.**

#### Compress-image — `web/nodes/operations/compress-image.js`

Move `isInputSocketVisible` compress-specific logic (lines 84–88), `compressInHasTextUpstream` (lines 75–80), `maintainCompressInstructions` (lines 1098–1128), `createCompressInstructionsHelper` (lines 1130–1160), and `COMPRESS_HELPER_PROMPT` (lines 1092–1096) into `compress-image.js`.

Register as:

```js
{
  resolve: async function(...) { ... },          // existing compute
  isInputVisible(node, sock) { ... },            // replaces line 85 check
  onEdgeChange(nodeId, socket, helpers) { ... }, // replaces maintainCompressInstructions
}
```

The generic `isInputSocketVisible` at line 84 becomes:

```js
function isInputSocketVisible(node, def, sock) {
  const reg = (window.RundeerNodes || {})[node?.type];
  if (reg?.isInputVisible) return reg.isInputVisible(node, sock);
  return true;
}
```

Remove all 5 compress-specific functions from `node-editor.js`.

**~70 lines moved out.**

#### Text-input — `web/nodes/primitives/text-input.js`

Add a `resizeMin` hook:

```js
resizeMin(node, def) {
  return { w: 240, h: 110, bottomBuffer: 12 };
}
```

Replace checks at lines 4194 and 4209:

```js
// old
if (node.type === "text-input") return { w: 240, ... };
// new
if (reg?.resizeMin) return reg.resizeMin(node, def);
```

**~6 lines replaced.**

#### Mix migration — `web/nodes/vector/mix.js`

Move `migrateMixNode` (lines 1575–1583) and `migrateMixEdge` (lines 1585–1591) into `mix.js`. Register as a `migrate` hook:

```js
{
  resolve: async function(...) { ... },
  migrate(node) { /* rename color_a→a, color_b→b */ },
  migrateEdge(edge) { /* rename socket ids */ },
}
```

`loadGraphData` calls `migrate` for each node and `migrateEdge` for each edge if the hook exists.

**~17 lines moved out.**

#### Loop pair creation — `web/nodes/loop/loop-decompose.js`

Move the `addLoopPair` (lines 834–889) and `nextLoopId` (lines 892–906) logic into `loop-decompose.js`. Add a YAML field `pairWith: loop-output` to `loop-decompose.yaml`. The generic `addNode` reads this and calls:

```js
if (def.pairWith) {
  const reg = (window.RundeerNodes || {})[node.type];
  if (reg?.createPair) reg.createPair(id, node, graph, uiHelpers);
}
```

**~75 lines moved out.**

### 1D. Delete `executeCommandNode` from `node-editor.js`

`executeCommandNode` (lines 6901–7029, ~130 lines) builds the API payload for all 5 command nodes. It's already called by every `cmd-*.js` resolver via `helpers.executeCommandNode`. It stays accessible through the helpers bag — but physically move the function body into a shared module:

Create `web/nodes/grok-imagine/_command-helpers.js` loaded before the cmd-* resolvers (declared as a dependency or loaded first by convention). This file defines `executeCommandNode` and `collectDefinitionMapForCommand` on `window.RundeerNodeHelpers` (or similar).

Update the 5 cmd-* JS files to call `window.RundeerNodeHelpers.executeCommandNode(...)` directly instead of going through the helpers bag.

**~150 lines moved out of `node-editor.js`.**

### 1E. Summary — lines removed from `node-editor.js`

| Extraction | Lines Removed |
|---|---|
| Reroute buildNode | ~55 |
| Toolbox buildBody | ~170 |
| RunTrigger buildFooter | ~20 |
| Pause buildFooter | ~25 |
| Compress-image hooks | ~70 |
| Mix migration | ~17 |
| Loop pair creation | ~75 |
| executeCommandNode + collectDefinitionMapForCommand | ~150 |
| Hardcoded type set declarations | ~7 |
| **Total** | **~590 lines** |

Remaining type-aware code in `node-editor.js` after this: ~260 lines of generic dispatch (`if (reg?.buildNode)`, `if (HEAVY_TYPES.has(...)`) plus the preview system and loop-decompose resolver branching which is part of the core engine.

---

## Workstream 2 — Extract Server Node Backends

Node-specific Python compute functions are embedded in `web/server.py`. Extract them into per-node Python files mirroring the existing structure.

### 2A. Create `web/nodes/` directory

```
web/nodes/
├── __init__.py
├── _helpers.py
├── operations/
│   ├── __init__.py
│   ├── blur.py
│   ├── compress.py
│   ├── crop_media.py
│   └── resize_media.py
├── output/
│   ├── __init__.py
│   └── canvas.py
└── prompt/
    ├── __init__.py
    └── filter_prompt.py
```

UV backends already live in `web/uv_api.py` — leave them there (they're already separated).

### 2B. Extract shared helpers into `web/nodes/_helpers.py`

Move from `server.py`:

| Function | Current Lines | What It Does |
|---|---|---|
| `_coerce_vector2(value, default)` | 1107–1135 | Parses vector2 from various formats |
| `_coerce_vector2_list(value, count)` | 1138–1147 | Parses list of vector2s |
| `_payload_paths(value)` | 1150–1155 | Extracts paths from payload value |
| `_media_result(root, path, ...)` | 1158–1171 | Builds standard media response dict |
| `IMAGE_COMPRESS_EXTS` | 1033 | Extension constant |
| `VIDEO_COMPRESS_EXTS` | 1034 | Extension constant |

### 2C. Extract each backend function

#### `web/nodes/prompt/filter_prompt.py`

Move from `server.py`:
- `_coerce_filter_image_values(value)` — lines 837–846
- `filter_prompt_image_urls(root, value)` — lines 849–870
- `filter_prompt_messages(prompt_text, instructions, image_urls)` — lines 873–881
- `filter_prompt(root, payload)` — lines 884–974

Dependencies: `litellm`, `rundeer.core.config.load_project_env`, `rundeer.core.models.resolve_llm_api_key`, `rundeer.core.media.encode_image`, `os`, `re`

#### `web/nodes/operations/compress.py`

Move from `server.py`:
- `compress_image(root, payload)` — lines 977–1030
- `compress_dispatch(root, payload)` — lines 1221–1244
- `_compress_video(root, payload)` — lines 1247–1288
- `_compress_bundle(root, payload)` — lines 1291–1328

Dependencies: `PIL.Image`, `subprocess`, `shutil.which`, `zipfile`, `time`, `_helpers` (for `IMAGE_COMPRESS_EXTS`, `VIDEO_COMPRESS_EXTS`)

#### `web/nodes/operations/blur.py`

Move from `server.py`:
- `blur_image(root, payload)` — lines 1037–1104

Dependencies: `PIL.Image`, `PIL.ImageFilter`, `_helpers.IMAGE_COMPRESS_EXTS`

#### `web/nodes/operations/crop_media.py`

Move from `server.py`:
- `crop_media_node(root, payload)` — lines 1174–1185

Dependencies: `rundeer.core.media.crop_media`, `_helpers`

#### `web/nodes/operations/resize_media.py`

Move from `server.py`:
- `resize_media_node(root, payload)` — lines 1188–1199

Dependencies: `rundeer.core.media.resize_media`, `_helpers`

#### `web/nodes/output/canvas.py`

Move from `server.py`:
- `canvas_media_node(root, payload)` — lines 1202–1218

Dependencies: `rundeer.core.media.canvas_images`, `_helpers`

### 2D. Update `server.py` routes

Replace the inline function calls with imports:

```python
from web.nodes.prompt.filter_prompt import filter_prompt
from web.nodes.operations.compress import compress_dispatch, compress_image
from web.nodes.operations.blur import blur_image
from web.nodes.operations.crop_media import crop_media_node
from web.nodes.operations.resize_media import resize_media_node
from web.nodes.output.canvas import canvas_media_node
```

The route handlers in `do_POST` stay in `server.py` — they're just thin dispatchers now:

```python
elif path == "/api/filter-prompt":
    self._send_json(filter_prompt(root, data))
```

No change to the route structure, no change to the API contract.

### 2E. Lines removed from `server.py`

| Block | Lines |
|---|---|
| filter_prompt + helpers | ~140 |
| compress_image | ~55 |
| blur_image | ~70 |
| crop/resize/canvas | ~45 |
| compress_dispatch + _compress_video + _compress_bundle | ~105 |
| Shared helpers | ~65 |
| **Total** | **~480 lines** |

---

## Workstream 3 — Make Agent 100% YAML-Compatible

Every hardcoded node type string in the agent code gets replaced with dynamic data from `get_node_defs()` / `node_defs_socket_map()`. No stale info, no fallback dicts.

### 3A. Delete `NODE_SOCKETS` hardcoded dict — `graph_mutate.py`

**Current state:** Lines 18–41 define 22 hardcoded socket maps. Line 43 merges YAML on top. The hardcoded entries are 100% redundant with YAML.

**Change:** Delete lines 18–41 entirely. Change line 43 to:

```python
NODE_SOCKETS = node_defs_socket_map()
```

That's it. The YAML-derived map becomes the only source of truth. No fallback.

### 3B. Move `NODE_SOCKET_ALIASES` into YAML — `graph_mutate.py`

**Current state:** Lines 45–62 define 16 entries mapping fuzzy socket names to canonical IDs per node type. These help the LLM agent when it guesses wrong socket names.

**Change:** Add an `aliases` field to each YAML config that needs it:

```yaml
cmd-image:
  # ... existing fields ...
  aliases:
    inputs:
      run: trigger
      prompt: subject
      reference: input
    outputs:
      image: out
      result: out
```

Update `node_defs.py` `_parse_one()` to include `aliases` in the parsed output.

Update `node_defs_socket_map()` (or add a new `node_defs_alias_map()`) to return:

```python
{("cmd-image", "inputs"): {"run": "trigger", "prompt": "subject", ...}, ...}
```

Replace the hardcoded `NODE_SOCKET_ALIASES` dict with:

```python
NODE_SOCKET_ALIASES = node_defs_alias_map()
```

**YAML files that need `aliases`:**

| YAML | Input Aliases | Output Aliases |
|---|---|---|
| `cmd-image.yaml` | `run→trigger, prompt→subject, reference→input` | `image→out, result→out` |
| `cmd-video.yaml` | `run→trigger, prompt→subject, reference→input, image→start_frame` | `video→out, result→out` |
| `cmd-edit.yaml` | `run→trigger, prompt→subject, reference→input` | `result→out` |
| `cmd-merge.yaml` | `run→trigger, prompt→subject, reference→input` | `image→out, result→out` |
| `cmd-extend.yaml` | `run→trigger, video→source` | `video→out, result→out` |
| `preview.yaml` | `input→in, image→in, video→in, text→in` | `output→out, result→out` |
| `canvas.yaml` | `image→images` | `image→out, result→out` |
| `crop-media.yaml` | `input→in, image→in` | `output→out, result→out` |
| `resize-media.yaml` | `input→in, image→in` | `output→out, result→out` |
| `uv-render.yaml` | `image→pixel, map→uv` | `image→out, result→out` |
| `text-input.yaml` | *(none)* | `text→out, value→out, string→out` |
| `number-input.yaml` | *(none)* | `number→out, value→out` |
| `boolean-input.yaml` | *(none)* | `bool→out, value→out` |
| `create-bundle.yaml` | `input→items` | `bundle→out, output→out` |
| `folder-bundle.yaml` | *(none)* | `bundle→out, output→out` |
| `run-trigger.yaml` | *(none)* | `trigger→run, output→run` |

Delete `NODE_SOCKET_ALIASES` dict (lines 45–62) and `GLOBAL_SINGLE_OUTPUT_ALIASES` / `GLOBAL_SINGLE_INPUT_ALIASES` (lines 65–66) from `graph_mutate.py`. Move the global aliases into a `_globals` key in the alias system or keep them as small constants (they're generic, not node-specific).

### 3C. Auto-generate `CORE_PROMPT` — `system_prompt.py`

**Current state:** Lines 6–56 are a handwritten string listing every node type, socket type, and a wiring example.

**Change:** Replace the static string with a function that builds it from `get_node_defs()`:

```python
from web.node_defs import get_node_defs, KNOWN_SOCKET_TYPES

def build_core_prompt():
    defs = get_node_defs()
    by_cat = {}
    for d in defs:
        by_cat.setdefault(d["category"], []).append(d["type"])
    
    lines = ["You build node graphs. Available node types:\n"]
    for cat, types in by_cat.items():
        lines.append(f"{cat} — {', '.join(types)}")
    lines.append(f"\nSocket types: {', '.join(sorted(KNOWN_SOCKET_TYPES))}")
    lines.append("\nMinimal image graph: text-input → cmd-image ← run-trigger, cmd-image → preview.")
    return "\n".join(lines)

CORE_PROMPT = build_core_prompt()
```

Delete the entire handwritten string. If a new node YAML is added, the agent automatically knows about it.

### 3D. Auto-generate `ADD_NODE` valid types — `tools.py`

**Current state:** Lines 261–266 hardcode a list of valid type strings in the tool description.

**Change:** Build the description dynamically:

```python
from web.node_defs import get_node_defs

def _add_node_description():
    types = sorted(d["type"] for d in get_node_defs())
    return (
        "Create a node in the user's graph. "
        f"Valid types: {', '.join(types)}."
    )
```

Use `_add_node_description()` as the `description` field for `ADD_NODE`. No more stale lists.

### 3E. Derive `COMMAND_TYPES` from YAML — `execution.py`

**Current state:** Line 7 hardcodes `{"cmd-image", "cmd-video", "cmd-edit", "cmd-merge", "cmd-extend"}`.

**Change:** Derive from YAML traits (added in Workstream 1A):

```python
from web.node_defs import get_node_defs

COMMAND_TYPES = {d["type"] for d in get_node_defs() if "command" in (d.get("traits") or [])}
```

### 3F. Derive trigger detection from YAML — `execution.py` + `graph_inspect.py`

**Current state:** `execution.py` line 40 and `graph_inspect.py` line 87 hardcode `"run-trigger"`.

**Change:** Derive from socket types — a trigger node is any node whose outputs include a socket of type `run`:

```python
from web.node_defs import get_node_defs

TRIGGER_TYPES = {
    d["type"] for d in get_node_defs()
    if any(s.get("type") == "run" for s in d.get("outputs", []))
}
```

Replace `n["type"] == "run-trigger"` with `n["type"] in TRIGGER_TYPES`.

### 3G. Centralize brain node type sets — `brain_graph.py`

**Current state:** Lines 25–47 define 5 hardcoded sets.

**Change:** Derive from YAML category:

```python
from web.node_defs import get_node_defs

_defs = get_node_defs()
BRAIN_NODE_TYPES = {d["type"] for d in _defs if d.get("category") == "Agent Brain"}
```

Keep `DYNAMIC_SOURCE_TYPES`, `TEXT_SOURCE_TYPES`, `BUNDLE_PASSTHROUGH_TYPES` as small derived sets — these are architectural roles that map to specific YAML-defined types:

```python
DYNAMIC_SOURCE_TYPES = {d["type"] for d in _defs if d["type"] in ("time", "context")}
```

Or tag them in YAML with a `role` field if we want full declarativity. But since the brain graph architecture is stable and these sets are tiny, deriving by type name from the loaded YAML defs is sufficient — the point is they break loudly if a YAML is renamed/removed rather than silently going stale.

Delete `LEGACY_BRAIN_NODE_TYPES` (lines 40–47) — the legacy migration should have been a one-time operation. If any user still has a legacy brain graph, `_requires_reseed()` can check for the absence of required brain node types rather than checking for legacy names.

### 3H. Update `brain_mutate.py` imports

**Current state:** Hardcodes `"brain"`, `"text-input"`, `"tool-flag"`, `"agent"`, `"create-bundle"` throughout.

**Change:** Import the sets from `brain_graph.py`:

```python
from web.agent.brain_graph import (
    BRAIN_NODE_TYPES, TEXT_SOURCE_TYPES, BUNDLE_PASSTHROUGH_TYPES
)
```

Replace string literals with set membership or constants. The type strings themselves still exist — they're just sourced from one place (the YAML→brain_graph.py derivation) instead of duplicated.

### 3I. Summary — agent files changed

| File | What Changes |
|---|---|
| `graph_mutate.py` | Delete NODE_SOCKETS (22 entries), NODE_SOCKET_ALIASES (16 entries), GLOBAL_*_ALIASES. Replace with YAML-derived data |
| `system_prompt.py` | Replace 50-line handwritten CORE_PROMPT with auto-generated function |
| `tools.py` | Replace hardcoded ADD_NODE type list with dynamic generation |
| `execution.py` | Replace COMMAND_TYPES and "run-trigger" checks with YAML-derived sets |
| `graph_inspect.py` | Replace "run-trigger" check with TRIGGER_TYPES set |
| `brain_graph.py` | Derive BRAIN_NODE_TYPES from YAML category. Delete LEGACY_BRAIN_NODE_TYPES |
| `brain_mutate.py` | Import type sets from brain_graph.py instead of hardcoding strings |

---

## Execution Order

These three workstreams have dependencies:

```
1A (YAML traits) ──→ 1B (hook system) ──→ 1C (move UI code) ──→ 1D (move executeCommandNode)
                 ╲
                  └──→ 3E (derive COMMAND_TYPES from traits)

2A–2E (server backends) ── independent, can run in parallel with 1 or 3

3A–3D (agent YAML compat) ── depends on 1A for traits, otherwise independent
3E–3I (agent derived sets) ── depends on 1A for traits
```

**Recommended order:**

| Step | Work | Depends On |
|---|---|---|
| **1** | 1A — Add `traits` to YAML configs + parse in `node_defs.py` | Nothing |
| **2** | 3A–3D — Delete NODE_SOCKETS, auto-gen CORE_PROMPT, auto-gen ADD_NODE types, add aliases to YAML | Step 1 (for traits) |
| **3** | 3E–3I — Derive COMMAND_TYPES, TRIGGER_TYPES, BRAIN_NODE_TYPES from YAML | Step 1 |
| **4** | 2A–2E — Extract server backends into `web/nodes/` | Nothing (parallel with 2–3) |
| **5** | 1B — Expand JS file pattern to support hooks | Step 1 |
| **6** | 1C–1D — Move type-specific UI code into per-node JS files | Step 5 |

Steps 2, 3, and 4 can run in parallel. Step 6 is the biggest individual chunk of work.

---

## Validation After Each Step

| Step | Validation |
|---|---|
| 1 | `python3 -m compileall -q src web` + `python3 rundeer.py web --help` + verify `/api/node-defs` returns `traits` in JSON |
| 2–3 | `python3 -m compileall -q src web` + agent tool descriptions include all 42 types + CORE_PROMPT lists all categories |
| 4 | `python3 -m compileall -q src web` + all node API endpoints still return correct results |
| 5–6 | `rg --files -g '*.js' -g '*.mjs' \| xargs -r -n 1 node --check` + nodes render correctly in browser |

---

## Final State After All Three Workstreams

- `node-editor.js`: ~9,186 lines (down from 9,776) — no hardcoded type sets, no type-specific UI code, all behavioral branching reads from YAML traits and JS hooks
- `server.py`: ~1,520 lines (down from ~2,000) — thin route dispatchers, all compute in `web/nodes/`
- Agent code: zero hardcoded node type lists, zero stale info — everything derived from YAML at import time
- Adding a new node type: create one YAML + one JS file + optionally one Python backend file. The agent, editor, and server all discover it automatically