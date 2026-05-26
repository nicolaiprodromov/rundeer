# Legacy Code Cleanup

All old node type names (`preview-image`, `preview-video`, `preview-text`, `image-input`, `video-input`, `filepath-input`) are pre-launch leftovers. No saved graphs in `.rundeer/data/graphs/` use them. Delete everything — no migration shims needed.

---

## 1. `web/static/node-editor.js` — Legacy migration sets (lines 401–402)

Delete both constants:

```
line 401  →  const LEGACY_PREVIEW_TYPES = new Set(["preview-image", "preview-video", "preview-text"]);
line 402  →  const LEGACY_FILE_TYPES = new Set(["image-input", "video-input", "filepath-input"]);
```

## 2. `web/static/node-editor.js` — Migration shim in `loadGraphData` (lines 8158–8159)

Delete both lines:

```
line 8158  →  if (LEGACY_PREVIEW_TYPES.has(n.type)) migrated = { ...migrated, type: "preview" };
line 8159  →  if (LEGACY_FILE_TYPES.has(migrated.type)) migrated = { ...migrated, type: "file" };
```

## 3. `web/static/node-editor.js` — Dead `gatherMentionOptions` checks (lines 5875–5879)

Delete both `if` blocks — old type names that can never appear at runtime:

```
line 5875  →  if (n.type === "image-input" && n.props?.path) {
               pushOpt(id, `Image · ${basenameOf(n.props.path)}`, n.props.path, "image");
             }
line 5878  →  if (n.type === "video-input" && n.props?.path) {
               pushOpt(id, `Video · ${basenameOf(n.props.path)}`, n.props.path, "video");
             }
```

## 4. `web/static/node-editor.js` — Stale `preview-video` hint in `makeBundleMedia` (line 2931)

Remove the `hint === "preview-video"` check — old kindHint value that nothing produces anymore:

```
line 2931  →  const isVideo = hint === "video" || hint === "preview-video" || /\.(mp4|...
```

Change to:

```
const isVideo = hint === "video" || /\.(mp4|mov|webm|mkv)$/i.test(String(value));
```

## 5. `web/nodes/primitives/file.js` — Legacy resolver aliases (lines 4–6)

Delete the three alias lines that register the `file` resolver under old type names:

```
line 4  →  window.RundeerNodes["image-input"] = window.RundeerNodes["file"];
line 5  →  window.RundeerNodes["video-input"] = window.RundeerNodes["file"];
line 6  →  window.RundeerNodes["filepath-input"] = window.RundeerNodes["file"];
```

## 6. `web/static/node-editor.js` — `window.NODE_REGISTRY` stale global (line 8464)

`NODE_REGISTRY` is never set anywhere in the codebase. Every other def lookup uses `NODE_BY_TYPE`. This means `def` is always `undefined` and the `setNodePropValue` branch inside the loop is dead.

```
line 8464  →  const def = (window.NODE_REGISTRY || {})[node.type];
```

Change to:

```
const def = NODE_BY_TYPE[node.type];
```

## 7. `web/static/node-editor.js` — `REMOVED_COMMAND_PROP_IDS` + `sanitizeCommandProps` migration shim (lines 1211–1225, 8184)

Strips old command prop names (`dry_run`, `grid`, `grid_only`, `grid_rows`, `grid_columns`, `grid_padding`, `grid_bg_color`) from saved graphs on load. These props no longer exist in any YAML config — pre-launch artifact.

Delete the constant, the function, and the call site:

```
line 1211  →  const REMOVED_COMMAND_PROP_IDS = new Set([
               "dry_run", "grid", "grid_only", "grid_rows",
               "grid_columns", "grid_padding", "grid_bg_color",
             ]);
line 1221  →  function sanitizeCommandProps(node) { ... }
line 8184  →  sanitizeCommandProps(graph.nodes[id]);
```

## 8. `web/static/node-editor.js` — Hardcoded `tool-flag` palette filter (lines 8299–8303)

Hardcodes `"tool-flag"` to hide it from the node palette. Every other filtering concern is YAML-trait-driven.

```
line 8299  →  if (cat.category === "Agent Brain") {
               return { ...cat, nodes: cat.nodes.filter((n) => n.type !== "tool-flag") };
             }
```

Add a `paletteHidden` trait to `web/nodes/agent-brain/tool-flag.yaml` and replace this with:

```js
return { ...cat, nodes: cat.nodes.filter((n) => !(n.traits || []).includes("paletteHidden")) };
```

Or if you don't want to add a trait, just delete the filter — the tool-flag node is part of the Agent Brain category which is only shown in brain graph mode anyway.

## 9. `web/agent/brain_graph.py` — Dead `BRAIN_NODE_TYPES` set (line 23)

Computed from YAML but never referenced by any code. Grep returns only the definition and a mention in `NODE_MIGRATION_PLAN.md`.

```
line 23  →  BRAIN_NODE_TYPES = {d["type"] for d in _defs if d.get("category") == "Agent Brain"}
```

Delete the line.

## 10. `web/server.py` — Dead `import urllib.request` (line 16)

Never used. No `urllib.request.*` call exists in the file.

```
line 16  →  import urllib.request
```

Delete the line.

---

## Verification

After cleanup, confirm zero references remain:

```bash
grep -rn 'preview-image\|preview-video\|preview-text\|image-input\|video-input\|filepath-input\|LEGACY_PREVIEW_TYPES\|LEGACY_FILE_TYPES\|NODE_REGISTRY\|REMOVED_COMMAND_PROP_IDS\|sanitizeCommandProps\|BRAIN_NODE_TYPES' web/static/node-editor.js web/nodes/ web/agent/ web/server.py
```

CSS classes like `.ne-preview-text` and `.ex-preview-text` are unrelated (they style preview panels, not node types) — leave those alone.