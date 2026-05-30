# Phase 1 — Export Node

## Goal

Add a single, modular `export` node (category **Operations**) that writes any upstream value to a real file under `.rundeer/data/outputs/`. It accepts a data input plus a name+extension input, auto-detects the data type (text/number → text file; image/video → media file), and is bundle-aware: a bundle of images/videos is exported as separate files, while an image bundle with `fps > 0` is assembled into a single `mp4` or `gif` (user toggle). The node is a run sink (`terminal` trait) so it executes during a graph run and also emits the written `filepath`(s) downstream.

## Scope

In scope:
- One new 3-file node: `web/nodes/operations/export.yaml` + `export.js` + `export.py`.
- Text-based export (number/boolean/string/any non-path → text). User-chosen extension; documented/tested: `.txt`, `.md`, `.json`.
- Image export to `.png`, `.jpg`/`.jpeg`, `.webp`, `.gif` (re-encode via Pillow).
- Video export to `.mp4` only.
- Bundle export: each item written separately when `fps == 0`.
- Image-bundle → single `.mp4` or `.gif` at `fps > 0`, toggled by a select socket, plus optional `crf` (mp4) and `loop` (gif) settings sockets.
- Output socket of type `filepath` (single path, or array for separate-file bundles).
- One backend route `/api/export` registered in `web/server.py`.

Out of scope:
- Non-mp4 video containers (mov/webm/etc.) — **mp4 only** for video output even though the user types the name+ext.
- Video-bundle → single-clip assembly (fps/toggle apply to **image** bundles only; video bundles always export separately).
- Any new socket category (Operations already exists in `settings.yaml`).
- Live migration of old graphs, fallbacks, or legacy shims.

## Background (current state)

- The export node **does not exist**. `web/nodes/operations/` contains `blur`, `compress-image`, `crop-media`, `resize-media`, `math-op`, `random`, `text-join`, `text-op` only (verified via `list_dir`). No `export.*` files anywhere (`grep export` hits only `node-editor.js`, `server.py`, `node_defs.py`, `graph_mutate.py`, unrelated).
- Operations category is already registered: `web/config/settings.yaml:33` → `Operations: oklch(55% 0.2 140)`. **No settings change needed.**
- Node architecture and the 3-file pattern are documented in `NODES.md` (YAML schema, JS `window.RundeerNodes` registration, PY handler with `safe_project_path`/`relpath`/`rpaths`, route registration).
- Socket types incl. `filepath`, `image-bundle`, `video-bundle` are defined in `web/static/node-editor.js:4-19`; `baseType()` maps `image-bundle→image`, `video-bundle→video` (`node-editor.js:21-25`).
- Trait wiring: `producesBundle→BUNDLE_TYPES`, `terminal→TERMINAL_TYPES`, `preview→PREVIEW_TYPES` at `node-editor.js:9494-9502`.
- Run sinks: `node-editor.js:6212-6223` selects terminals = command nodes, `TERMINAL_TYPES`, and preview nodes with incoming edges. A node with the `terminal` trait runs even with no downstream → required so export fires.
- Backend handler pattern (sibling, verified):
  - `web/nodes/operations/blur.py:13-34` — type dispatch by extension, `safe_project_path`, `rpaths.cache_dir`, returns `{"path": relpath(...), "bytes": ...}`; `_blur_video` shells `ffmpeg` (`blur.py:76-108`).
  - `web/nodes/operations/compress.py:130-166` `_compress_bundle` iterates a `paths` list, dedupes names, returns `{"path", "items"}`.
  - `web/nodes/bundle/folder_bundle.py:101-184` `extract_frames` is the canonical **ffmpeg image-sequence** example (writes `frame_%06d.<fmt>`, cache dir, manifest) — the reverse of what we encode.
  - `src/rundeer/core/media.py` uses `ffmpeg` throughout (`resize_media`, `crop_media`, `make_video_grid`) and exposes `has_ffmpeg()` (`media.py:138-139`).
