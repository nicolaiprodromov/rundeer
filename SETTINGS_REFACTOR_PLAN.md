# Settings Refactor Plan

Merge the **Runs**, **Graphs**, and **Settings** views into a single **Settings** page with a 3-panel resizable layout (modeled after the Explore page's 2-panel split).

---

## Current State

| Piece | Location | Status |
|---|---|---|
| Runs view | `view-runs` in `node-editor.html`, JS in `node-editor.js` (~line 6844–6960) | Standalone tab |
| Graphs view | `view-graphs` in `node-editor.html`, JS in `node-editor.js` (~line 7375–7880) | Standalone tab |
| Settings view | `view-settings` in `node-editor.html`, JS in `node-editor.js` (~line 4606) | Shortcuts only |
| Explore split | `ex-shell` grid + `ex-resizer` in `explorer.css`, `setupExploreResizer()` in JS | Reference pattern |
| `settings.yaml` | `web/config/settings.yaml` | Orphaned — nothing reads it |
| `config.json` | `.rundeer/config.json` via `paths.config_path()` | Active config (rate_limits, web, image, video, etc.) |
| `/api/settings` | `server.py:772–811` | Reads/writes only `rate_limits` + `web` from `config.json` |
| `/api/web-state` | `server.py` + JS `webLayoutState()` | Persists UI layout (explore split, palette, etc.) |
| Nav tabs | `nav.view-tabs` in `node-editor.html`, `setActiveView()` in JS | 5 tabs: Tree, Runs, Graphs, Explore, Settings |

---

## Target State

A single **Settings** tab replaces the three old tabs. The page is a 3-column resizable grid:

```
┌─────────────┬──────────────┬──────────────┐
│   RUNS      │   GRAPHS     │   SETTINGS   │
│  (left)     │  (center)    │  (right)     │
│             ║              ║              │
│  run list   ║  graph list  ║  yaml-driven │
│  + detail   ║  + actions   ║  config UI   │
│             ║              ║              │
└─────────────┴──────────────┴──────────────┘
                ↑              ↑
            resizer-1      resizer-2
```

- `settings.yaml` becomes the **source of truth** for the right panel
- Parsed at server startup, served to the UI
- UI edits write back to the yaml file on disk in real time
- `config.json` is **not touched** by this refactor — it continues to serve its existing role for CLI config
- Old `/api/settings` endpoint is replaced with new yaml-backed endpoints

---

## Step-by-Step Plan

### Phase 1 — Backend: settings.yaml read/write

#### Step 1.1 — Add `settings_yaml_path()` to `paths.py`
- Add a function returning `web/config/settings.yaml` (relative to project root)
- This keeps path resolution centralized

#### Step 1.2 — Create `web/config/settings_manager.py`
- Isolated module for all settings.yaml I/O
- `load_settings_yaml(root) → dict` — reads and parses the yaml file, returns the full settings tree
- `save_settings_yaml(root, data: dict)` — serializes and writes back to yaml, preserving key order and structure
- Uses `ruamel.yaml` (or `pyyaml` — check what's already in deps) for round-trip yaml handling that preserves comments
- Thread-safe with a lock (same pattern as `_web_state_lock` in server.py)

#### Step 1.3 — Add new API routes in `server.py`
- `GET /api/settings-yaml` → returns the parsed yaml as JSON
- `POST /api/settings-yaml` → accepts JSON payload, writes back to yaml
- Remove or redirect old `GET/POST /api/settings` (which only served rate_limits/web from config.json)
- The POST endpoint must do a **merge** — the UI sends partial updates (e.g., just `settings.UI.Header.title`), the backend patches the yaml tree and writes

#### Step 1.4 — Parse settings.yaml at server startup
- In the server init/startup flow, call `load_settings_yaml()` to validate the file exists and is parseable
- Cache in memory for fast GET responses
- POST invalidates cache and re-reads after write

---

### Phase 2 — Frontend: Merge 3 views into 1

#### Step 2.1 — New HTML structure in `node-editor.html`
Replace the three `<div class="ne-view">` blocks (`view-runs`, `view-graphs`, `view-settings`) with a single one:

```html
<div class="ne-view" id="view-settings" data-view="settings" hidden>
  <div class="settings-shell" id="settingsShell">
    <section class="settings-panel settings-runs">
      <!-- existing runs panel content moved here -->
    </section>
    <div class="settings-resizer" id="settingsResizer1" role="separator" aria-orientation="vertical"></div>
    <section class="settings-panel settings-graphs">
      <!-- existing graphs panel content moved here -->
    </section>
    <div class="settings-resizer" id="settingsResizer2" role="separator" aria-orientation="vertical"></div>
    <section class="settings-panel settings-config">
      <!-- new yaml-driven settings form -->
    </section>
  </div>
</div>
```

#### Step 2.2 — New CSS file `web/static/css/settings.css`
- Grid layout: `grid-template-columns: var(--st-split1, 30%) 6px var(--st-split2, 35%) 6px minmax(0, 1fr)`
- Resizer styling: reuse `ex-resizer` pattern (cursor, hover highlight, hit area)
- Panel base styling: same padding/gap/overflow pattern as `ex-panel`
- Panel-specific styling for runs list, graphs list, config form
- Responsive: if viewport < 900px, stack vertically (single column)

#### Step 2.3 — Resizer JS logic
- `setupSettingsResizers()` — handles both resizers independently
- Same pattern as `setupExploreResizer()`: mousedown → mousemove → mouseup
- Resizer 1 controls `--st-split1` (runs panel width, clamped 15–50%)
- Resizer 2 controls `--st-split2` (graphs panel width, clamped 15–50%)
- Constraint: `split1 + split2 < 85%` so the config panel always has space
- Persist both values to `webLayoutState().settingsSplit1` / `settingsSplit2` via `/api/web-state`
- Restore on page load

#### Step 2.4 — Move existing Runs JS into the new panel
- `refreshRunsList()` and `renderRunDetail()` stay as-is but target the new DOM IDs inside `settings-runs`
- The runs panel keeps its existing list + detail sub-layout (no changes to run functionality)
- Remove the old `view-runs` init path from `setActiveView()`

#### Step 2.5 — Move existing Graphs JS into the new panel
- `refreshSavedGraphs()` and `renderGraphsPage()` target the new DOM IDs inside `settings-graphs`
- All graph actions (save, open, rename, delete, load JSON, clear) work as before
- Remove the old `view-graphs` init path from `setActiveView()`

#### Step 2.6 — Build the yaml-driven Settings form (right panel)
- `renderSettingsForm(yamlData)` — dynamically generates a form from the parsed yaml structure
- Walks the yaml tree recursively:
  - **Section headers** (`Agent`, `Shortcuts`, `UI`, `Nodes`) → collapsible `<details>` groups
  - **Nested sections** (`UI.Header`, `UI.tree.canvas`, etc.) → nested `<details>` inside parent
  - **String values** → `<input type="text">`
  - **Number values** (or `# number from min to max` hint) → `<input type="number">`
  - **Boolean values** → toggle switch / checkbox
  - **Color values** (oklch strings) → `<input type="text">` with color preview swatch
  - **List values** (e.g., `expand: [0,0,0,0,...]`) → editable list UI
  - **Null / empty values** (placeholders like `Text_size:`) → `<input type="number">` with placeholder "auto"
  - **Comments** (preserved in yaml) → shown as hint text below fields
- Each field change triggers a debounced `POST /api/settings-yaml` with the updated value path and new value
- On successful save, update local cache (no full re-fetch needed)
- Categories list under `Nodes.Categories` → rendered as a reorderable list with color pickers
- Sockets under `Nodes.Sockets` → rendered as a sub-form per socket type

#### Step 2.7 — Settings form CSS
- Clean form styling consistent with the app's design tokens (from `DESIGN.md`)
- Collapsible sections with smooth transitions
- Input styling matching existing form elements in the app
- Color swatches for oklch values
- Mono font for technical values, regular font for labels

---

### Phase 3 — Navigation cleanup

#### Step 3.1 — Update nav tabs
Change from 5 tabs to 3:

```
[⊞ Tree]  [▢ Explore]  [⚙ Settings]
```

- Remove `Runs` and `Graphs` tab buttons from `nav.view-tabs`
- The `Settings` tab now triggers the merged view
- Update `setActiveView("settings")` to call `initSettingsView()` which calls all three: `refreshRunsList()`, `renderGraphsPage()`, `renderSettingsForm()`

#### Step 3.2 — Update URL routing
- Remove `/runs` and `/graphs` from the valid SPA paths in `server.py`
- `/settings` serves the merged page
- Update `initialViewFromPath()` in JS to handle old `/runs` or `/graphs` URLs → redirect to `/settings`
- Update `popstate` handler

#### Step 3.3 — Clean up old HTML/CSS
- Remove the old `view-runs` and `view-graphs` `<div>` blocks from `node-editor.html`
- Remove any runs-specific or graphs-specific CSS that's now redundant
- Remove the old `shortcut-settings-page` content (shortcuts move into the yaml-driven form under `settings.Shortcuts`)

---

### Phase 4 — Polish & edge cases

#### Step 4.1 — Startup validation
- If `settings.yaml` doesn't exist or is malformed, create it from a default template
- Log a warning but don't crash

#### Step 4.2 — Real-time sync
- When the user edits a setting in the UI, the POST writes to yaml immediately (debounced 300ms)
- If the yaml is edited externally (e.g., in a text editor), the next GET re-reads from disk
- No file-watching needed — just always read from disk on GET, cache is just for startup

#### Step 4.3 — Settings that affect live UI
- Some settings (like `UI.Header.title`, `UI.Header.menu`, colors) should take effect immediately in the running app
- After a successful settings save, emit a JS event (`settingsChanged`) that other components can listen to
- Header component listens and updates title/menu mode
- Canvas component listens and updates cell_size/thickness/opacity
- Node rendering listens and updates category colors

#### Step 4.4 — Keyboard shortcuts migration
- Current shortcuts are stored in `web-state.json`
- The `Shortcuts` section in `settings.yaml` should become the new home
- Migrate shortcut definitions to yaml, keep runtime rebinding in web-state for user overrides
- Or: shortcuts are fully in yaml, no more web-state for shortcuts

---

## File Change Summary

| File | Action |
|---|---|
| `src/rundeer/core/paths.py` | Add `settings_yaml_path()` |
| `web/config/settings_manager.py` | **New** — yaml read/write/merge module |
| `web/server.py` | Replace `/api/settings` routes, add yaml endpoints, update SPA paths |
| `web/static/node-editor.html` | Merge 3 views into 1, update nav tabs |
| `web/static/node-editor.js` | Add `setupSettingsResizers()`, `renderSettingsForm()`, `initSettingsView()`, update `setActiveView()` |
| `web/static/css/settings.css` | **New** — 3-panel grid layout, resizers, form styling |
| `web/static/css/explorer.css` | No changes (reference only) |
| `web/config/settings.yaml` | Becomes actively read/written |

---

## Dependency Check

- `pyyaml` or `ruamel.yaml` must be available for round-trip yaml I/O with comment preservation
- Check current `requirements.txt` / `pyproject.toml` — `pyyaml` is likely already present since `web/node_defs.py` imports `yaml`

---

## Execution Order

```
1.1 → 1.2 → 1.3 → 1.4  (backend, sequential)
2.1 → 2.2              (HTML + CSS, parallel with backend)
     ↓
2.3 → 2.4 → 2.5       (JS resizers + panel migration)
     ↓
2.6 → 2.7              (settings form + styling)
     ↓
3.1 → 3.2 → 3.3       (nav cleanup)
     ↓
4.1 → 4.2 → 4.3 → 4.4 (polish)
```

Phases 1 and 2.1–2.2 can be done in parallel. Everything else is sequential.
