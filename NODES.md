# NODES — How to Build a Rundeer Node

## Architecture

A node is defined by up to 3 files inside `web/nodes/<category-folder>/`:

| File | Required | Purpose |
|---|---|---|
| `<slug>.yaml` | yes | Definition: inputs, outputs, metadata |
| `<slug>.js` | yes | Frontend: resolve logic + optional UI hooks |
| `<slug>.py` | only if backend work needed | Python handler called via `api` route |

The YAML key is the **node type** (kebab-case slug, e.g. `blur-image`). The `src` field points at the JS file. The optional `api` field names a backend endpoint.

`web/node_defs.py` scans all `web/nodes/**/*.yaml` at startup, parses them into a flat list served at `GET /api/node-defs`. The frontend loads this, injects each `src` JS as a `<script>`, and builds `NODE_BY_TYPE` + `NODE_CATALOG`.

## YAML Definition

All inputs — both pure sockets and widget controls — live in a single `in` array. Entries without `kind` are pure sockets (wire dot + label). Entries with `kind` are widget sockets (wire dot + editable control).

```yaml
my-node:
  label: My Node
  category: Operations
  desc: "Short description for tooltip"
  defaultWidth: 260
  defaultHeight: 240
  resizable: true
  in:
    - id: in
      label: Input
      type: any
    - id: ref
      label: Reference
      type: image
      multi: true
    - id: size
      label: Size
      type: vector
      kind: text
      default: "1024,1024"
      passthroughWired: true
    - id: quality
      label: Quality
      kind: range
      min: 1
      max: 100
      step: 1
      default: 75
    - id: mode
      label: Mode
      kind: select
      options: [fast, quality]
      default: fast
      group: settings
  out:
    - id: out
      label: Result
      type: any
  traits: [heavy]
  src: web/nodes/operations/my-node.js
  api: /api/my-node
```

### Entry classification

| Has `kind`? | Has `type`? | Result |
|---|---|---|
| no | yes (required) | Pure socket — wire dot + label only |
| yes | yes (explicit) | Widget socket — widget + wire dot, socket type from `type` |
| yes | no | Widget socket — widget + wire dot, socket type inferred from `kind` |

Type inference from `kind` (when `type` is omitted):
- `checkbox` → `boolean`
- `number`, `range` → `number`
- `color` → `color`
- everything else (`text`, `textarea`, `select`, `hidden`) → `text`

### Socket types

`text` · `image` · `video` · `number` · `boolean` · `definition` · `filepath` · `vector` · `vector-map` · `color` · `image-bundle` · `video-bundle` · `run` · `any`

Colors are set in `SOCKET_TYPES` at the top of `web/static/node-editor.js`.

### Output socket fields

`id` · `label` · `type`

### Input entry fields

| Key | Use |
|---|---|
| `id` | Kebab-case identifier |
| `label` | Display label |
| `type` | Socket type (required for pure sockets, optional for widget entries — inferred from `kind`) |
| `multi` | `true` for dotted multi-connect sockets |
| `kind` | Widget type: `text` · `number` · `checkbox` · `select` · `range` · `textarea` · `color` · `hidden` |
| `default` | Default value for widget entries |
| `placeholder` | Hint string |
| `options` | Array for `select` kind |
| `min`, `max`, `step` | For `range` kind |
| `group` | Groups widget entries into a collapsible panel (e.g. `settings`, `media`, `run`). `null` = inline, omitted = inline |
| `passthroughWired` | `true` hides the widget when a wire is connected |
| `mdEditor` | `true` enables markdown editor for `textarea` kind |

### Top-level YAML keys

| Key | Type | Notes |
|---|---|---|
| `label` | string | Display name |
| `category` | string | Add-menu category; defaults to folder name |
| `desc` | string | Tooltip |
| `defaultWidth` | int | Default px width (default 220) |
| `defaultHeight` | int | Default px height |
| `resizable` | bool | User-resizable |
| `allInline` | bool | Compact inline layout |
| `traits` | list | See Traits below |
| `pairWith` | string | Node type to auto-create together (e.g. loop pairs) |
| `src` | string | Path to JS file relative to repo root |
| `api` | string | Backend endpoint path |