- Path helpers (`src/rundeer/core/paths.py`): `default_output_dir(root)` → `.rundeer/data/outputs` (`paths.py:66-67`); `cache_dir(root, *parts)` → `.rundeer/data/cache/...` (`paths.py:70-71`); `atomic_wb(dest, bytes)` (`paths.py:98`); `atomic_pil(img, dest, **kw)` (`paths.py:117`). **Exports go to `default_output_dir` (user deliverables), staging for sequence encode goes to `cache_dir`.**
- `web/nodes/_shared/helpers.py`: `safe_project_path(root, rel)` (`:31`), `relpath(root, path)` (`:15`), `IMAGE_EXTS`/`VIDEO_EXTS` (`:9-10`), `IMAGE_COMPRESS_EXTS`/`VIDEO_COMPRESS_EXTS` (`:11-12`).
- Frontend type/bundle detection pattern (verified): `web/nodes/operations/compress-image.js:7-12,31-37` reads `activeIncomingEdges` + `outputSocketDef` + `baseType`, plus a `looksLikePath` regex; `isInputVisible`/`onEdgeChange` hooks at `:70-131`. Bundle-loop pattern in `blur.js:20-31` and `resize-media.js:22-32`.
- Route registration: operations handlers are **top-level imports** at `web/server.py:32-36` and dispatched as `elif parsed.path == "/api/...":` at `web/server.py:312-323`. `filepath` socket type confirmed at `node-editor.js:11`.

## Affected / New Files

| File | New/Modified | Purpose |
|---|---|---|
| `web/nodes/operations/export.yaml` | New | Node definition: `in` (data), `name`, `fps`, `fmt`, `crf`, `loop`; `out` filepath; traits; `src`; `api`. |
| `web/nodes/operations/export.js` | New | `resolve` (type/bundle detection → mode routing → backend call → write `outputs.out`) + `isInputVisible` (image-bundle-only sockets). |
| `web/nodes/operations/export.py` | New | Backend handler `export_node(root, payload)`: text/file/files/sequence modes; Pillow + ffmpeg encode; writes to outputs dir; returns `{path}` / `{paths,count}`. |
| `web/server.py` | Modified | Top-level `from web.nodes.operations.export import export_node` (near `:32-36`) + `elif parsed.path == "/api/export": self._send_json(export_node(self.server.project_root, payload))` (near `:323`). |
| `web/config/settings.yaml` | **No change** | Operations category already present (`:33`). Noted to prevent accidental edits. |

Reminder: **no `__init__.py` change** — `web/nodes/operations/__init__.py` already exists.

## Node Definition (YAML)

Slug `export`. All inputs in one `in[]`. fps/fmt/crf/loop live in a `media` group and are revealed only for image bundles via `isInputVisible`.

```yaml
export:
  label: Export
  category: Operations
  desc: Export any value to a file. Text/number → .txt/.md/.json; images → png/jpg/webp/gif; video → mp4. Bundles export separately; image bundles with fps>0 become mp4/gif.
  defaultWidth: 280
  in:
  - id: in
    label: Data
    type: any
  - id: name
    label: Name (with extension)
    kind: text
    default: export.png
    placeholder: name.ext (e.g. clip.mp4, notes.md)
    passthroughWired: true
    type: text
  - id: fps
    label: FPS (image bundle, 0 = separate files)
    kind: number
    default: 0
    group: media
  - id: fmt
    label: Bundle Format
    kind: select
    options: [mp4, gif]
    default: mp4
    group: media
    type: text
  - id: crf
    label: MP4 Quality (CRF, lower = better)
    kind: range
    min: 0
    max: 51
    step: 1
    default: 18
    group: media
  - id: loop
    label: GIF Loops (0 = infinite)
    kind: number
    default: 0
    group: media
  out:
  - id: out
    label: File
    type: filepath
  traits: [terminal, heavy]
  src: web/nodes/operations/export.js
  api: /api/export
```

