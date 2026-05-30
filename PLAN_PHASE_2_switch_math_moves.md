# Phase 2 — Switch Node, Math Conditionals, Move Mix & Vector Op

## Goal

Deliver the three Phase-2 items verbatim from `new_nodes.md`:

1. A new **Switch** node (category `Operations`) that routes one of two same-data-type inputs to a single output via a selector.
2. **Conditional / comparison operations** in the existing **Math** node (`less`, `greater`, `equal`-with-epsilon, plus more useful ops).
3. Move **Mix** and the renamed **Vector → Vector Op** node into the `Operations` category.

All work stays under `web/`. No code comments, no docstrings, no inline comments. No fallbacks, no legacy preservation, no live migrations. Short token-efficient names. Modular, isolated code.

## Scope

In scope:
- New files for the Switch node under `web/nodes/operations/`.
- Edits to `web/nodes/operations/math-op.yaml` + `math-op.js`.
- Move + edit of `vector-op.{yaml,js,py}` and `mix.{yaml,js,py}` from `web/nodes/vector/` to `web/nodes/operations/`.
- Route import edits in `web/server.py`.
- `Vector` category removal from `web/config/settings.yaml` and `web/config/settings_manager.py`.

Out of scope:
- Multi-type / N-way switching (item 1 is explicitly "for now only switch between same data type" / 2 inputs).
- Dynamic per-instance output socket typing (the def/type system is static YAML; see Part A "Same-type handling").
- Migrating or rewriting old graphs in `.rundeer/data/graphs/` (handled as a warning — see Breaking Changes).

## Background (current state)

Verified references:

- **Math node** — `web/nodes/operations/math-op.yaml:1`
  - `category: Operations` (`math-op.yaml:3`).
  - Options: `[add, subtract, multiply, divide, modulo, power, min, max]` (`math-op.yaml:15`).
  - Output `out` is `type: number` (`math-op.yaml:17`).
  - Resolve `switch (op)` with 8 cases, `outputs.out = r` (`web/nodes/operations/math-op.js:6`).
- **Vector Op node** — `web/nodes/vector/vector-op.yaml:1`
  - `label: Vector` (`vector-op.yaml:2`), `category: Vector` (`vector-op.yaml:3`).
  - `a`/`b`/`out` all `type: any` (`vector-op.yaml:6`,`:9`,`:18`).
  - `src: web/nodes/vector/vector-op.js` (`vector-op.yaml:21`), `api: /api/uv/vector` (`vector-op.yaml:22`).
  - JS calls `/api/uv/vector` via `graphFetchJSON` (`web/nodes/vector/vector-op.js:9`); backend `vector()` in `web/nodes/vector/vector_op.py:10`.
- **Mix node** — `web/nodes/vector/mix.yaml:1`
  - `category: Vector` (`mix.yaml:3`), `traits: [liveUpdate]` (`mix.yaml:38`).
  - `src: web/nodes/vector/mix.js` (`mix.yaml:39`), `api: /api/uv/mix` (`mix.yaml:40`).
  - JS has a scalar fast-path then calls `/api/uv/mix` (`web/nodes/vector/mix.js:37`); backend `mix()` in `web/nodes/vector/mix.py:12`.
