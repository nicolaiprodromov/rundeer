# Node Consolidation Plan

Each node's code is scattered across three directories — config YAML in `web/config/nodes/`, frontend JS in `web/static/nodes/`, and Python backends in `web/backends/` (plus `web/uv_api.py` and `web/server.py`). This plan consolidates everything into `web/nodes/` so each node's YAML, JS, and Python backend live side-by-side in the same category folder.

---

## Current State

### Three directories with mirrored category structures

```
web/config/nodes/{category}/{node}.yaml    ← 42 YAML configs
web/static/nodes/{category}/{node}.js      ← 42 JS resolvers
web/backends/{category}/{function}.py      ← 6 Python backends (partial)
web/uv_api.py                              ← 5 UV/vector backends (monolith)
web/server.py                              ← 1 backend inline (list_folder)
```

### How the pieces connect

1. **YAML → JS**: Each YAML has a `src` field pointing to `web/static/nodes/{cat}/{node}.js`
2. **YAML → Python**: Some YAMLs have an `api` field (e.g. `/api/compress`). The server routes in `server.py` dispatch these to Python backend functions
3. **JS loading**: `node-editor.js` `loadYamlNodeDefs()` fetches `/api/node-defs`, reads each node's `src`, strips `web/static/` → `/static/`, creates `<script>` tags
4. **YAML loading**: `node_defs.py` scans `web/config/nodes/` recursively for `*.yaml` via `_CONFIG_DIR`
5. **Static serving**: `server.py` maps URL `/static/*` → filesystem `web/static/*`
6. **Backend imports**: `server.py` imports from `web.backends.*` (top-level) and `web.uv_api` (inline)

### Complete node inventory (42 nodes)