Notes per socket:
- `in` — pure socket, `type: any` (accepts number/text/image/video/bundles). Number/boolean coerce to text downstream.
- `name` — text widget, `passthroughWired: true` so a wired text node hides the field; extension parsed from this string.
- `fps` — number widget; `> 0` triggers image-bundle assembly.
- `fmt` — select `mp4`/`gif`; selects the assembled container for image bundles.
- `crf` — range, mp4 quality for assembly (and single-video transcode when needed).
- `loop` — number, gif loop count.
- `out` — `filepath`; value is a single rel path, or an array of rel paths for separate-file bundles.
- traits: `terminal` (run sink so it executes), `heavy` (ffmpeg/encode is long-running, shows indicator).

## Frontend resolve (JS)

`web/nodes/operations/export.js` registers `window.RundeerNodes["export"]` with `resolve` + `isInputVisible`. Short names, **no comments**.

Shape (pseudocode, not final code):

```
const VID = new Set([".mp4",".mov",".mkv",".webm",".avi",".m4v"]);
const extOf = (p) => (String(p).match(/(\.[a-z0-9]+)$/i)?.[1]||"").toLowerCase();

function _imgBundleUp(nodeId, ctx) {
  const e = ctx.activeIncomingEdges(nodeId, "in")[0];
  if (!e) return false;
  const t = ctx.outputSocketDef(e.fromNode, e.fromSocket)?.type || "any";
  return t === "image-bundle" ||
         (ctx.outputProducesBundle(e.fromNode, e.fromSocket) && ctx.baseType(t) === "image");
}

resolve(node, inputs, outputs, props, helpers):
  name = String(inputs.name ?? props.name ?? "").trim()
  if (!name) throw Error("export: name (with extension) required")
  fps = Math.max(0, Number(props.fps ?? 0))
  fmt = String(props.fmt || "mp4")
  crf = Number(props.crf ?? 18)
  loop = Number(props.loop ?? 0)

  v = inputs.in
  edge = helpers.activeIncomingEdges(helpers.nodeId, "in")[0]
  upT = edge ? helpers.baseType(helpers.outputSocketDef(edge.fromNode, edge.fromSocket)?.type || "any") : "any"

  if (Array.isArray(v)) {
    items = v.filter(x => x != null && x !== "").map(String)
    if (!items.length) { outputs.out = ""; return }
    itemType = (upT === "video" || VID.has(extOf(items[0]))) ? "video" : "image"
    if (itemType === "image" && fps > 0) {
      r = await helpers.graphFetchJSON("/api/export",
        { method:"POST", body: JSON.stringify({ mode:"sequence", paths:items, name, fps, fmt, crf, loop }) }, helpers.opts)
      if (r.error) throw Error("export: "+r.error)
      outputs.out = r.path
    } else {
      r = await helpers.graphFetchJSON("/api/export",
        { method:"POST", body: JSON.stringify({ mode:"files", paths:items, name, asType:itemType }) }, helpers.opts)
      if (r.error) throw Error("export: "+r.error)
      outputs.out = r.paths
    }
    return
  }

  str = v == null ? "" : String(v)
  looksPath = /\.[A-Za-z0-9]{1,6}$/.test(str) && !str.includes("\n") && str.length < 512
  isText = upT === "text" || upT === "number" || upT === "boolean" || (!looksPath && upT === "any")
  if (isText) {
    r = await POST /api/export { mode:"text", text:str, name }
    outputs.out = r.path
  } else {
    media = (upT === "video" || VID.has(extOf(str))) ? "video" : "image"
    r = await POST /api/export { mode:"file", path:str, name, asType:media, crf }
    outputs.out = r.path
  }
```

Plus `appendRunLog` lines mirroring siblings (e.g. ``  ↳ Exporting … → ${r.path}\n``). Add `isInputVisible(node, sock, ctx)` returning `_imgBundleUp(node.id, ctx)` for `sock.id ∈ {fps, fmt, crf, loop}`, else `true` (keeps the node compact unless an image bundle is wired). No `onEdgeChange`/helper-node creation needed.

## Backend handler (PY)

`web/nodes/operations/export.py`. **No docstrings, no comments.** Imports:

```
from pathlib import Path
from typing import Any, Dict, List
import shutil, subprocess
from PIL import Image
from rundeer.core import paths as rpaths
from rundeer.core.paths import atomic_wb, atomic_pil
from web.nodes._shared.helpers import IMAGE_EXTS, VIDEO_EXTS, relpath, safe_project_path
```

