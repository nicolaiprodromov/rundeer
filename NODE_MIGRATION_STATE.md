# Node System Migration State

Full audit of the Rundeer node system after the YAML + JS extraction migration.
Goal: map every piece of node-related code — what's modular, what's still monolithic — to plan the next steps toward a fully modular, agent-friendly codebase.

---

## Executive Summary

| Layer | Modular | Still Monolithic |
|---|---|---|
| **Node definitions** (YAML) | 42/42 nodes extracted | 0 remaining inline |
| **Node compute** (JS resolvers) | 42/42 extracted to individual files | 0 remaining inline |
| **Python backend** (`node_defs.py`) | Fully YAML-driven loader | 0 hardcoded defs |
| **Main editor** (`node-editor.js`) | YAML loading + dynamic `<script>` injection | ~850 lines of type-aware behavioral logic across 9,776-line monolith |
| **Agent code** (Python) | Socket map merges YAML at runtime | ~200 lines hardcoded socket maps, aliases, type lists across 4 files |
| **Server backends** (`server.py`) | Routes call generic handlers | ~250 lines of node-specific compute functions embedded in server |
| **CSS** (`nodes.css`) | Generic node styling | ~356 lines of type-specific CSS (toolbox, reroute, run-trigger) |

**The YAML/JS extraction of node definitions and resolvers is 100% complete.** What remains is behavioral logic, agent knowledge, and infrastructure still locked in monolithic files.

---

## Part 1: What's Fully Modular (Completed Migration)

### 1.1 YAML Node Configs — `web/config/nodes/`

42 YAML files organized by category. Each defines: type ID, label, category, description, inputs, outputs, props (with kinds, defaults, options), `src` pointing to its JS file, and optional `api` endpoint.

| Category | Dir | Count | Nodes |
|---|---|---|---|
| Agent Brain | `agent-brain/` | 6 | agent, brain, context, time, tool-flag, toolbox |
| Bundle | `bundle/` | 3 | create-bundle, folder-bundle, sample-bundle |
| Coordinates | `coordinates/` | 2 | coordinate, mapping |
| Grok Imagine | `grok-imagine/` | 5 | cmd-edit, cmd-extend, cmd-image, cmd-merge, cmd-video |
| Layout | `layout/` | 1 | reroute |
| Loop | `loop/` | 2 | loop-decompose, loop-output |
| Operations | `operations/` | 8 | blur-image, compress-image, crop-media, math-op, random, resize-media, text-join, text-op |
| Output | `output/` | 3 | canvas, preview, uv-render |
| Primitives | `primitives/` | 5 | boolean-input, file, number-input, text-input, vector-input |
| Prompt | `prompt/` | 3 | definition, prompt-filter, prompt |
| Triggers | `triggers/` | 2 | pause, run-trigger |
| Vector | `vector/` | 2 | mix, vector-op |
| **Total** | | **42** | |

**Cross-reference:** Perfect 1:1 YAML↔JS. Every YAML has `src` → existing JS. Every JS has a YAML. One minor inconsistency: `blur.yaml` filename vs `blur-image` type ID inside.

### 1.2 JS Node Resolvers — `web/static/nodes/`

42 JS files, each self-registering via `window.RundeerNodeResolvers["<type>"]`. Breakdown by complexity:

| Classification | Count | Examples |
|---|---|---|
| Empty stub | 2 | agent, run-trigger |
| Thin wrapper (1-5 lines) | 12 | boolean-input, text-input, number-input, vector-input, text-join, create-bundle, reroute, preview, tool-flag, toolbox, context, file |
| Medium logic | 7 | brain, time, sample-bundle, definition, math-op, text-op, random |
| Substantial (API calls or complex iteration) | 16 | All cmd-* (via helpers.executeCommandNode), prompt, prompt-filter, folder-bundle, loop-output, blur, compress-image, crop-media, resize-media, canvas, uv-render, coordinate, mapping, mix, vector-op |
| Command delegate | 5 | cmd-image, cmd-video, cmd-edit, cmd-merge, cmd-extend |