| Category | Node | YAML | JS | Python Backend |
|---|---|---|---|---|
| **agent-brain** | agent | `config/nodes/agent-brain/agent.yaml` | `static/nodes/agent-brain/agent.js` | — |
| | brain | `config/nodes/agent-brain/brain.yaml` | `static/nodes/agent-brain/brain.js` | — |
| | context | `config/nodes/agent-brain/context.yaml` | `static/nodes/agent-brain/context.js` | — |
| | time | `config/nodes/agent-brain/time.yaml` | `static/nodes/agent-brain/time.js` | — |
| | tool-flag | `config/nodes/agent-brain/tool-flag.yaml` | `static/nodes/agent-brain/tool-flag.js` | — |
| | toolbox | `config/nodes/agent-brain/toolbox.yaml` | `static/nodes/agent-brain/toolbox.js` | — |
| **bundle** | create-bundle | `config/nodes/bundle/create-bundle.yaml` | `static/nodes/bundle/create-bundle.js` | — |
| | folder-bundle | `config/nodes/bundle/folder-bundle.yaml` | `static/nodes/bundle/folder-bundle.js` | `server.py:list_folder()` |
| | sample-bundle | `config/nodes/bundle/sample-bundle.yaml` | `static/nodes/bundle/sample-bundle.js` | — |
| **coordinates** | coordinate | `config/nodes/coordinates/coordinate.yaml` | `static/nodes/coordinates/coordinate.js` | `uv_api.py:coordinate()` |
| | mapping | `config/nodes/coordinates/mapping.yaml` | `static/nodes/coordinates/mapping.js` | `uv_api.py:mapping()` |
| **grok-imagine** | cmd-edit | `config/nodes/grok-imagine/cmd-edit.yaml` | `static/nodes/grok-imagine/cmd-edit.js` | — |
| | cmd-extend | `config/nodes/grok-imagine/cmd-extend.yaml` | `static/nodes/grok-imagine/cmd-extend.js` | — |
| | cmd-image | `config/nodes/grok-imagine/cmd-image.yaml` | `static/nodes/grok-imagine/cmd-image.js` | — |
| | cmd-merge | `config/nodes/grok-imagine/cmd-merge.yaml` | `static/nodes/grok-imagine/cmd-merge.js` | — |
| | cmd-video | `config/nodes/grok-imagine/cmd-video.yaml` | `static/nodes/grok-imagine/cmd-video.js` | — |
| **layout** | reroute | `config/nodes/layout/reroute.yaml` | `static/nodes/layout/reroute.js` | — |
| **loop** | loop-decompose | `config/nodes/loop/loop-decompose.yaml` | `static/nodes/loop/loop-decompose.js` | — |
| | loop-output | `config/nodes/loop/loop-output.yaml` | `static/nodes/loop/loop-output.js` | — |
| **operations** | blur | `config/nodes/operations/blur.yaml` | `static/nodes/operations/blur.js` | `backends/operations/blur.py` |
| | compress-image | `config/nodes/operations/compress-image.yaml` | `static/nodes/operations/compress-image.js` | `backends/operations/compress.py` |
| | crop-media | `config/nodes/operations/crop-media.yaml` | `static/nodes/operations/crop-media.js` | `backends/operations/crop_media.py` |
| | math-op | `config/nodes/operations/math-op.yaml` | `static/nodes/operations/math-op.js` | — |
| | random | `config/nodes/operations/random.yaml` | `static/nodes/operations/random.js` | — |
| | resize-media | `config/nodes/operations/resize-media.yaml` | `static/nodes/operations/resize-media.js` | `backends/operations/resize_media.py` |
| | text-join | `config/nodes/operations/text-join.yaml` | `static/nodes/operations/text-join.js` | — |
| | text-op | `config/nodes/operations/text-op.yaml` | `static/nodes/operations/text-op.js` | — |
| **output** | canvas | `config/nodes/output/canvas.yaml` | `static/nodes/output/canvas.js` | `backends/output/canvas.py` |
| | preview | `config/nodes/output/preview.yaml` | `static/nodes/output/preview.js` | — |
| | uv-render | `config/nodes/output/uv-render.yaml` | `static/nodes/output/uv-render.js` | `uv_api.py:render()` |
| **primitives** | boolean-input | `config/nodes/primitives/boolean-input.yaml` | `static/nodes/primitives/boolean-input.js` | — |
| | file | `config/nodes/primitives/file.yaml` | `static/nodes/primitives/file.js` | — |
| | number-input | `config/nodes/primitives/number-input.yaml` | `static/nodes/primitives/number-input.js` | — |
| | text-input | `config/nodes/primitives/text-input.yaml` | `static/nodes/primitives/text-input.js` | — |
| | vector-input | `config/nodes/primitives/vector-input.yaml` | `static/nodes/primitives/vector-input.js` | — |
| **prompt** | definition | `config/nodes/prompt/definition.yaml` | `static/nodes/prompt/definition.js` | — |
| | prompt-filter | `config/nodes/prompt/prompt-filter.yaml` | `static/nodes/prompt/prompt-filter.js` | `backends/prompt/filter_prompt.py` |
| | prompt | `config/nodes/prompt/prompt.yaml` | `static/nodes/prompt/prompt.js` | `backends/prompt/filter_prompt.py` (shared) |
| **triggers** | pause | `config/nodes/triggers/pause.yaml` | `static/nodes/triggers/pause.js` | — |
| | run-trigger | `config/nodes/triggers/run-trigger.yaml` | `static/nodes/triggers/run-trigger.js` | — |
| **vector** | mix | `config/nodes/vector/mix.yaml` | `static/nodes/vector/mix.js` | `uv_api.py:mix()` |
| | vector-op | `config/nodes/vector/vector-op.yaml` | `static/nodes/vector/vector-op.js` | `uv_api.py:vector()` |

### Shared backend code

| File | Used By | Contains |
|---|---|---|
| `web/backends/_helpers.py` | All 6 backend modules | `IMAGE_EXTS`, `IMAGE_COMPRESS_EXTS`, `VIDEO_COMPRESS_EXTS`, `relpath()`, `is_sensitive_file()`, `safe_project_path()`, `_coerce_vector2()`, `_coerce_vector2_list()`, `_payload_paths()`, `_media_result()` |
| `web/uv_api.py` | coordinates, vector, output nodes | `_safe_path()`, `_relpath()`, `_resolve_input()`, `_shape_meta()`, `_value_is_map()` + 5 endpoint functions |

---

## Target State

### Single `web/nodes/` directory

All node files consolidated into `web/nodes/{category}/` with YAML, JS, and Python files side-by-side. Shared backend helpers in `web/nodes/_shared/`.

