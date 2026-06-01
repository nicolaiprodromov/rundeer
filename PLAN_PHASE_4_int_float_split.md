# Phase 4 — Replace Number with Integer & Float Primitives

## Goal

Remove the single `Number` primitive node and the catch-all `number` socket data type, and replace them with two first-class numeric primitives — **Integer** and **Float** — plus two distinct socket types, `integer` and `float`. Every node that currently uses the `number` data type must declare, per socket, whether it is an **integer** or a **float** "depending on what each node needs" (verbatim, `new_nodes.md` PHASE 4).

> Verbatim source (`new_nodes.md:22-24`): "we need to remove the `Number` node and replace it with `Integer` and `Float` primitive nodes. This also means that all nodes that use *number data* type must now choose to be either integer or float depending on what each node needs."

## Scope

In scope:
- Delete the `number-input` node (`Number`) entirely (`.yaml` + `.js`).
- Add `integer-input` (`Integer`) and `float-input` (`Float`) primitive nodes.
- Split the `number` socket type into two new socket types `integer` and `float` (colors, inference, compatibility) — **Option B**, justified below.
- Add two widget kinds `int` and `float`; update widget rendering + value coercion.
- Convert **every** existing `number` socket (69 widget/pure/output sockets across 19 surviving node files) to either `integer` or `float` (`mix.factor` keeps its `any` type — see table).
- Update the two compatibility validators (frontend `canConnect`, backend `_can_connect`) so integer↔float wires are allowed (numeric family).
- Update `web/node_defs.py` (`KNOWN_SOCKET_TYPES` + kind→type inference).
- Sync `NODES.md` docs (socket types list, inference table, widget kinds).

Out of scope (hard rules):
- NO migration of old graphs, NO fallback to `number`, NO legacy alias. Breaking changes are expected.
- NO code comments / docstrings / inline comments in the implementation.
- No backend `.py` node-handler changes (handlers receive numeric JSON regardless of socket type — verified below).
- No `web/config/settings.yaml` change (socket colors live in JS, not settings; `Primitives` category already registered).

## Background (current state)

All paths repo-relative to `/workspaces/ttiar/rundeer`.

**The node being removed — `Number`:**
- `web/nodes/primitives/number-input.yaml:1` — top-level key / node type slug is **`number-input`**; `web/nodes/primitives/number-input.yaml:2` — `label: Number`; widget `value` is `kind: number` (`:8`), output `out` is `type: number` (`:13`).
- `web/nodes/primitives/number-input.js:1-3` — `resolve` sets `outputs.out = Number(props.value ?? 1)`.

**Socket type registry (frontend, authoritative for colors + compatibility):**
- `web/static/node-editor.js:4-19` — `SOCKET_TYPES` map. `number: { color: "oklch(76% 0.180 165)", label: "Number" }` at `:8`.
- `web/static/node-editor.js:21-25` — `baseType(t)` (bundle→element only; not numeric).
- `web/static/node-editor.js:27-48` — `canConnect(typeA, typeB)`: equal types pass (`:29`); `run` never (`:32`); `any` wildcard (`:33`); same baseType (`:35`); `filepath`↔`text` (`:36`); vector/vector-map/image special cases (`:39-46`). **No numeric cross-rule today** (none needed — there was one numeric type).
- `web/static/node-editor.js:713-721` — `pruneInvalidEdges()` drops any edge where `canConnect(fromSock.type, toSock.type)` is false; invoked on run (`:6199`) and load. This is how type changes silently break old wires.
- `web/static/node-editor.js:736-746` — `addEdge` rejects incompatible types via `canConnect`.

**Widget rendering + coercion (frontend):**
- `web/static/node-editor.js:3126-3133` — `normalizePropValue`: `kind === "number" || kind === "range"` → `Number(control.value)`.
- `web/static/node-editor.js:3135-3144` — `coerceWiredPropValue`: same numeric branch.
- `web/static/node-editor.js:3210-3248` — `buildPropValueControl`: `kind === "number"` → `<input type=number>` (`:3230-3232`); `kind === "range"` → slider with min/max/step (`:3236-3244`).
- `web/static/node-editor.js:2969-2977` — `inferPreviewMediaKind`: `k === "number"` treated as text preview (`:2976`).
- `web/static/node-editor.js:139-146` — bundle-detection special case keys on `src?.type === "number-input"` (`:143`) to read a wired iterations value. **References the node being deleted — must change.**

