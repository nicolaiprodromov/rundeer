# Phase 3 — Prompt & Prompt Filter: Run Input + xhigh Effort

## Goal

Improve the two Prompt-category nodes (`prompt`, `prompt-filter`) so that:

1. Both expose `xhigh` as a selectable reasoning-effort level (currently the select stops at `high`).
2. Both gain a `run`-type input socket so they can be triggered independently by a `run-trigger` (Run) node, exactly like the command nodes and the terminal node.

After this change a user can wire a **Run** node into a prompt node and execute just that prompt node (plus its upstream dependencies) on demand, without needing a downstream command/preview node to pull it.

## Scope

In scope:
- `web/nodes/prompt/prompt.yaml` — add `xhigh` option, add `run` input, add `terminal` trait.
- `web/nodes/prompt/prompt-filter.yaml` — same three edits.

Out of scope (verified no change needed — see Background):
- `web/nodes/prompt/prompt.js` / `prompt-filter.js` — already pass `reasoning_effort` through unchanged; the `run` input is a graph-execution-layer concern and is not read inside `resolve`.
- `web/nodes/prompt/filter_prompt.py` — already accepts `xhigh`.
- `web/static/node-editor.js`, `web/node_defs.py` — the `run` socket type and trigger machinery already exist and are generic.

Hard-rule reminders for the implementer: NO comments / docstrings of any kind; NO fallbacks, NO legacy preservation, NO live migration; web code stays under `web/`; short names; isolated edits.

## Background (current state)

Effort select options (the lists to extend):
- `web/nodes/prompt/prompt.yaml:22` → `options: [default, none, low, medium, high]`
- `web/nodes/prompt/prompt-filter.yaml:25` → `options: [default, none, low, medium, high]`

JS passthrough (reads the prop, forwards verbatim, no allow-list — so `xhigh` flows through with zero JS change):
- `web/nodes/prompt/prompt.js:20` → `const reasoningEffort = pf_str("reasoning_effort");`
- `web/nodes/prompt/prompt.js:26` → `reasoning_effort: (reasoningEffort && reasoningEffort !== "default") ? reasoningEffort : "",`
- `web/nodes/prompt/prompt-filter.js:20` and `:26` → identical lines.

Python already accepts `xhigh` (confirmed — no backend change for xhigh):
- `web/nodes/prompt/filter_prompt.py:107` → `reasoning_effort = str(payload.get("reasoning_effort") or "").strip().lower()`
- `web/nodes/prompt/filter_prompt.py:108` → `is_reasoning = reasoning_effort in {"none", "low", "medium", "high", "xhigh"}`
- `web/nodes/prompt/filter_prompt.py:109-110` → when reasoning, sets `call_kwargs["reasoning_effort"] = reasoning_effort` (passed straight to litellm).

The `run` socket type and trigger pattern (already present, generic):
- Socket type registered: `web/static/node-editor.js:17` → `run: { color: "oklch(80% 0.180 100)", label: "Run" }`; allowed in `web/node_defs.py:11-15` (`KNOWN_SOCKET_TYPES` includes `"run"`).
- Connect rule: `web/static/node-editor.js:29` (`typeA === typeB` allows run→run) and `:32` (`if (typeA === "run" || typeB === "run") return false;` blocks run↔anything-else). So a `run` input only accepts a `run` output.
- Trigger source: `web/nodes/triggers/run-trigger.yaml:8-11` (output `id: run`, `type: run`); `web/nodes/triggers/run-trigger.js:3` (`outputs.run = true;`); `web/nodes/triggers/run-trigger.js:18-21` (Run button → `ctx.runFromTrigger(nodeId)`).
- `runFromTrigger`: `web/static/node-editor.js:6139-6157` → builds the subset via `nodesInTriggerSubgraph` then `runGraph({ ...opts, subset })`.
- `nodesInTriggerSubgraph`: `web/static/node-editor.js:6111-6137` → `targets = activeOutgoingEdges(triggerId, "run").map(toNode)` (line 6113), i.e. the nodes whose `run` input is wired to the trigger; then BFS expands upstream+downstream but **stops crossing `run`-type output edges** (line 6130: `if (sock?.type === "run") continue;`).
- Endpoint selection inside a run: `web/static/node-editor.js:6212-6223` → a node is resolved as a terminal only if it is in `COMMAND_TYPES`, `TERMINAL_TYPES`, or `PREVIEW_TYPES` (preview also requires incoming edges).
- Trait → set wiring: `web/static/node-editor.js:9494-9502` → `command`→`COMMAND_TYPES` (9497), `preview`→`PREVIEW_TYPES` (9496), `terminal`→`TERMINAL_TYPES` (9501).
- `TERMINAL_TYPES` is referenced in only two places: `web/static/node-editor.js:6218` (always treated as an endpoint to resolve) and `web/static/node-editor.js:2857` (`_srcIsPreformatted` — a downstream preview of a terminal-typed source renders monospace/preformatted). It carries no PTY or backend coupling.