```
web/nodes/
├── __init__.py
├── _shared/
│   ├── __init__.py
│   ├── helpers.py               ← from web/backends/_helpers.py
│   └── uv.py                   ← from web/uv_api.py (shared UV helpers only)
│
├── agent-brain/
│   ├── agent.yaml
│   ├── agent.js
│   ├── brain.yaml
│   ├── brain.js
│   ├── context.yaml
│   ├── context.js
│   ├── time.yaml
│   ├── time.js
│   ├── tool-flag.yaml
│   ├── tool-flag.js
│   ├── toolbox.yaml
│   └── toolbox.js
│
├── bundle/
│   ├── __init__.py
│   ├── create-bundle.yaml
│   ├── create-bundle.js
│   ├── folder-bundle.yaml
│   ├── folder-bundle.js
│   ├── folder_bundle.py         ← from server.py:list_folder()
│   ├── sample-bundle.yaml
│   └── sample-bundle.js
│
├── coordinates/
│   ├── __init__.py
│   ├── coordinate.yaml
│   ├── coordinate.js
│   ├── coordinate.py            ← from uv_api.py:coordinate()
│   ├── mapping.yaml
│   ├── mapping.js
│   └── mapping.py               ← from uv_api.py:mapping()
│
├── grok-imagine/
│   ├── cmd-edit.yaml
│   ├── cmd-edit.js
│   ├── cmd-extend.yaml
│   ├── cmd-extend.js
│   ├── cmd-image.yaml
│   ├── cmd-image.js
│   ├── cmd-merge.yaml
│   ├── cmd-merge.js
│   ├── cmd-video.yaml
│   └── cmd-video.js
│
├── layout/
│   ├── reroute.yaml
│   └── reroute.js
│
├── loop/
│   ├── loop-decompose.yaml
│   ├── loop-decompose.js
│   ├── loop-output.yaml
│   └── loop-output.js
│
├── operations/
│   ├── __init__.py
│   ├── blur.yaml
│   ├── blur.js
│   ├── blur.py                  ← from web/backends/operations/blur.py
│   ├── compress-image.yaml
│   ├── compress-image.js
│   ├── compress.py              ← from web/backends/operations/compress.py
│   ├── crop-media.yaml
│   ├── crop-media.js
│   ├── crop_media.py            ← from web/backends/operations/crop_media.py
│   ├── math-op.yaml
│   ├── math-op.js
│   ├── random.yaml
│   ├── random.js
│   ├── resize-media.yaml
│   ├── resize-media.js
│   ├── resize_media.py          ← from web/backends/operations/resize_media.py
│   ├── text-join.yaml
│   ├── text-join.js
│   ├── text-op.yaml
│   └── text-op.js
│
├── output/
│   ├── __init__.py
│   ├── canvas.yaml
│   ├── canvas.js
│   ├── canvas.py                ← from web/backends/output/canvas.py
│   ├── preview.yaml
│   ├── preview.js
│   ├── uv-render.yaml
│   ├── uv-render.js
│   └── uv_render.py             ← from uv_api.py:render()
│
├── primitives/
│   ├── boolean-input.yaml
│   ├── boolean-input.js
│   ├── file.yaml
│   ├── file.js
│   ├── number-input.yaml
│   ├── number-input.js
│   ├── text-input.yaml
│   ├── text-input.js
│   ├── vector-input.yaml
│   └── vector-input.js
│
├── prompt/
│   ├── __init__.py
│   ├── definition.yaml
│   ├── definition.js
│   ├── prompt-filter.yaml
│   ├── prompt-filter.js
│   ├── filter_prompt.py         ← from web/backends/prompt/filter_prompt.py
│   ├── prompt.yaml
│   └── prompt.js
│
├── triggers/
│   ├── pause.yaml
│   ├── pause.js
│   ├── run-trigger.yaml
│   └── run-trigger.js
│
└── vector/
    ├── __init__.py
    ├── mix.yaml
    ├── mix.js
    ├── mix.py                   ← from uv_api.py:mix()
    ├── vector-op.yaml
    ├── vector-op.js
    └── vector_op.py             ← from uv_api.py:vector()
```

### Naming conventions

