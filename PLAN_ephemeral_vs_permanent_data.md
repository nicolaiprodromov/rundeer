# PLAN — Split `.rundeer/` data into PERMANENT vs EPHEMERAL + `rundeer web --cleanup`

## Goal
Stop writing user-precious data under `.rundeer/data/`. Promote **graphs**, **outputs**, and the **agent** dir (which holds **brain graphs** + **past conversations** + the agent registry) to live directly under `.rundeer/`, alongside the already-permanent `def/` and `presets/`. Everything left under `.rundeer/data/` becomes purely **ephemeral** and is safe to wipe. Add `rundeer web --cleanup` to wipe `.rundeer/data/` on startup without touching permanent data.

`paths.py` is the single source of truth for these locations, so changing 3 path functions + the dir tuples auto-propagates to every Python consumer (server graph/agent/runs logic, export node, CLI, persistence, profiles). The remaining work is hardcoded display-string defaults (JS/YAML/preset JSON/docs), ignore rules, and the agent sandbox prefix.

---

## Current state (what is where today)

`src/rundeer/core/paths.py`:
- `DATA_DIRS = ("agent", "benchmark", "cache", "graphs", "logs", "outputs", "runs")` (`paths.py:10`)
- `DEFAULT_OUTPUT_DIR = .rundeer/data/outputs` (`paths.py:11-12`)
- `default_output_dir → .rundeer/data/outputs` (`paths.py:66-67`)
- `graphs_dir → .rundeer/data/graphs` (`paths.py:78-79`)
- `agent_dir → .rundeer/data/agent` (`paths.py:90-91`)
- Already permanent (NO change): `definitions_dir → .rundeer/def` (`paths.py:50-51`), `presets_dir → .rundeer/presets` (`paths.py:54-55`)
- Stay ephemeral (NO change): `cache_dir`, `benchmark_dir`, `runs_dir`, `logs_dir`, `web_state_path → data/web-state.json`, `rate_limit_state_path → data/rate_limits.json`

`agent_dir` holds BOTH things the user named separately:
- conversations: `_index.json`, `<conv_id>.json` (`web/agent/persistence.py:16-25`)
- brain graphs: `brain.graph.json`, `runtime.json`, `brain.log`, plus per-agent `agents/<id>/...` (`web/agent/brain_graph.py:534-554`)
- agent registry: `agents.json` (`web/agent/profiles.py:20-25`)

The user already manually moved graphs to `.rundeer/graphs/` (has content), but code still points at `.rundeer/data/graphs` — so graphs are currently broken until `paths.py` is updated.

---

## Target structure

```
.rundeer/
  config.json            permanent (config)
  batch.json             permanent (config)
  benchmark.json         permanent (config)
  def/                   permanent  (unchanged)
  presets/               permanent  (unchanged)
  graphs/                permanent  (user already moved; code must follow)
  outputs/               permanent  (MOVE out of data/)
  agent/                 permanent  (MOVE out of data/: brain graphs + conversations + registry)
  data/                  EPHEMERAL  (wiped by --cleanup)
    benchmark/
    cache/
    logs/
    runs/
    web-state.json       (UI layout/tabs — reset on cleanup)
    rate_limits.json     (rate-limit counters — reset on cleanup)
```

### Classification

| Dir / file | Class | Action |
|---|---|---|
| `graphs/` | permanent | move to `.rundeer/graphs/` (user did the folder; fix code) |
| `outputs/` | permanent | move to `.rundeer/outputs/` |
| `agent/` (brain graphs + conversations + registry) | permanent | move to `.rundeer/agent/` |
| `def/`, `presets/` | permanent | already correct, no change |
| `config.json`, `batch.json`, `benchmark.json` | permanent | already correct, no change |
| `benchmark/`, `cache/`, `logs/`, `runs/` | ephemeral | stay under `data/` |
| `web-state.json`, `rate_limits.json` | ephemeral | stay under `data/` |

---

## Code changes (ordered)

### 1. `src/rundeer/core/paths.py` — single source of truth
- Split the dir tuples:
  - `DATA_DIRS = ("benchmark", "cache", "logs", "runs")` (ephemeral only)
  - add `PERSIST_DIRS = ("graphs", "outputs", "agent")` (permanent, directly under `.rundeer/`)
- Repoint the 3 permanent helpers to `rundeer_dir(root)` instead of `data_path(root, ...)`:
  - `default_output_dir(root) → rundeer_dir(root) / "outputs"`
  - `graphs_dir(root) → rundeer_dir(root) / "graphs"`
  - `agent_dir(root) → rundeer_dir(root) / "agent"`