Existing nodes that already expose the run input (the templates to copy):
- `web/nodes/terminal/terminal.yaml:12-14` → `- id: trigger` / `label: Run` / `type: run`, with `traits: [terminal, heavy]` at `web/nodes/terminal/terminal.yaml:71`.
- `web/nodes/grok-imagine/cmd-image.yaml:6-8` and `cmd-merge.yaml:6-8` → identical `trigger` socket as the **first** input, with `traits: [command, heavy]`.
- Their resolvers never read `inputs.trigger` (e.g. `web/nodes/grok-imagine/cmd-image.js` only calls `executeCommandNode`), confirming the run input is consumed by the graph layer, not by `resolve`.

## Part A — Add xhigh effort

Append `xhigh` to the `reasoning_effort` select options in both YAMLs (keep order; `xhigh` last, after `high`):

`web/nodes/prompt/prompt.yaml:22`
```yaml
    options: [default, none, low, medium, high, xhigh]
```

`web/nodes/prompt/prompt-filter.yaml:25`
```yaml
    options: [default, none, low, medium, high, xhigh]
```

No other change for xhigh:
- JS: NO change. `prompt.js` / `prompt-filter.js` forward `reasoning_effort` verbatim (only the literal `"default"` is mapped to `""`); any other value, including `xhigh`, passes straight through (`prompt.js:20,26`).
- Python: NO change. `filter_prompt.py:108` already lists `"xhigh"` in `is_reasoning`, so it is accepted and forwarded to litellm at `filter_prompt.py:109-110`.

## Part B — Add run input

Chosen pattern (copied verbatim from `web/nodes/terminal/terminal.yaml`): a pure `run` socket named `trigger`, placed as the **first** entry of `in`, inline (no `group`), plus the `terminal` trait so the node is selectable as an independent endpoint.

1. Socket to add as the first item under `in:` in **both** YAMLs:
```yaml
  - id: trigger
    label: Run
    type: run
```
- `id: trigger` (matches the cmd-* and terminal convention; `runFromTrigger` keys off the `run` *type*, not the id — see `nodesInTriggerSubgraph` line 6113).
- `type: run` → pure socket (no `kind`), so it renders as a wire dot only and accepts only a `run` output (`canConnect`, node-editor.js:32).
- No `group` → inline at the node top, like the templates.

2. Trait to add — change `traits` in **both** YAMLs from:
```yaml
  traits: [heavy]
```
to:
```yaml
  traits: [terminal, heavy]
```
Rationale: independent triggering requires the node to be picked as an endpoint by `runGraph` (node-editor.js:6218). `terminal` is the generic "Output/endpoint node, resolved independently" trait (NODES.md Traits table) and couples to nothing but endpoint selection + preview formatting. `command` is rejected (it implies Grok-Imagine generation semantics: `executeCommandNode`, iterations/bundle logic at node-editor.js:133-135). `preview` is rejected (it would replace the node body with an inline preview renderer). The terminal node is the exact precedent: it has both the `trigger`/`run` input and the `terminal` trait.

3. Resolve / trigger wiring — NO JS change required:
- When triggered via a Run node: the `run-trigger` output (`run-trigger.js:3`, `outputs.run = true`) is wired into the prompt node's `trigger` input. Clicking Run calls `runFromTrigger(triggerId)` → `nodesInTriggerSubgraph` selects the prompt node as a `target` (its `trigger` input is wired from the trigger's `run` output) and builds the subset; `runGraph` then resolves the prompt node because `TERMINAL_TYPES.has(type)` is now true (node-editor.js:6218).
- When pulled as a dependency: unchanged — `resolveNode` recursion resolves it normally.
- In both cases `resolve` does not read `inputs.trigger`; during input gathering (`resolveNode`, node-editor.js:6385-6411) the `trigger` input resolves to `true` (if wired) or `""` (if not) and is simply ignored by the prompt resolvers, exactly as in the command nodes. Therefore `prompt.js` and `prompt-filter.js` stay byte-for-byte unchanged.