**Def parser (backend, builds `/api/node-defs` and the socket map used by the agent):**
- `web/node_defs.py:11-15` — `KNOWN_SOCKET_TYPES` set; contains `"number"` (`:12`).
- `web/node_defs.py:112-135` — `_normalize_inputs`: when a widget entry has `kind` but no explicit `type`, infers type — `checkbox`→`boolean`, **`number`/`range`→`number`** (`:123-124`), `color`→`color`, else `text`. The guard `if "type" not in e:` (`:119`) means an **explicit `type` always wins** over inference (important: lets range sockets carry explicit `integer`/`float`).
- `web/node_defs.py:254-259` — `node_defs_socket_map()` exposes each socket's `type` to the agent tools.

**Backend connection validator (agent graph edits):**
- `web/agent/tools_impl/graph_mutate.py:39-60` — `_base_type` + `_can_connect` mirror the frontend rules in Python and are used by `_connect_error` (`:77-103`). Reads socket `type` from `NODE_SOCKETS` (the `node_defs_socket_map`). **Must gain the integer↔float rule.**

**Agent prompt (auto-derived, no manual edit needed):**
- `web/agent/system_prompt.py:5,38` — prints `KNOWN_SOCKET_TYPES` dynamically, so removing `number` / adding `integer`,`float` there propagates automatically.

**Confirmed NON-impacts:**
- `web/server.py` — only `isinstance(value, (int, float))` (`:1783`), a Python runtime check, unrelated to socket type strings.
- Python node handlers (`blur.py`, `compress.py`, `coordinate.py`, `mapping.py`, …) receive numeric JSON values; socket-type strings are frontend/agent only. `blur.py:20` ("radius must be a number") still valid for floats.
- `web/static/css/nodes/sockets.css` — no `number` references; socket colors are injected from `SOCKET_TYPES` in JS.
- `web/static/node-editor.html`, `web/static/agent.js` — no `number-input` / `number` socket references.
- The many `typeof x === "number"` checks throughout `node-editor.js` are JS runtime type guards, **not** socket types — leave untouched.
- `web/config/settings.yaml:30-44` — node *category* accent colors only; no socket colors; `Primitives` already present (`:32`).

**Compact YAML syntax check:** `_expand_compact_props` (`web/node_defs.py:47-109`) supports dict-form widgets like `Label: number:5`. A grep for `number:`/`range:` compact usage found **none** in `web/nodes` — every numeric widget uses the canonical list form. No compact conversions required.

## Design Decision: socket-type split vs node-only

### Option A — node-only (keep a single `number` socket type)
Add `Integer` and `Float` nodes that emit ints vs floats; per widget, choose integer vs float behavior via widget kind/coercion. Existing sockets stay typed `number`.
- Pros: minimal type-system change; no `canConnect` edits; old number↔number wires keep working; smallest diff.
- Cons: **does not satisfy the requirement.** PHASE 4 says nodes "must now choose to be either integer or float" — the *data type* is what's being split. Under A the sockets keep a single undifferentiated `number` type, so a `Width (px)` input and a `Temperature` input look/behave identically at the socket level. No color/semantic distinction; the "choose per node" mandate is unmet. The two new primitives would also both emit into the same `number` socket, making `Integer` vs `Float` cosmetic.

### Option B — split the socket type (RECOMMENDED)
Introduce two socket types `integer` and `float` (new `SOCKET_TYPES` entries + colors), remove `number`, update `node_defs` inference, and convert every existing `number` socket to `integer` or `float`. Add a numeric-family compatibility rule so `integer`↔`float` wires connect.
- Pros: directly implements "all nodes … must choose to be either integer or float." Distinct socket colors give artists immediate visual semantics (counts/sizes/seeds vs factors/weights). The new primitives become meaningful (each emits its own type). Aligns with the parts of `NODES.md` the task highlights (Socket types list, kind→type inference, `SOCKET_TYPES` colors).
- Cons: larger diff; old graphs break harder (acceptable per hard rules — alpha, no migration).

**Decision: Option B**, with one critical sub-decision resolved below.

### Sub-decision: are integer↔float wires cross-compatible? → YES (numeric family)
Two variants of B:
- **B-strict:** `integer` and `float` are mutually incompatible; converting requires an explicit node. Clean typing, but high friction — you could not feed an `Integer` count into a `float` `scale`, and far more old wires would be pruned.
- **B-compatible (CHOSEN):** `integer` and `float` form a numeric family that interconnects, analogous to the existing `filepath`↔`text` rule (`node-editor.js:36`). The color/semantic distinction is preserved (each socket declares intent), but wiring stays ergonomic and runtime coercion (`Number(...)` / `Math.trunc(...)`) handles precision at the consumer.