- **Server routes** — `web/server.py:327` (`/api/uv/vector` → `from web.nodes.vector.vector_op import vector`), `web/server.py:333` (`/api/uv/mix` → `from web.nodes.vector.mix import mix`). Lazy imports.
- **Category registry** — `web/config/settings.yaml:31` (`settings.Nodes.Categories`); `Operations` at `:33`, `Vector: oklch(55% 0.2 270)` at `:41`. Mirrored default in `web/config/settings_manager.py:53`; `Vector` at `:63`.
- **Category mechanics (CRITICAL)** — In `web/node_defs.py`, `category` is read from the YAML body and only falls back to the folder name when absent: `str(body.get("category", _category_from_path(yaml_path)))` (`node_defs.py:174`; `_category_from_path` at `:138`). YAML discovery is `root.rglob("*.yaml")` (`node_defs.py:205`), so a node's folder location does **not** affect which category it lands in. `src` (`node_defs.py:180`) and `api` (`node_defs.py:182`) are passed through verbatim — the frontend injects `src` as a `<script>` and the backend routes `api`. **Conclusion: the `category` field is metadata, fully independent of the folder.** The add-menu groups purely by `category` (`web/static/node-editor.js:387` `NODE_CATALOG`, grouping at `:5184`/`:8315`).
- **Type system** — `SOCKET_TYPES` includes `boolean` and `any` (`web/static/node-editor.js:4`, boolean at `:9`, any at `:18`). `canConnect` (`node-editor.js:27`): identical types connect; `any` connects to anything (`:33`); same `baseType` connects (`:35`). `aggregateSocketType` returns the shared type or `any` (`node-editor.js:689`). Output socket type is read statically from the def (`outputSocketDef`, used at `node-editor.js:367`) — there is no per-instance dynamic output type. `onEdgeChange` / `isInputVisible` hooks exist and are demonstrated in `web/nodes/operations/compress-image.js:70`,`:75`.
- **No existing Switch node** (grep for a `switch` node type/slug found only JS `switch` statements). The slug `switch` is free.
- **Only Mix and Vector Op use `category: Vector`** (grep `category: Vector` across `web/nodes` → exactly `vector-op.yaml:3` and `mix.yaml:3`). No agent code references the `"Vector"` category string. Note: `SOCKET_TYPES.vector` / `vector-map` (`node-editor.js:12`) are **socket data types**, unrelated to the category — do **not** touch them.

## Part A — Switch Node

New node, pure frontend (no backend / no `api` / no `.py`). Selector is a **boolean** ("Select B"): unchecked → `A`, checked → `B`. Boolean chosen over an index because there are exactly two inputs and it wires cleanly to the new Math comparison output (Part B) and to the `boolean` socket type. `passthroughWired: true` lets the selector be driven by a wire or toggled manually.

### Node Definition (YAML)

New file `web/nodes/operations/switch.yaml`:

```yaml
switch:
  label: Switch
  category: Operations
  desc: Route one of two same-type inputs to the output by a selector
  in:
  - id: sel
    label: Select B
    kind: checkbox
    default: false
    type: boolean
    passthroughWired: true
  - id: a
    label: A
    type: any
  - id: b
    label: B
    type: any
  out:
  - id: out
    label: Out
    type: any
  src: web/nodes/operations/switch.js
```

No `settings.yaml` change is needed: `Operations` is already registered (`settings.yaml:33`). No `api`, no `__init__` work (folder already has `__init__.py`).

### Frontend resolve (JS)

New file `web/nodes/operations/switch.js`. Register on `window.RundeerNodes["switch"]` (key must equal the YAML type). Selector reads the wired value if present, else the prop; coerces to boolean (so a wired `0/1` from a Math comparison works):

```js
(window.RundeerNodes = window.RundeerNodes || {})["switch"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    const useB = (inputs.sel !== undefined && inputs.sel !== "" && inputs.sel !== null)
      ? Boolean(inputs.sel)
      : Boolean(props.sel);
    outputs.out = useB ? inputs.b : inputs.a;
  },
};
```

### Same-type handling

The def/type system is static (output type comes from YAML, not from the live upstream), so `a`/`b`/`out` are declared `any` — `any` connects to every type (`node-editor.js:33`) and `any → any` passthrough preserves the value at runtime.

To honor "for now only switch between same data type", enforce the constraint **softly** with an `onEdgeChange(nodeId, changedSocket, ctx)` hook on the Switch (pattern mirrors `compress-image.js:75`):

- Fire only when `changedSocket` is `a` or `b`.
- Read both incoming edges via `ctx.activeIncomingEdges(nodeId, "a")` / `"b"`, resolve each source type with `ctx.outputSocketDef(...)` then `ctx.baseType(...)`.
- If both inputs are connected and their base types differ (and neither is `any`), drop the just-added edge (`ctx.graph.edges = ctx.graph.edges.filter(...)`), call `ctx.renderGraph()` / `ctx.scheduleAutosave()`, and surface a hint.

Output stays `any` (renders with the neutral gray accent). Dynamic output-type tracking is intentionally **not** implemented — it would require per-instance def mutation the system does not support; adding it now would be over-engineering against the "no half-baked patches" rule.