Signature & dispatch:

```
def export_node(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    mode = str(payload.get("mode") or "").strip().lower()
    if mode == "text":     return _exp_text(root, payload)
    if mode == "file":     return _exp_file(root, payload)
    if mode == "files":    return _exp_files(root, payload)
    if mode == "sequence": return _exp_seq(root, payload)
    raise ValueError(f"unknown export mode: {mode or '(none)'}")
```

Destination helper (writes only under outputs, traversal-safe):

```
def _dest(root, name) -> Path:
    rel = str(name or "").strip()
    if not rel: raise ValueError("name is required")
    out = safe_project_path(root, rpaths.default_output_dir(root).joinpath(rel).as_posix())
    out.parent.mkdir(parents=True, exist_ok=True)
    return out
```

Per-mode logic:

- **text** — `txt = str(payload.get("text") or "")`; `dest = _dest(root, name)`; if no suffix, append `.txt`; `atomic_wb(dest, txt.encode("utf-8"))`. Any text extension allowed; `.txt`/`.md`/`.json` are the documented set. Return `{"path": relpath(root, dest), "bytes": dest.stat().st_size}`.

- **file** (single media) — `src = safe_project_path(root, payload["path"])`; must exist. `asType = payload.get("asType")`. `ext = dest.suffix.lower()`.
  - image: validate `ext in {.png,.jpg,.jpeg,.webp,.gif}` else `ValueError`; open with Pillow, convert mode as needed (RGBA→RGB for jpg), `atomic_pil` with format `JPEG/PNG/WEBP/GIF` (reuse the save-kwargs shape from `compress.py:46-57`).
  - video: enforce **mp4**: if `ext != ".mp4"` → `ValueError("video export supports .mp4 only")`. If `src.suffix.lower() == ".mp4"` → copy bytes via `atomic_wb`/`shutil.copyfile`; else ffmpeg transcode to mp4 (`libx264 -pix_fmt yuv420p -crf {crf} -movflags +faststart`, guard `has_ffmpeg`). Return `{"path", "bytes"}`.

- **files** (bundle, separate) — `paths = payload["paths"]` (non-empty list). Derive `stem`/`ext` from `name`; for each item index `i`, build `f"{stem}_{i:03d}{ext}"` and run the same single-file logic (`asType` applies to all). Skip empties; dedupe like `compress.py:152-158`. Return `{"paths": [...], "count": n}`.

- **sequence** (image bundle → mp4/gif at fps) — require ffmpeg (`if shutil.which("ffmpeg") is None: return {"error": "ffmpeg not found on PATH; install ffmpeg to assemble bundles"}`). Stage frames into `rpaths.cache_dir(root, "export_stage", <key>)` as `f_%06d.png` (copy when already `.png`, else load+save via Pillow so dimensions/format are uniform — mirrors `extract_frames` in reverse, `folder_bundle.py:143-176`). `fps = float(payload["fps"])`; force `dest` extension to `.mp4` or `.gif` per `payload["fmt"]` (override whatever the user typed).
  - mp4: `ffmpeg -framerate {fps} -i f_%06d.png -c:v libx264 -pix_fmt yuv420p -crf {crf} -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -movflags +faststart dest.mp4`.
  - gif: single-pass palette `ffmpeg -framerate {fps} -i f_%06d.png -vf "split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop {loop} dest.gif`.
  - Run with `subprocess.run(cmd, capture_output=True, text=True, check=False)`; on `returncode != 0` return `{"error": f"ffmpeg failed: {stderr[:400]}"}` (matches `blur.py:101-102`). Clean staging dir after. Return `{"path", "bytes", "frames": n}`.

Response shapes (consumed by JS): single modes → `{"path": <rel>, "bytes": ...}`; `files` → `{"paths": [<rel>...], "count": n}`; errors → `{"error": "..."}` so `resolve` throws.

Route registration in `web/server.py` (top-level import to match siblings at `:32-36`, dispatch near `:323`):

```python
from web.nodes.operations.export import export_node
...
elif parsed.path == "/api/export":
    self._send_json(export_node(self.server.project_root, payload))
```

