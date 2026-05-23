# Plan: YAML-Driven Node Registration — Blur Node Pilot

## Problem

Every node in Rundeer is currently hardcoded across **four separate locations**, all kept in sync manually:

| Location | What lives there | Lines (blur) |
|---|---|---|
| `web/static/node-editor.js` → `NODE_CATALOG` | Node definition (type, label, desc, inputs, outputs, props) | 550–562 |
| `web/static/node-editor.js` → `resolveNode` switch-case | Frontend execution logic | 7485–7512 |
| `web/server.py` → `blur_image()` | Python backend processing (PIL) | 1010–1077 |
| `web/agent/tools_impl/graph_mutate.py` → `NODE_SOCKETS` | Agent socket validation map | line 25 |

Adding a new node means touching all four files and carefully matching field names, socket types, and prop IDs. This doesn't scale.

## Goal

Replace hardcoded node registration with a **YAML-first** declarative system. Each node is described by a `.yaml` file under `web/config/nodes/` and its execution code lives in a standalone file referenced by the YAML's `src` field. The web app parses these YAML files at startup and feeds them into the existing `NODE_CATALOG` / `NODE_BY_TYPE` / `NODE_SOCKETS` structures.

**Blur is the pilot node.** Once it works, the same pattern applies to every other node.

## Current Blur YAML Spec

```yaml
# web/config/nodes/operations/blur.yaml
Blur:
  out:
    Color: color
  in:
    Color: color
    Radius: slider:[0,100]
  src: web/static/nodes/operations/blur.js
```

## Refined YAML Schema

The current YAML is minimal. We need to extend it slightly to carry everything the existing hardcoded definition carries. Proposed canonical schema:

```yaml
# web/config/nodes/operations/blur.yaml
blur-image:
  label: Blur
  category: Operations
  desc: Gaussian blur an image (or bundle of images)
  in:
    - id: in
      label: Image
      type: color
  out:
    - id: out
      label: Blurred
      type: color
  props:
    - id: radius
      label: "Radius (px)"
      kind: range
      min: 0
      max: 100
      step: 0.5
      default: 4
  src: web/static/nodes/operations/blur.js
  api: /api/blur-image
```

Key decisions:
- Top-level key = node `type` (used as `NODE_BY_TYPE` key, e.g. `blur-image`).
- `in` / `out` are ordered lists of socket defs (not dicts) to preserve layout order.
- `props` is a list matching the existing prop shape (`id`, `label`, `kind`, `default`, etc.).
- `src` points to the JS file containing the frontend execution function.
- `api` (optional) points to the Python backend endpoint, if the node needs server-side processing.
- `color` socket type maps to the existing `color` type in SOCKET_TYPES (compatible with vector and UV).

The user's original shorthand form (`Radius: slider:[0,100]`) is a valid compact syntax we should also support — the parser can expand it into the full prop object.

---

## Implementation Steps

### Step 1 — Add YAML parsing to the Python server

**Files:** `web/server.py`

- Add `import yaml` (PyYAML) to `web/server.py`. PyYAML is already available in the Python environment via `pip install pyyaml` (or it may already be installed — check first).
- Write a function `load_node_defs(config_dir)` that:
  1. Walks `web/config/nodes/` recursively for `*.yaml` files.
  2. Parses each YAML file.
  3. Normalizes the compact YAML shorthand into the canonical shape (expand `slider:[0,100]` → full prop dict, etc.).
  4. Returns a list of node definition dicts ready for the frontend.
- Cache the result at server startup (re-scan on each request is unnecessary; a reload endpoint can be added later).

### Step 2 — Expose node definitions via API

**Files:** `web/server.py`