## Part B — Math Node Conditionals

Extend `web/nodes/operations/math-op.yaml` and `math-op.js`. Comparisons return a JS boolean; arithmetic returns a number. Because a node's output socket type is a single static value, **change `out` from `number` to `any`** so one socket can feed both `number` and `boolean` inputs (e.g. the Switch `sel`). `any` is strictly more permissive, so existing `out → number` links keep working (`canConnect("any","number")` is true, `node-editor.js:33`).

Add an **epsilon** widget used by `equal` / `not-equal`.

### Proposed `options` list (full)

```yaml
options: [add, subtract, multiply, divide, modulo, power, min, max, abs, sqrt, equal, not-equal, greater, greater-equal, less, less-equal]
default: add
```

Rationale: keep the 8 existing arithmetic ops; add 2 unary ops (`abs`, `sqrt`, operate on `A`); add the 6 requested conditionals. `clamp` is deliberately omitted — it needs a third operand (value/min/max) and there are only `A`/`B`; adding it would be a half-baked two-input version. Note it (and `sqrt` of negatives → `NaN`) as a possible future op once a third input exists.

### Epsilon input

Add one widget entry to `math-op.yaml` `in`:

```yaml
  - id: eps
    label: Epsilon
    kind: number
    default: 0.0001
    type: number
    group: settings
```

Grouped under `settings` so it stays out of the way. Optional polish (recommended, mirrors `compress-image.js:70`): add `isInputVisible(node, sock, ctx)` returning `true` for `eps` only when `props.op` is `equal` or `not-equal`, else `true` for all other sockets. Keep this hook optional — the always-visible grouped widget is acceptable and simpler.

### Output-type note

`out` becomes `type: any` (`math-op.yaml:17`). Arithmetic/unary cases write a `number`; comparison cases write a real JS `boolean` (not `1/0`) so downstream boolean sockets (Switch `sel`) get a clean value. This is a breaking type-tightening only in the sense that `out` is no longer advertised as `number`; see Breaking Changes.

### Resolve additions (JS)

In `math-op.js`, read `eps` and extend the `switch`:

```js
const eps = Number(inputs.eps ?? props.eps ?? 0.0001);
...
case "abs":           r = Math.abs(a); break;
case "sqrt":          r = Math.sqrt(a); break;
case "equal":         r = Math.abs(a - b) <= eps; break;
case "not-equal":     r = Math.abs(a - b) > eps; break;
case "greater":       r = a > b; break;
case "greater-equal": r = a >= b; break;
case "less":          r = a < b; break;
case "less-equal":    r = a <= b; break;
```

`outputs.out = r` stays. `r` is initialized as before; comparison cases reassign it to a boolean.

## Part C — Move Mix & Vector Op to Operations

### Rename

`vector-op.yaml`: `label: Vector` → `label: Vector Op` (`vector-op.yaml:2`). The node **type/slug stays `vector-op`** (top-level YAML key) so existing graphs/edges keyed on `vector-op` still resolve. Only the display label changes. Mix keeps `label: Mix`.

### Category-field changes

`vector-op.yaml:3` and `mix.yaml:3`: `category: Vector` → `category: Operations`.

### Folder-move decision (RECOMMENDED: physical move)

Two approaches:

- **Approach A — category field only.** Change just the `category:` field; leave files in `web/nodes/vector/`. Sufficient for the add-menu (category is folder-independent, `node_defs.py:174`). Downsides: `web/nodes/vector/` and its `src:` paths keep saying `vector` while the nodes live under `Operations` (folder/category mismatch); the `Vector` settings category and the `vector/` folder linger as orphans — i.e. retained legacy, which the project rules forbid.

- **Approach B — physically move the files (RECOMMENDED).** Move all six files into `web/nodes/operations/` so folder == category, the `vector/` folder is removed, and the `Vector` category is fully retired. This is true cleanup with no legacy, and the cost is small and fully enumerable below.

Recommend **Approach B**. Move:

