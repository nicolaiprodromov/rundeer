# Phase 5 — String Op: to_int and to_float

## Goal

Deliver working, hard-rule-compliant `to_int` and `to_float` operations on the **String Op** node (`text-op`), so a string (or stringified number) on input **A** can be converted to a real numeric JavaScript value on the **Result** output and consumed by numeric nodes (e.g. Math).

> Verbatim source (`new_nodes.md`): "we need new string operations: `to_int` and `to_float` in the String Op node".

## Scope

**Important reality check (verified against the live code):** both operations are *already present* in the node — listed in the `op` select and implemented in the resolve switch. They are, however, **not finished correctly**:

1. They use a `|| 0` fallback, which violates the project hard rule **NO fallbacks**.
2. The shared `Result` output socket is typed `text`, but `to_int`/`to_float` (and the existing `length`) emit numbers — a numeric value silently flows out of a String socket.

Therefore Phase 5 is **not** "add two cases from scratch"; it is **finalize the two existing cases to spec**:

- Keep the two options in the select (do **not** re-add — that would duplicate).
- Remove the `|| 0` fallback and lock decisive parsing semantics.
- Fix the output socket typing so numeric results are wireable into numeric inputs.

Out of scope: new sockets, new nodes, backend `.py`, Phase 4 work, graph migration.

## Background (current state)

All paths are repo-relative to `/workspaces/ttiar/rundeer`.

**`web/nodes/operations/text-op.yaml`**
- `text-op.yaml:2` — `label: String Op` (confirms this is the target node).
- `text-op.yaml:12-16` — the `Operation` select:
  ```yaml
  - id: op
    label: Operation
    kind: select
    options: [to_string, replace, upper, lower, trim, slice, to_int, to_float, length, format]
    default: to_string
  ```
  → `to_int` and `to_float` are **already in the list**.
- `text-op.yaml:21-24` — the single output:
  ```yaml
  out:
  - id: out
    label: Result
    type: text
  ```
  → `Result` socket type is **`text`**.

**`web/nodes/operations/text-op.js`** (resolve switch)
- `text-op.js:2-5` — inputs coerced: `a = String(inputs.a ?? "")`, `b = String(inputs.b ?? "")`, `op = props.op || "to_string"`, `extra = String(props.extra ?? "")`.
- `text-op.js:20` — `case "to_int":   outputs.out = parseInt(a, 10) || 0; break;`
- `text-op.js:21` — `case "to_float": outputs.out = parseFloat(a) || 0; break;`
- `text-op.js:22` — `case "length":   outputs.out = a.length; break;` (already emits a number through the `text` socket — pre-existing latent inconsistency).

**Type/connection system** (`web/static/node-editor.js`)
- `node-editor.js:4-19` — `SOCKET_TYPES` registry; `text` = "String", `number` = "Number", `any` = "Any".
- `node-editor.js:27-48` — `canConnect(typeA, typeB)`: equal types pass; **`if (typeA === "any" || typeB === "any") return true;`** (line 33); `text`↔`filepath` pass; **`text` does NOT connect to `number`** (no rule pairs them). So today a String Op `Result` (`text`) **cannot** wire into a `number` input such as Math A/B.

**Reference consumers / Phase 4 target**
- `web/nodes/operations/math-op.yaml:6-20` — Math `a`, `b`, `out` are all `type: number`; `math-op.js:2-3` reads `Number(inputs.a ?? 0)`.
- `web/nodes/primitives/number-input.yaml:1-14` — the `Number` node (label `Number`) outputs `type: number`; this is the node Phase 4 will remove/replace with `Integer`/`Float`.
- `web/config/settings.yaml:33` — `Operations: oklch(55% 0.2 140)` (category already registered; no settings change needed).

## Operation Additions

Because the two ops already exist, the canonical final state is documented below. **No new option entries are added** (re-adding would create duplicates).

### Final `op` options (unchanged — verify, do not edit)
```yaml
options: [to_string, replace, upper, lower, trim, slice, to_int, to_float, length, format]
```

### Resolve cases (the only JS change — remove the `|| 0` fallback)