- Add `GET /api/node-defs` endpoint that returns the parsed YAML node definitions as JSON:
  ```json
  {
    "nodes": [
      {
        "type": "blur-image",
        "label": "Blur",
        "category": "Operations",
        "desc": "Gaussian blur an image (or bundle of images)",
        "inputs": [{"id": "in", "label": "Image", "type": "color"}],
        "outputs": [{"id": "out", "label": "Blurred", "type": "color"}],
        "props": [{"id": "radius", "label": "Radius (px)", "kind": "range", "min": 0, "max": 100, "step": 0.5, "default": 4}],
        "src": "web/static/nodes/operations/blur.js",
        "api": "/api/blur-image"
      }
    ]
  }
  ```
- The response shape matches the existing `NODE_CATALOG` node objects so the frontend can merge them directly.

### Step 3 — Frontend: fetch and merge YAML-defined nodes into NODE_CATALOG

**Files:** `web/static/node-editor.js`

- At startup (during `loadState()` or immediately after), fetch `GET /api/node-defs`.
- For each returned node definition:
  - If a node with that `type` already exists in `NODE_CATALOG`, **replace it** (the YAML version is authoritative).
  - Otherwise, insert it into the correct category (creating the category if needed).
- Rebuild `NODE_BY_TYPE` after merging.
- This means the hardcoded blur-image entry in `NODE_CATALOG` gets removed (or overridden) once the YAML version loads.

### Step 4 — Create `web/static/nodes/operations/blur.js`

**Files:** `web/static/nodes/operations/blur.js` (new)

- Extract the blur-image case from the `resolveNode` switch-case into a standalone async function:
  ```js
  async function resolveBlurImage(node, inputs, outputs, props, helpers) {
    const radius = Math.max(0, Number(props.radius ?? 4));
    const blurOne = async (path) => {
      const p = String(path || "").trim();
      if (!p) return "";
      helpers.appendRunLog(`  ↳ Blurring ${p} (r=${radius})…\n`);
      const result = await helpers.graphFetchJSON("/api/blur-image", {
        method: "POST",
        body: JSON.stringify({ path: p, radius }),
      }, helpers.opts);
      if (result.error) throw new Error(`blur: ${result.error}`);
      helpers.appendRunLog(`  ↳ → ${result.path}\n`);
      return result.path;
    };
    const v = inputs.in;
    if (Array.isArray(v)) {
      const out = [];
      for (const item of v) {
        const blurred = await blurOne(item);
        if (blurred) out.push(blurred);
      }
      outputs.out = out;
      return;
    }
    outputs.out = await blurOne(v);
  }
  ```
- The function receives a `helpers` object containing `appendRunLog`, `graphFetchJSON`, `opts`, and any other utilities the node needs from the host environment.
- This file is loaded at runtime when the blur node is first resolved (or eagerly when the node def is fetched). Since there's no bundler, use dynamic `<script>` injection or `fetch()` + `eval()` / `Function()` (or register on a global like `window.RundeerNodes["blur-image"] = resolveBlurImage`).

**Recommended approach**: Each node JS file registers itself on a global map:
```js
// web/static/nodes/operations/blur.js
(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["blur-image"] = async function(node, inputs, outputs, props, helpers) {
  // ... execution code
};
```
The host `resolveNode` switch-case checks `window.RundeerNodeResolvers[node.type]` before falling through to hardcoded cases.

### Step 5 — Modify `resolveNode` to support external resolvers

**Files:** `web/static/node-editor.js`

- At the top of the `switch (node.type)` block, add a check:
  ```js
  const externalResolver = (window.RundeerNodeResolvers || {})[node.type];
  if (externalResolver) {
    await externalResolver(node, inputs, outputs, props, { appendRunLog, graphFetchJSON, opts, ... });
    break;  // skip the hardcoded switch-case
  }
  ```
- This is a **non-breaking, additive change**. All existing hardcoded nodes continue to work. Only YAML-defined nodes with a `src` file will use the external resolver path.
- Once blur works via the external resolver, remove the hardcoded `case "blur-image"` block.

### Step 6 — Load node JS files dynamically

**Files:** `web/static/node-editor.js`

- After fetching `/api/node-defs`, for each node that has a `src` field, inject a `<script>` tag:
  ```js
  const script = document.createElement("script");
  script.src = `/static/nodes/operations/blur.js`;
  document.head.appendChild(script);
  ```