### 1.3 Python YAML Loader — `web/node_defs.py` (225 lines)

Fully dynamic. Zero hardcoded node definitions.

| Function | Purpose |
|---|---|
| `load_node_defs(config_dir)` | Globs `*.yaml` under `web/config/nodes/`, parses all |
| `get_node_defs()` | Cached singleton wrapper |
| `node_defs_socket_map()` | Returns `{type: {inputs: {id: socket_type}, outputs: {id: socket_type}}}` from YAML |
| `_parse_one()` | Supports canonical and compact YAML formats |
| `_expand_compact_io()` | Expands shorthand IO dicts |
| `_expand_compact_props()` | Expands shorthand prop notation |

Known socket types defined as constant (line 11): `text, image, video, number, boolean, definition, filepath, vector, vector-map, color, image-bundle, video-bundle, run, any`.

### 1.4 App-Level Config — `web/config/app.yaml`

Defines the 12 node categories with header colors, socket rendering config (partially filled), and link interpolation settings. Perfectly matches the 12 categories across all 42 YAML node configs.

---

## Part 2: What's Still Monolithic

### 2.1 `web/static/node-editor.js` — 9,776 lines

The entire node editor engine in a single file. Node definitions and resolvers have been extracted, but **~850 lines of type-aware behavioral logic** remain hardcoded.

#### Hardcoded Type Sets (lines 580–586)

```
PREVIEW_TYPES      = {"preview", "file", "uv-render", "coordinate", "canvas"}
LIVE_UPDATE_TYPES  = {"mix"}
COMMAND_TYPES      = {"cmd-image", "cmd-video", "cmd-edit", "cmd-merge", "cmd-extend"}
LEGACY_FILE_TYPES  = {"image-input", "video-input", "filepath-input"}
LEGACY_PREVIEW_TYPES = {"preview-image", "preview-video", "preview-text"}
```

#### Type-Specific Behavioral Code Still Embedded

| Section | Lines | Size | What's Hardcoded |
|---|---|---|---|
| `isInputSocketVisible` | 84–89 | ~6 | compress-image specific visibility logic |
| `outputProducesBundle` | 129–168 | ~40 | Checks loop-output, folder-bundle, create-bundle, sample-bundle, cmd-* types |
| `buildToolboxBody` | 420–578 | ~160 | Entire DOM builder for toolbox node rendering |
| `addNode` / `addLoopPair` | 758–892 | ~135 | Loop-decompose + loop-output pair creation |
| `maintainCompressInstructions` / `createCompressInstructionsHelper` | 1098–1161 | ~63 | compress-image auto-wiring |
| `buildNodeElement` | 1695–2007 | — | Calls `buildRerouteNodeElement`, `buildToolboxBody`, `buildRunTriggerButton`, `buildPauseNodeButton` for specific types |
| `buildRunTriggerButton` / `buildPauseNodeButton` | 6451–6517 | ~67 | Type-specific node body builders |
| `resolveNode` | 6709–6853 | ~145 | Heavy branching for loop-decompose, command types, compress, prompt, heavy-check classification |
| `executeCommandNode` | 6901–7029 | ~130 | Builds the API payload for all cmd-* nodes |
| `migrateMixNode` / `migrateMixEdge` | 1575–1592 | ~17 | Mix-specific migration |
| `refreshAllPreviews` | 8591–8717 | ~126 | Type-aware branching for preview refresh |
| `applyAgentPatchOp` | 9030–9135 | ~105 | Agent patch processing with mix key remapping |

#### Total hardcoded node type references: ~86 occurrences across the file