- **YAML files**: `{node-name}.yaml` (hyphens, matching the node type slug)
- **JS files**: `{node-name}.js` (hyphens, matching the node type slug)
- **Python files**: `{function_name}.py` (underscores, valid Python module names). The Python filename doesn't need to exactly match the YAML/JS name — it matches the function name since Python can't use hyphens. When the function name already matches (blur, canvas, etc.), it does match naturally
- **`__init__.py`**: Only needed in category folders that contain Python backend files

---

## Code Changes Required

### 1. `web/node_defs.py` — Update YAML scan directory

**Current** (line 9):
```python
_CONFIG_DIR = Path(__file__).resolve().parent / "config" / "nodes"
```

**New**:
```python
_CONFIG_DIR = Path(__file__).resolve().parent / "nodes"
```

The `load_node_defs()` function uses `_CONFIG_DIR.rglob("*.yaml")` which will find all YAML files in the new location without any other changes.

### 2. `web/server.py` — Add `/nodes/` route for JS serving

The server currently serves JS from `/static/nodes/*` → `web/static/nodes/*`. After consolidation, JS files live in `web/nodes/` alongside YAML and Python files. The server must serve JS from the new location while NOT exposing YAML or Python files.

**Add a `NODES_DIR` constant**:
```python
NODES_DIR = Path(__file__).resolve().parent / "nodes"
```

**Add route in `do_GET`** (after the `/static/` handler):
```python
elif path.startswith("/nodes/"):
    rel = unquote(path.removeprefix("/nodes/")).lstrip("/")
    fpath = (NODES_DIR / rel).resolve()
    nodes_root = NODES_DIR.resolve()
    if fpath != nodes_root and nodes_root not in fpath.parents:
        raise PermissionError("nodes path escapes directory")
    if fpath.suffix != ".js":
        raise PermissionError("only .js files served from /nodes/")
    self._send_file(fpath, cache=False)
```

This serves only `.js` files from `web/nodes/`, blocking access to `.yaml` and `.py` files.

### 3. `web/static/node-editor.js` — Update JS path transform

**Current** (`loadYamlNodeDefs`, line 9254):
```js
const srcPath = nodeDef.src.startsWith("web/static/")
  ? "/" + nodeDef.src.replace("web/static/", "static/")
  : "/" + nodeDef.src;
```

**New**:
```js
const srcPath = nodeDef.src.startsWith("web/")
  ? "/" + nodeDef.src.replace("web/", "")
  : "/" + nodeDef.src;
```

This transforms `web/nodes/operations/blur.js` → `/nodes/operations/blur.js`, which the new server route serves.

### 4. All 42 YAML `src` fields — Update paths

Every YAML file's `src` field changes from `web/static/nodes/{cat}/{node}.js` to `web/nodes/{cat}/{node}.js`.

**Example** (`operations/blur.yaml`):
```yaml
# before
src: web/static/nodes/operations/blur.js

# after
src: web/nodes/operations/blur.js
```

This is a bulk find-replace: `web/static/nodes/` → `web/nodes/` in all `.yaml` files.

### 5. `web/server.py` — Update backend imports

**Current**:
```python
from web.backends._helpers import IMAGE_EXTS, is_sensitive_file, relpath, safe_project_path
from web.backends.operations.blur import blur_image
from web.backends.operations.compress import compress_dispatch, compress_image
from web.backends.operations.crop_media import crop_media_node
from web.backends.operations.resize_media import resize_media_node
from web.backends.output.canvas import canvas_media_node
from web.backends.prompt.filter_prompt import filter_prompt
```

**New**:
```python
from web.nodes._shared.helpers import IMAGE_EXTS, is_sensitive_file, relpath, safe_project_path
from web.nodes.operations.blur import blur_image
from web.nodes.operations.compress import compress_dispatch, compress_image
from web.nodes.operations.crop_media import crop_media_node
from web.nodes.operations.resize_media import resize_media_node
from web.nodes.output.canvas import canvas_media_node
from web.nodes.prompt.filter_prompt import filter_prompt
```

### 6. Backend Python files — Update internal imports

Each backend file imports from `web.backends._helpers`. These change to `web.nodes._shared.helpers`.