Rationale: the requirement is about each node *declaring* integer vs float intent (precision + color clarity), not about forbidding numeric interchange. Creative graphs routinely route a count into a continuous parameter. Cross-compatibility minimizes gratuitous breakage while fully honoring "choose per node." The `any` wildcard continues to connect to both.

## New Primitive Nodes

Two new files each, under `web/nodes/primitives/` (category **Primitives**, already registered). Slugs follow the existing `*-input` convention (`boolean-input`, `text-input`, `vector-input`).

### Integer — `web/nodes/primitives/integer-input.yaml`
```yaml
integer-input:
  label: Integer
  category: Primitives
  desc: Integer value
  in:
  - id: value
    label: Value
    kind: int
    default: 0
  out:
  - id: out
    label: Integer
    type: integer
  src: web/nodes/primitives/integer-input.js
```
### Integer — `web/nodes/primitives/integer-input.js`
```js
(window.RundeerNodes = window.RundeerNodes || {})["integer-input"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = Math.trunc(Number(props.value ?? 0));
} };
```

### Float — `web/nodes/primitives/float-input.yaml`
```yaml
float-input:
  label: Float
  category: Primitives
  desc: Floating-point value
  in:
  - id: value
    label: Value
    kind: float
    default: 0.0
  out:
  - id: out
    label: Float
    type: float
  src: web/nodes/primitives/float-input.js
```
### Float — `web/nodes/primitives/float-input.js`
```js
(window.RundeerNodes = window.RundeerNodes || {})["float-input"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = Number(props.value ?? 0);
} };
```

Notes:
- `kind: int` and `kind: float` are the two new widget kinds (see Socket Type Changes). With explicit `type` omitted on these two primitives, the parser infers `integer` / `float` respectively.
- Default changes from the old `Number` default `1` to `0` / `0.0` (neutral). Decisive, no legacy carry-over.
- No comments/docstrings (hard rule).

## Socket Type Changes

### `web/static/node-editor.js` — `SOCKET_TYPES` (`:4-19`)
Remove the `number` entry (`:8`). Add two entries (numeric-family hues near the old green-teal so they read as "numbers", but distinct):
```js
  integer:      { color: "oklch(74% 0.17 196)", label: "Integer" },
  float:        { color: "oklch(80% 0.16 150)", label: "Float" },
```

### `web/static/node-editor.js` — `canConnect` (`:27-48`)
Add a numeric-family rule (place beside the `filepath`/`text` rule at `:36`):
```js
  if ((typeA === "integer" || typeA === "float") && (typeB === "integer" || typeB === "float")) return true;
```
Do **not** add integer/float to `baseType` (that function is bundle-only; keep it untouched).

### `web/static/node-editor.js` — widget kinds (rendering + coercion)
- `buildPropValueControl` (`:3230`): render a numeric `<input type=number>` for `kind === "int"` and `kind === "float"`. For `int`, also set `control.step = 1`. (`range` branch unchanged.)
- `normalizePropValue` (`:3128`): extend the numeric branch — `int` → `control.value === "" ? null : Math.trunc(Number(control.value))`; `float`/`range`/`number-removed` → `Number(control.value)`.
- `coerceWiredPropValue` (`:3138`): same split — `int` rounds via `Math.trunc(Number(value))`, `float`/`range` use `Number(value)`.
- `inferPreviewMediaKind` (`:2976`): replace `k === "number"` with `k === "integer" || k === "float"`.
- Bundle-detection special case (`:143`): replace `src?.type === "number-input"` with `(src?.type === "integer-input" || src?.type === "float-input")`.

### `web/node_defs.py` — `KNOWN_SOCKET_TYPES` (`:11-15`)
Remove `"number"`; add `"integer"`, `"float"`.

### `web/node_defs.py` — kind→type inference (`:121-128`)
Replace the `elif k in ("number", "range"): e["type"] = "number"` branch with:
```python
elif k == "int":
    e["type"] = "integer"
elif k == "float":
    e["type"] = "float"
elif k == "range":
    e["type"] = "float"
```
The existing `if "type" not in e:` guard (`:119`) ensures any `range` socket carrying an explicit `type: integer`/`type: float` keeps it (range precision varies — see table). Remove all `number` handling (no legacy).

### `web/agent/tools_impl/graph_mutate.py` — `_can_connect` (`:47-60`)
Add the mirror numeric-family rule:
```python
    if from_type in ("integer", "float") and to_type in ("integer", "float"):
        return True
```