| Node Type | Occurrences |
|---|---|
| reroute | 8 |
| loop-decompose | 8 |
| loop-output | 9 |
| compress-image | 4 |
| text-input | 7 |
| mix | 5 |
| toolbox | 1 |
| run-trigger | 1 |
| pause | 1 |
| preview/file/uv-render/coordinate/canvas | 5 |
| cmd-image/cmd-video/cmd-edit/cmd-merge/cmd-extend | 4 |
| create-bundle/folder-bundle/sample-bundle | 4 |
| definition | 2 |
| prompt/prompt-filter | 2 |
| tool-flag | 1 |

#### Major Sections of `node-editor.js`

| Lines | Section | Size | Node-Specific? |
|---|---|---|---|
| 1–70 | Socket type system + property groups | ~70 | YES — hardcoded SOCKET_TYPES, PROP_GROUPS |
| 75–168 | Type-specific visibility/bundle logic | ~94 | YES |
| 176–308 | Vector/color/UV utilities | ~132 | No |
| 309–595 | Bundle inference, node registry init, toolbox builder | ~287 | PARTIAL — toolbox builder is type-specific |
| 596–695 | Graph state + mute/edge helpers | ~100 | No |
| 696–757 | Viewport/zoom | ~62 | No |
| 758–931 | Node creation + loop pairs | ~174 | YES — loop pair creation |
| 932–1161 | Socket defs + edge management + compress helpers | ~230 | PARTIAL — compress auto-wiring |
| 1162–1384 | Selection, collapse, fold layout | ~222 | No |
| 1388–1690 | Minimize/mute, renderGraph, signature, migration, title edit | ~302 | PARTIAL — mix migration |
| 1695–2007 | Node DOM construction | ~312 | PARTIAL — type switches for special nodes |
| 2008–2660 | Run engine + panels + preview infra | ~652 | No |
| 2660–3196 | Preview content builders | ~536 | No |
| 3197–3690 | Preview rendering + socket rows + prop controls | ~493 | No |
| 3690–3875 | Loop regions + SVG connections | ~185 | YES — loop region rendering |
| 3876–4475 | Wire interaction + drag/resize | ~599 | No |
| 4475–5127 | Canvas mouse events + keyboard shortcuts | ~652 | No |
| 5127–5775 | Keyboard handler + clipboard + add menu | ~648 | No |
| 5776–6265 | Text utilities + markdown editor | ~489 | No |
| 6266–6450 | Mention system | ~184 | No |
| 6451–7082 | Triggers + core resolver + command execution | ~631 | YES — resolver branching, executeCommandNode |
| 7083–7600 | Run dock + run log | ~517 | No |
| 7600–8200 | Web store + palette + tabs | ~600 | No |
| 8200–8717 | Save/load + brain tabs + graphs + preview refresh | ~517 | PARTIAL — preview refresh type checks |
| 8718–9030 | Serialization + palette render | ~312 | PARTIAL — legacy migration, tool-flag filter |
| 9030–9776 | Agent patches + utilities + explorer + YAML loader + init | ~746 | PARTIAL — agent patch type checks |

### 2.2 Python Agent Code — Hardcoded Node Knowledge

#### `web/agent/tools_impl/graph_mutate.py` (259 lines) — HIGH priority

| What | Lines | Detail |
|---|---|---|
| `NODE_SOCKETS` dict | 18–41 | 24 hardcoded entries duplicating YAML socket info. Line 43 merges YAML on top via `node_defs_socket_map()`, so these act as fallback/override baseline |
| `NODE_SOCKET_ALIASES` dict | 45–62 | 18 fuzzy socket name → canonical socket ID mappings. Entirely hardcoded, not derivable from YAML |
| `GLOBAL_SINGLE_OUTPUT_ALIASES` | 65 | `{"out", "output", "result", ...}` |
| `GLOBAL_SINGLE_INPUT_ALIASES` | 66 | `{"in", "input", "value", ...}` |
| Core functions | 69–259 | `add_node_tool`, `connect_nodes_tool`, `set_node_prop_tool`, etc. — these use the above lookups |