**Files to update**:
- `web/nodes/operations/blur.py` — `from web.nodes._shared.helpers import ...`
- `web/nodes/operations/compress.py` — `from web.nodes._shared.helpers import ...`
- `web/nodes/operations/crop_media.py` — `from web.nodes._shared.helpers import ...`
- `web/nodes/operations/resize_media.py` — `from web.nodes._shared.helpers import ...`
- `web/nodes/output/canvas.py` — `from web.nodes._shared.helpers import ...`
- `web/nodes/prompt/filter_prompt.py` — `from web.nodes._shared.helpers import ...`

### 7. `web/uv_api.py` — Split into per-node backends + shared helpers

**Current**: Monolith with 5 endpoint functions + 5 private helpers.

**Split**:
- **Shared helpers** → `web/nodes/_shared/uv.py`: `_safe_path()`, `_relpath()`, `_resolve_input()`, `_shape_meta()`, `_value_is_map()`
- **`coordinate()`** → `web/nodes/coordinates/coordinate.py`
- **`mapping()`** → `web/nodes/coordinates/mapping.py`
- **`mix()`** → `web/nodes/vector/mix.py`
- **`vector()`** → `web/nodes/vector/vector_op.py`
- **`render()`** → `web/nodes/output/uv_render.py`

Each new file imports shared helpers from `web.nodes._shared.uv`.

**Update `server.py`** UV route imports:
```python
# before
from .uv_api import coordinate as _uv_coord

# after
from web.nodes.coordinates.coordinate import coordinate as _uv_coord
```

After all 5 functions are extracted, delete `web/uv_api.py`.

### 8. `web/server.py` — Extract `list_folder` into bundle backend

**Current**: `list_folder()` is defined inline in `server.py` (~35 lines) and dispatched for the `/api/folder-list` route.

**Move to**: `web/nodes/bundle/folder_bundle.py`

**Update `server.py`**:
```python
from web.nodes.bundle.folder_bundle import list_folder
```

### 9. Delete emptied directories

After all moves:
- Delete `web/config/nodes/` (all YAMLs moved)
- Delete `web/config/` if empty
- Delete `web/static/nodes/` (all JS moved)
- Delete `web/backends/` (all Python moved)
- Delete `web/uv_api.py` (all functions extracted)

### 10. Update `repomix.config.json`

If the repomix config has include/exclude patterns referencing the old paths, update them.

### 11. Update `NODE_MIGRATION_PLAN.md`

The existing migration plan references old paths (`web/static/nodes/`, `web/config/nodes/`, `web/backends/`). Update all path references to the new `web/nodes/` structure.

### 12. Update `AGENTS.md`

The project instructions reference these paths in the Current Structure section. Update to reflect the new `web/nodes/` directory.

---

## Execution Order

The work is ordered to keep the app functional after each step.

| Step | Work | Risk |
|---|---|---|
| **1** | Create `web/nodes/` directory tree with `__init__.py` files | None — additive |
| **2** | Move all YAML files from `web/config/nodes/` → `web/nodes/` | Breaks YAML loading until step 3 |
| **3** | Update `node_defs.py` `_CONFIG_DIR` to `web/nodes` | Restores YAML loading |
| **4** | Move all JS files from `web/static/nodes/` → `web/nodes/` | Breaks JS loading until steps 5-6 |
| **5** | Add `/nodes/` route to `server.py` | Enables serving JS from new location |
| **6** | Update all YAML `src` fields: `web/static/nodes/` → `web/nodes/` | Restores JS loading |
| **7** | Update `node-editor.js` path transform | Restores JS loading (works with step 6) |
| **8** | Move `web/backends/_helpers.py` → `web/nodes/_shared/helpers.py` | Breaks backend imports until step 9 |
| **9** | Move all backend `.py` files to `web/nodes/{cat}/` | Continues break until step 10 |
| **10** | Update all Python imports in `server.py` and backend files | Restores all backends |
| **11** | Split `web/uv_api.py` into per-node files + shared helpers | Swap — restores immediately |
| **12** | Extract `list_folder` from `server.py` to `web/nodes/bundle/folder_bundle.py` | Swap — restores immediately |
| **13** | Delete emptied old directories | Cleanup |
| **14** | Update `repomix.config.json`, `AGENTS.md`, `NODE_MIGRATION_PLAN.md` | Docs only |