### Category registration

Every category used by a node **must** also be listed in `web/config/settings.yaml` under `settings.Nodes.Categories` with an oklch accent color. This controls the `--node-accent` CSS variable for the header tint and is exposed in the app settings UI so the user can change it.

```yaml
settings:
  Nodes:
    Categories:
      My Category: oklch(55% 0.2 200)
```

The key must match the `category` value in the node YAML exactly. Without this entry the category will render with a fallback gray accent and won't appear in the settings panel.

### Traits

| Trait | Meaning |
|---|---|
| `command` | Grok Imagine generation command (uses `executeCommandNode` helper) |
| `heavy` | Long-running, shows execution indicator |
| `preview` | Renders inline image/video/text preview |
| `terminal` | Output/endpoint node, resolved independently |
| `liveUpdate` | Auto-refreshes preview when props change |
| `producesBundle` | Output is an array/bundle |

## JS Registration

Every node JS file registers on `window.RundeerNodes`:

```js
(window.RundeerNodes = window.RundeerNodes || {})["my-node"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    outputs.out = inputs.in;
  },
};
```

The key **must** match the YAML node type exactly.

### `resolve(node, inputs, outputs, props, helpers)`

Required. Runs during graph execution. Read from `inputs.<socketId>`, write to `outputs.<socketId>`.

`helpers` provides:

| Key | Use |
|---|---|
| `appendRunLog(text)` | Write to the run log panel |
| `graphFetchJSON(url, fetchOpts, runOpts)` | POST/GET to backend API (handles pause/cancel) |
| `opts` | Run options: `{dryRun, lite, liteCommands, run}` |
| `formatBytes(n)` | Human-readable byte string |
| `nodeId` | Current node's ID |
| `activeIncomingEdges(nodeId, socketId?)` | Get incoming edges |
| `baseType(type)` | Resolve bundle types (`image-bundle` → `image`) |
| `outputSocketDef(nodeId, socketId)` | Get upstream socket definition |
| `graph` | Full graph object |
| `cache` | Shared resolution cache |
| `resolveNode(nodeId, cache, loopCtx, opts)` | Resolve another node |
| `executeCommandNode(node, inputs, opts)` | Shared helper for command-type nodes |

### Optional lifecycle hooks

| Hook | Signature | When |
|---|---|---|
| `buildBody(nodeId, node, ctx)` | → DOM Element | Custom body replacing default field rendering |
| `buildFooter(nodeId, node, ctx)` | → DOM Element | Custom footer area below body |
| `buildNode(id, node, def, ctx)` | → DOM Element | Full custom node (replaces entire default) |
| `resizeMin(node, def)` | → `{w, h}` | Custom minimum resize dimensions |
| `isInputVisible(node, sock, ctx)` | → boolean | Conditionally show/hide an input socket |
| `onEdgeChange(nodeId, changedSocket, ctx)` | void | React to connection add/remove |
| `createPair(x, y, opts, ctx)` | → nodeId | Auto-create a companion node |
| `migrate(node)` | void | Patch node data on creation |

`ctx` provides: `graph`, `SOCKET_TYPES`, `NODE_BY_TYPE`, `renderNodes`, `renderConnections`, `renderGraph`, `scheduleAutosave`, `schedulePreviewRefresh`, `activeIncomingEdges`, `outputSocketDef`, `baseType`, `isNodeMuted`, `fetchJSON`, `genNodeId`, `genEdgeId`, `runFromTrigger`, `selectOnly`, `startWire`.

## Python Backend Handler

For nodes with server-side work, add a `.py` file and register the route.

### Handler pattern

```python
from pathlib import Path
from typing import Any, Dict
from web.nodes._shared.helpers import safe_project_path, relpath

def my_handler(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    rel = str(payload.get("path") or "").strip()
    src = safe_project_path(root, rel)
    # ... process ...
    return {"path": relpath(root, dest)}
```