#### `web/agent/tools_impl/execution.py` (102 lines) — MEDIUM priority

| What | Lines | Detail |
|---|---|---|
| `COMMAND_TYPES` | 7 | `{"cmd-image", "cmd-video", "cmd-edit", "cmd-merge", "cmd-extend"}` — duplicated from JS |
| `_connected_trigger_ids()` | 35–50 | Scans for `run-trigger` node type |
| `_execution_patch()` | 53–93 | Checks `run-trigger` node type |

#### `web/agent/tools.py` (671 lines) — HIGH priority

| What | Lines | Detail |
|---|---|---|
| ADD_NODE tool description | 258–266 | Hardcoded list of all valid node types as a static string: `"text-input, number-input, file, definition, prompt, prompt-filter, cmd-image, cmd-video, cmd-edit, cmd-merge, cmd-extend, run-trigger, preview, reroute, folder-bundle, create-bundle, sample-bundle, loop-decompose, loop-output, text-join, compress-image, blur-image, crop-media, resize-media, canvas, coordinate, mapping, vector-op, mix, uv-render, math-op, text-op, random."` |
| LIST_NODES tool | 207 | type_filter parameter hints "cmd-image" |

#### `web/agent/system_prompt.py` (63 lines) — HIGH priority

| What | Lines | Detail |
|---|---|---|
| `CORE_PROMPT` | 6–56 | Complete hardcoded catalog of all node types organized by category, socket type names, and wiring examples. Gets stale when YAML adds new types |

#### `web/agent/brain_graph.py` (720 lines) — MEDIUM priority

| What | Lines | Detail |
|---|---|---|
| `BRAIN_NODE_TYPES` | 25 | `{"agent", "brain", "tool-flag", "toolbox", "time", "context"}` |
| `DYNAMIC_SOURCE_TYPES` | 26 | `{"time", "context"}` |
| `TEXT_SOURCE_TYPES` | 27 | `{"text-input"}` |
| `BUNDLE_PASSTHROUGH_TYPES` | 28 | `{"create-bundle", "folder-bundle", "sample-bundle"}` |
| `LEGACY_BRAIN_NODE_TYPES` | 30–33 | `{"agent-settings", "system-prompt-root", ...}` |
| `seed_default_graph()` | 178–321 | Programmatically builds default brain graph with hardcoded node structures, positions, edges, props |
| `compile_brain_graph()` | 462–570 | Traverses graph checking "agent", "brain", "text-input", "tool-flag", "toolbox", "time", "context" types |

#### `web/agent/tools_impl/brain_mutate.py` (223 lines) — MEDIUM priority

Hardcoded references to: `"brain"`, `"text-input"`, `"tool-flag"`, `"agent"`, `"create-bundle"`.

#### `web/agent/tools_impl/graph_inspect.py` (91 lines) — LOW priority

Single hardcoded reference: `"run-trigger"` at line 87 for validation warnings.

#### `web/agent/conversation.py` (942 lines) — LOW priority

Indirectly node-related: holds graph snapshots, dispatches patches. Hardcodes tool operation names like `"remove_node"`, `"clear_graph"`.

### 2.3 Server Backend Functions — `web/server.py` (~2000 lines)

Node-specific compute functions embedded in the server:

| Function | Lines | Size | Corresponding Node |
|---|---|---|---|
| `filter_prompt()` | 884 | ~90 | prompt, prompt-filter |
| `compress_image()` | 977 | ~53 | compress-image |
| `blur_image()` | 1037 | ~67 | blur-image |
| `crop_media_node()` | 1174 | ~12 | crop-media |
| `resize_media_node()` | 1188 | ~12 | resize-media |
| `canvas_media_node()` | 1202 | ~17 | canvas |
| `compress_dispatch()` | 1221 | ~23 | compress-image |