## Affected / New Files

| File | Modified | Purpose |
|---|---|---|
| `web/nodes/prompt/prompt.yaml` | Yes | Add `xhigh` to effort options; add `trigger` run input; add `terminal` trait |
| `web/nodes/prompt/prompt-filter.yaml` | Yes | Add `xhigh` to effort options; add `trigger` run input; add `terminal` trait |
| `web/nodes/prompt/prompt.js` | No | Already forwards `reasoning_effort`; run input not read in resolve |
| `web/nodes/prompt/prompt-filter.js` | No | Same as above |
| `web/nodes/prompt/filter_prompt.py` | No | Already accepts `xhigh` (line 108) |
| `web/static/node-editor.js` | No | `run` socket, `runFromTrigger`, `terminal`→`TERMINAL_TYPES` already generic |
| `web/node_defs.py` | No | `run` already in `KNOWN_SOCKET_TYPES` |

## Implementation Steps

1. `web/nodes/prompt/prompt.yaml`
   - Line 22: change `options: [default, none, low, medium, high]` → `options: [default, none, low, medium, high, xhigh]`.
   - Insert as the first child of `in:` (above the existing `- id: prompt` at line 6):
     ```yaml
       - id: trigger
         label: Run
         type: run
     ```
   - Line 70: change `traits: [heavy]` → `traits: [terminal, heavy]`.
2. `web/nodes/prompt/prompt-filter.yaml`
   - Line 25: change `options: [default, none, low, medium, high]` → `options: [default, none, low, medium, high, xhigh]`.
   - Insert as the first child of `in:` (above the existing `- id: prompt` at line 6):
     ```yaml
       - id: trigger
         label: Run
         type: run
     ```
   - Line 73: change `traits: [heavy]` → `traits: [terminal, heavy]`.
3. Do NOT touch `prompt.js`, `prompt-filter.js`, or `filter_prompt.py`.
4. Preserve exact YAML indentation (2 spaces; list items under `in:` are indented with 2 spaces before `-`, matching the existing entries). Add no comments.

## Breaking Changes / Data Impact

- Schema is additive: existing saved graphs that contain `prompt` / `prompt-filter` nodes still load. The new `trigger` input simply has no incoming edge (defaults to `""`); the `xhigh` option does not affect any previously saved `reasoning_effort` value.
- Behavioral change from the `terminal` trait: prompt nodes are now endpoints. (a) On a **full graph run** they will always be resolved (and will fire their LLM call) even when nothing downstream pulls them — previously they ran only when pulled as a dependency. (b) A downstream `preview` whose source is a prompt node will now render its text preformatted/monospace (`_srcIsPreformatted`, node-editor.js:2857) instead of as markdown.
- Per project rules: no fallback, no compatibility shim, and no migration of old graphs. Do not add a `migrate` hook. If the changed full-run behavior matters, warn the user that prompt nodes in pre-existing graphs now execute as independent endpoints; do not silently special-case them.

## Validation

- `node --check web/nodes/prompt/prompt.js`
- `node --check web/nodes/prompt/prompt-filter.js`
- `python3 -m compileall -q web/nodes/prompt/`
- `python3 rundeer.py web --help` (CLI entrypoint smoke; must exit 0)
- Optional YAML sanity: `python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('web/nodes/prompt/*.yaml')]"`
- Manual: load the web console, add a `Run` node + a `Prompt` node, wire Run→`trigger`, confirm the link is accepted (run↔run only), confirm clicking Run resolves just the prompt node, and confirm `xhigh` appears in the Reasoning Effort dropdown of both nodes.

## Acceptance Checklist

- [ ] `xhigh` present in `reasoning_effort` options of `prompt.yaml`
- [ ] `xhigh` present in `reasoning_effort` options of `prompt-filter.yaml`
- [ ] `trigger` (`type: run`) input added as first `in` entry of `prompt.yaml`
- [ ] `trigger` (`type: run`) input added as first `in` entry of `prompt-filter.yaml`
- [ ] `terminal` trait added to both nodes (`traits: [terminal, heavy]`)
- [ ] A `Run` node can wire into each prompt node and trigger it independently
- [ ] No JS / Python changes; no comments or docstrings added
- [ ] `node --check` (both JS), `compileall`, and `web --help` all pass