Final form of the two cases in the `switch (op)` block:
```js
case "to_int":   outputs.out = parseInt(a, 10); break;
case "to_float": outputs.out = parseFloat(a); break;
```

Pseudocode / parsing semantics (decisive, minimal — no defensive code):
```
a = String(inputs.a ?? "")          // already done at top of resolve
to_int   -> parseInt(a, 10)         // base-10, parses leading integer portion
to_float -> parseFloat(a)           // parses leading float portion
```

Decisions and rationale:
- **Base 10 for `to_int`** via `parseInt(a, 10)` — avoids accidental octal/hex interpretation; matches the existing call.
- **`parseFloat(a)` for `to_float`** — handles decimals and exponent notation.
- **No explicit `.trim()`** — `parseInt`/`parseFloat` already skip leading whitespace; an extra trim is redundant defensive code and is omitted.
- **Lenient leading-numeric parse is intentional** — `parseInt("12px",10)→12`, `parseFloat("3.14abc")→3.14`. This fits the "extract a number from a string" intent of a *String* Op and matches the established behavior.
- **Non-numeric input → `NaN`** (the natural result). The `|| 0` fallback is **removed** per the hard "NO fallbacks" rule: `NaN` is the honest signal; we do not silently coerce to `0`.
- These return **real JS numbers** (`typeof === "number"`), so downstream `Number(inputs.a)` consumers work directly.
- **No comments / no docstrings** in the edit (hard rule).

## Output Typing

**Problem:** one `Result` socket is shared by all 10 operations. Most emit strings; `length`, `to_int`, `to_float` emit numbers. A static socket type cannot be both `text` and `number`. Today it is `text`, so the numeric outputs cannot be wired into `number` inputs (`canConnect("text","number") === false`, per `node-editor.js:35-47`).

**Decision:** change the `Result` socket from `text` to **`any`**.
```yaml
out:
- id: out
  label: Result
  type: any
```

Rationale:
- `any` connects to everything via `node-editor.js:33` (`typeA==="any" || typeB==="any" → true`), so the numeric value can flow into `number` inputs (Math A/B) **and** the string values still flow into `text` inputs.
- The **runtime value carries the real type** (`parseInt`/`parseFloat` return numbers; string ops return strings); only the *static socket label* is widened. No coercion, no wrapper, no fallback.
- This also resolves the **pre-existing** `length`-returns-number-through-`text` inconsistency (`text-op.js:22`).
- This is the minimal, decisive typing that keeps a single Result socket honest for a mixed-output node — no extra sockets, no node split (those would be scope creep).

## Coordination with Phase 4

Phase 4 (planned separately, `new_nodes.md` PHASE 4) **removes the `Number` node and replaces it with `Integer` and `Float` primitives**, and may split the `number` socket type into `integer` and `float`. Phase 5 must align but **must not implement Phase 4**.

Guidance for whichever way Phase 4 lands:

- **Semantic intent:** `to_int` aligns with the integer type; `to_float` aligns with the float type. At runtime this is already true (`parseInt` → integer value, `parseFloat` → float value).
- **If Phase 4 keeps a single `number` type:** the String Op `Result` still cannot be typed `number`, because the *same* socket also emits strings (`to_string`, `replace`, `upper`, …). Keep `Result` = **`any`**; the numeric runtime value connects cleanly to `number` inputs.
- **If Phase 4 splits into `integer`/`float`:** `to_int` and `to_float` still emit from **one shared `Result` socket**, which cannot simultaneously be `integer` and `float`. **Recommended pragmatic typing: keep `Result` = `any`** and document the limitation — the integer/float distinction is enforced only by the runtime value, not by the static socket type. When Phase 4 fixes the type split, re-verify `canConnect(any, integer)` and `canConnect(any, float)` both return `true` (the `any` wildcard rule already covers this).
- **Documented limitation:** strict static typing of these two outputs would require either splitting String Op into typed variants or adding dedicated numeric output sockets. Both are **out of Phase 5 scope** and noted only as a future option; do not pursue them now.

## Affected / New Files

