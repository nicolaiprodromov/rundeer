# Dead Code & Legacy Audit

Full codebase audit — dead functions, unused imports, legacy fallbacks, orphan files, stale configs, and duplicated code.

---

## 1. Dead Functions (confirmed zero callers)

| Function | File | Notes |
|---|---|---|
| `refresh_models_cache()` | `src/rundeer/core/models.py` | Exported in `__init__.py`, never called anywhere |
| `_SENTINEL = object()` | `src/rundeer/core/models.py` | Defined, zero references |
| `_serializable_detection()` | `src/rundeer/workflows/benchmark.py` | Defined, never called |
| `_value_is_map()` | `web/nodes/_shared/uv.py` | Defined, never called |
| `data_dirs()` | `src/rundeer/core/paths.py` | Wraps `DATA_DIRS` constant but nothing calls it; `DATA_DIRS` is used directly |
| `load_logo_frames()` | `web/server.py` | Along with `_logo_cache`, `LOGO_DIR`, `LOGO_FILES` — full dead logo subsystem |
| `_as_int()` | `web/agent/brain_graph.py` | Defined, never called |
| `_csv_list()` | `web/agent/brain_graph.py` | Defined, never called |
| `_node_id_is_muted()` | `web/agent/brain_graph.py` | Defined, never called (only `_node_is_muted()` is used) |
| `_requires_reseed()` | `web/agent/brain_graph.py` | Defined, never called — was for schema migration |
| `legacyRunDockState()` | `web/static/node-editor.js` | Old dock-position format migration, never called |
| `_relpath()` | `src/rundeer/core/uv_ops.py` | Not the same as `web/nodes/_shared/uv.py:_relpath` which IS used. The one in `uv_ops.py` is dead |

## 2. Dead Constants & Variables

| Symbol | File | Notes |
|---|---|---|
| `BRAIN_GRAPH_FILENAME` | `web/agent/brain_graph.py` | String constant, never referenced — paths built via functions |
| `RUNTIME_FILENAME` | `web/agent/brain_graph.py` | Same — never referenced |
| `AUDIT_LOG_FILENAME` | `web/agent/brain_graph.py` | Same — never referenced |
| `SCHEMA_VERSION = 1` | `web/agent/brain_graph.py`, `profiles.py`, `persistence.py` | Written to JSON output but never read back or compared — dead metadata in all 3 files |
| `_parent` | `rundeer.py` | Computed on line 16, only `_parent_str` (derived from it) is used |

## 3. Unused Imports

| Import | File | Notes |
|---|---|---|
| `load_vision_config` | `src/rundeer/cli/commands.py` | Imported, never called |
| `make_vision_client` | `src/rundeer/cli/commands.py` | Imported, never called |
| `rate_limit_state_path` | `src/rundeer/cli/commands.py` | Imported, never referenced |

## 4. Legacy Migration Code (runs every launch, no longer needed)

### `src/rundeer/core/bootstrap.py` — full data-dir migration system
- `LEGACY_DATA_REPLACEMENTS` (lines 9–14)
- `_rewrite_legacy_data_refs()` (lines 49–61) — rewrites old path strings in every text file under `.rundeer/`
- `migrate_data_dirs()` (lines 64–81) — moves files from old locations
- `legacy_data_path()` in `paths.py` — exists solely to support migration
- Called on **every** `ensure_rundeer_dir()` invocation. Since only you and the user have access (alpha), this migration has long been applied and runs wastefully.

### `web/agent/profiles.py` — old registry format migration
- Lines 86–87: If JSON is a bare list (old format), wraps it into `{schema, active_id, agents}`. Legacy format no longer exists.

### `web/nodes/vector/mix.js` — prop rename migration
- `migrate(node)` (lines 53–61): Renames `color_a`/`color_b` → `a`/`b`
- `migrateEdge(edge)` (lines 63–67): Renames socket IDs
- `canonicalInputSocketId()` (lines 47–51): Runtime fallback for old socket names
- Also in the resolve function: `props.a ?? props.color_a ?? "#000000"` — dead compat for already-migrated data

## 5. Legacy Config Key Fallbacks

| Fallback | File | Line | Notes |
|---|---|---|---|
| `_section("rateLimiter")` | `src/rundeer/core/config.py` | 306 | camelCase fallback — old config format |
| `config.get("reference")` singular | `src/rundeer/core/config.py` | 441 | All presets use `"references"` (plural) now |
| `VISION_API_KEY` env var | `src/rundeer/core/api.py` + `models.py` | — | Fallback for `GROK_IMAGINE_API_KEY` |
| `BASE_URL` env var | `src/rundeer/core/api.py` + `models.py` | — | Fallback for `GROK_IMAGINE_BASE_URL` |
| `MODEL_NAME` env var | `web/nodes/prompt/filter_prompt.py`, `.rundeer/def/fractal.py` | — | Old env var name, predates `RUNDEER_LLM_MODEL` |

## 6. Dead CSS

| Selector | File | Notes |
|---|---|---|
| `.ne-runs-panel` styles | `web/static/css/work-pages.css` | Line 1 hides it with `display: none !important`, then lines 3–25 define full styling — all dead |
| `.ascii-deer` | `web/static/css/masthead.css` | Line 128: `display: none !important` — permanently hidden, no HTML uses it |

## 7. Dead/Suspicious JS

