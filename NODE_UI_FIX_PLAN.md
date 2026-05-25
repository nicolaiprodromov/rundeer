# Node UI Category Collapse Fix Plan

## The rendering pipeline (YAML → UI)

The path from a YAML node config to rendered DOM is:

1. **`web/node_defs.py` `_normalize_props()`** (line 112) — Reads each prop's `category` field from the YAML, pops it, and converts it to a `group` key via `_slugify()`. Props without a `category` get `group: null`.

2. **`/api/node-defs`** endpoint serves the parsed defs as JSON to the frontend.

3. **`web/static/node-editor.js` `loadYamlNodeDefs()`** (line 9235) — Loads the JSON into `NODE_BY_TYPE` and `NODE_CATALOG`, then loads each node's `src` script.

4. **`buildNodeElement()`** (line 1464) — Master function that builds the full node DOM. Calls `buildNodeFields()` for the props area and `buildSocketRow()` for explicit input/output sockets.

5. **`buildNodeFields()`** (line 3326) — For Primitives, inlines the first prop directly. Remaining props with `group !== null` are grouped into a `Map` keyed by `propGroupId()` and wrapped in a collapsible **`buildNodePanel()`**.

6. **`buildNodePanel()`** (line 2046) — Creates a `<section class="ne-node-panel is-prop-panel is-{groupId}">` with a clickable header, toggleable collapse state, and a `.ne-node-panel-body` that holds the socket rows. Collapse state is read from `node.collapsedPanels[panelKey]`.

7. **`toggleNodePanel()`** (line 2119) — Flips the boolean in `node.collapsedPanels`, **sets `node.height = null`**, and calls `renderGraph()`.

8. **`nodeResizeMin()` / custom `resizeMin()`** (line 3890 / `text-input.js` line 6) — Computes the minimum height the node needs given its current panel collapse state. The generic function iterates all props and accounts for groups. Individual nodes can override via `resizeMin` in their registered module.

9. **CSS** (`web/static/css/nodes.css`) — `.ne-node-panel.is-collapsed .ne-node-panel-body { display: none; }` hides collapsed panel content. Additional flex rules for `text-input` when `is-resized`.

---

## Bugs found

### Bug 1 — CSS specificity: collapsed panel body never hides on resized text-input

**File:** `web/static/css/nodes.css` lines 745 and 813–820

The collapse rule:
```css
.ne-node-panel.is-collapsed .ne-node-panel-body {
  display: none;
}
```
Has **lower specificity** than the text-input flex stretch rule:
```css
.ne-node[data-node-type="text-input"].is-resized .ne-node-panel.is-settings .ne-node-panel-body {
  display: flex;
  flex: 1 1 auto;
  ...
}
```

When the node has `is-resized` (which it always does — see Bug 2), the `display: flex` wins over `display: none`, so the Settings panel body **never actually hides** when collapsed. The `is-collapsed` class is applied correctly to the panel, but the higher-specificity flex rule overrides its effect.

This is the root cause of "it doesn't collapse the socket that it should."

### Bug 2 — `usesDefaultHeight: true` always forces `is-resized`

**File:** `web/static/node-editor.js` line 1479

```js
const fixedHeight = !node.minimized
  ? (node.height || (_reg?.usesDefaultHeight ? def.defaultHeight : null))
  : null;
if (fixedHeight) {
  el.style.height = `${fixedHeight}px`;
  el.classList.add("is-resized");
}
```

`text-input.js` declares `usesDefaultHeight: true`. When `toggleNodePanel` resets `node.height = null`, the re-render falls through to `def.defaultHeight` (240), sets that as the height, and **always adds `is-resized`**. This means the CSS specificity conflict from Bug 1 is permanently active on text-input nodes — the collapse rule can never win.

### Bug 3 — `text-input.js` `resizeMin` ignores the Settings panel

**File:** `web/static/nodes/primitives/text-input.js` lines 6–16

```js
resizeMin(node, def) {
  ...
  return { w: 220, h: HEADER + SOCKET_ROW + TEXTAREA_ROW + BOTTOM_BUFFER };
  // = 34 + 31 + 68 + 6 = 139
}
```

This was written before `highlight_pairs` was moved into a `Settings` category. It hardcodes only the output socket row + one textarea row. It does **not** account for:
- The Settings panel header (32px, always present)
- The Settings panel body when expanded (68px for the textarea)
- The footer height (26px)

This causes the minimum height to be too small, letting the node shrink below what's needed when the panel toggles.