| File | Modified | Purpose |
|---|---|---|
| `web/nodes/operations/text-op.yaml` | Yes | Change `out` socket `type: text` → `type: any`. (Options list already contains `to_int`/`to_float` — verify, do **not** re-add.) |
| `web/nodes/operations/text-op.js` | Yes | Remove the `|| 0` fallback from the `to_int` and `to_float` resolve cases; lock parsing semantics. |
| `web/nodes/operations/math-op.yaml` / `web/nodes/primitives/number-input.yaml` | No (reference only) | Numeric consumer + Phase 4 target; used to validate wiring. |
| `web/config/settings.yaml` | No | `Operations` category already registered (`:33`). |

No new files. No backend `.py`. No `web/server.py` route (pure frontend resolve).

## Implementation Steps

1. Open `web/nodes/operations/text-op.yaml`. Confirm `op.options` (line 15) already contains `to_int` and `to_float`. Make **no** change to the options list.
2. In the same YAML, change the `out` socket `type: text` to `type: any` (lines 21-24).
3. Open `web/nodes/operations/text-op.js`. In the `switch (op)` block, edit the existing cases:
   - `case "to_int":   outputs.out = parseInt(a, 10); break;` (drop `|| 0`).
   - `case "to_float": outputs.out = parseFloat(a); break;` (drop `|| 0`).
4. Leave `to_string`, `length`, and all other cases untouched (`length` is already a number and is now correctly carried by the `any` socket). Add **no** comments or docstrings.
5. Run validation (next section).
6. Manual graph check: add a String Op node, set A to e.g. `"42"` / `"3.14"`, select `to_int` / `to_float`, wire `Result` into a Math `A` input, confirm the connection is allowed (any→number) and Math computes on the numeric value.

## Breaking Changes / Data Impact

- **Behavior change (intended):** `to_int`/`to_float` on a non-numeric A now produce `NaN` instead of `0` (the `|| 0` fallback is removed per the **NO fallbacks** rule). Old graphs that relied on the silent `0` will now see `NaN`. Per project rules we **do not migrate** and **do not add a fallback** — **warn about old graphs** instead of preserving legacy behavior.
- **Output socket type change (`text` → `any`):** widening only. Existing wires from `Result` into `text` inputs remain valid (`canConnect(any, text) === true`). The change additionally *enables* previously-impossible wires into `number` inputs. The only visible difference is the socket's color/label (now "Any").
- **No data/schema migration, no config changes, no persisted-graph rewrite.** Breaking changes are acceptable in alpha.

## Validation

- JS syntax: `node --check web/nodes/operations/text-op.js`
- YAML is parsed at server startup by `web/node_defs.py` (scans `web/nodes/**/*.yaml`); a malformed YAML surfaces there. Sanity-check the CLI is intact: `rundeer web --help` (or `python3 -m rundeer web --help`) — should print the web usage without import/parse errors.
- Optional Python sanity (no handler added, but harmless): `python3 -m compileall -q web/nodes/operations/`.
- Runtime smoke test: start `rundeer web`, open the editor, add **String Op**, exercise `to_int` ("42" → 42) and `to_float` ("3.14" → 3.14), confirm `Result` wires into Math `A` (any→number) and Math output is numeric; confirm a non-numeric input yields `NaN` (no silent 0).

## Acceptance Checklist

- [ ] `to_int` present in `op.options` (verified, not duplicated).
- [ ] `to_float` present in `op.options` (verified, not duplicated).
- [ ] `to_int` resolve case works and uses `parseInt(a, 10)` with **no `|| 0` fallback**.
- [ ] `to_float` resolve case works and uses `parseFloat(a)` with **no `|| 0` fallback**.
- [ ] `Result` output socket typed sensibly so numeric results are wireable (`type: any`).
- [ ] Numeric `Result` connects into a `number` input (e.g. Math A) in the editor.
- [ ] No comments/docstrings added; no fallbacks; no migration; `Operations` category unchanged.
- [ ] `node --check web/nodes/operations/text-op.js` passes and `rundeer web --help` runs clean.