Total: ~274 lines of node-specific compute spread across the monolithic server file.

### 2.4 UV Backend — `web/uv_api.py` (185 lines)

Already a separate file (good), but contains backend implementations for 5 nodes:

| Function | Lines | Corresponding Node |
|---|---|---|
| `coordinate()` | 74–86 | coordinate |
| `vector()` | 89–108 | vector-op |
| `mapping()` | 111–128 | mapping |
| `mix()` | 135–159 | mix |
| `render()` | 162–184 | uv-render |

### 2.5 CSS — `web/static/css/nodes.css` (~1,007 lines)

Type-specific CSS still embedded in the monolithic CSS file:

| Target | Lines | Size |
|---|---|---|
| run-trigger + pause buttons | 1–98 | ~98 lines |
| reroute node | 396–467 | ~72 lines |
| toolbox node | 822–1007 | ~186 lines |
| **Total type-specific** | | **~356 lines** |

Category accent colors (~30 lines) are also hardcoded but are already config-adjacent via `app.yaml`.

---

## Part 3: Data Flow Architecture

### Node Definition → Registration → Execution

```
web/config/nodes/*.yaml
       │
       ├──parse──→ web/node_defs.py (Python loader)
       │                │
       │      ┌─────────┼──────────────┐
       │      ▼         ▼              ▼
       │  GET /api/    socket_map()  get_node_defs()
       │  node-defs        │           [cached]
       │      │            ▼
       │      │     agent graph_mutate.py
       │      │     (NODE_SOCKETS.update)
       │      ▼
       │  Frontend JS
       │  (loadYamlNodeDefs)
       │      │
       │  ┌───┴───┬──────────┐
       │  ▼       ▼          ▼
       │ NODE_   NODE_    <script src="...">
       │ CATALOG BY_TYPE   injection
       │  │       │          │
       │  ▼       ▼          ▼
       │ Palette All       window.RundeerNodeResolvers[type]
       │ Menu   runtime         │
       │        lookups         ▼
       │          │        resolveNode()
       │          │            │
       │          │   ┌────────┼────────┐
       │          │   ▼        ▼        ▼
       │          │  Local   POST     subprocess
       │          │  compute /api/*   (CLI command)
       │          │            │        │
       │          │            ▼        ▼
       │          │        server.py  src/rundeer/
       │          │        handlers   workflows/
       │          ▼
       │     graph.nodes[id].lastResult
```

### Key Architecture Points

1. **Two registries**: `NODE_CATALOG` (display) and `NODE_BY_TYPE` (runtime) — both populated from YAML at startup
2. **Resolver pattern**: YAML `src` → `<script>` injection → `window.RundeerNodeResolvers[type]` → called by `resolveNode()`
3. **Three execution tiers**:
   - Client-only: primitives, math, text ops, loops, bundles
   - Server API: image ops (PIL), LLM calls (litellm), UV ops (numpy)
   - CLI subprocess: command nodes (cmd-image, cmd-video, etc.)
4. **Agent patches**: Python builds JSON patches → WebSocket → `applyAgentPatchOp()` in frontend
5. **Brain graph**: Same node types, separate graph instance, compiled by `compile_brain_graph()`

---

## Part 4: Duplication Map

Places where the same information exists in multiple locations:

| Information | Location 1 | Location 2 | Location 3 |
|---|---|---|---|
| Socket types per node | YAML configs (source of truth) | `graph_mutate.py` NODE_SOCKETS (hardcoded fallback) | — |
| Socket type names | `node_defs.py` KNOWN_SOCKET_TYPES | `node-editor.js` SOCKET_TYPES | — |
| Command node set | `node-editor.js` COMMAND_TYPES | `execution.py` COMMAND_TYPES | — |
| Valid node type list | YAML configs (authoritative) | `tools.py` ADD_NODE description | `system_prompt.py` CORE_PROMPT |
| Node categories | YAML dir structure | `app.yaml` categories | `system_prompt.py` CORE_PROMPT |
| Bundle-producing types | YAML (implicit) | `node-editor.js` outputProducesBundle | — |
| Preview types | YAML (implicit) | `node-editor.js` PREVIEW_TYPES | — |