- `web/nodes/vector/vector-op.yaml` → `web/nodes/operations/vector-op.yaml`
- `web/nodes/vector/vector-op.js`  → `web/nodes/operations/vector-op.js`
- `web/nodes/vector/vector_op.py` → `web/nodes/operations/vector_op.py`
- `web/nodes/vector/mix.yaml` → `web/nodes/operations/mix.yaml`
- `web/nodes/vector/mix.js`   → `web/nodes/operations/mix.js`
- `web/nodes/vector/mix.py`   → `web/nodes/operations/mix.py`

Edits required by the move (enumerated):

1. **YAML `src:` paths.** `vector-op.yaml:21` → `src: web/nodes/operations/vector-op.js`; `mix.yaml:39` → `src: web/nodes/operations/mix.js`.
2. **YAML `api:` routes.** Keep `/api/uv/vector` (`vector-op.yaml:22`) and `/api/uv/mix` (`mix.yaml:40`) unchanged — they are arbitrary route strings, and keeping them avoids needless churn while staying valid.
3. **Python module imports in `web/server.py`.** `server.py:328` → `from web.nodes.operations.vector_op import vector as _uv_vec`; `server.py:334` → `from web.nodes.operations.mix import mix as _uv_mix`. The route-path strings (`/api/uv/vector`, `/api/uv/mix`) stay, matching the YAML `api`.
4. **Internal imports of the moved `.py` files.** None to change: `vector_op.py:7` / `mix.py:9` import from `web.nodes._shared.uv` and `rundeer.core` (absolute) — unaffected by the move.
5. **`__init__.py`.** `web/nodes/operations/__init__.py` already exists; no addition needed. Remove the now-empty `web/nodes/vector/` folder (its `__init__.py` and `__pycache__`).
6. **Frontend helpers.** `_coerceVectorInput` / `_coerceMixInput` / `_jsBlend` / `_rgbaToHex` live in `node-editor.js` (`:187`, `:6436`) and are exposed via `helpers` — unaffected by the move.

### settings.yaml `Vector` category cleanup

After the move, **zero** nodes use `category: Vector` (verified: only the two nodes referenced it). Remove the orphan entry from **both** registries:

- `web/config/settings.yaml:41` — delete `Vector: oklch(55% 0.2 270)`.
- `web/config/settings_manager.py:63` — delete the matching `"Vector": "oklch(55% 0.2 270)"` default.

Do **not** touch `SOCKET_TYPES.vector` / `vector-map` (`node-editor.js:12`) — those are socket data types, not the category.

## Affected / New Files

| File | New/Modified/Moved | Purpose |
|---|---|---|
| `web/nodes/operations/switch.yaml` | New | Switch node definition (boolean selector, two `any` inputs, `any` output) |
| `web/nodes/operations/switch.js` | New | Switch resolve + `onEdgeChange` same-type guard |
| `web/nodes/operations/math-op.yaml` | Modified | Add comparison/unary ops, `eps` widget, change `out` to `any` |
| `web/nodes/operations/math-op.js` | Modified | Add `eps` read + comparison/unary `switch` cases |
| `web/nodes/operations/vector-op.yaml` | Moved + Modified | From `vector/`; `label: Vector Op`, `category: Operations`, new `src:` |
| `web/nodes/operations/vector-op.js` | Moved | From `vector/`; unchanged contents |
| `web/nodes/operations/vector_op.py` | Moved | From `vector/`; unchanged contents |
| `web/nodes/operations/mix.yaml` | Moved + Modified | From `vector/`; `category: Operations`, new `src:` |
| `web/nodes/operations/mix.js` | Moved | From `vector/`; unchanged contents |
| `web/nodes/operations/mix.py` | Moved | From `vector/`; unchanged contents |
| `web/nodes/vector/` | Removed | Empty after move (drop `__init__.py`, `__pycache__`) |
| `web/server.py` | Modified | Update two lazy imports to `web.nodes.operations.*` |
| `web/config/settings.yaml` | Modified | Remove orphan `Vector` category |
| `web/config/settings_manager.py` | Modified | Remove orphan `Vector` default |

## Implementation Steps