### Inference table (new canonical form, for `NODES.md` sync)
| `kind` | inferred `type` |
|---|---|
| `checkbox` | `boolean` |
| `int` | `integer` |
| `float` | `float` |
| `range` | `float` (override with explicit `type`) |
| `color` | `color` |
| everything else | `text` |

### Updated Socket types list (for `NODES.md`)
`text` · `image` · `video` · `integer` · `float` · `boolean` · `definition` · `filepath` · `vector` · `vector-map` · `color` · `image-bundle` · `video-bundle` · `run` · `any` (the `number` entry is removed; `Number` no longer appears).

## Per-Node Conversion Table

Heuristic applied: **integer** for counts, indices, seeds, iterations, concurrency, pixel dimensions, DPI, quality (0–100), token caps, exit codes, byte/entry limits, frame numbers, modulo, threshold/kernel pixel params, whole-second durations. **float** for factors, scales, opacities/weights, temperatures, penalties, top_p, rotation degrees, sub-pixel radii, frame rates, spatial coordinates, and general arithmetic operands.

| File | Socket id | Current (kind / type) | → | Reason |
|---|---|---|---|---|
| `web/nodes/primitives/number-input.yaml` | value / out | `kind: number` / `type: number` | **DELETED** | Node removed; replaced by Integer & Float primitives |
| `web/nodes/primitives/integer-input.yaml` | value / out | *(new)* | **integer** | New Integer primitive |
| `web/nodes/primitives/float-input.yaml` | value / out | *(new)* | **float** | New Float primitive |
| `web/nodes/operations/math-op.yaml` | `a` | pure `type: number` (`:8`) | **float** | Operand; divide/power yield fractional results |
| `web/nodes/operations/math-op.yaml` | `b` | pure `type: number` (`:11`) | **float** | Operand; fractional results possible |
| `web/nodes/operations/math-op.yaml` | `out` | output `type: number` (`:20`) | **float** | General arithmetic result |
| `web/nodes/operations/random.yaml` | `min` | `kind: number` + `type: number` (`:14,16`) | **float** | Bound serves both float and integer modes (superset) |
| `web/nodes/operations/random.yaml` | `max` | `kind: number` + `type: number` (`:19,21`) | **float** | Bound serves both modes (superset) |
| `web/nodes/operations/compress-image.yaml` | `quality` | `kind: range` (`:14`) | **integer** | JPEG-style 1–100 quality scale, step 1 |
| `web/nodes/operations/compress-image.yaml` | `max_dimension` | `kind: number` (`:21`) | **integer** | Pixel dimension |
| `web/nodes/operations/blur.yaml` | `radius` | `kind: range` step 0.1 (`:11`) | **float** | Sub-pixel blur radius (step 0.1) |
| `web/nodes/loop/loop-decompose.yaml` | `times` | `kind: number` + `type: number` (`:14-15`) | **integer** | Iteration count (resolve uses `parseInt`) |
| `web/nodes/loop/loop-decompose.yaml` | `index` | output `type: number` (`:33`) | **integer** | Current loop index |
| `web/nodes/loop/loop-decompose.yaml` | `count` | output `type: number` (`:36`) | **integer** | Total item/iteration count |
| `web/nodes/terminal/terminal.yaml` | `exit_code` | output `type: number` (`:70`) | **integer** | Process exit codes are integers |
| `web/nodes/bundle/sample-bundle.yaml` | `count` | output `type: number` (`:21`) | **integer** | Element count |
| `web/nodes/bundle/folder-bundle.yaml` | `fps` | `kind: number` (`:25`) | **float** | Frame rates can be fractional (e.g. 23.976) |
| `web/nodes/bundle/folder-bundle.yaml` | `modulo` | `kind: number` (`:30`) | **integer** | Every Nth (whole number) |
| `web/nodes/bundle/folder-bundle.yaml` | `start` | `kind: number` (`:35`) | **integer** | Item/frame index |
| `web/nodes/bundle/folder-bundle.yaml` | `end` | `kind: number` (`:40`) | **integer** | Item/frame index |
| `web/nodes/grok-imagine/cmd-image.yaml` | `iterations` | `kind: number` (`:24`) | **integer** | Generation count |
| `web/nodes/grok-imagine/cmd-image.yaml` | `concurrency` | `kind: number` (`:29`) | **integer** | Worker count |
| `web/nodes/grok-imagine/cmd-image.yaml` | `ref_quality` | `kind: number` (`:72`) | **integer** | JPEG quality 0–100 |
| `web/nodes/grok-imagine/cmd-merge.yaml` | `iterations` | `kind: number` (`:24`) | **integer** | Generation count |
| `web/nodes/grok-imagine/cmd-merge.yaml` | `concurrency` | `kind: number` (`:29`) | **integer** | Worker count |
| `web/nodes/grok-imagine/cmd-merge.yaml` | `ref_quality` | `kind: number` (`:66`) | **integer** | JPEG quality 0–100 |
| `web/nodes/grok-imagine/cmd-extend.yaml` | `iterations` | `kind: number` (`:26`) | **integer** | Generation count |
| `web/nodes/grok-imagine/cmd-extend.yaml` | `concurrency` | `kind: number` (`:31`) | **integer** | Worker count |
| `web/nodes/grok-imagine/cmd-extend.yaml` | `duration` | `kind: number` (`:52`) | **integer** | Whole-second clip length |
| `web/nodes/grok-imagine/cmd-video.yaml` | `iterations` | `kind: number` (`:30`) | **integer** | Generation count |
| `web/nodes/grok-imagine/cmd-video.yaml` | `concurrency` | `kind: number` (`:35`) | **integer** | Worker count |
| `web/nodes/grok-imagine/cmd-video.yaml` | `duration` | `kind: number` (`:61`) | **integer** | Whole-second clip length |
| `web/nodes/grok-imagine/cmd-video.yaml` | `ref_quality` | `kind: number` (`:83`) | **integer** | JPEG quality 0–100 |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `iterations` | `kind: number` (`:27`) | **integer** | Generation count |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `concurrency` | `kind: number` (`:32`) | **integer** | Worker count |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `duration` | `kind: number` (`:71`) | **integer** | Whole-second clip length |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `ref_quality` | `kind: number` (`:87`) | **integer** | JPEG quality 0–100 |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `chain_threshold` | `kind: number` (`:102`) | **integer** | Mask threshold (0–100 / pixel) |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `chain_override` | `kind: number` (`:107`) | **integer** | Override level (0–100) |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `chain_dilate` | `kind: number` (`:112`) | **integer** | Dilation in pixels |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `chain_feather` | `kind: number` (`:117`) | **integer** | Feather in pixels |
| `web/nodes/grok-imagine/cmd-edit.yaml` | `chain_min_region` | `kind: number` (`:122`) | **integer** | Min region in pixels |
| `web/nodes/prompt/prompt.yaml` | `temperature` | `kind: number` (`:27`) | **float** | Sampling temperature 0.0–2.0 |
| `web/nodes/prompt/prompt.yaml` | `top_p` | `kind: number` (`:33`) | **float** | Nucleus prob 0.0–1.0 |
| `web/nodes/prompt/prompt.yaml` | `max_tokens` | `kind: number` (`:39`) | **integer** | Token cap |
| `web/nodes/prompt/prompt.yaml` | `seed` | `kind: number` (`:44`) | **integer** | RNG seed |
| `web/nodes/prompt/prompt.yaml` | `frequency_penalty` | `kind: number` (`:50`) | **float** | Penalty -2.0–2.0 |
| `web/nodes/prompt/prompt.yaml` | `presence_penalty` | `kind: number` (`:56`) | **float** | Penalty -2.0–2.0 |
| `web/nodes/prompt/prompt-filter.yaml` | `temperature` | `kind: number` (`:30`) | **float** | Sampling temperature 0.0–2.0 |
| `web/nodes/prompt/prompt-filter.yaml` | `top_p` | `kind: number` (`:36`) | **float** | Nucleus prob 0.0–1.0 |
| `web/nodes/prompt/prompt-filter.yaml` | `max_tokens` | `kind: number` (`:42`) | **integer** | Token cap |
| `web/nodes/prompt/prompt-filter.yaml` | `seed` | `kind: number` (`:47`) | **integer** | RNG seed |
| `web/nodes/prompt/prompt-filter.yaml` | `frequency_penalty` | `kind: number` (`:53`) | **float** | Penalty -2.0–2.0 |
| `web/nodes/prompt/prompt-filter.yaml` | `presence_penalty` | `kind: number` (`:59`) | **float** | Penalty -2.0–2.0 |
| `web/nodes/primitives/vector-input.yaml` | `x` | `kind: number` (`:9`) | **float** | Continuous vector component (out stays `vector`) |
| `web/nodes/primitives/vector-input.yaml` | `y` | `kind: number` (`:13`) | **float** | Continuous vector component |
| `web/nodes/primitives/vector-input.yaml` | `z` | `kind: number` (`:17`) | **float** | Continuous vector component |
| `web/nodes/coordinates/coordinate.yaml` | `width` | `kind: number` (`:11`) | **integer** | Pixel width |
| `web/nodes/coordinates/coordinate.yaml` | `height` | `kind: number` (`:15`) | **integer** | Pixel height |
| `web/nodes/coordinates/coordinate.yaml` | `dpi` | `kind: number` (`:19`) | **integer** | Dots per inch |
| `web/nodes/coordinates/mapping.yaml` | `location_x` | `kind: number` (`:11`) | **float** | Continuous translate |
| `web/nodes/coordinates/mapping.yaml` | `location_y` | `kind: number` (`:16`) | **float** | Continuous translate |
| `web/nodes/coordinates/mapping.yaml` | `rotation` | `kind: number` (`:21`) | **float** | Degrees, fractional |
| `web/nodes/coordinates/mapping.yaml` | `scale_x` | `kind: number` (`:26`) | **float** | Continuous scale |
| `web/nodes/coordinates/mapping.yaml` | `scale_y` | `kind: number` (`:31`) | **float** | Continuous scale |
| `web/nodes/coordinates/mapping.yaml` | `pivot_x` | `kind: number` (`:36`) | **float** | Normalized pivot 0–1 |
| `web/nodes/coordinates/mapping.yaml` | `pivot_y` | `kind: number` (`:41`) | **float** | Normalized pivot 0–1 |
| `web/nodes/agent-brain/agent.yaml` | `temperature` | `kind: number` (`:17`) | **float** | Sampling temperature |
| `web/nodes/agent-brain/agent.yaml` | `max_tool_iterations` | `kind: number` (`:22`) | **integer** | Iteration cap |
| `web/nodes/agent-brain/agent.yaml` | `max_web_search_per_turn` | `kind: number` (`:27`) | **integer** | Count cap |
| `web/nodes/agent-brain/agent.yaml` | `max_file_bytes` | `kind: number` (`:31`) | **integer** | Byte cap |
| `web/nodes/agent-brain/agent.yaml` | `max_list_entries` | `kind: number` (`:35`) | **integer** | Entry cap |
| `web/nodes/vector/mix.yaml` | `factor` | `kind: range` + **`type: any`** (`:6-14`) | **no socket-type change (stays `any`)** | Already explicitly `any` (factor may be number, image, or map). Only the widget kind changes `range`→keep range; intent is float. Do **not** type it `float` — that would narrow the socket and break image/map wiring. |