**Atomic execution**: Steps 2-3 should be done together (YAML move + config update). Steps 4-7 should be done together (JS move + serving + path update). Steps 8-10 should be done together (Python move + import update). This gives three atomic transitions with no broken intermediate state.

---

## File Move Manifest

### YAML moves (42 files)

All follow the pattern: `web/config/nodes/{cat}/{file}` → `web/nodes/{cat}/{file}`

```
web/config/nodes/agent-brain/agent.yaml        → web/nodes/agent-brain/agent.yaml
web/config/nodes/agent-brain/brain.yaml         → web/nodes/agent-brain/brain.yaml
web/config/nodes/agent-brain/context.yaml       → web/nodes/agent-brain/context.yaml
web/config/nodes/agent-brain/time.yaml          → web/nodes/agent-brain/time.yaml
web/config/nodes/agent-brain/tool-flag.yaml     → web/nodes/agent-brain/tool-flag.yaml
web/config/nodes/agent-brain/toolbox.yaml       → web/nodes/agent-brain/toolbox.yaml
web/config/nodes/bundle/create-bundle.yaml      → web/nodes/bundle/create-bundle.yaml
web/config/nodes/bundle/folder-bundle.yaml      → web/nodes/bundle/folder-bundle.yaml
web/config/nodes/bundle/sample-bundle.yaml      → web/nodes/bundle/sample-bundle.yaml
web/config/nodes/coordinates/coordinate.yaml    → web/nodes/coordinates/coordinate.yaml
web/config/nodes/coordinates/mapping.yaml       → web/nodes/coordinates/mapping.yaml
web/config/nodes/grok-imagine/cmd-edit.yaml     → web/nodes/grok-imagine/cmd-edit.yaml
web/config/nodes/grok-imagine/cmd-extend.yaml   → web/nodes/grok-imagine/cmd-extend.yaml
web/config/nodes/grok-imagine/cmd-image.yaml    → web/nodes/grok-imagine/cmd-image.yaml
web/config/nodes/grok-imagine/cmd-merge.yaml    → web/nodes/grok-imagine/cmd-merge.yaml
web/config/nodes/grok-imagine/cmd-video.yaml    → web/nodes/grok-imagine/cmd-video.yaml
web/config/nodes/layout/reroute.yaml            → web/nodes/layout/reroute.yaml
web/config/nodes/loop/loop-decompose.yaml       → web/nodes/loop/loop-decompose.yaml
web/config/nodes/loop/loop-output.yaml          → web/nodes/loop/loop-output.yaml
web/config/nodes/operations/blur.yaml           → web/nodes/operations/blur.yaml
web/config/nodes/operations/compress-image.yaml → web/nodes/operations/compress-image.yaml
web/config/nodes/operations/crop-media.yaml     → web/nodes/operations/crop-media.yaml
web/config/nodes/operations/math-op.yaml        → web/nodes/operations/math-op.yaml
web/config/nodes/operations/random.yaml         → web/nodes/operations/random.yaml
web/config/nodes/operations/resize-media.yaml   → web/nodes/operations/resize-media.yaml
web/config/nodes/operations/text-join.yaml      → web/nodes/operations/text-join.yaml
web/config/nodes/operations/text-op.yaml        → web/nodes/operations/text-op.yaml
web/config/nodes/output/canvas.yaml             → web/nodes/output/canvas.yaml
web/config/nodes/output/preview.yaml            → web/nodes/output/preview.yaml
web/config/nodes/output/uv-render.yaml          → web/nodes/output/uv-render.yaml
web/config/nodes/primitives/boolean-input.yaml  → web/nodes/primitives/boolean-input.yaml
web/config/nodes/primitives/file.yaml           → web/nodes/primitives/file.yaml
web/config/nodes/primitives/number-input.yaml   → web/nodes/primitives/number-input.yaml
web/config/nodes/primitives/text-input.yaml     → web/nodes/primitives/text-input.yaml
web/config/nodes/primitives/vector-input.yaml   → web/nodes/primitives/vector-input.yaml
web/config/nodes/prompt/definition.yaml         → web/nodes/prompt/definition.yaml
web/config/nodes/prompt/prompt-filter.yaml      → web/nodes/prompt/prompt-filter.yaml
web/config/nodes/prompt/prompt.yaml             → web/nodes/prompt/prompt.yaml
web/config/nodes/triggers/pause.yaml            → web/nodes/triggers/pause.yaml
web/config/nodes/triggers/run-trigger.yaml      → web/nodes/triggers/run-trigger.yaml
web/config/nodes/vector/mix.yaml                → web/nodes/vector/mix.yaml
web/config/nodes/vector/vector-op.yaml          → web/nodes/vector/vector-op.yaml
```