## Implementation Steps

1. Create `web/nodes/operations/export.yaml` exactly as in **Node Definition** (category `Operations`, `api: /api/export`, traits `[terminal, heavy]`).
2. Create `web/nodes/operations/export.py` with `export_node` + `_dest`/`_exp_text`/`_exp_file`/`_exp_files`/`_exp_seq` helpers; Pillow for images, ffmpeg for video/sequence; write to `rpaths.default_output_dir`, stage in `rpaths.cache_dir`. **No comments/docstrings.**
3. Create `web/nodes/operations/export.js` registering `window.RundeerNodes["export"]` with `resolve` + `isInputVisible` per **Frontend resolve**. **No comments.**
4. Edit `web/server.py`: add the top-level import near `:32-36` and the `/api/export` `elif` near `:323`.
5. Confirm `web/config/settings.yaml` already lists `Operations` — make **no** edit.
6. Run validation (next section).

## Breaking Changes / Data Impact

- Purely additive: new node type `export`, new route `/api/export`. No existing socket type, schema, or handler is modified, so **current graphs in `.rundeer/data/graphs/` keep loading**.
- New runtime artifacts are written under `.rundeer/data/outputs/` (exports) and `.rundeer/data/cache/export_stage/` (transient frame staging). Both are within `.rundeer/data/` via `paths.py` — compliant.
- **No fallbacks, no legacy preservation, no live migration.** ffmpeg is a hard requirement for video/sequence export; if absent the handler returns a clear `{"error": ...}` (the same convention as `blur.py`/`compress.py`) rather than silently degrading. Unsupported extensions raise `ValueError` instead of guessing. If any future change alters the node contract, old graphs that referenced it must be **warned about to the user**, not migrated.

## Validation

From repo root (per AGENTS.md "Useful Validation"):
- `python3 -m compileall -q src web rundeer.py __init__.py` — Python syntax incl. new `export.py` + edited `server.py`.
- `node --check web/nodes/operations/export.js` — JS syntax of the new resolver.
- `python3 rundeer.py web --help` — web command still imports cleanly (proves top-level handler import in `server.py` resolves).
- `python3 rundeer.py --help` — CLI smoke test.
- `rg --files -g '*.js' -g '*.mjs' | xargs -r -n 1 node --check` — full JS check when web static/node code changes.
- (Optional, only if user asks for runtime testing) start `python3 rundeer.py web`, build a throwaway graph, export each type, then **stop the server** (no dangling processes).

## Acceptance Checklist

- [ ] New node lives at `web/nodes/operations/` (3 files: `export.yaml`, `export.js`, `export.py`).
- [ ] Category is **Operations** (already registered in `settings.yaml`).
- [ ] Has a **data input** (`in`, type `any`) and a **name+extension input** (`name`, text, user picks the extension).
- [ ] Text/number/other text-based input exports to a text file with user-chosen extension; `.txt`, `.md`, `.json` supported.
- [ ] Image input exports to **png / jpg / webp / gif**.
- [ ] Video input exports to **mp4 only** (other video extensions rejected with a clear error).
- [ ] A bundle of images/videos is detected and each item is exported **separately** (when `fps == 0`).
- [ ] When an image bundle is provided, **two extra inputs** appear: `fps` and the **mp4/gif toggle** (`fmt`).
- [ ] `fps > 0` on an image bundle produces a **single mp4 or gif** (per the toggle) at that frame rate.
- [ ] Extra gif/mp4 settings sockets provided (`crf` for mp4, `loop` for gif).
- [ ] Output exposes the written file via a `filepath` socket (single path, or array for separate-file bundles).
- [ ] Exports written under `.rundeer/data/outputs/` via `src/rundeer/core/paths.py`; staging under `.rundeer/data/cache/`.
- [ ] Backend route `/api/export` registered in `web/server.py`.
- [ ] No code comments, no docstrings, no inline comments anywhere.
- [ ] No fallbacks, no legacy preservation, no live migration; missing ffmpeg / bad extension errors explicitly.
- [ ] Validation commands pass (compileall, node --check, web --help, --help).
