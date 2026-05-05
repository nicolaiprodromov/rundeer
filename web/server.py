"""Stdlib web server for the rundeer local console."""
from __future__ import annotations

import ast
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse

from rundeer import __version__
from rundeer.core.config import brain_dir, normalize_config, normalize_rate_limits, normalize_web_settings
from rundeer.scaffold.bootstrap import ensure_rundeer_dir
from rundeer.web.animator import log_line, run_console


STATIC_DIR = Path(__file__).resolve().parent / "static"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
TEXT_EXTS = {".md", ".txt", ".json", ".py", ".csv", ".log"}
ARTIFACT_EXTS = IMAGE_EXTS | VIDEO_EXTS | {".json", ".csv"}
SKIP_DIRS = {
    ".crush",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".vscode",
    "__pycache__",
    "node_modules",
    "target",
}
ALLOWED_DOTFILE_ROOTS = {".rundeer"}
COMMANDS = {"image", "video", "edit", "extend", "merge", "batch", "benchmark"}

LOGO_DIR = Path(__file__).resolve().parent.parent / "cli" / "assets"
LOGO_FILES = ("logo_frame1.txt", "logo.txt", "logo_frame2.txt")
_logo_cache: Optional[List[str]] = None


def load_logo_frames() -> List[str]:
    global _logo_cache
    if _logo_cache is not None:
        return _logo_cache
    frames: List[str] = []
    for name in LOGO_FILES:
        path = LOGO_DIR / name
        if path.exists():
            frames.append(path.read_text(encoding="utf-8"))
    _logo_cache = frames or [" rundeer "]
    return _logo_cache


def serve(
    *,
    host: str = "127.0.0.1",
    port: int = 8787,
    project_root: Optional[Path] = None,
    open_browser: bool = False,
) -> int:
    root = (project_root or Path.cwd()).resolve()
    ensure_rundeer_dir(root)
    httpd = RundeerWebServer((host, port), RundeerWebHandler, project_root=root)
    actual_port = httpd.server_address[1]
    shown_host = "localhost" if host in {"127.0.0.1", "0.0.0.0"} else host
    url = f"http://{shown_host}:{actual_port}"

    server_thread = threading.Thread(target=httpd.serve_forever, name="rundeer-web", daemon=True)
    server_thread.start()
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        run_console(url=url, project_root=root, server=httpd)
    finally:
        httpd.shutdown()
        httpd.server_close()
        server_thread.join(timeout=2)
    return 0


class RundeerWebServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, server_address: Tuple[str, int], handler, *, project_root: Path):
        super().__init__(server_address, handler)
        self.project_root = project_root.resolve()
        self.runs: Dict[str, Dict[str, Any]] = {}
        self.runs_lock = threading.Lock()
        self.request_count = 0
        self.last_request: Optional[str] = None
        self.started_at = time.time()

    def record_request(self, method: str, path: str) -> None:
        with self.runs_lock:
            self.request_count += 1
            self.last_request = f"{method} {path}"
        # Skip the chatty static + polling endpoints so the console stays readable.
        if path.startswith(("/static/", "/api/logo", "/api/state")):
            return
        if method == "GET" and path.startswith("/api/runs/"):
            return
        log_line(f"{method} {path}", dim=True)