- Update the constant: `DEFAULT_OUTPUT_DIR = Path(RUNDEER_DIRNAME) / "outputs"` (drop `DATA_DIRNAME`); `DEFAULT_OUTPUT_DIR_STR` recomputes from it.
- Leave `cache_dir`, `benchmark_dir`, `runs_dir`, `logs_dir`, `web_state_path`, `rate_limit_state_path` untouched (still under `data/`).

> Effect: every Python consumer that imports these helpers (server.py graph/runs/artifact logic, export.py, commands.py, persistence.py, brain_graph.py, profiles.py) moves automatically — no edits needed in those files.

### 2. `src/rundeer/core/bootstrap.py` — create permanent dirs + cleanup helper
- Import `PERSIST_DIRS` alongside `DATA_DIRS`.
- In `ensure_rundeer_dir`, after seeding the template, also create the permanent dirs directly under `.rundeer/`:
  - loop `PERSIST_DIRS` → `(root / name).mkdir(parents=True, exist_ok=True)`
  - keep the existing `DATA_DIRS` loop under `data_dir(cwd)`.
- Add a new modular helper:
  - `clear_data(cwd=None)` → resolve `data_dir(cwd)`, `shutil.rmtree(..., ignore_errors=True)`. (Recreation is handled by the `ensure_rundeer_dir` call that follows it.)
- No comments/docstrings (project rule).

### 3. `web/server.py` — wire `--cleanup` into `serve()`
- `serve(...)` signature (`server.py:64-72`): add `cleanup: bool = False`.
- In the body (`server.py:73-75`), before `ensure_rundeer_dir(root)`:
  - `if cleanup: from rundeer.core.bootstrap import clear_data; clear_data(root)`
  - then existing `ensure_rundeer_dir(root)` recreates ephemeral dirs and re-seeds template files.
- `ensure_web_storage_dirs` (`server.py:422-426`) and the `graphs_dir`/`runs_dir` wrappers (`server.py:410-415`) need NO change — they delegate to `paths.py`.

### 4. `src/rundeer/cli/commands.py` — expose `--cleanup`
- `WEB_USAGE` (`commands.py:630-642`): add option line, e.g. `--cleanup            Wipe ephemeral .rundeer/data/ before starting.`
- `cmd_web` (`commands.py:659-685`): pass `cleanup=bool(args.get("--cleanup"))` into `serve(...)`.

### 5. `web/agent/sandbox.py` — keep agent data restricted
- `SENSITIVE_PREFIXES` (`sandbox.py:11`): change `".rundeer/data/agent/"` → `".rundeer/agent/"` so the agent still cannot read its own conversation/brain files at the new location.

### 6. Hardcoded default strings (no path helper available there)
These are display defaults / fallbacks that don't import `paths.py`. Update `.rundeer/data/outputs` → `.rundeer/outputs`, `.rundeer/data/graphs` → `.rundeer/graphs`, `.rundeer/data/agent` → `.rundeer/agent`:
- `web/static/node-editor.js:6469, 6504` (outputs default/fallback)
- `web/static/node-editor.js:7708, 7844, 7919` (graphs UI messages)
- `web/static/agent.js:1066` (agent save message)
- `web/agent/tools.py:172` (list-artifacts tool description text)
- `web/nodes/grok-imagine/_command-helpers.js:61` (outputs default)
- `web/nodes/grok-imagine/cmd-image.yaml:36`, `cmd-video.yaml:42`, `cmd-edit.yaml:39`, `cmd-extend.yaml:38`, `cmd-merge.yaml:36` (output_dir defaults)
- `src/rundeer/presets/**/*.json` — `"dir": ".rundeer/data/outputs"` appears in ~40 preset files (camera/color-grading/effects/enhance/lut/mask/rotate). Bulk replace to `".rundeer/outputs"`.

> `web/nodes/operations/compress.py:134` writes to `.rundeer/data/cache/compressed` — cache stays ephemeral, leave as-is.

### 7. Ignore / config rules (preserve current git + tooling behavior)
- `.gitignore` (`.gitignore:17-25`): keep `.rundeer/data/` ignored; add new permanent locations so generated media/conversations stay out of git exactly as before the move:
  - add `.rundeer/outputs/`, `.rundeer/agent/`, `.rundeer/graphs/`
  - the old `.rundeer/data/outputs|agent|graphs` lines become redundant (data/ no longer holds them) — remove them.