- The script self-registers on `window.RundeerNodeResolvers` when it loads.
- This happens during startup, before any graph execution.

### Step 7 — Keep the Python blur backend as-is

**Files:** `web/server.py`

- The `blur_image()` function and `/api/blur-image` route in `server.py` stay exactly where they are — no change needed.
- The frontend JS file calls the same API endpoint. The Python backend is the execution engine; the YAML `api` field documents which endpoint to hit.
- In the future, if we want to make the Python side also declarative (auto-route based on YAML), that's a separate step. For now, the existing route stays.

### Step 8 — Update graph_mutate.py NODE_SOCKETS to read from YAML

**Files:** `web/agent/tools_impl/graph_mutate.py`, `web/server.py`

- The `NODE_SOCKETS` dict in `graph_mutate.py` is a manually-maintained duplicate. Once YAML parsing exists in server.py, have `graph_mutate.py` import and use the parsed YAML data instead of its hardcoded dict.
- For the blur pilot: just ensure the existing `"blur-image"` entry stays correct. Automating NODE_SOCKETS from YAML can be done as a follow-up.

### Step 9 — Remove the hardcoded blur-image from NODE_CATALOG

**Files:** `web/static/node-editor.js`

- Once the YAML-loaded definition works end-to-end (palette shows the node, graph execution works, agent can create it), remove the hardcoded blur-image entry from `NODE_CATALOG` (lines 550–562).
- Remove the `case "blur-image"` block from `resolveNode` (lines 7485–7512).
- Verify the node still works identically via the YAML path.

### Step 10 — Smoke test and validation

- Python syntax check: `python3 -m compileall -q src web rundeer.py __init__.py`
- JS syntax check: `rg --files -g '*.js' -g '*.mjs' | xargs -r -n 1 node --check`
- CLI smoke test: `python3 rundeer.py --help`
- Web smoke test: `python3 rundeer.py web --help`
- Manual test: start the web server, open the node editor, add a Blur node from the palette, wire an image into it, set a radius, run the graph, confirm the output is a blurred image.

---

## File Change Summary

| File | Action |
|---|---|
| `web/config/nodes/operations/blur.yaml` | Update to canonical schema (full props, type id, etc.) |
| `web/static/nodes/operations/blur.js` | **New** — extracted blur execution function |
| `web/server.py` | Add YAML parsing (`load_node_defs`), add `GET /api/node-defs` route |
| `web/static/node-editor.js` | Fetch `/api/node-defs` at startup, merge into NODE_CATALOG, add external resolver dispatch in `resolveNode`, remove hardcoded blur-image entry |
| `web/agent/tools_impl/graph_mutate.py` | (Later) derive NODE_SOCKETS from YAML instead of hardcoding |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| PyYAML not installed | Check with `python3 -c "import yaml"`. If missing, add to requirements or use a stdlib fallback parser for the simple YAML subset we need. |
| Dynamic script loading race condition | Ensure all `<script>` tags for node resolvers finish loading before any graph execution begins. Use `script.onload` promises. |
| YAML schema drift from JS expectations | Validate parsed YAML against expected shape before merging. Log warnings for missing fields. |
| Breaking existing saved graphs | The node `type` string (`blur-image`) stays identical. Saved graphs reference type strings, not code locations. No migration needed. |
| Performance of YAML parsing on every request | Parse once at server startup, cache the result. Only re-parse on explicit reload. |

## Future Steps (Out of Scope for This Pilot)

- Migrate remaining ~40 nodes from hardcoded to YAML+JS files.
- Auto-generate NODE_SOCKETS from YAML (eliminate graph_mutate.py duplication).
- Auto-register Python API routes from YAML `api` field.
- YAML hot-reload in dev mode (watch `web/config/nodes/` for changes).
- YAML validation CLI command (`python3 rundeer.py validate-nodes`).
- Support for node categories defined in YAML (`web/config/nodes/categories.yaml`).