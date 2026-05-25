# Web Errors — Diagnosis & Fix Plan

Three browser console errors observed at startup / during Mix node execution:

```
Failed to load resource: the server responded with a status of 404 (Not Found)
api/web-state:1  Failed to load resource: net::ERR_CONTENT_LENGTH_MISMATCH
api/uv/mix:1  Failed to load resource: the server responded with a status of 500 (Internal Server Error)
```

---

## Error 1 — 404 (Not Found)

### What is happening

The first 404 in the console does not specify which URL failed (no path prefix shown). The most likely candidates are:

1. **A stale `src` reference in a YAML node config.** The `NODE_CONSOLIDATION_PLAN.md` describes a migration that moves JS files from `web/static/nodes/{cat}/{node}.js` to `web/nodes/{cat}/{node}.js`, with the `src` field in each YAML updated accordingly. If any YAML's `src` field still references the old `web/static/nodes/…` path after the move (or if the move never happened and the `src` was pre-emptively updated), the `/api/node-defs` loader will resolve a URL that maps to a non-existent file on disk → 404.

2. **The `sendWebStoreKeepalive` call racing with the initial `loadWebStore`.** On `beforeunload` the app fires a `POST /api/web-state` using `fetch({ keepalive: true })`. If the page reloads quickly, the keepalive request can arrive before the server has accepted it, or the navigation kills the connection mid-flight — the browser may log a generic 404 / network error for that orphaned request.

3. **A reference to a static asset (CSS, font, favicon, or image) that does not exist on disk.** This is less likely to be related to the migration, but still possible.

### How to confirm

- Open DevTools → Network → check which URL returned 404.
- Run: `grep -r '"src":' web/config/nodes/ | grep -v '#'` and verify every `src` path maps to an existing file under `web/`.
- Check `web/static/` for any referenced assets that are missing.

### Fix

| If the cause is… | Fix |
|---|---|
| Stale `src` in a YAML node | Update the YAML `src` field to match the actual JS file location. |
| Missing static asset | Restore or create the file, or remove the reference. |
| Keepalive race | Benign — suppress by wrapping the `fetch` in a `try/catch` (already done in `sendWebStoreKeepalive`). No action needed. |

---

## Error 2 — `ERR_CONTENT_LENGTH_MISMATCH` on `api/web-state`

### What is happening

The server reads `.rundeer/data/web-state.json` (currently ~200 KB), wraps it as `{"state": <data>}`, serializes with `json.dumps(data, indent=2)`, encodes to UTF-8, sets `Content-Length` to the byte count, and writes to the socket. The browser reports `ERR_CONTENT_LENGTH_MISMATCH` — meaning the number of bytes received does **not** equal the `Content-Length` header value.

Root cause analysis — two scenarios, either or both active:

1. **Concurrent write during read.** The server uses `ThreadingHTTPServer`, so GET and POST handlers run on separate threads. A `POST /api/web-state` (e.g. from `sendWebStoreKeepalive` at page close or from the auto-save debounce timer) writes a new `web-state.json` while a simultaneous `GET /api/web-state` reads the old file. There is **no lock** protecting the read/write pair on the file. `_write_json_file` does atomic-rename (write to `.tmp` then `rename`), which protects against corrupt partial reads, but the `_read_json_file` → `json.dumps` → `wfile.write` pipeline has a second problem:

2. **`_send_json` writes to a connection that the client has already closed.** When the browser navigates away or aborts the fetch, `wfile.write(raw)` raises `BrokenPipeError` / `ConnectionResetError`. If the server wrote the headers (including `Content-Length`) before the client disconnected but only partially wrote the body, the browser sees a short body → `ERR_CONTENT_LENGTH_MISMATCH`.

   Python's `ThreadingHTTPServer` + `BaseHTTPRequestHandler` does not buffer the full response before sending — `send_header` writes directly to the socket. So headers go out, then body starts; if the body write is interrupted, the mismatch is inevitable.

3. **Large payload inflation.** The `indent=2` pretty-printing roughly 2×–3× inflates the raw JSON. For a 200 KB JSON file, the HTTP response body can exceed 400 KB. Slow or congested connections (especially WebSocket + HTTP sharing the same host) can time out or abort mid-stream.

### Fix

| Step | Change |
|---|---|
| 1 | Add a per-request read/write lock around `web-state.json` access (both `load_web_state` and `save_web_state`). A module-level `threading.Lock` is sufficient — `web-state.json` is the only file affected. |
| 2 | Wrap `self.wfile.write(raw)` in `_send_json` (and `_send_file`) in a `try/except (BrokenPipeError, ConnectionResetError)` to silently swallow partial-write exceptions on closed connections. This is safe — the client is already gone. |
| 3 | Drop `indent=2` in `_send_json` (use `separators=(",",":")` for compact JSON) to halve the payload size and reduce the write window for disconnection. The indentation is never seen by humans — only JS parses it. |
| 4 | In `sendWebStoreKeepalive` on the JS side, switch from `fetch({ keepalive: true })` to `navigator.sendBeacon` which is designed for fire-and-forget unload payloads and does not produce console errors on abort. If Beacon cannot carry JSON, leave the current fetch but accept that the console error is benign. |