Totals: **72** number-typed sockets found across **21** files (64 widget sockets with `kind`, plus 8 pure/output sockets typed `number` without a `kind`). Of these: **2** deleted (the `number-input` node's `value` widget + `out` output), **1** stays `any` (`mix.factor`), and **69** are converted to `integer`/`float` — split **43 integer** (generation counts, indices, seeds, caps, pixel dims, quality, durations) + **26 float** (factors, temperatures, penalties, top_p, coordinates, rotation, scales, radius, fps, arithmetic operands), exact per rows above. The 69 conversions span **19** surviving files (`mix.yaml` keeps its single numeric socket as `any`; `number-input` is deleted). Plus **2** new primitive output sockets (`integer`, `float`).

## Affected / New Files

| File | Action | Why |
|---|---|---|
| `web/nodes/primitives/number-input.yaml` | **Delete** | Remove `Number` node def |
| `web/nodes/primitives/number-input.js` | **Delete** | Remove `Number` resolve |
| `web/nodes/primitives/integer-input.yaml` | **New** | Integer primitive def |
| `web/nodes/primitives/integer-input.js` | **New** | Integer resolve (`Math.trunc`) |
| `web/nodes/primitives/float-input.yaml` | **New** | Float primitive def |
| `web/nodes/primitives/float-input.js` | **New** | Float resolve (`Number`) |
| `web/static/node-editor.js` | **Edit** | `SOCKET_TYPES` (remove `number`, add `integer`/`float` + colors); `canConnect` numeric-family rule; `buildPropValueControl`/`normalizePropValue`/`coerceWiredPropValue` for `int`/`float` kinds; `inferPreviewMediaKind` (`:2976`); bundle special-case (`:143`) |
| `web/node_defs.py` | **Edit** | `KNOWN_SOCKET_TYPES` (swap `number`→`integer`,`float`); kind→type inference (`int`/`float`/`range`) |
| `web/agent/tools_impl/graph_mutate.py` | **Edit** | `_can_connect` integer↔float rule |
| `web/nodes/operations/math-op.yaml` | **Edit** | a, b, out → float |
| `web/nodes/operations/random.yaml` | **Edit** | min, max → float |
| `web/nodes/operations/compress-image.yaml` | **Edit** | quality→integer (explicit type on range), max_dimension→integer |
| `web/nodes/operations/blur.yaml` | **Edit** | radius→float (explicit type on range) |
| `web/nodes/loop/loop-decompose.yaml` | **Edit** | times, index, count → integer |
| `web/nodes/terminal/terminal.yaml` | **Edit** | exit_code → integer |
| `web/nodes/bundle/sample-bundle.yaml` | **Edit** | count → integer |
| `web/nodes/bundle/folder-bundle.yaml` | **Edit** | fps→float; modulo/start/end→integer |
| `web/nodes/grok-imagine/cmd-image.yaml` | **Edit** | iterations/concurrency/ref_quality → integer |
| `web/nodes/grok-imagine/cmd-merge.yaml` | **Edit** | iterations/concurrency/ref_quality → integer |
| `web/nodes/grok-imagine/cmd-extend.yaml` | **Edit** | iterations/concurrency/duration → integer |
| `web/nodes/grok-imagine/cmd-video.yaml` | **Edit** | iterations/concurrency/duration/ref_quality → integer |
| `web/nodes/grok-imagine/cmd-edit.yaml` | **Edit** | iterations/concurrency/duration/ref_quality + 5 chain_* → integer |
| `web/nodes/prompt/prompt.yaml` | **Edit** | max_tokens/seed→integer; temperature/top_p/freq/presence→float |
| `web/nodes/prompt/prompt-filter.yaml` | **Edit** | max_tokens/seed→integer; temperature/top_p/freq/presence→float |
| `web/nodes/primitives/vector-input.yaml` | **Edit** | x, y, z widget kind → float (out stays `vector`) |
| `web/nodes/coordinates/coordinate.yaml` | **Edit** | width/height/dpi → integer |
| `web/nodes/coordinates/mapping.yaml` | **Edit** | all 7 transform params → float |
| `web/nodes/agent-brain/agent.yaml` | **Edit** | temperature→float; 4 caps→integer |
| `web/nodes/vector/mix.yaml` | **Edit (minimal)** | factor widget stays `kind: range`, `type: any` unchanged; documented float intent (no socket-type change) |
| `NODES.md` | **Edit (doc)** | Socket types list, inference table, widget-kinds list (`number`→`int`,`float`) |

Conversion mechanics per socket:
- **Widget sockets** (`kind: number`): change to `kind: int` or `kind: float` (type then inferred). For `int` widgets that need step enforcement, the renderer sets `step=1` automatically.
- **Range sockets** (`kind: range`): keep `kind: range`, **add explicit `type: integer` or `type: float`** (range precision is set-specific, so explicit type is required; the parser's `if "type" not in e` guard preserves it).
- **Pure sockets / outputs** (`type: number`, no `kind`): change `type: number` → `type: integer`/`type: float`.

## Implementation Steps

Sequenced to land the type system before the consumers, minimizing transient broken states.

1. **Type registry first (frontend + parser).** Edit `web/static/node-editor.js` `SOCKET_TYPES` (remove `number`, add `integer`+`float` with the oklch colors). Edit `web/node_defs.py` `KNOWN_SOCKET_TYPES` (swap). At this point old `number` sockets are temporarily unknown — that's fine; subsequent steps convert them.
2. **Compatibility rules.** Add the integer↔float rule to `canConnect` (`node-editor.js`) and `_can_connect` (`graph_mutate.py`).
3. **Widget kinds.** Update `node_defs.py` inference (`int`→integer, `float`→float, `range`→float). Update `node-editor.js` `buildPropValueControl`, `normalizePropValue`, `coerceWiredPropValue` to handle `int`/`float` (round vs Number). Update `inferPreviewMediaKind` (`:2976`).
4. **New primitives.** Create `integer-input.yaml/.js` and `float-input.yaml/.js`.
5. **Remove Number.** Delete `number-input.yaml` + `number-input.js`. Update the bundle special-case at `node-editor.js:143` to reference `integer-input`/`float-input` instead of `number-input`.
6. **Convert all sockets.** Apply the Per-Node Conversion Table to all 20 surviving node YAMLs (widget→`int`/`float`, range→explicit `type`, pure/output `type` swap). Handle `mix.yaml` minimally (no socket-type change).
7. **Docs sync.** Update `NODES.md` socket-types list, inference table, and widget-kinds list.
8. **Validate** (next section). Iterate until clean.

## Breaking Changes / Data Impact

> **DIRECT WARNING TO THE USER:** This phase deletes the `Number` node (`number-input`) and the `number` socket type outright. **Per project hard rules there is NO migration and NO fallback. Every saved graph in `.rundeer/graphs/` that contains a `Number` node WILL break.** On load those nodes become unknown types: they will not instantiate/resolve, and every edge connected to them is dropped by `pruneInvalidEdges()` (`node-editor.js:713-721`). You must manually replace each old `Number` with an `Integer` or `Float` node and re-wire it.

Verified current blast radius (grep `"type": "number-input"` in `.rundeer/graphs/`): **9 `Number` instances across 5 graphs** —
- `arturito.json` (4)
- `crop-test.json` (2)
- `all.json` (1)
- `blur_dream_contrast_test.json` (1)
- `dream-blur-video-to-video.json` (1)

Additional impact:
- **Socket-type change on surviving nodes:** edges between number sockets are re-validated on load/run. Because integer↔float are cross-compatible (and `any` connects to both), most existing numeric wires survive. Any wire whose *source* was a deleted `Number` node is pruned.
- **Stored prop values persist** (they are plain JSON numbers in each node's `props`). Integer widgets will `Math.trunc` a previously-fractional stored value the next time it is edited/normalized; no data file is rewritten by this phase.
- **Node types whose saved socket values may need re-entry / re-wiring:** `number-input` (deleted — mandatory replacement). All other listed nodes keep their prop values; only inbound wires *from* a deleted `Number` need reconnecting (notably `math-op`, `cmd-*` `iterations`, `loop-decompose` `times`, `coordinate` `width/height`, anything an artist drove with a `Number` constant).

No backend handler, no `settings.yaml`, and no persisted-graph rewrite are part of this phase.

## Validation

- **Python compile:** `python3 -m compileall -q web/` (covers `node_defs.py`, `graph_mutate.py`).
- **JS syntax (changed files):** `node --check web/static/node-editor.js && node --check web/nodes/primitives/integer-input.js && node --check web/nodes/primitives/float-input.js`.
- **JS syntax (full sweep):** `rg --files -g '*.js' web | xargs -n1 node --check` (must pass for every JS file; confirms no stray reference to the deleted node breaks parsing).
- **CLI / def-parse intact:** `python3 rundeer.py web --help` (and/or `python3 -m rundeer web --help`) — must print web usage with no import/parse error (proves all YAML still parses through `web/node_defs.py`).
- **Def payload check:** start `rundeer web`, `GET /api/node-defs`; assert `integer-input` and `float-input` are present and `number-input` is absent; assert no surviving socket has `type: number`.
- **Manual editor checks:**
  - Add-menu → **Primitives** shows **Integer** and **Float**, and **does NOT show Number**.
  - Integer node value entry is integer-stepped; Float node accepts decimals.
  - Wire `Integer.out` → a `float` input (e.g. `mapping.scale_x`) and `Float.out` → an `integer` input (e.g. `cmd-image.iterations`): both connect (numeric family); the consumer coerces precision.
  - Socket dots show the two new colors and tooltips read "Integer"/"Float".
  - Load a graph containing an old `Number` node and confirm the node is unknown and its edges are pruned (the documented breakage).

## Acceptance Checklist

- [ ] `Number` node removed (`number-input.yaml` + `.js` deleted; not in add-menu; not in `/api/node-defs`).
- [ ] `Integer` node added (`integer-input.yaml` + `.js`; emits `integer`; `Math.trunc` resolve).
- [ ] `Float` node added (`float-input.yaml` + `.js`; emits `float`; `Number` resolve).
- [ ] `number` socket type removed from `SOCKET_TYPES` (JS) and `KNOWN_SOCKET_TYPES` (Python).
- [ ] `integer` and `float` socket types added with distinct oklch colors + labels.
- [ ] kind→type inference updated (`int`→integer, `float`→float, `range`→float; explicit type honored).
- [ ] `int`/`float` widget kinds render + coerce correctly (int rounds; float keeps decimals).
- [ ] `canConnect` (JS) and `_can_connect` (Python) allow integer↔float.
- [ ] `inferPreviewMediaKind` and the `:143` bundle special-case no longer reference `number`/`number-input`.
- [ ] Every one of the 69 number sockets reclassified per the conversion table (and `mix.factor` correctly left as `any`).
- [ ] `vector-input` x/y/z widgets are float; output socket still `vector`.
- [ ] No code comments/docstrings; no fallback; no migration added.
- [ ] `NODES.md` socket-types list, inference table, and widget-kinds list updated.
- [ ] All validation commands pass; manual add-menu shows Integer/Float and not Number.