---

## Part 5: Extraction Roadmap

### P0 — High Impact, Clear Boundaries

| Item | Location | ~Lines | Approach |
|---|---|---|---|
| `system_prompt.py` CORE_PROMPT | `web/agent/system_prompt.py:6-56` | 50 | Auto-generate from YAML at startup. Read categories + types + socket types from `get_node_defs()` |
| `tools.py` ADD_NODE type list | `web/agent/tools.py:258-266` | 8 | Auto-generate from `get_node_defs()`. Build the valid-types string dynamically |
| `graph_mutate.py` NODE_SOCKETS | `web/agent/tools_impl/graph_mutate.py:18-41` | 24 | Remove hardcoded dict. Use only `node_defs_socket_map()`. It already merges |
| `executeCommandNode` | `node-editor.js:6901-7029` | 130 | Move to a shared helper in `web/static/nodes/grok-imagine/` or make it the default resolver for cmd-* type trait |
| `buildToolboxBody` | `node-editor.js:420-578` | 160 | Move to `web/static/nodes/agent-brain/toolbox.js` as a render hook |
| Type-specific CSS | `nodes.css` | 356 | Move run-trigger, reroute, toolbox styles to per-node CSS files alongside their JS |
| Hardcoded type sets | `node-editor.js:580-586` | 7 | Add YAML traits (`traits: [preview]`, `traits: [command]`, etc.) and derive sets from loaded defs |

### P1 — Medium Impact, Some Complexity

| Item | Location | ~Lines | Approach |
|---|---|---|---|
| `NODE_SOCKET_ALIASES` | `graph_mutate.py:45-62` | 18 | Add `aliases` field to YAML configs |
| `seed_default_graph()` | `brain_graph.py:178-321` | 143 | Move to a seed YAML/JSON file under `web/config/` |
| `outputProducesBundle` | `node-editor.js:129-168` | 40 | Add YAML trait `producesBundle: true` |
| `addLoopPair` | `node-editor.js:758-892` | 135 | Add YAML directive `pairWith: loop-output` on loop-decompose |
| `buildRunTriggerButton` / `buildPauseNodeButton` | `node-editor.js:6451-6517` | 67 | Register as render hooks in JS resolvers |
| `maintainCompressInstructions` | `node-editor.js:1098-1161` | 63 | Move to compress-image.js as an onConnect hook |
| Server node backends | `server.py:884-1244` | 274 | Extract to per-node Python files under `web/backends/` mirroring the YAML/JS structure |
| `SOCKET_TYPES` / `PROP_GROUPS` | `node-editor.js:9-70` | 30 | Move to `app.yaml` or a separate `sockets.yaml` |
| Brain node type sets | `brain_graph.py:25-33` | 9 | Derive from YAML category or add `brainNode: true` trait |

### P2 — Lower Priority, Larger Scope

| Item | Location | ~Lines | Approach |
|---|---|---|---|
| `resolveNode` type branching | `node-editor.js:6709-6853` | 145 | Requires a lifecycle/hook system (onResolve, onBeforeResolve) in the resolver pattern |
| `compile_brain_graph()` | `brain_graph.py:462-570` | 108 | Depends on brain node categorization being YAML-driven first |
| Markdown editor | `node-editor.js:5776-6265` | 489 | Extract as a standalone field-type module |
| Run dock + log system | `node-editor.js:7083-7600` | 517 | Extract as independent module (zero node awareness) |
| Tabs system | `node-editor.js:7930-8600` | 670 | Extract as independent module (minimal node awareness) |
| Explorer/file browser | `node-editor.js:9294-9571` | 277 | Extract as independent module (zero node awareness) |
| `node-editor.js` overall split | entire file | 9,776 | The ultimate goal — split into: core engine, canvas, node rendering, graph execution, UI modules |