- `repomix.config.json` (`repomix.config.json:44`): keep `.rundeer/data/**`; add `.rundeer/outputs/**`, `.rundeer/graphs/**`, `.rundeer/agent/**` so the context pack does NOT balloon with media/graph/conversation blobs (token-management rule).
- `web/config/settings.yaml:29` `ignore_patterns`: currently hides `.rundeer/data/` from agent file tools; add `.rundeer/outputs/`, `.rundeer/graphs/`, `.rundeer/agent/` to keep them hidden from the agent workspace walker as today.

### 8. Docs / project rules
- `AGENTS.md:24` and mirror `Agents.md:24` — rewrite the runtime-data line: ephemeral `data/` = `benchmark/`, `cache/`, `logs/`, `runs/`; permanent under `.rundeer/` = `graphs/`, `outputs/`, `agent/`, `def/`, `presets/`. Also reword `:39` and the "graphs in `.rundeer/data/graphs`" mentions (`:42`, `:62`).
- `README.md:60, 101, 188, 297` — update the path descriptions for outputs/graphs/agent.
- `impeccable.md:40` — outputs path.

---

## `--cleanup` behavior (spec)
- `rundeer web --cleanup` → in `serve()`, BEFORE `ensure_rundeer_dir`, call `clear_data(root)` which `rmtree`s `.rundeer/data/`. Then `ensure_rundeer_dir` recreates empty `DATA_DIRS` and re-seeds any template-provided files.
- WIPED: `benchmark/`, `cache/`, `logs/`, `runs/`, `web-state.json` (UI layout resets), `rate_limits.json` (counters reset).
- PRESERVED (outside `data/`): `graphs/`, `outputs/`, `agent/` (brain graphs + conversations + registry), `def/`, `presets/`, all `*.json` configs.
- Ordering matters: cleanup must run before `ensure_rundeer_dir(root)` (`server.py:74`) and before `RundeerWebServer(...)` construction (`server.py:76`, which calls `ensure_web_storage_dirs` and `load_run_records`), so the server boots on a clean `data/`.

---

## Breaking changes / manual steps (alpha: no fallbacks, no live migration)
- Per project hard rules there is NO migration/fallback. Existing projects must move folders by hand once:
  - `.rundeer/data/outputs/` → `.rundeer/outputs/`
  - `.rundeer/data/agent/` → `.rundeer/agent/`
  - `.rundeer/data/graphs/` → `.rundeer/graphs/` (already done by the user)
- After the code change, anything still left in `.rundeer/data/{outputs,agent,graphs}/` is treated as ephemeral and is destroyed by `--cleanup`.
- `--cleanup` deletes benchmark outputs/templates and logs under `data/`; if benchmark assets are wanted long-term they are out of scope here and would need their own promotion.

---

## Validation (run only if testing is requested)
- `python3 -m compileall -q src web rundeer.py __init__.py`
- `python3 rundeer.py web --help` (shows `--cleanup`)
- `python3 rundeer.py image --dry-run --no-tui --iterations=1` (output dir prints `.rundeer/outputs`)
- `rg --files -g '*.js' -g '*.mjs' | xargs -r -n 1 node --check` (web static changed)
- Manual: `rundeer web --cleanup` wipes `data/` but leaves `graphs/ outputs/ agent/` intact.

---

## Touched files (summary)
| File | Change |
|---|---|
| `src/rundeer/core/paths.py` | split `DATA_DIRS`, add `PERSIST_DIRS`, repoint `default_output_dir`/`graphs_dir`/`agent_dir`, fix `DEFAULT_OUTPUT_DIR` |
| `src/rundeer/core/bootstrap.py` | create `PERSIST_DIRS`, add `clear_data()` |
| `web/server.py` | `serve(cleanup=...)` + call `clear_data` before `ensure_rundeer_dir` |
| `src/rundeer/cli/commands.py` | `WEB_USAGE` `--cleanup`, pass through in `cmd_web` |
| `web/agent/sandbox.py` | `SENSITIVE_PREFIXES` → `.rundeer/agent/` |
| `web/static/node-editor.js` | outputs + graphs hardcoded strings |
| `web/static/agent.js` | agent save message |
| `web/agent/tools.py` | list-artifacts description text |
| `web/nodes/grok-imagine/_command-helpers.js` | outputs default |
| `web/nodes/grok-imagine/cmd-*.yaml` (5) | output_dir defaults |
| `src/rundeer/presets/**/*.json` (~40) | `"dir"` default |
| `.gitignore` | add `.rundeer/{outputs,agent,graphs}/`, drop `data/` variants |
| `repomix.config.json` | ignore new permanent dirs |
| `web/config/settings.yaml` | ignore_patterns add new permanent dirs |
| `AGENTS.md` / `Agents.md` / `README.md` / `impeccable.md` | doc path updates |