### JS moves (42 files)

All follow the pattern: `web/static/nodes/{cat}/{file}` → `web/nodes/{cat}/{file}`

```
web/static/nodes/agent-brain/agent.js        → web/nodes/agent-brain/agent.js
web/static/nodes/agent-brain/brain.js        → web/nodes/agent-brain/brain.js
web/static/nodes/agent-brain/context.js      → web/nodes/agent-brain/context.js
web/static/nodes/agent-brain/time.js         → web/nodes/agent-brain/time.js
web/static/nodes/agent-brain/tool-flag.js    → web/nodes/agent-brain/tool-flag.js
web/static/nodes/agent-brain/toolbox.js      → web/nodes/agent-brain/toolbox.js
web/static/nodes/bundle/create-bundle.js     → web/nodes/bundle/create-bundle.js
web/static/nodes/bundle/folder-bundle.js     → web/nodes/bundle/folder-bundle.js
web/static/nodes/bundle/sample-bundle.js     → web/nodes/bundle/sample-bundle.js
web/static/nodes/coordinates/coordinate.js   → web/nodes/coordinates/coordinate.js
web/static/nodes/coordinates/mapping.js      → web/nodes/coordinates/mapping.js
web/static/nodes/grok-imagine/cmd-edit.js    → web/nodes/grok-imagine/cmd-edit.js
web/static/nodes/grok-imagine/cmd-extend.js  → web/nodes/grok-imagine/cmd-extend.js
web/static/nodes/grok-imagine/cmd-image.js   → web/nodes/grok-imagine/cmd-image.js
web/static/nodes/grok-imagine/cmd-merge.js   → web/nodes/grok-imagine/cmd-merge.js
web/static/nodes/grok-imagine/cmd-video.js   → web/nodes/grok-imagine/cmd-video.js
web/static/nodes/layout/reroute.js           → web/nodes/layout/reroute.js
web/static/nodes/loop/loop-decompose.js      → web/nodes/loop/loop-decompose.js
web/static/nodes/loop/loop-output.js         → web/nodes/loop/loop-output.js
web/static/nodes/operations/blur.js          → web/nodes/operations/blur.js
web/static/nodes/operations/compress-image.js → web/nodes/operations/compress-image.js
web/static/nodes/operations/crop-media.js    → web/nodes/operations/crop-media.js
web/static/nodes/operations/math-op.js       → web/nodes/operations/math-op.js
web/static/nodes/operations/random.js        → web/nodes/operations/random.js
web/static/nodes/operations/resize-media.js  → web/nodes/operations/resize-media.js
web/static/nodes/operations/text-join.js     → web/nodes/operations/text-join.js
web/static/nodes/operations/text-op.js       → web/nodes/operations/text-op.js
web/static/nodes/output/canvas.js            → web/nodes/output/canvas.js
web/static/nodes/output/preview.js           → web/nodes/output/preview.js
web/static/nodes/output/uv-render.js         → web/nodes/output/uv-render.js
web/static/nodes/primitives/boolean-input.js → web/nodes/primitives/boolean-input.js
web/static/nodes/primitives/file.js          → web/nodes/primitives/file.js
web/static/nodes/primitives/number-input.js  → web/nodes/primitives/number-input.js
web/static/nodes/primitives/text-input.js    → web/nodes/primitives/text-input.js
web/static/nodes/primitives/vector-input.js  → web/nodes/primitives/vector-input.js
web/static/nodes/prompt/definition.js        → web/nodes/prompt/definition.js
web/static/nodes/prompt/prompt-filter.js     → web/nodes/prompt/prompt-filter.js
web/static/nodes/prompt/prompt.js            → web/nodes/prompt/prompt.js
web/static/nodes/triggers/pause.js           → web/nodes/triggers/pause.js
web/static/nodes/triggers/run-trigger.js     → web/nodes/triggers/run-trigger.js
web/static/nodes/vector/mix.js               → web/nodes/vector/mix.js
web/static/nodes/vector/vector-op.js         → web/nodes/vector/vector-op.js
```