---

## Part 6: Files Inventory

### Fully Modular Files (node-related, already clean)

| File | Lines | Role |
|---|---|---|
| `web/node_defs.py` | 225 | YAML parser/loader |
| `web/uv_api.py` | 185 | UV/vector node backends |
| `web/config/app.yaml` | 77 | App-level node category config |
| `web/config/nodes/**/*.yaml` (42 files) | ~1,200 total | Node definitions |
| `web/static/nodes/**/*.js` (42 files) | ~800 total | Node compute resolvers |

### Monolithic Files (contain node logic that needs extraction)

| File | Total Lines | Node-Specific Lines | Priority |
|---|---|---|---|
| `web/static/node-editor.js` | 9,776 | ~850 | P0 — biggest monolith |
| `web/server.py` | ~2,000 | ~274 | P1 — server backends |
| `web/agent/brain_graph.py` | 720 | ~300 | P1 — brain graph logic |
| `web/agent/tools.py` | 671 | ~30 | P0 — auto-gen type list |
| `web/agent/tools_impl/graph_mutate.py` | 259 | ~50 | P0 — remove hardcoded sockets |
| `web/agent/system_prompt.py` | 63 | ~50 | P0 — auto-gen from YAML |
| `web/agent/tools_impl/execution.py` | 102 | ~15 | P1 — small hardcoded set |
| `web/agent/tools_impl/brain_mutate.py` | 223 | ~30 | P1 — brain node refs |
| `web/agent/tools_impl/graph_inspect.py` | 91 | ~5 | P2 — single ref |
| `web/agent/conversation.py` | 942 | ~20 | P2 — indirect |
| `web/static/css/nodes.css` | ~1,007 | ~356 | P1 — type-specific CSS |

### Files with Zero Node Logic (confirmed clean)

| File | Role |
|---|---|
| `web/animator.py` | Terminal animation |
| `web/__init__.py` | Package init |
| `web/agent/diff.py` | Graph diff (generic) |
| `web/agent/ws_server.py` | WebSocket transport (generic) |
| `web/agent/config.py` | Agent config |
| `web/agent/persistence.py` | Agent persistence |
| `web/agent/profiles.py` | Agent profiles |
| `web/agent/sandbox.py` | Agent sandbox |
| `web/agent/tools_impl/artifacts.py` | Artifact tools |
| `web/agent/tools_impl/code_reads.py` | Code read tools |
| `web/agent/tools_impl/docs.py` | Doc tools |
| `web/agent/tools_impl/vision.py` | Vision tools |
| `web/agent/tools_impl/web_search.py` | Web search tools |
| `src/rundeer/core/*` | All core modules (paths, config, models, batch, etc.) |
| `src/rundeer/workflows/*` | All workflow modules |
| `src/rundeer/cli/*` | All CLI modules |
| `web/static/agent.js` | Agent chat UI (no node refs) |
| `web/static/node-editor.html` | HTML shell (83 lines, no inline node logic) |

---

## Part 7: Migration Progress Score

| Dimension | Score | Notes |
|---|---|---|
| Node definitions extracted to YAML | **100%** | 42/42 |
| Node compute extracted to JS | **100%** | 42/42 |
| Python backend YAML-driven | **90%** | `node_defs.py` clean, but server has inline backends |
| Agent code YAML-aware | **40%** | Socket map merges YAML, but type lists, prompt, aliases all hardcoded |
| Frontend type-decoupled | **70%** | Definitions/resolvers extracted, but ~850 lines of behavioral hardcoding remain |
| CSS modular | **60%** | Generic styles in place, ~356 lines of type-specific CSS not extracted |
| **Overall modularization** | **~75%** | Definitions done, behavioral extraction is the next frontier |