| Item | File | Notes |
|---|---|---|
| `outputs.in = inputs.in` | `web/nodes/output/preview.js` line 3 | Writes to output socket named `"in"` which doesn't exist in `preview.yaml`. Line 2 already does the correct `outputs.out = inputs.in` |

## 8. Duplicated Code (DRY violations)

| What | Location A | Location B | Notes |
|---|---|---|---|
| `_api_host_from_base_url()` | `src/rundeer/core/api.py:12` | `src/rundeer/core/models.py:146` | Identical function |
| `_atomic_write()` | `web/agent/profiles.py:52` | `web/agent/persistence.py:42` | Identical function |
| `DEFAULT_AGENT_ID` | `web/agent/profiles.py:17` | `web/agent/persistence.py:15` | Same constant |
| `VIDEO_EXTS` | `src/rundeer/workflows/edit.py:21` | `web/nodes/bundle/folder_bundle.py:14` | Same set |
| `_safe_path()` | `web/nodes/_shared/uv.py:12` | `web/nodes/_shared/helpers.py:30` (`safe_project_path`) | Near-identical logic |
| `_slug()` | `web/agent/brain_graph.py` | `web/agent/profiles.py:38` | Duplicate |
| `_shape_meta()` branches | `web/nodes/_shared/uv.py:66–71` | — | `ndim == 2` and `ndim >= 3` return identical dicts — first branch makes second unreachable |
| Env-var fallback chains | `src/rundeer/core/api.py:33–34` | `src/rundeer/core/models.py:141–142` | Same `GROK_IMAGINE_*` / `VISION_*` / `BASE_URL` chains |
| Query-param parsing | `web/nodes/bundle/folder_bundle.py:46–64` | Same file, lines 88–103 | Same `fps`/`modulo`/`start`/`end` parsing done twice |

## 9. Stale / Orphan Files & Configs

| Item | Notes |
|---|---|
| `src/rundeer/brain/Goya/goya.md` | Empty file — placeholder brain never written |
| `src/rundeer/brain/Hewlett/hewlett.md` | Empty file — placeholder brain never written |
| `src/rundeer/brain/Niku/niku.md` | Empty file — placeholder brain never written |
| `.rundeer/def/t_pose.py` | Dynamically loadable via `@t_pose` but zero references in any config, doc, or example |
| `pytest.ini` | Configured with `testpaths = tests` but `tests/` directory does not exist |
| `".crush"` in `SKIP_DIRS` | `web/nodes/bundle/folder_bundle.py:17` — old product name, should be `".rundeer"` or removed |
| `.rundeer/def/fractal.py` | Uses raw `requests.post` with hardcoded `http://localhost:8000/v1` — bypasses the project's LLM abstraction entirely |
| Hardcoded test path in preset | `src/rundeer/presets/rotate/rotate_back.json` has `"input": "reuben/beatrice/beatrice3.png"` — all other presets have `null` |

## 10. Version Drift

| Source | Value |
|---|---|
| `rundeer.py` | `0.2.0` |
| `__init__.py` | `0.2.0` |
| `web/config/app.yaml` | `0.3.5` |

Three version declarations, two different values. No single source of truth.

## 11. Defensive Fallbacks (may want to keep or kill)

| Pattern | File | Notes |
|---|---|---|
| `try: import fcntl / except: fcntl = None` | `src/rundeer/core/rate_limit.py` | Windows compat — silently disables file locking |
| `try: curses.start_color()... except: pass` | `src/rundeer/cli/tui.py` | Terminal compat |
| `pick_reporter()` → `PlainReporter` | `src/rundeer/cli/tui.py` | Curses not available fallback |
| `getattr(stream, "aclose") or getattr(stream, "close")` | `web/agent/conversation.py` | Multi-SDK stream compat |
| `_delta_text(delta, "reasoning_content", "reasoning", "thinking")` | `web/agent/conversation.py` | Multi-LLM response format compat |

## 12. Boilerplate Duplication (not dead, but bloat)

The five workflow files (`image_gen.py`, `merge.py`, `video_gen.py`, `extend.py`, `edit.py`) all repeat ~200 lines of identical `build_jobs()` → `make_worker()` → `run()` scaffolding. A shared base runner would cut significant duplication.

---

## Priority Recommendations

**Immediate cleanup (safe, no behavior change):**
- Remove all dead functions from §1
- Remove dead constants from §2
- Remove unused imports from §3
- Remove dead CSS from §6
- Fix `outputs.in` bug in preview.js (§7)
- Fix `".crush"` → `".rundeer"` in `SKIP_DIRS`
- Null out the hardcoded path in `rotate_back.json`
- Unify `__version__` to a single source

**Kill legacy (per AGENTS.md "no fallbacks" rule):**
- Remove full migration system in `bootstrap.py` (§4)
- Remove old registry format migration in `profiles.py` (§4)
- Remove `mix.js` migrate/migrateEdge and old prop fallbacks (§4)
- Remove all legacy config key fallbacks (§5)

**Consolidate (reduces maintenance):**
- Deduplicate the 8 items in §8
- Extract shared workflow runner (§12)

**Decide:**
- Keep or kill empty brain placeholders (§9)
- Keep or kill `t_pose.py`, `cityscape.py` definitions (§9)
- Keep or kill `fractal.py` or rewrite to use project LLM abstraction
- Keep or kill `pytest.ini` (no tests exist)