class RundeerWebHandler(BaseHTTPRequestHandler):
    server: RundeerWebServer

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def log_error(self, fmt: str, *args: Any) -> None:
        return

    def log_request(self, code: Any = "-", size: Any = "-") -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        self.server.record_request("GET", path)
        try:
            if path in {"/", "/index.html"}:
                self._send_static(STATIC_DIR / "index.html")
            elif path.startswith("/static/"):
                self._send_static(safe_static_path(path.removeprefix("/static/")))
            elif path == "/api/state":
                self._send_json(build_state(self.server.project_root))
            elif path == "/api/settings":
                self._send_json(load_settings(self.server.project_root))
            elif path == "/api/artifacts":
                self._send_json({"artifacts": list_artifacts(self.server.project_root)})
            elif path == "/api/files":
                self._send_json({"files": list_files(self.server.project_root, query)})
            elif path == "/api/tree":
                rel = (query.get("path") or [""])[0]
                self._send_json({"tree": build_file_tree(self.server.project_root, rel)})
            elif path == "/api/references":
                style = (query.get("style") or [""])[0]
                self._send_json({"references": list_style_references(self.server.project_root, style)})
            elif path == "/api/mentions":
                q = (query.get("q") or [""])[0]
                self._send_json({"items": collect_mentions(self.server.project_root, q)})
            elif path == "/api/artifact-meta":
                rel = (query.get("path") or [""])[0]
                self._send_json(artifact_meta(self.server.project_root, rel))
            elif path.startswith("/api/runs/"):
                self._send_json(get_run(self.server, path.rsplit("/", 1)[-1]))
            elif path == "/api/file":
                rel = (query.get("path") or [""])[0]
                self._send_project_file(rel)
            elif path == "/api/logo":
                self._send_json({"frames": load_logo_frames()})
            else:
                self._send_error(HTTPStatus.NOT_FOUND, "not found")
        except PermissionError as exc:
            self._send_error(HTTPStatus.FORBIDDEN, str(exc))
        except FileNotFoundError as exc:
            self._send_error(HTTPStatus.NOT_FOUND, str(exc))
        except Exception as exc:  # noqa: BLE001
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        self.server.record_request("POST", parsed.path)
        try:
            payload = self._read_json()
            if parsed.path == "/api/plan":
                self._send_json(run_plan(self.server.project_root, payload))
            elif parsed.path == "/api/run":
                self._send_json(start_run(self.server, payload))
            elif parsed.path == "/api/settings":
                self._send_json(save_settings(self.server.project_root, payload))
            else:
                self._send_error(HTTPStatus.NOT_FOUND, "not found")
        except ValueError as exc:
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:  # noqa: BLE001
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def _read_json(self) -> Dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0") or "0")
        if size <= 0:
            return {}
        return json.loads(self.rfile.read(min(size, 2_000_000)).decode("utf-8"))

    def _send_json(self, data: Dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(data, indent=2, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_error(self, status: HTTPStatus, message: str) -> None:
        self._send_json({"error": message}, int(status))

    def _send_static(self, path: Path) -> None:
        if not path.is_file():
            raise FileNotFoundError(path)
        self._send_file(path, cache=False)

    def _send_project_file(self, rel: str) -> None:
        path = safe_project_path(self.server.project_root, rel)
        if not path.is_file():
            raise FileNotFoundError(rel)
        self._send_file(path, cache=False)

    def _send_file(self, path: Path, *, cache: bool) -> None:
        data = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=3600" if cache else "no-store")
        self.end_headers()
        self.wfile.write(data)


def safe_static_path(rel: str) -> Path:
    path = (STATIC_DIR / unquote(rel).lstrip("/")).resolve()
    static_root = STATIC_DIR.resolve()
    if path != static_root and static_root not in path.parents:
        raise PermissionError("static path escapes web root")
    return path


def safe_project_path(root: Path, rel: str) -> Path:
    raw = unquote(rel or "")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = root / raw
    path = candidate.resolve()
    resolved_root = root.resolve()
    if path != resolved_root and resolved_root not in path.parents:
        raise PermissionError("path escapes rundeer project")
    if is_sensitive_file(path, resolved_root):
        raise PermissionError("file is not available through the web console")
    return path


def relpath(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def project_url(rel: str) -> str:
    return f"/api/file?path={quote(rel)}"


def build_state(root: Path) -> Dict[str, Any]:
    config_path = root / ".rundeer" / "config.json"
    config_error = None
    raw_config = read_project_config(root)
    if config_path.exists() and not raw_config:
        try:
            json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            config_error = str(exc)
    normalized = normalize_config(dict(raw_config)) if raw_config else normalize_config({})
    return {
        "version": __version__,
        "projectRoot": str(root),
        "configPath": relpath(root, config_path),
        "config": {"raw": raw_config, "normalized": normalized, "error": config_error},
        "styles": list_styles(root),
        "definitions": list_definitions(root),
        "presets": list_presets(root),
        "artifacts": list_artifacts(root),
        "env": env_summary(root),
        "options": option_data(),
        "batch": batch_summary(root),
    }


def config_path(root: Path) -> Path:
    return root / ".rundeer" / "config.json"


def read_project_config(root: Path) -> Dict[str, Any]:
    path = config_path(root)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def write_project_config(root: Path, config: Dict[str, Any]) -> None:
    path = config_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def load_settings(root: Path) -> Dict[str, Any]:
    raw = read_project_config(root)
    normalized = normalize_config(dict(raw))
    return {
        "configPath": relpath(root, config_path(root)),
        "settings": {
            "rate_limits": normalized.get("rate_limits", normalize_rate_limits({})),
            "web": normalized.get("web", normalize_web_settings({})),
        },
    }


def save_settings(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    incoming = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
    raw = read_project_config(root)
    if not raw:
        raw = {}
    if isinstance(incoming.get("rate_limits"), dict):
        raw["rate_limits"] = normalize_rate_limits(incoming["rate_limits"])
    if isinstance(incoming.get("web"), dict):
        raw["web"] = normalize_web_settings(incoming["web"])
    schema = raw.setdefault("_schema", {})
    if isinstance(schema, dict):
        schema.update({
            "rate_limits.enabled": "Enable API request rate limiting.",
            "rate_limits.per_second": "Maximum API requests per second. null/0 = unlimited.",
            "rate_limits.per_minute": "Maximum API requests per minute. null/0 = unlimited.",
            "rate_limits.per_hour": "Maximum API requests per hour. null/0 = unlimited.",
            "rate_limits.per_day": "Maximum API requests per day. null/0 = unlimited.",
            "web.artifact_view": "Default web artifact browser view: grid or tree.",
            "web.artifact_size": "Default artifact tile size: sm, md, or lg.",
            "web.dock_expanded": "Open the artifact dock in expanded mode by default.",
            "web.output_open_on_run": "Expand Output when a web run starts.",
            "web.output_panel_open": "Show the Output section on web load.",
            "web.files_panel_open": "Show the Files section on web load.",
            "web.artifacts_panel_open": "Show the Artifacts section on web load.",
        })
    write_project_config(root, raw)
    return load_settings(root)


def env_summary(root: Path) -> Dict[str, bool]:
    keys = ["VISION_API_KEY", "MODEL_API_KEY", "BASE_URL"]
    return {key: bool(os.environ.get(key) or env_file_has_key(root, key)) for key in keys}


def env_file_has_key(root: Path, key: str) -> bool:
    env_file = root / ".env"
    if not env_file.exists():
        return False
    prefixes = (f"{key}=", f"export {key}=")
    for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.strip().startswith(prefixes):
            return True
    return False


def list_styles(root: Path) -> List[Dict[str, Any]]:
    styles: List[Dict[str, Any]] = []
    base = brain_dir()
    if not base.exists():
        return styles
    for style_dir in sorted((path for path in base.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
        prompt_path = style_dir / f"{style_dir.name.lower()}.md"
        prompt = prompt_path.read_text(encoding="utf-8", errors="ignore")[:2400] if prompt_path.exists() else ""
        ref_dir = style_dir / "Reference"
        references = []
        if ref_dir.exists():
            references = [
                file_payload(root, ref, reference_id=reference_id(ref.name))
                for ref in sorted(ref_dir.iterdir(), key=lambda path: path.name.lower())
                if ref.is_file() and ref.suffix.lower() in IMAGE_EXTS
            ]
        styles.append({
            "name": style_dir.name,
            "path": relpath(root, style_dir),
            "promptPath": relpath(root, prompt_path),
            "prompt": prompt,
            "references": references,
        })
    return styles


def reference_id(name: str) -> Optional[int]:
    prefix = name.split("_", 1)[0]
    return int(prefix) if prefix.isdigit() else None


def list_definitions(root: Path) -> List[Dict[str, Any]]:
    base = root / ".rundeer" / "def"
    if not base.exists():
        return []
    return [
        {**file_payload(root, path), "functions": python_functions(path)}
        for path in sorted(base.rglob("*.py"), key=lambda item: item.as_posix().lower())
        if path.is_file()
    ]


def python_functions(path: Path) -> List[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
    except SyntaxError:
        return []
    return [node.name for node in tree.body if isinstance(node, ast.FunctionDef)]


def list_presets(root: Path) -> List[Dict[str, Any]]:
    base = root / ".rundeer" / "presets"
    if not base.exists():
        return []
    return [file_payload(root, path) for path in iter_files(base, root)][:400]


def list_artifacts(root: Path) -> List[Dict[str, Any]]:
    roots = [root / ".rundeer" / "outputs", root / ".rundeer" / "benchmark" / "position" / "outputs", root / "docs"]
    artifacts: List[Dict[str, Any]] = []
    seen = set()
    for base in roots:
        if not base.exists():
            continue
        for path in iter_files(base, root):
            if path.suffix.lower() not in ARTIFACT_EXTS:
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            artifacts.append(file_payload(root, path))
    artifacts.sort(key=lambda item: item.get("mtime", 0), reverse=True)
    return artifacts[:240]


def list_files(root: Path, query: Dict[str, List[str]]) -> List[Dict[str, Any]]:
    text = (query.get("query") or [""])[0].strip().lower()
    kind = (query.get("kind") or ["all"])[0]
    files: List[Dict[str, Any]] = []
    for path in iter_files(root, root):
        rel = relpath(root, path)
        suffix = path.suffix.lower()
        if text and text not in rel.lower():
            continue
        if kind == "media" and suffix not in IMAGE_EXTS | VIDEO_EXTS:
            continue
        if kind == "subject" and suffix not in {".md", ".txt"}:
            continue
        if kind == "config" and suffix != ".json":
            continue
        if kind == "definition" and suffix != ".py":
            continue
        item = file_payload(root, path)
        if suffix == ".py":
            item["functions"] = python_functions(path)
        files.append(item)
        if len(files) >= 500:
            break
    return sorted(files, key=lambda item: item["path"].lower())


def iter_files(base: Path, root: Path) -> Iterable[Path]:
    for current, dirs, filenames in os.walk(base):
        current_path = Path(current)
        dirs[:] = [name for name in dirs if not skip_dir(current_path / name, root)]
        for filename in sorted(filenames):
            path = current_path / filename
            if path.is_file() and not skip_file(path, root):
                yield path


def skip_dir(path: Path, root: Path) -> bool:
    if path.name in SKIP_DIRS:
        return True
    try:
        rel_parts = path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return False
    blocked = ((".rundeer", "cache"), (".rundeer", "web", "runs"))
    return any(rel_parts[: len(prefix)] == prefix for prefix in blocked)


def skip_file(path: Path, root: Path) -> bool:
    if is_sensitive_file(path, root):
        return True
    try:
        rel_parts = path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return False
    return path.name.startswith(".") and (not rel_parts or rel_parts[0] not in ALLOWED_DOTFILE_ROOTS)


def is_sensitive_file(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    name = path.name.lower()
    return name == ".env" or name.startswith(".env.")


def file_payload(root: Path, path: Path, *, reference_id: Optional[int] = None) -> Dict[str, Any]:
    stat = path.stat()
    suffix = path.suffix.lower()
    kind = "image" if suffix in IMAGE_EXTS else "video" if suffix in VIDEO_EXTS else "text" if suffix in TEXT_EXTS else "file"
    rel = relpath(root, path)
    payload = {
        "name": path.name,
        "path": rel,
        "url": project_url(rel),
        "kind": kind,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "isGrid": "_grid" in path.stem,
    }
    if reference_id is not None:
        payload["referenceId"] = reference_id
    return payload


def build_file_tree(root: Path, rel: str = "") -> Dict[str, Any]:
    """Return one lazy-loaded directory node scoped to *root* (the CWD).

    The frontend asks for children when a directory is opened. This keeps large
    workspaces responsive while preserving a normal file-explorer hierarchy.
    """
    root = root.resolve()
    base = safe_project_path(root, rel)
    if not base.is_dir():
        raise FileNotFoundError(rel or str(base))
    base_rel = relpath(root, base)
    if base == root:
        base_rel = ""
    tree: Dict[str, Any] = {
        "name": root.name or str(root) if base == root else base.name,
        "path": base_rel,
        "kind": "dir",
        "children": [],
        "loaded": True,
    }

    children: List[Dict[str, Any]] = []
    for child in sorted(base.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        if child.is_dir():
            if skip_dir(child, root):
                continue
            child_rel = relpath(root, child)
            children.append({
                "name": child.name,
                "path": child_rel,
                "kind": "dir",
                "children": None,
                "loaded": False,
                "hasChildren": directory_has_visible_children(child, root),
            })
        elif child.is_file() and not skip_file(child, root):
            leaf = file_payload(root, child)
            leaf["children"] = None
            children.append(leaf)
    tree["children"] = children
    return tree


def directory_has_visible_children(path: Path, root: Path) -> bool:
    try:
        for child in path.iterdir():
            if child.is_dir() and not skip_dir(child, root):
                return True
            if child.is_file() and not skip_file(child, root):
                return True
    except OSError:
        return False
    return False


def _sort_tree(node: Dict[str, Any]) -> None:
    children = node.get("children")
    if not children:
        return
    children.sort(key=lambda n: (n.get("kind") != "dir", n.get("name", "").lower()))
    for child in children:
        if child.get("kind") == "dir":
            _sort_tree(child)


def list_style_references(root: Path, style: str) -> List[Dict[str, Any]]:
    """List all reference images for a given style, with their numeric ids."""
    if not style:
        # Return references for every style, grouped flat with style label.
        out: List[Dict[str, Any]] = []
        base = brain_dir()
        if not base.exists():
            return out
        for sd in sorted((p for p in base.iterdir() if p.is_dir()), key=lambda p: p.name.lower()):
            ref_dir = sd / "Reference"
            if not ref_dir.exists():
                continue
            for ref in sorted(ref_dir.iterdir(), key=lambda p: p.name.lower()):
                if ref.is_file() and ref.suffix.lower() in IMAGE_EXTS:
                    payload = file_payload(root, ref, reference_id=reference_id(ref.name))
                    payload["style"] = sd.name
                    out.append(payload)
        return out

    style_dir = brain_dir() / style
    ref_dir = style_dir / "Reference"
    if not ref_dir.exists():
        return []
    return [
        {**file_payload(root, ref, reference_id=reference_id(ref.name)), "style": style}
        for ref in sorted(ref_dir.iterdir(), key=lambda p: p.name.lower())
        if ref.is_file() and ref.suffix.lower() in IMAGE_EXTS
    ]


def collect_mentions(root: Path, query: str) -> List[Dict[str, Any]]:
    """Lightweight @-mention completion source: definitions + project files.

    Definitions are surfaced as ``@name`` items; files are surfaced as path
    items so users can paste them into the subject as context references.
    """
    q = (query or "").strip().lower().lstrip("@")
    max_items = 60
    max_file_scan = 1200
    items: List[Dict[str, Any]] = []
    # Definitions (functions in .rundeer/def/*.py)
    for d in list_definitions(root):
        for fn in d.get("functions", []) or []:
            label = fn
            if not q or q in label.lower():
                items.append({"kind": "definition", "label": f"@{label}", "value": f"@{label}", "detail": d.get("path", "")})
    # Files are strictly from the CWD-backed project root. Prefer rg so large
    # workspaces stay responsive; fall back to a bounded stdlib walk.
    for rel, path in iter_mention_files(root, q, limit=max_file_scan):
        if len(items) >= max_items:
            break
        if q and q not in rel.lower() and q not in path.name.lower():
            continue
        items.append({"kind": "file", "label": rel, "value": rel, "detail": path.suffix.lstrip(".") or "file"})
    # Definitions first, then files; cap results for snappy UI.
    items.sort(key=lambda i: (0 if i["kind"] == "definition" else 1, i["label"].lower()))
    return items[:max_items]


def iter_mention_files(root: Path, query: str, *, limit: int) -> Iterable[Tuple[str, Path]]:
    root = root.resolve()
    rg = shutil.which("rg")
    if rg:
        cmd = [rg, "--files", "--hidden"]
        for name in sorted(SKIP_DIRS):
            cmd.extend(["--glob", f"!**/{name}/**"])
        if query and all(ch.isalnum() or ch in "._-/" for ch in query):
            cmd.extend(["--glob", f"*{query}*"])
        try:
            result = subprocess.run(
                cmd,
                cwd=root,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=0.8,
                check=False,
            )
            yielded = 0
            for raw in result.stdout.splitlines():
                if yielded >= limit:
                    break
                rel = raw.strip().lstrip("/")
                if not rel or skip_mention_rel(rel):
                    continue
                if query and query not in rel.lower() and query not in Path(rel).name.lower():
                    continue
                path = root / rel
                if path.is_file():
                    yielded += 1
                    yield rel, path
            return
        except (OSError, subprocess.TimeoutExpired, PermissionError):
            pass

    yielded = 0
    scanned_dirs = 0
    for current, dirs, filenames in os.walk(root):
        current_path = Path(current)
        scanned_dirs += 1
        if scanned_dirs > 220:
            dirs[:] = []
        else:
            dirs[:] = [name for name in dirs if not skip_dir(current_path / name, root)]
        for filename in sorted(filenames):
            if yielded >= limit:
                return
            path = current_path / filename
            if not path.is_file() or skip_file(path, root):
                continue
            rel = relpath(root, path)
            if query and query not in rel.lower() and query not in path.name.lower():
                continue
            yielded += 1
            yield rel, path


def skip_mention_rel(rel: str) -> bool:
    rel_path = Path(rel)
    parts = rel_path.parts
    if rel_path.is_absolute() or not parts or any(part == ".." for part in parts):
        return True
    if any(part in SKIP_DIRS for part in parts[:-1]):
        return True
    name = parts[-1]
    lower_name = name.lower()
    if lower_name == ".env" or lower_name.startswith(".env."):
        return True
    if lower_name in {".ds_store"} or rel_path.suffix.lower() in {".pyc", ".pyo"}:
        return True
    return name.startswith(".") and parts[0] not in ALLOWED_DOTFILE_ROOTS


def artifact_meta(root: Path, rel: str) -> Dict[str, Any]:
    """Return rich metadata for an artifact (size, mtime, dimensions when image)."""
    path = safe_project_path(root, rel)
    if not path.is_file():
        raise FileNotFoundError(rel)
    stat = path.stat()
    suffix = path.suffix.lower()
    info: Dict[str, Any] = {
        "name": path.name,
        "path": relpath(root, path),
        "url": project_url(relpath(root, path)),
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "suffix": suffix,
    }
    if suffix in IMAGE_EXTS:
        info["kind"] = "image"
        dims = _image_dimensions(path)
        if dims:
            info["width"], info["height"] = dims
    elif suffix in VIDEO_EXTS:
        info["kind"] = "video"
    elif suffix == ".json":
        info["kind"] = "json"
        try:
            info["preview"] = json.dumps(json.loads(path.read_text(encoding="utf-8")), indent=2)[:4000]
        except Exception:  # noqa: BLE001
            info["preview"] = path.read_text(encoding="utf-8", errors="ignore")[:4000]
    else:
        info["kind"] = "file"
    return info


def _image_dimensions(path: Path) -> Optional[Tuple[int, int]]:
    """Best-effort dimension parser for PNG/JPEG/WEBP/GIF without Pillow."""
    try:
        with path.open("rb") as fh:
            head = fh.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                width = int.from_bytes(head[16:20], "big")
                height = int.from_bytes(head[20:24], "big")
                return width, height
            if head[:3] == b"\xff\xd8\xff":  # JPEG
                fh.seek(0)
                fh.read(2)  # SOI
                while True:
                    byte = fh.read(1)
                    while byte and byte != b"\xff":
                        byte = fh.read(1)
                    while byte == b"\xff":
                        byte = fh.read(1)
                    if not byte:
                        return None
                    marker = byte[0]
                    if 0xC0 <= marker <= 0xCF and marker not in {0xC4, 0xC8, 0xCC}:
                        fh.read(3)
                        height = int.from_bytes(fh.read(2), "big")
                        width = int.from_bytes(fh.read(2), "big")
                        return width, height
                    seg_len = int.from_bytes(fh.read(2), "big")
                    fh.read(seg_len - 2)
            if head[:6] in (b"GIF87a", b"GIF89a"):
                width = int.from_bytes(head[6:8], "little")
                height = int.from_bytes(head[8:10], "little")
                return width, height
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                # VP8X chunk gives canvas size; VP8/VP8L parsing is best-effort.
                if head[12:16] == b"VP8X":
                    fh.seek(24)
                    w = int.from_bytes(fh.read(3), "little") + 1
                    h = int.from_bytes(fh.read(3), "little") + 1
                    return w, h
    except Exception:  # noqa: BLE001
        return None
    return None


def batch_summary(root: Path) -> Dict[str, Any]:
    path = root / ".rundeer" / "batch.json"
    if not path.exists():
        return {"path": relpath(root, path), "entries": 0, "sleep": 0}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {"path": relpath(root, path), "error": str(exc), "entries": 0, "sleep": 0}
    return {"path": relpath(root, path), "entries": len([item for item in data.get("batch", []) if item]), "sleep": data.get("sleep", 0)}


def option_data() -> Dict[str, Any]:
    ratios = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1"]
    return {
        "commands": sorted(COMMANDS),
        "aspectRatios": ratios,
        "imageModels": ["grok-imagine-image", "grok-imagine-image-pro"],
        "videoModels": ["grok-imagine-video"],
        "imageResolutions": ["", "1k", "2k"],
        "videoResolutions": ["480p", "720p", "1080p"],
    }


def run_plan(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    run_id = new_run_id()
    command, config_path = build_cli_command(root, payload, run_id, dry_run=True)
    proc = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=120)
    return {
        "id": run_id,
        "command": command,
        "configPath": relpath(root, config_path) if config_path else None,
        "returncode": proc.returncode,
        "output": (proc.stdout or "") + (proc.stderr or ""),
    }


def start_run(server: RundeerWebServer, payload: Dict[str, Any]) -> Dict[str, Any]:
    root = server.project_root
    run_id = new_run_id()
    command, config_path = build_cli_command(root, payload, run_id, dry_run=bool(payload.get("dryRun")))
    record = {
        "id": run_id,
        "command": command,
        "configPath": relpath(root, config_path) if config_path else None,
        "status": "queued",
        "output": "",
        "returncode": None,
        "startedAt": time.time(),
        "endedAt": None,
    }
    with server.runs_lock:
        server.runs[run_id] = record
    cmd_str = " ".join(command[2:] if command[:2] == [sys.executable, "-c"] else command)
    log_line(f"run {run_id} · queued · {cmd_str}")
    threading.Thread(target=run_process, args=(server, run_id), daemon=True).start()
    return {"id": run_id, "status": "queued", "command": command, "configPath": record["configPath"]}


def run_process(server: RundeerWebServer, run_id: str) -> None:
    with server.runs_lock:
        record = server.runs[run_id]
        command = list(record["command"])
        record["status"] = "running"
    proc = subprocess.Popen(command, cwd=server.project_root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    with server.runs_lock:
        record["pid"] = proc.pid
    output_parts: List[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        output_parts.append(line)
        if len(output_parts) > 2000:
            output_parts = output_parts[-2000:]
        with server.runs_lock:
            record["output"] = "".join(output_parts)
    returncode = proc.wait()
    with server.runs_lock:
        record["returncode"] = returncode
        record["status"] = "done" if returncode == 0 else "failed"
        record["endedAt"] = time.time()
        record["output"] = "".join(output_parts)
    status = "done" if returncode == 0 else f"failed (rc={returncode})"
    log_line(f"run {run_id} · {status}")


def get_run(server: RundeerWebServer, run_id: str) -> Dict[str, Any]:
    with server.runs_lock:
        record = server.runs.get(run_id)
        if record is None:
            raise FileNotFoundError(run_id)
        return dict(record)


def new_run_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]


_BOOTSTRAP = (
    "import sys; from rundeer.cli.commands import main; sys.exit(main(sys.argv[1:]))"
)


def rundeer_invoker() -> List[str]:
    """Return argv prefix that invokes the rundeer CLI regardless of CWD.

    Web runs use the currently loaded Python package instead of a `rundeer`
    console script from PATH. That keeps web-triggered jobs on the same code
    as the server, including local edits such as rate-limit enforcement.
    """
    return [sys.executable, "-c", _BOOTSTRAP]


def build_cli_command(root: Path, payload: Dict[str, Any], run_id: str, *, dry_run: bool) -> Tuple[List[str], Optional[Path]]:
    command_name = str(payload.get("command") or "image")
    if command_name not in COMMANDS:
        raise ValueError(f"unknown command: {command_name}")
    inputs_block = _section(payload, "inputs")
    run_dir = root / ".rundeer" / "web" / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    config_path: Optional[Path] = None
    command = rundeer_invoker() + [command_name]
    if command_name == "benchmark":
        command.append("position")
    if command_name != "batch":
        config_path = run_dir / "config.json"
        config_path.write_text(json.dumps(build_run_config(root, payload), indent=2), encoding="utf-8")
        command.append(f"--config={config_path}")
    if command_name == "edit":
        command.append(f"--type={inputs_block.get('editType') or payload.get('editType') or 'image'}")
    if command_name == "video":
        start_frame = clean_str(inputs_block.get("startFrame")) or clean_str(payload.get("startFrame"))
        if start_frame:
            command.append(f"--start-frame={start_frame}")
    if command_name == "extend":
        source = clean_str(inputs_block.get("source")) or clean_str(payload.get("source"))
        if source:
            command.append(f"--source={source}")
    if command_name == "batch":
        batch_file = clean_str(inputs_block.get("batchFile")) or clean_str(payload.get("batchFile"))
        if batch_file:
            command.append(f"--batch-file={batch_file}")
    if command_name == "benchmark":
        bench_cfg = clean_str(inputs_block.get("benchmarkConfig")) or clean_str(payload.get("benchmarkConfig"))
        bench_tpl = clean_str(inputs_block.get("benchmarkTemplate")) or clean_str(payload.get("benchmarkTemplate"))
        if bench_cfg:
            command.append(f"--benchmark-config={bench_cfg}")
        if bench_tpl:
            command.append(f"--template={bench_tpl}")
    if command_name != "benchmark":
        command.append("--no-tui")
    if dry_run:
        command.append("--dry-run")
    return command, config_path


def _section(payload: Dict[str, Any], key: str) -> Dict[str, Any]:
    """Return ``payload[key]`` when it is a dict, else an empty dict.

    Lets the helpers transparently accept both nested objects (from the web UI)
    and legacy flat keys.
    """
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _pick(payload: Dict[str, Any], section_key: str, sub_key: str, *flat_keys: str) -> Any:
    """Read a value from a nested section first, then from any flat fallback keys."""
    section = _section(payload, section_key)
    if sub_key in section and section[sub_key] not in (None, ""):
        return section[sub_key]
    for flat in flat_keys:
        if payload.get(flat) not in (None, ""):
            return payload[flat]
    if sub_key in section:
        return section[sub_key]
    for flat in flat_keys:
        if flat in payload:
            return payload[flat]
    return None


def build_run_config(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    output = _section(payload, "output")
    image = _section(payload, "image")
    video = _section(payload, "video")
    references = _section(payload, "references")
    grid = _section(payload, "grid")
    chain = _section(payload, "chain")
    inputs = _section(payload, "inputs")

    output_dir = clean_str(output.get("dir")) or clean_str(payload.get("outputDir")) or ".rundeer/outputs"
    output_name = clean_str(output.get("name")) or clean_str(payload.get("outputName")) or "output"

    config: Dict[str, Any] = {
        "style": clean_str(payload.get("style")) or "Moebius",
        "subject": clean_str(payload.get("subject")) or "rundeer",
        "motion": clean_str(payload.get("motion")) or None,
        "input": clean_str(inputs.get("input")) or clean_str(payload.get("input")) or None,
        "output": {"dir": output_dir, "name": output_name},
        "batch": {
            "iterations": coerce_int(payload.get("iterations"), 1),
            "concurrency": coerce_optional_int(payload.get("concurrency")),
            "grid": _coerce_bool(grid.get("enabled"), payload.get("grid"), default=False),
            "grid_only": _coerce_bool(grid.get("only"), payload.get("gridOnly"), default=False),
            "grid_options": {
                "rows": clean_str(grid.get("rows")) or clean_str(payload.get("gridRows")) or "auto",
                "columns": clean_str(grid.get("columns")) or clean_str(payload.get("gridColumns")) or "auto",
                "padding": coerce_int(grid.get("padding") if "padding" in grid else payload.get("gridPadding"), 0),
                "bg_color": clean_str(grid.get("bg")) or clean_str(payload.get("gridBgColor")) or "#000000",
            },
            "chain": _coerce_bool(chain.get("enabled"), payload.get("chain"), default=False),
            "chain_compose": _coerce_bool(chain.get("compose"), payload.get("chainCompose"), default=False),
            "chain_threshold": coerce_int(chain.get("threshold") if "threshold" in chain else payload.get("chainThreshold"), 12),
            "chain_override": coerce_int(chain.get("override") if "override" in chain else payload.get("chainOverride"), 50),
            "chain_dilate": coerce_int(chain.get("dilate") if "dilate" in chain else payload.get("chainDilate"), 6),
            "chain_feather": coerce_int(chain.get("feather") if "feather" in chain else payload.get("chainFeather"), 8),
            "chain_min_region": coerce_int(chain.get("minRegion") if "minRegion" in chain else payload.get("chainMinRegion"), 64),
        },
        "references": {
            "ids": coerce_refs(references.get("ids") if "ids" in references else payload.get("references")),
            "pad": _coerce_bool(references.get("pad") if "pad" in references else payload.get("padReference"), default=True),
            "quality": coerce_int(references.get("quality") if "quality" in references else payload.get("refQuality"), 85),
        },
        "image": {
            "model": clean_str(image.get("model")) or clean_str(payload.get("imageModel")) or "grok-imagine-image",
            "aspect_ratio": (
                clean_str(image.get("aspectRatio") or image.get("aspect_ratio"))
                or clean_str(payload.get("imageAspectRatio"))
                or clean_str(payload.get("aspectRatio"))
                or "1:1"
            ),
            "resolution": clean_str(image.get("resolution")) or clean_str(payload.get("imageResolution")) or None,
        },
        "video": {
            "model": clean_str(video.get("model")) or clean_str(payload.get("videoModel")) or "grok-imagine-video",
            "aspect_ratio": (
                clean_str(video.get("aspectRatio") or video.get("aspect_ratio"))
                or clean_str(payload.get("videoAspectRatio"))
                or clean_str(payload.get("aspectRatio"))
                or "16:9"
            ),
            "duration": coerce_int(video.get("duration") if "duration" in video else payload.get("duration"), 6),
            "resolution": clean_str(video.get("resolution")) or clean_str(payload.get("videoResolution")) or "720p",
            "concurrency": coerce_int(video.get("concurrency") if "concurrency" in video else payload.get("videoConcurrency"), 1),
            "output_dir": clean_str(video.get("outputDir") or video.get("output_dir")) or clean_str(payload.get("videoOutputDir")) or None,
        },
        "definitions": coerce_definitions(payload.get("definitions")),
    }
    persisted = normalize_config(read_project_config(root))
    if persisted.get("rate_limits"):
        config["rate_limits"] = persisted["rate_limits"]
    extra = parse_extra_config(payload.get("extra") if "extra" in payload else payload.get("extraConfig"))
    if extra:
        deep_merge(config, extra)
    return config


def _coerce_bool(*candidates: Any, default: bool) -> bool:
    """Return the first non-None candidate as a bool, otherwise *default*.

    Treats the strings ``"true"``/``"false"``/``"1"``/``"0"`` sensibly and
    skips ``None`` so a nested ``{"enabled": false}`` flag is honoured even
    when a dict is also present at the same key.
    """
    for value in candidates:
        if value is None:
            continue
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            text = value.strip().lower()
            if text in {"", "false", "0", "no", "off"}:
                return False
            return True
    return default



def clean_str(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def coerce_optional_int(value: Any) -> Optional[int]:
    text = clean_str(value)
    return coerce_int(text, 0) if text else None


def coerce_refs(value: Any) -> List[int]:
    if isinstance(value, list):
        return [coerce_int(item, 0) for item in value][:5]
    text = clean_str(value)
    if not text:
        return []
    return [coerce_int(part, 0) for part in text.replace(",", " ").split() if part][:5]


def coerce_definitions(value: Any) -> Dict[str, str]:
    if isinstance(value, dict):
        return {str(key).lstrip("@"): str(path) for key, path in value.items() if clean_str(key) and clean_str(path)}
    out: Dict[str, str] = {}
    if isinstance(value, list):
        for row in value:
            if not isinstance(row, dict):
                continue
            name = clean_str(row.get("name")).lstrip("@")
            path = clean_str(row.get("value")) or clean_str(row.get("path"))
            if name and path:
                out[name] = path
    return out


def parse_extra_config(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = clean_str(value)
    if not text:
        return {}
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Config JSON must be an object")
    return parsed


def deep_merge(base: Dict[str, Any], extra: Dict[str, Any]) -> None:
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            deep_merge(base[key], value)
        else:
            base[key] = value