`root` is the project root. `payload` is the JSON body from the frontend.

Use `safe_project_path(root, rel)` for all file access (prevents path traversal).
Use `rpaths.cache_dir(root, "subfolder")` from `rundeer.core.paths` for cache output.
Use `relpath(root, path)` to convert absolute paths back to project-relative for the response.

### Register the route

In `web/server.py`, add an `elif` inside the POST handler:

```python
elif parsed.path == "/api/my-node":
    from web.nodes.my_category.my_node import my_handler
    self._send_json(my_handler(self.server.project_root, payload))
```

Use lazy import. The endpoint string must match the `api` field in the YAML.

## Resolve Patterns

### Pure frontend (no backend)

```js
(window.RundeerNodes = window.RundeerNodes || {})["math-op"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    const a = Number(inputs.a ?? 0);
    const b = Number(inputs.b ?? 0);
    const op = props.op || "add";
    switch (op) {
      case "add": outputs.out = a + b; break;
      case "subtract": outputs.out = a - b; break;
    }
  },
};
```

### Backend API call

```js
(window.RundeerNodes = window.RundeerNodes || {})["blur-image"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    const v = inputs.in;
    helpers.appendRunLog(`  ↳ Processing ${v}…\n`);
    const result = await helpers.graphFetchJSON("/api/blur-image", {
      method: "POST",
      body: JSON.stringify({ path: v, radius: Number(props.radius ?? 4) }),
    }, helpers.opts);
    if (result.error) throw new Error(result.error);
    outputs.out = result.path;
  },
};
```

### Bundle-aware (handle arrays)

```js
const v = inputs.in;
if (Array.isArray(v)) {
  const out = [];
  for (const item of v) {
    const result = await processOne(item);
    if (result) out.push(result);
  }
  outputs.out = out;
  return;
}
outputs.out = await processOne(v);
```

### Command node (Grok Imagine)

```js
(window.RundeerNodes = window.RundeerNodes || {})["cmd-image"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    const result = await helpers.executeCommandNode(node, inputs, helpers.opts);
    outputs.out = Array.isArray(result.artifacts) && result.artifacts.length > 1
      ? result.artifacts : result.firstArtifact || "";
  },
};
```

### Passthrough

```js
outputs.out = inputs.in;
```

## CSS

Node-specific CSS goes in `web/static/css/nodes/core.css`, scoped via the `data-node-type` attribute:

```css
.ne-shell .ne-node[data-node-type="my-node"] .ne-node-body {
  padding: 12px;
}
```

Category accent color is set via `--node-accent` on `[data-category="My Category"]` (driven by settings YAML).

Key CSS variables: `--gold`, `--violet`, `--bg-deep`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-strong`, `--text`, `--text-soft`, `--muted`, `--quiet`, `--whisper`, `--radius`, `--radius-lg`, `--font-mono`, `--font-body`, `--font-display`.

Key CSS classes: `.ne-node`, `.ne-node-header`, `.ne-node-body`, `.ne-node-footer`, `.ne-socket-row`, `.ne-socket`, `.ne-socket-label`, `.ne-inline-prop-row`, `.ne-node-field`, `.ne-node-field-control`, `.ne-node-panel`.

## Checklist for a New Node

1. Create folder `web/nodes/<category>/` if new category
2. If new category, add it to `web/config/settings.yaml` under `settings.Nodes.Categories` with an oklch color
3. Add `__init__.py` in folder if Python handler needed
4. Write `<slug>.yaml` with definition
5. Write `<slug>.js` with `resolve` + optional hooks
6. (Optional) Write `<slug>.py` with backend handler
7. (Optional) Add route in `web/server.py` POST handler
8. (Optional) Add type-specific CSS in `web/static/css/nodes/core.css`
9. Validate: `node --check web/nodes/<category>/<slug>.js`
10. Validate Python if added: `python3 -m compileall -q web/nodes/<category>/`