### Bug 4 — Node height jumps to `defaultHeight` on every panel toggle

**File:** `web/static/node-editor.js` line 2127

`toggleNodePanel` sets `node.height = null`, and because `usesDefaultHeight: true`, the re-render always snaps to `defaultHeight` (240px). It doesn't compute a new appropriate height based on the panel's new collapsed/expanded state. The user sees the height suddenly jump to 240px regardless of whether the panel expanded or collapsed — "when I collapse the category it simply changes the entire node height."

### Bug 5 — Visual misattribution: wrong element appears to collapse

When the Settings panel body stays visible (Bug 1) but the node height snaps to 240px (Bug 4), the flex layout redistributes space within the fixed 240px container. The `value` textarea row (`.ne-inline-prop-row.has-md-editor`) has `flex: 1 1 auto`, so it shrinks to accommodate the unchanged Settings panel. The user perceives the **value textarea shrinking** as "collapsing the previous one" instead of the Settings panel collapsing.

---

## Fix plan

### Fix 1 — CSS: add collapsed override at correct specificity

**File:** `web/static/css/nodes.css`

Add a rule with sufficient specificity that `.is-collapsed` beats the flex stretch:

```css
.ne-node[data-node-type="text-input"].is-resized .ne-node-panel.is-settings.is-collapsed .ne-node-panel-body {
  display: none;
}
```

Place it after line 820 (after the flex stretch block). This rule has the same ancestor selector specificity **plus** the extra `.is-collapsed` class, so it always wins when the panel is collapsed.

### Fix 2 — Update `text-input.js` `resizeMin` to account for the Settings panel

**File:** `web/static/nodes/primitives/text-input.js`

The `resizeMin` function needs to:
1. Read `node.collapsedPanels?.["props:settings"]` to know if the panel is collapsed
2. Always include `PANEL_HEAD` (32px) for the Settings header
3. Include `TEXTAREA_ROW` (68px) for the body only when not collapsed
4. Include `FOOTER` (26px)

### Fix 3 — `toggleNodePanel` should compute a proper height instead of snapping to `defaultHeight`

**File:** `web/static/node-editor.js` line 2127

Instead of blindly clearing `node.height = null` (which causes `usesDefaultHeight` to snap to `defaultHeight`), the toggle should:
- Clear `node.height` so the node gets a fresh layout
- After `renderGraph()`, rely on `enforceNodeMinimumSize` + the corrected `resizeMin` to set the right minimum

Since `node.height = null` with `usesDefaultHeight: true` already falls through to `defaultHeight`, we should either:
- **Option A**: After setting `node.height = null` and re-rendering, let the natural DOM height determine the node size (remove `usesDefaultHeight: true` from text-input and let the node auto-size)
- **Option B**: Have `toggleNodePanel` compute the new minimum height from `resizeMin` and set `node.height` to that value

Option A is cleaner — the `usesDefaultHeight` flag was only needed because the textarea needed an initial size, but with proper `min-height` from `resizeMin`, the node can auto-size based on content.

### Fix 4 — Make the `.is-resized` flex rules collapse-aware generically

**File:** `web/static/css/nodes.css`

Rather than a one-off fix for `is-settings`, make the flex stretch rule exclude collapsed panels:

```css
.ne-node[data-node-type="text-input"].is-resized .ne-node-panel.is-settings:not(.is-collapsed),
.ne-node[data-node-type="text-input"].is-resized .ne-node-panel.is-settings:not(.is-collapsed) .ne-node-panel-body,
.ne-node[data-node-type="text-input"].is-resized .ne-inline-prop-row.has-md-editor {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
}
```

This is the preferred approach over Fix 1 — it prevents the flex rules from applying when collapsed, rather than adding an override to undo them.

---

## Files to touch

| File | What changes |
|---|---|
| `web/static/css/nodes.css` | Fix 4 — Add `:not(.is-collapsed)` to the flex stretch selectors (lines 813–820) |
| `web/static/nodes/primitives/text-input.js` | Fix 2 — Update `resizeMin` to include Settings panel header + conditional body |
| `web/static/node-editor.js` | Fix 3 — Adjust `toggleNodePanel` or `usesDefaultHeight` logic so height doesn't snap to a stale default |

## Execution order

1. **Fix 4** (CSS) — Immediately stops the visual corruption. Low risk.
2. **Fix 2** (`text-input.js` `resizeMin`) — Corrects minimum height calculation. Required for Fix 3 to work.
3. **Fix 3** (`node-editor.js` toggle logic) — Ensures height adapts to panel state changes correctly.