1. Create `web/nodes/operations/switch.yaml` (Part A definition).
2. Create `web/nodes/operations/switch.js` (resolve + `onEdgeChange` same-type guard).
3. Edit `web/nodes/operations/math-op.yaml`: extend `options`, add `eps` widget, change `out` type to `any`.
4. Edit `web/nodes/operations/math-op.js`: read `eps`, add unary + comparison `switch` cases.
5. Move `vector-op.{yaml,js,py}` and `mix.{yaml,js,py}` from `web/nodes/vector/` to `web/nodes/operations/`.
6. Edit moved `vector-op.yaml`: `label: Vector Op`, `category: Operations`, `src:` → operations path (keep slug `vector-op`, keep `api`).
7. Edit moved `mix.yaml`: `category: Operations`, `src:` → operations path (keep `api`, keep `traits`).
8. Edit `web/server.py:328` and `:334`: imports → `web.nodes.operations.vector_op` / `web.nodes.operations.mix` (route strings unchanged).
9. Delete the now-empty `web/nodes/vector/` folder.
10. Remove `Vector` from `web/config/settings.yaml:41` and `web/config/settings_manager.py:63`.
11. Run validation (below).

## Breaking Changes / Data Impact

No fallbacks, no live migrations (per project rules). Warn the user directly:

- **Math `out` type `number` → `any`.** Purely widening; existing `out → number` links survive. New comparison ops emit booleans.
- **Math new ops are additive.** No existing option is removed, so saved `props.op` values stay valid.
- **Vector Op label/category + Mix category changed; both files moved.** The node **types stay `vector-op` and `mix`**, so existing graphs that instantiate them still resolve and the kept `api` routes still match. The only user-visible change is add-menu grouping (now under Operations) and the `Vector Op` label.
- **Old graphs referencing these nodes** (verified instances): `mix` in `.rundeer/data/graphs/graph-2026-05-30.json:393`, `blur_dream_contrast_test.json:505,597,659`, `dream-blur.json:479`, `all.json:898`, `poster1.json:314,632,784`; `vector-op` in `crop-test.json:349`, `all.json:868`, `blur-compress-test.json:202,495`. These keep working because the slugs/`api` are unchanged — but any tooling that filtered by the `Vector` category string will no longer find them. Not auto-migrated by design.
- **`Vector` category removed** from settings. Any user setting overriding the `Vector` accent color becomes a no-op; no other node uses it.

## Validation

From `AGENTS.md` "Useful Validation" (run only the applicable smoke tests; no frontend Playwright unless the user asks):

- Python syntax: `python3 -m compileall -q src web rundeer.py __init__.py` (covers moved `vector_op.py`/`mix.py` and edited `server.py`).
- Changed/new JS: `node --check web/nodes/operations/switch.js`, `node --check web/nodes/operations/math-op.js`, `node --check web/nodes/operations/vector-op.js`, `node --check web/nodes/operations/mix.js` (or `rg --files -g '*.js' -g '*.mjs' | xargs -r -n 1 node --check`).
- Web command smoke test: `python3 rundeer.py web --help`.
- Sanity: confirm `GET /api/node-defs` lists `switch` under `Operations`, and `vector-op`/`mix` under `Operations` (node_defs scans via `rglob`, so the moved YAMLs are picked up automatically).

## Acceptance Checklist

- [ ] (1) New `switch` node exists in category `Operations`, switches between two inputs of the same data type via a selector — `web/nodes/operations/switch.{yaml,js}` created; same-type guard in `onEdgeChange`; appears in add-menu under Operations.
- [ ] (2) Math node has conditionals: `less`, `greater`, `equal` (epsilon) plus `not-equal`, `greater-equal`, `less-equal`, and extra ops `abs`, `sqrt` — `math-op.yaml` options + `eps` widget updated, `math-op.js` cases added, `out` is `any`, comparisons emit booleans.
- [ ] (3a) Vector node renamed `Vector` → `Vector Op` (`label`), slug unchanged.
- [ ] (3b) Mix and Vector Op both `category: Operations` and physically moved to `web/nodes/operations/` with `src:`/server imports updated and `api` routes intact.
- [ ] (3c) Orphan `Vector` category removed from `settings.yaml` and `settings_manager.py`; `web/nodes/vector/` deleted; `SOCKET_TYPES.vector`/`vector-map` untouched.
- [ ] Validation commands pass; user warned about non-migrated old graphs.