### Files to touch

- `web/server.py` — `_send_json`, `load_web_state`, `save_web_state`
- `web/static/node-editor.js` — `sendWebStoreKeepalive`

---

## Error 3 — 500 on `/api/uv/mix`

### What is happening

The server route at line 307 of `web/server.py`:

```python
elif parsed.path == "/api/uv/mix":
    from .uv_api import mix as _uv_mix
    self._send_json(_uv_mix(self.server.project_root, payload))
```

calls `web/uv_api.py:mix()`, which calls `rundeer.core.uv_ops.mix()`. The generic exception handler catches any raised exception and returns `{"error": "<message>"}` as a 500 response.

Likely failure modes:

1. **Color string input not handled by `_resolve_input`.** The `mix.js` resolver only calls the API when at least one input `isPath` (i.e. it came from an upstream node as a file path). But the other inputs may still be **hex color strings** like `"#ff0000"`. The `_resolve_input` function in `uv_api.py` treats a bare string as a file path and calls `uv_ops.load_map(_safe_path(root, value))` — a hex color string like `"#ff0000"` is not a valid file path → `FileNotFoundError` or `OSError` → 500.

   The `mix.js` payload construction uses `helpers._coerceMixInput(…).payload`:
   - If the input is a path string → `{ path: "…" }`
   - If the input is a scalar number → `{ scalar: N }`
   - If the input is a color array → `{ color: [r,g,b,a] }`

   So the payload should already be a dict, not a bare string. **However**, if `_coerceMixInput` returns an unexpected shape (e.g. the raw hex string itself), `_resolve_input` in Python will try to open it as a file.

2. **Numpy type serialization.** The `mix()` function in `uv_api.py` returns `{"color": list(result)}` when the result is a flat list. But `list(result)` on a numpy array produces numpy scalar objects (`np.float32`), which are not JSON-serializable by default. The `_send_json` method uses `json.dumps(data, default=str)` which would convert them to strings like `"0.5"` — this won't crash, but the JS side would then receive strings instead of numbers, which could cause downstream issues.

3. **Missing numpy dependency.** If `numpy` is not installed or there's an import error in `uv_ops`, the `from .uv_api import mix` would fail → `ImportError` → 500. Less likely since other uv endpoints exist.

4. **The payload's `a`/`b` values arriving as the raw prop hex strings** when the JS-side scalar-only short-circuit (`!factor.isPath && !a.isPath && !b.isPath`) incorrectly falls through. If one input is wired from an upstream node but the upstream value hasn't resolved yet (returns `undefined` or empty string), `_coerceMixInput` may set `isPath = false` for all three, causing the JS-side blend to run with invalid values, OR it may incorrectly set `isPath = true`, sending a bare hex string as the payload.

### How to confirm

- Add a temporary `print(f"mix payload: {payload}")` in the `mix` route in `server.py` and trigger the Mix node.
- Check the exact traceback in the server console — the 500 handler prints `str(exc)` but the actual traceback is swallowed. Add `import traceback; traceback.print_exc()` temporarily.

### Fix

| Step | Change |
|---|---|
| 1 | In `web/uv_api.py:_resolve_input`, add a guard for bare color strings: if `isinstance(value, str)` and `value.startswith("#")`, parse it as a hex color `[r, g, b, a]` instead of treating it as a file path. |
| 2 | In `web/uv_api.py:mix`, ensure the `list(result)` return converts numpy scalars to native Python floats: `[float(x) for x in result]` instead of `list(result)`. |
| 3 | Add `traceback.print_exc()` to the server's generic `except Exception` handler so future 500s are diagnosable from the terminal. |
| 4 | In `web/static/nodes/vector/mix.js`, verify the `_coerceMixInput` helper handles all edge cases — upstream `undefined`/empty values, raw hex strings, scalar numbers, and path dictionaries. |

### Files to touch

- `web/uv_api.py` — `_resolve_input`, `mix`
- `web/server.py` — exception handler in `do_POST`
- `web/static/nodes/vector/mix.js` — audit `_coerceMixInput` usage

---

## Execution Order

| # | Task | Priority |
|---|---|---|
| 1 | Add traceback logging to server 500 handler | High — enables diagnosing all future errors |
| 2 | Fix `_resolve_input` hex-color guard in `uv_api.py` | High — direct cause of the 500 |
| 3 | Fix numpy scalar serialization in `uv_api.py:mix` return | Medium — prevents subtle downstream bugs |
| 4 | Add threading lock for `web-state.json` read/write | High — prevents content-length mismatch |
| 5 | Wrap `wfile.write` in `_send_json` with broken-pipe guard | Medium — prevents noisy console errors |
| 6 | Drop `indent=2` from `_send_json` | Low — reduces payload size |
| 7 | Audit YAML `src` fields against actual file paths | Medium — resolves or rules out the 404 |
| 8 | Audit `_coerceMixInput` in `mix.js` | Medium — defensive JS-side fix |