### Python backend moves (6 extracted + 1 shared)

```
web/backends/_helpers.py                 → web/nodes/_shared/helpers.py
web/backends/operations/blur.py          → web/nodes/operations/blur.py
web/backends/operations/compress.py      → web/nodes/operations/compress.py
web/backends/operations/crop_media.py    → web/nodes/operations/crop_media.py
web/backends/operations/resize_media.py  → web/nodes/operations/resize_media.py
web/backends/output/canvas.py            → web/nodes/output/canvas.py
web/backends/prompt/filter_prompt.py     → web/nodes/prompt/filter_prompt.py
```

### Python splits from `web/uv_api.py`

```
uv_api.py shared helpers                → web/nodes/_shared/uv.py
uv_api.py:coordinate()                  → web/nodes/coordinates/coordinate.py
uv_api.py:mapping()                     → web/nodes/coordinates/mapping.py
uv_api.py:mix()                         → web/nodes/vector/mix.py
uv_api.py:vector()                      → web/nodes/vector/vector_op.py
uv_api.py:render()                      → web/nodes/output/uv_render.py
```

### Python extraction from `web/server.py`

```
server.py:list_folder()                  → web/nodes/bundle/folder_bundle.py
```

---

## Files That Need Code Edits (not just moves)

| File | Change |
|---|---|
| `web/node_defs.py` | `_CONFIG_DIR` path |
| `web/server.py` | Add `/nodes/` route, update 7 backend imports, remove `list_folder` function, update UV imports from inline to new paths |
| `web/static/node-editor.js` | `loadYamlNodeDefs()` path transform |
| `web/nodes/operations/blur.py` | `from web.backends._helpers` → `from web.nodes._shared.helpers` |
| `web/nodes/operations/compress.py` | `from web.backends._helpers` → `from web.nodes._shared.helpers` |
| `web/nodes/operations/crop_media.py` | `from web.backends._helpers` → `from web.nodes._shared.helpers` |
| `web/nodes/operations/resize_media.py` | `from web.backends._helpers` → `from web.nodes._shared.helpers` |
| `web/nodes/output/canvas.py` | `from web.backends._helpers` → `from web.nodes._shared.helpers` |
| `web/nodes/prompt/filter_prompt.py` | `from web.backends._helpers` → `from web.nodes._shared.helpers` |
| `web/nodes/coordinates/coordinate.py` | New file — extracted from `uv_api.py`, imports from `web.nodes._shared.uv` |
| `web/nodes/coordinates/mapping.py` | New file — extracted from `uv_api.py`, imports from `web.nodes._shared.uv` |
| `web/nodes/vector/mix.py` | New file — extracted from `uv_api.py`, imports from `web.nodes._shared.uv` |
| `web/nodes/vector/vector_op.py` | New file — extracted from `uv_api.py`, imports from `web.nodes._shared.uv` |
| `web/nodes/output/uv_render.py` | New file — extracted from `uv_api.py`, imports from `web.nodes._shared.uv` |
| `web/nodes/bundle/folder_bundle.py` | New file — extracted from `server.py` |
| 42 YAML files | `src` field path update |
| `AGENTS.md` | Path references |
| `NODE_MIGRATION_PLAN.md` | Path references |
| `repomix.config.json` | Include/exclude patterns if applicable |

---

## Validation After Completion

```bash
python3 -m compileall -q src web rundeer.py __init__.py
python3 rundeer.py --help
python3 rundeer.py web --help
rg --files -g '*.js' web/nodes/ | xargs -r -n 1 node --check
```

Verify in browser:
- `/api/node-defs` returns all 42 nodes with updated `src` paths
- All node JS resolvers load (no 404s in console)
- Node operations that call backends (blur, compress, crop, resize, canvas, filter-prompt, UV ops) still work
- Graph execution still works end-to-end