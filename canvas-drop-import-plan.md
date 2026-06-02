# Canvas Drop → Outputs → File Nodes — Implementation Plan

## Goal
When a file / image / video is dropped onto the node canvas editor surface (the grid + nodes area), Rundeer should:
1. Copy the dropped file into the project's `.rundeer/outputs/` directory.
2. Insert a **File primitive** node at the drop position whose `path` prop points to the copied file, so it previews inline immediately.

Dropping several files at once creates one File node per file.

## How it works today (relevant facts)
- The canvas (`wrap` / `#canvasWrap`) already has `dragover` + `drop` listeners at `web/static/node-editor.js:9570-9577`. The current `drop` only handles **internal palette drags** via the `rundeer/node-type` dataTransfer key and `return`s on anything else, so external file drops are ignored today.
- Nodes are created programmatically with `addNode(type, canvasX, canvasY, { props })` (`web/static/node-editor.js:588`). Passing `{ props: { path } }` pre-fills the node's `path`. `screenToCanvas(clientX, clientY)` (`:552`) maps cursor → canvas coordinates.
- The **File** node (`web/nodes/primitives/file.{js,yaml}`) is `path → out` with a `preview` trait. A File node with `props.path` set to a project-relative path previews automatically, because previews resolve through `artifactURL()` → `/api/file?path=` (`web/static/node-editor.js:3039`).
- Backend writers (e.g. `web/nodes/operations/export.py`) follow a uniform pattern: resolve a dest with `safe_project_path(root, …)` under `rpaths.default_output_dir(root)`, write atomically with `atomic_wb`, and return a **project-relative** path via `relpath(root, dest)`.
- `default_output_dir(root)` = `.rundeer/outputs` (`src/rundeer/core/paths.py:67`).
- HTTP: `do_POST` (`web/server.py:292`) currently always parses the body as JSON via `_read_json()` (capped at 20 MB). There is **no** upload endpoint yet.

## Design (recommended)
Isolated + modular, no fallbacks/legacy.

### Transport — raw-bytes POST, one request per file
`POST /api/canvas-drop?name=<basename>` with the file's **raw bytes** as the body.
- Avoids base64 inflation (~33%) and avoids multipart parsing in stdlib `http.server`.
- Handles binary (video) cleanly and supports a configurable size cap.
- One request per dropped file → simple per-file node creation and progress.

### Backend — new module `web/drop_ingest.py` (isolated, reusable)
Single entry point:
```
save_drop(root: Path, name: str, data: bytes) -> dict   # {"path": <rel>, "bytes": int}
```
- Sanitize `name` to a basename (`Path(name).name`); reject empty.
- Dest dir = `rpaths.default_output_dir(root)` (created if missing).
- Collision-safe: if `name.ext` exists, append `_1`, `_2`, … before the suffix.
- Resolve through `safe_project_path` (stays inside project), write via `atomic_wb`.
- Return `{ "path": relpath(root, dest), "bytes": size }`.

### Backend — wire route in `web/server.py`
- Import `from web.drop_ingest import save_drop`.
- In `do_POST`, **before** `_read_json()`, special-case `parsed.path == "/api/canvas-drop"`: read the `Content-Length` raw bytes from `self.rfile`, take `name` from the query string, call `save_drop`, and `_send_json` the result. Enforce a max-size cap (open Q2).

### Frontend — `web/static/node-editor.js`
- Extend the existing `drop` handler (`:9571`): when there is no `rundeer/node-type` but `e.dataTransfer.files?.length`, call a new isolated async helper `dropFilesToCanvas(files, pos)`.
- `dropFilesToCanvas(files, pos)`:
  - For each file: `fetch("/api/canvas-drop?name=…", { method:"POST", body:file })`; on success `addNode("file", x, y, { props: { path } })` at a **staggered** offset (~36 px cascade) so multiple nodes don't fully overlap; collect ids and select them.
  - `scheduleAutosave()` once at the end.
- Optional polish: toggle an `is-dropping` class on `#canvasWrap` during `dragenter`/`dragleave` for a drop affordance (CSS in `web/static/css/nodes/canvas.css`).

## Files touched
| File | Change |
|---|---|
| `web/drop_ingest.py` | **new** — `save_drop()` copy-into-outputs helper |
| `web/server.py` | import + `/api/canvas-drop` raw-bytes route in `do_POST` |
| `web/static/node-editor.js` | external-file branch in `drop` + `dropFilesToCanvas()` helper |
| `web/static/css/nodes/canvas.css` | *(optional)* drop-target affordance |

## Validation
- `python3 -m compileall -q src web rundeer.py __init__.py`
- `node --check web/static/node-editor.js`
- `python3 rundeer.py web --help`
- *(Manual, only if you ask for testing)* drop a png / mp4 / arbitrary file → confirm the copy into `.rundeer/outputs/` and that the File node previews.

## Decisions (locked)
1. **Accepted types** — any file type.
2. **Max upload size** — no cap.
3. **Collisions in `.rundeer/outputs/`** — dedupe with `_1/_2` suffix.
4. **Destination layout** — flat in `.rundeer/outputs/`.
5. **Multi-file layout** — arrange created nodes in a **grid** (avoids the huge vertical scroll a cascade would cause); mixed types are fine.

## Grid layout detail
File node default size is 320×260 (`web/nodes/primitives/file.yaml`). For N dropped files, place nodes on a grid anchored at the drop point:
- columns `cols = ceil(sqrt(N))`; step ~`360` px horizontal, ~`300` px vertical.
- node `i` → `col = i % cols`, `row = floor(i / cols)`; `x = dropX + col*360`, `y = dropY + row*300`.
- Files resolve over the network in parallel, so capture each file's grid slot **before** awaiting to keep placement deterministic regardless of completion order.

## No-cap transport note
Because there is no size limit, the raw-bytes route streams the request body to disk in chunks using `Content-Length` (no full in-memory read, no 20 MB JSON cap).
