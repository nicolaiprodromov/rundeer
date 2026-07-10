from __future__ import annotations

import ast
import json
import mimetypes
import os
import re
import signal
import shutil
import subprocess
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse, urlunparse

from rundeer import __version__
from rundeer.core import paths as rpaths
from rundeer.core.paths import atomic_pil, atomic_wb
from rundeer.core.bootstrap import ensure_rundeer_dir
from rundeer.core.config import brain_dir, normalize_config
from rundeer.web.animator import log_line, run_console
from web.node_defs import get_node_defs

from web.nodes._shared.helpers import IMAGE_EXTS, VIDEO_EXTS, is_sensitive_file, relpath, safe_project_path
from web.nodes.operations.blur import blur_image
from web.nodes.operations.compress import compress_dispatch, compress_image
from web.nodes.operations.crop_media import crop_media_node
from web.nodes.operations.export import export_node
from web.nodes.operations.resize_media import resize_media_node
from web.nodes.output.canvas import canvas_media_node
from web.nodes.prompt.filter_prompt import filter_prompt
from web.nodes.bundle.folder_bundle import list_folder
from web.drop_ingest import save_drop_stream
import fnmatch
from web.config.settings_manager import get_cached_settings, load_settings_yaml, merge_settings_yaml


STATIC_DIR = Path(__file__).resolve().parent / "static"
NODES_DIR = Path(__file__).resolve().parent / "nodes"
SPLASH_DIR = Path(__file__).resolve().parent.parent / "deer-walk"
TEXT_EXTS = {".md", ".txt", ".json", ".py", ".csv", ".log"}
ARTIFACT_EXTS = IMAGE_EXTS | VIDEO_EXTS | {".json", ".csv"}
SKIP_DIRS = {
    ".rundeer",
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

def serve(
    *,
    host: str = "127.0.0.1",
    port: int = 8787,
    project_root: Optional[Path] = None,
    open_browser: bool = False,
    enable_agent: bool = True,
    agent_port: Optional[int] = None,
    cleanup: bool = False,
) -> int:
    root = (project_root or Path.cwd()).resolve()
    if cleanup:
        from rundeer.core.bootstrap import clear_data
        clear_data(root)
    ensure_rundeer_dir(root)
    load_settings_yaml(root)
    httpd = RundeerWebServer((host, port), RundeerWebHandler, project_root=root)
    actual_port = httpd.server_address[1]
    shown_host = "localhost" if host == "0.0.0.0" else host
    url = f"http://{shown_host}:{actual_port}"

    server_thread = threading.Thread(target=httpd.serve_forever, name="rundeer-web", daemon=True)
    server_thread.start()


    if enable_agent:
        try:
            from rundeer.web.agent.ws_server import start_agent_ws_server
            from rundeer.web.agent.config import get_agent_settings, resolve_ws_port
            settings = get_agent_settings(root)
            if agent_port is not None:
                settings.ws_port = int(agent_port)
            if settings.enabled:
                effective_port = resolve_ws_port(settings, actual_port)
                handle = start_agent_ws_server(httpd, web_port=actual_port, settings=settings)
                if handle is not None:
                    httpd.agent_handle = handle
                    httpd.agent_port = handle.ws_port
                    httpd.agent_settings = handle.settings
                    log_line(f"agent ws on ws://{shown_host}:{handle.ws_port}", dim=True)
                else:
                    log_line(f"agent disabled (settings)", dim=True)
                    _ = effective_port
        except Exception as exc:
            log_line(f"agent failed to start: {exc}", dim=True)

    try:
        from web.nodes.terminal.pty_ws import start_pty_ws_server
        pty_handle = start_pty_ws_server(str(root), actual_port, host=host)
        httpd.pty_handle = pty_handle
        httpd.pty_port = pty_handle.ws_port
        log_line(f"pty ws on ws://{shown_host}:{pty_handle.ws_port}", dim=True)
    except Exception as exc:
        log_line(f"pty ws failed to start: {exc}", dim=True)

    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        run_console(url=url, project_root=root, server=httpd)
    finally:
        try:
            handle = getattr(httpd, "agent_handle", None)
            if handle is not None:
                handle.stop()
        except Exception:
            pass
        try:
            pty_h = getattr(httpd, "pty_handle", None)
            if pty_h is not None:
                pty_h.stop()
        except Exception:
            pass
        httpd.shutdown()
        httpd.server_close()
        server_thread.join(timeout=2)
    return 0


class RundeerWebServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, server_address: Tuple[str, int], handler, *, project_root: Path):
        super().__init__(server_address, handler)
        self.project_root = project_root.resolve()
        ensure_web_storage_dirs(self.project_root)
        self.runs: Dict[str, Dict[str, Any]] = load_run_records(self.project_root)
        self.runs_lock = threading.Lock()
        self.run_processes: Dict[str, subprocess.Popen[str]] = {}
        self.request_count = 0
        self.last_request: Optional[str] = None
        self.started_at = time.time()
        self.agent_handle: Any = None
        self.agent_port: Optional[int] = None
        self.agent_settings: Any = None
        self.pty_handle: Any = None
        self.pty_port: Optional[int] = None

    def record_request(self, method: str, path: str) -> None:
        with self.runs_lock:
            self.request_count += 1
            self.last_request = f"{method} {path}"

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

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        self.server.record_request("GET", path)
        try:
            if path in {"/", "/index.html", "/nodes", "/explore", "/settings", "/runs", "/graphs"}:
                self._send_static(STATIC_DIR / "node-editor.html")
            elif path.startswith("/static/"):
                self._send_static(safe_static_path(path.removeprefix("/static/")))
            elif path.startswith("/splash-assets/"):
                rel = unquote(path.removeprefix("/splash-assets/")).lstrip("/")
                fpath = (SPLASH_DIR / rel).resolve()
                splash_root = SPLASH_DIR.resolve()
                if fpath != splash_root and splash_root not in fpath.parents:
                    raise PermissionError("splash path escapes directory")
                if not fpath.is_file():
                    self._send_error(HTTPStatus.NOT_FOUND, "not found")
                    return
                self._send_file(fpath, cache=True)
            elif path.startswith("/nodes/"):
                rel = unquote(path.removeprefix("/nodes/")).lstrip("/")
                fpath = (NODES_DIR / rel).resolve()
                nodes_root = NODES_DIR.resolve()
                if fpath != nodes_root and nodes_root not in fpath.parents:
                    raise PermissionError("nodes path escapes directory")
                if fpath.suffix != ".js":
                    raise PermissionError("only .js files served from /nodes/")
                self._send_file(fpath, cache=False)
            elif path == "/api/state":
                light = (query.get("light") or ["0"])[0] in {"1", "true", "yes"}
                state = build_state(self.server.project_root, light=light)
                state["agent"] = _agent_state(self.server)
                state["pty"] = {"port": getattr(self.server, "pty_port", None)}
                self._send_json(state)
            elif path == "/api/settings-yaml":
                self._send_json(load_settings_yaml(self.server.project_root))
            elif path == "/api/artifacts":
                extra_dirs = query.get("dir") or []
                self._send_json({"artifacts": list_artifacts(self.server.project_root, extra_dirs=extra_dirs)})
            elif path == "/api/files":
                self._send_json({"files": list_files(self.server.project_root, query)})
            elif path == "/api/folder-list":
                self._send_json(list_folder(self.server.project_root, query))
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
            elif path == "/api/runs":
                self._send_json({"runs": list_runs(self.server)})
            elif path == "/api/graphs":
                self._send_json({"graphs": list_graphs(self.server.project_root)})
            elif path == "/api/web-state":
                self._send_json(load_web_state(self.server.project_root))
            elif path == "/api/file":
                rel = (query.get("path") or [""])[0]
                self._send_project_file(rel)
            elif path == "/api/thumb":
                rel = (query.get("path") or [""])[0]
                try:
                    size = int((query.get("size") or ["256"])[0])
                except ValueError:
                    size = 256
                size = max(32, min(1024, size))
                thumb = ensure_thumbnail(self.server.project_root, rel, size)
                self._send_file(thumb, cache=True)
            elif path == "/api/logo":
                self._send_json({"frames": load_logo_frames()})
            elif path == "/api/agent/brain-graph":
                agent_id = (query.get("agent_id") or [None])[0]
                self._send_json(_brain_graph_payload(self.server.project_root, agent_id=agent_id))
            elif path == "/api/agent/tools-catalog":
                self._send_json({"tools": _tools_catalog()})
            elif path == "/api/tools":
                self._send_json(_tools_endpoint())
            elif path == "/api/agent/agents":
                self._send_json(_agent_profiles_state(self.server.project_root, getattr(self.server, "agent_settings", None)))
            elif path == "/api/agent/brain-list":
                self._send_json({"brains": _brain_list(self.server.project_root)})
            elif path == "/api/node-defs":
                self._send_json({"nodes": get_node_defs()})
            elif path == "/api/available-models":
                from rundeer.core.models import available_llm_providers
                self._send_json({"providers": available_llm_providers()})
            else:
                self._send_error(HTTPStatus.NOT_FOUND, "not found")
        except PermissionError as exc:
            self._send_error(HTTPStatus.FORBIDDEN, str(exc))
        except FileNotFoundError as exc:
            self._send_error(HTTPStatus.NOT_FOUND, str(exc))
        except Exception as exc:
            traceback.print_exc()
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        self.server.record_request("POST", parsed.path)
        try:
            if parsed.path == "/api/canvas-drop":
                name = (parse_qs(parsed.query).get("name") or [""])[0]
                length = int(self.headers.get("Content-Length", "0") or "0")
                self._send_json(save_drop_stream(self.server.project_root, unquote(name), self.rfile, length))
                return
            payload = self._read_json()
            if parsed.path == "/api/plan":
                self._send_json(run_plan(self.server.project_root, payload))
            elif parsed.path == "/api/run":
                self._send_json(start_run(self.server, payload))
            elif parsed.path.startswith("/api/runs/") and parsed.path.endswith("/cancel"):
                run_id = parsed.path.removeprefix("/api/runs/").removesuffix("/cancel").strip("/")
                self._send_json(cancel_run(self.server, run_id))
            elif parsed.path.startswith("/api/runs/") and parsed.path.endswith("/display-log"):
                run_id = parsed.path.removeprefix("/api/runs/").removesuffix("/display-log").strip("/")
                self._send_json(save_run_display_log(self.server, run_id, payload))
            elif parsed.path == "/api/settings-yaml":
                self._send_json(merge_settings_yaml(self.server.project_root, payload))
            elif parsed.path == "/api/graphs":
                self._send_json({"graph": save_graph(self.server.project_root, payload)})
            elif parsed.path == "/api/graphs/delete":
                self._send_json(delete_graph(self.server.project_root, payload))
            elif parsed.path == "/api/web-state":
                self._send_json(save_web_state(self.server.project_root, payload))
            elif parsed.path == "/api/filter-prompt":
                self._send_json(filter_prompt(self.server.project_root, payload))
            elif parsed.path == "/api/compress-image":
                self._send_json(compress_image(self.server.project_root, payload))
            elif parsed.path == "/api/blur-image":
                self._send_json(blur_image(self.server.project_root, payload))
            elif parsed.path == "/api/media/crop":
                self._send_json(crop_media_node(self.server.project_root, payload))
            elif parsed.path == "/api/media/resize":
                self._send_json(resize_media_node(self.server.project_root, payload))
            elif parsed.path == "/api/media/canvas":
                self._send_json(canvas_media_node(self.server.project_root, payload))
            elif parsed.path == "/api/compress":
                self._send_json(compress_dispatch(self.server.project_root, payload))
            elif parsed.path == "/api/export":
                self._send_json(export_node(self.server.project_root, payload))
            elif parsed.path == "/api/uv/coordinate":
                from web.nodes.coordinates.coordinate import coordinate as _uv_coord
                self._send_json(_uv_coord(self.server.project_root, payload))
            elif parsed.path == "/api/uv/vector":
                from web.nodes.operations.vector_op import vector as _uv_vec
                self._send_json(_uv_vec(self.server.project_root, payload))
            elif parsed.path == "/api/uv/mapping":
                from web.nodes.coordinates.mapping import mapping as _uv_map
                self._send_json(_uv_map(self.server.project_root, payload))
            elif parsed.path == "/api/uv/mix":
                from web.nodes.operations.mix import mix as _uv_mix
                self._send_json(_uv_mix(self.server.project_root, payload))
            elif parsed.path == "/api/uv/alpha":
                from web.nodes.operations.alpha import alpha as _uv_alpha
                self._send_json(_uv_alpha(self.server.project_root, payload))
            elif parsed.path == "/api/uv/math":
                from web.nodes.operations.math_op import math as _uv_math
                self._send_json(_uv_math(self.server.project_root, payload))
            elif parsed.path == "/api/uv/ramp":
                from web.nodes.operations.ramp import ramp as _uv_ramp
                self._send_json(_uv_ramp(self.server.project_root, payload))
            elif parsed.path == "/api/uv/render":
                from web.nodes.output.uv_render import render as _uv_render
                self._send_json(_uv_render(self.server.project_root, payload))
            elif parsed.path == "/api/agent/brain-graph":
                self._send_json(_save_brain_graph_payload(self.server.project_root, payload))
            elif parsed.path == "/api/agent/agents":
                self._send_json(_agent_profiles_action(self.server.project_root, payload, getattr(self.server, "agent_settings", None)))
            else:
                self._send_error(HTTPStatus.NOT_FOUND, "not found")
        except ValueError as exc:
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
        except FileNotFoundError as exc:
            self._send_error(HTTPStatus.NOT_FOUND, str(exc))
        except Exception as exc:
            traceback.print_exc()
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def _read_json(self) -> Dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0") or "0")
        if size <= 0:
            return {}
        return json.loads(self.rfile.read(min(size, 20_000_000)).decode("utf-8"))

    def _send_json(self, data: Dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(data, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

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
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


def safe_static_path(rel: str) -> Path:
    path = (STATIC_DIR / unquote(rel).lstrip("/")).resolve()
    static_root = STATIC_DIR.resolve()
    if path != static_root and static_root not in path.parents:
        raise PermissionError("static path escapes web root")
    return path


def graphs_dir(root: Path) -> Path:
    return rpaths.graphs_dir(root)


def runs_dir(root: Path) -> Path:
    return rpaths.runs_dir(root)


def web_state_path(root: Path) -> Path:
    return rpaths.web_state_path(root)


def ensure_web_storage_dirs(root: Path) -> None:
    rpaths.rundeer_dir(root).mkdir(parents=True, exist_ok=True)
    rpaths.data_dir(root).mkdir(parents=True, exist_ok=True)
    graphs_dir(root).mkdir(parents=True, exist_ok=True)
    runs_dir(root).mkdir(parents=True, exist_ok=True)


def _read_json_file(path: Path) -> Dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{path.name} is not a JSON object")
    return raw


def _write_json_file(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str) + "\n", encoding="utf-8")
    tmp.replace(path)


_web_state_lock = threading.Lock()


def load_web_state(root: Path) -> Dict[str, Any]:
    with _web_state_lock:
        path = web_state_path(root)
        if not path.is_file():
            return {"state": {}}
        state = _read_json_file(path)
        return {"state": state}


def save_web_state(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    with _web_state_lock:
        state = payload.get("state", payload)
        if not isinstance(state, dict):
            raise ValueError("missing or invalid web state")
        _write_json_file(web_state_path(root), state)
        return {"state": state}


def _slugify_graph_name(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", str(name or "").strip()).strip("-._")
    return (slug[:90] or "graph")


def _graph_path_for_id(root: Path, graph_id: str) -> Path:
    raw = str(graph_id or "").strip()
    if not raw or "/" in raw or "\\" in raw:
        raise ValueError("invalid graph id")
    name = raw if raw.endswith(".json") else f"{raw}.json"
    if name.startswith("."):
        raise ValueError("invalid graph id")
    path = (graphs_dir(root) / name).resolve()
    graph_root = graphs_dir(root).resolve()
    if path.parent != graph_root:
        raise ValueError("invalid graph id")
    return path


def _unique_graph_path(root: Path, name: str, *, avoid: Optional[Path] = None) -> Path:
    base = _slugify_graph_name(name)
    candidate = graphs_dir(root) / f"{base}.json"
    if avoid is not None and candidate.resolve() == avoid.resolve():
        return candidate
    if not candidate.exists():
        return candidate
    for idx in range(2, 1000):
        candidate = graphs_dir(root) / f"{base}-{idx}.json"
        if avoid is not None and candidate.resolve() == avoid.resolve():
            return candidate
        if not candidate.exists():
            return candidate
    stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
    return graphs_dir(root) / f"{base}-{stamp}.json"


def _graph_data_from_file(path: Path) -> Dict[str, Any]:
    raw = _read_json_file(path)
    graph = raw.get("graph") if isinstance(raw.get("graph"), dict) else raw
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), dict):
        raise ValueError(f"{path.name} is not a graph file")
    if "edges" in graph and not isinstance(graph.get("edges"), list):
        raise ValueError(f"{path.name} has invalid graph edges")
    return graph


def _graph_record(root: Path, path: Path, *, include_data: bool = True) -> Dict[str, Any]:
    stat = path.stat()
    data = _graph_data_from_file(path)
    node_count = len(data.get("nodes") or {})
    edge_count = len(data.get("edges") or [])
    record: Dict[str, Any] = {
        "id": path.name,
        "name": path.stem,
        "path": relpath(root, path),
        "createdAt": stat.st_ctime,
        "updatedAt": stat.st_mtime,
        "nodeCount": node_count,
        "edgeCount": edge_count,
    }
    if include_data:
        record["data"] = data
    return record


def list_graphs(root: Path) -> List[Dict[str, Any]]:
    ensure_web_storage_dirs(root)
    records: List[Dict[str, Any]] = []
    for path in sorted(graphs_dir(root).glob("*.json")):
        if path.name.startswith("."):
            continue
        try:
            records.append(_graph_record(root, path))
        except Exception as exc:
            records.append({
                "id": path.name,
                "name": path.stem,
                "path": relpath(root, path),
                "updatedAt": path.stat().st_mtime,
                "nodeCount": 0,
                "edgeCount": 0,
                "error": str(exc),
            })
    records.sort(key=lambda item: item.get("updatedAt") or 0, reverse=True)
    return records


def save_graph(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_web_storage_dirs(root)
    graph_id = str(payload.get("id") or "").strip()
    current_path: Optional[Path] = _graph_path_for_id(root, graph_id) if graph_id else None
    data = payload.get("data")
    if data is None and current_path is not None and current_path.is_file():
        data = _graph_data_from_file(current_path)
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), dict):
        raise ValueError("missing or invalid graph data")
    if "edges" in data and not isinstance(data.get("edges"), list):
        raise ValueError("invalid graph edges")

    current_name = current_path.stem if current_path is not None else "graph"
    name = str(payload.get("name") or current_name).strip() or current_name
    if current_path is not None and current_path.is_file():
        target_path = current_path
        if "name" in payload and _slugify_graph_name(name) != current_path.stem:
            target_path = _unique_graph_path(root, name, avoid=current_path)
    else:
        target_path = _unique_graph_path(root, name)

    _write_json_file(target_path, data)
    if current_path is not None and current_path.exists() and current_path.resolve() != target_path.resolve():
        current_path.unlink()
    return _graph_record(root, target_path)


def delete_graph(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    path = _graph_path_for_id(root, str(payload.get("id") or ""))
    if not path.is_file():
        raise FileNotFoundError(path.name)
    path.unlink()
    return {"ok": True, "id": path.name}


def run_record_path(root: Path, run_id: str) -> Path:
    raw = str(run_id or "").strip()
    if not raw or "/" in raw or "\\" in raw:
        raise ValueError("invalid run id")
    return runs_dir(root) / raw / "run.json"


def write_run_record(root: Path, record: Dict[str, Any]) -> None:
    run_id = str(record.get("id") or "")
    if not run_id:
        return
    _write_json_file(run_record_path(root, run_id), record)


def load_run_record(root: Path, run_id: str) -> Dict[str, Any]:
    record = _read_json_file(run_record_path(root, run_id))
    if str(record.get("id") or "") != str(run_id):
        raise ValueError("run id mismatch")
    return record


def load_run_records(root: Path) -> Dict[str, Dict[str, Any]]:
    ensure_web_storage_dirs(root)
    records: Dict[str, Dict[str, Any]] = {}
    for path in sorted(runs_dir(root).glob("*/run.json")):
        try:
            record = _read_json_file(path)
            run_id = str(record.get("id") or path.parent.name)
            record["id"] = run_id
            if record.get("status") in {"queued", "running"}:
                record["status"] = "failed"
                record["endedAt"] = record.get("endedAt") or time.time()
                output = record.get("output") or ""
                if "server stopped before this run completed" not in output:
                    record["output"] = f"{output}\n[server stopped before this run completed]\n"
                write_run_record(root, record)
            records[run_id] = record
        except Exception:
            continue
    return records


def _brain_graph_payload(root: Path, agent_id: Optional[str] = None) -> Dict[str, Any]:
    from .agent.brain_graph import compile_brain_graph, load_or_seed_brain_graph
    graph = load_or_seed_brain_graph(root, agent_id=agent_id)
    compiled = compile_brain_graph(graph)
    return {"graph": graph, "compiled": compiled.to_dict()}


def _save_brain_graph_payload(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    from .agent.brain_graph import save_brain_graph
    graph = (payload or {}).get("graph")
    if not isinstance(graph, dict):
        raise ValueError("missing or invalid 'graph' payload")
    compiled = save_brain_graph(root, graph, agent_id=(payload or {}).get("agent_id"))
    return {"ok": True, "compiled": compiled.to_dict()}


def _agent_model(settings: Any) -> str:
    return str(getattr(settings, "model", "") or "")


def _agent_profiles_state(root: Path, settings: Any = None) -> Dict[str, Any]:
    from .agent.profiles import active_agent_id, list_agent_profiles
    model = _agent_model(settings)
    return {
        "agents": list_agent_profiles(root, model=model),
        "active_id": active_agent_id(root, model=model),
    }


def _agent_profiles_action(root: Path, payload: Dict[str, Any], settings: Any = None) -> Dict[str, Any]:
    from .agent.profiles import (
        create_agent_profile,
        delete_agent_profile,
        list_agent_profiles,
        rename_agent_profile,
        set_active_agent,
    )
    model = _agent_model(settings)
    action = str((payload or {}).get("action") or "").strip().lower()
    if action == "create":
        profile = create_agent_profile(root, name=(payload or {}).get("name") or "New agent", model=model)
    elif action == "rename":
        profile = rename_agent_profile(root, (payload or {}).get("id"), name=(payload or {}).get("name") or "", model=model)
    elif action == "delete":
        profile = delete_agent_profile(root, (payload or {}).get("id"), model=model)
    elif action == "select":
        profile = set_active_agent(root, (payload or {}).get("id"), model=model)
    else:
        raise ValueError("unknown agent action")
    return {"ok": True, "agent": profile, "agents": list_agent_profiles(root, model=model)}


def _tools_catalog() -> List[Dict[str, Any]]:
    from .agent.tools import ALL_TOOLS
    return [
        {
            "name": t.name,
            "description": t.description,
            "category": t.category,
            "destructive": bool(t.destructive),
        }
        for t in ALL_TOOLS
    ]


def _tools_endpoint() -> Dict[str, Any]:
    from .agent.tools import ALL_TOOLS
    tools = []
    cat_map: Dict[str, List[str]] = {}
    for t in ALL_TOOLS:
        tools.append({
            "name": t.name,
            "description": t.description,
            "category": t.category,
            "destructive": bool(t.destructive),
        })
        cat_map.setdefault(t.category, []).append(t.name)
    cat_labels = {
        "read": "Read",
        "docs": "Docs",
        "artifacts": "Artifacts",
        "graph_read": "Graph Read",
        "graph_mutate": "Graph Mutate",
        "mutate": "Mutate",
        "execute": "Execute",
        "vision": "Vision",
        "search": "Search",
        "self_modify": "Self Modify",
    }
    categories = []
    for cat_id, tool_names in cat_map.items():
        categories.append({
            "id": cat_id,
            "label": cat_labels.get(cat_id, cat_id.replace("_", " ").title()),
            "tools": tool_names,
        })
    return {"tools": tools, "categories": categories}


def _brain_list(root: Path) -> List[str]:
    out: List[str] = []
    brains_dir = root / "brain"
    if not brains_dir.is_dir():
        return out
    for entry in sorted(brains_dir.iterdir()):
        if entry.is_dir() and not entry.name.startswith("."):
            out.append(entry.name)
    return out


def project_url(rel: str) -> str:
    return f"/api/file?path={quote(rel)}"


def build_state(root: Path, *, light: bool = False) -> Dict[str, Any]:
    config_path = rpaths.config_path(root)
    config_error = None
    raw_config = read_project_config(root)
    if config_path.exists() and not raw_config:
        try:
            json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            config_error = str(exc)
    normalized = normalize_config(dict(raw_config)) if raw_config else normalize_config({})
    payload: Dict[str, Any] = {
        "version": __version__,
        "projectRoot": str(root),
        "configPath": relpath(root, config_path),
        "config": {"raw": raw_config, "normalized": normalized, "error": config_error},
        "styles": list_styles(root, with_references=not light),
        "env": env_summary(root),
        "options": option_data(),
    }
    if not light:
        payload["definitions"] = list_definitions(root)
        payload["presets"] = list_presets(root)
        payload["artifacts"] = list_artifacts(root)
        payload["batch"] = batch_summary(root)
    return payload


def config_path(root: Path) -> Path:
    return rpaths.config_path(root)


def _agent_state(server: "RundeerWebServer") -> Dict[str, Any]:
    handle = getattr(server, "agent_handle", None)
    if handle is None:
        return {"enabled": False, "reason": "agent server not running"}
    settings = getattr(server, "agent_settings", None)
    out: Dict[str, Any] = {
        "enabled": True,
        "port": getattr(server, "agent_port", None),
        "host": getattr(handle, "host", "127.0.0.1"),
    }
    if settings is not None:
        try:
            out.update(settings.to_safe_dict())
        except Exception:
            pass
    return out


def read_project_config(root: Path) -> Dict[str, Any]:
    path = config_path(root)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def chat_completions_url(base_url: str) -> str:
    raw = (base_url or "https://api.x.ai/v1").strip() or "https://api.x.ai/v1"
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        final_path = path
    elif path.endswith("/v1"):
        final_path = f"{path}/chat/completions"
    else:
        final_path = f"{path}/v1/chat/completions" if path else "/v1/chat/completions"
    return urlunparse(parsed._replace(path=final_path, params="", query="", fragment=""))


def env_summary(root: Path) -> Dict[str, bool]:
    keys = ["GROK_IMAGINE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
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


def list_styles(root: Path, *, with_references: bool = True) -> List[Dict[str, Any]]:
    styles: List[Dict[str, Any]] = []
    base = brain_dir()
    if not base.exists():
        return styles
    for style_dir in sorted((path for path in base.iterdir() if path.is_dir()), key=lambda path: path.name.lower()):
        prompt_path = style_dir / f"{style_dir.name.lower()}.md"
        prompt = prompt_path.read_text(encoding="utf-8", errors="ignore")[:2400] if prompt_path.exists() else ""
        references: List[Dict[str, Any]] = []
        if with_references:
            ref_dir = style_dir / "Reference"
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
    base = rpaths.definitions_dir(root)
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
    base = rpaths.presets_dir(root)
    if not base.exists():
        return []
    return [file_payload(root, path) for path in iter_files(base, root)][:400]


def list_artifacts(root: Path, extra_dirs: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    roots = [rpaths.default_output_dir(root), rpaths.benchmark_dir(root, "position", "outputs"), root / "docs"]


    for rel in (extra_dirs or []):
        if not rel:
            continue
        try:
            extra = safe_project_path(root, rel)
        except Exception:
            continue
        if extra and extra not in roots:
            roots.append(extra)
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
    return artifacts[:1000]


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


ANIMATED_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".gif", ".webp", ".apng"}


def ensure_thumbnail(root: Path, rel: str, size: int) -> Path:


    if not rel:
        raise FileNotFoundError("no path")
    src = safe_project_path(root, rel)
    if not src.is_file():
        raise FileNotFoundError(rel)
    stat = src.stat()
    import hashlib
    key_src = f"{src.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{size}"
    key = hashlib.sha1(key_src.encode("utf-8")).hexdigest()[:16]
    cache_dir = rpaths.cache_dir(root, "thumbs")
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"{key}_{size}.jpg"
    if dest.exists() and dest.stat().st_size > 0:
        return dest


    with _THUMB_SEM:
        if dest.exists() and dest.stat().st_size > 0:
            return dest


        lock = _thumb_lock_for(key)
        with lock:
            if dest.exists() and dest.stat().st_size > 0:
                return dest
            _generate_thumbnail(src, dest, size)
    return dest


_THUMB_SEM = threading.Semaphore(max(2, (os.cpu_count() or 2) // 2))
_THUMB_LOCKS: Dict[str, threading.Lock] = {}
_THUMB_LOCKS_GUARD = threading.Lock()


def _thumb_lock_for(key: str) -> threading.Lock:
    with _THUMB_LOCKS_GUARD:
        lock = _THUMB_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _THUMB_LOCKS[key] = lock
        return lock


def _generate_thumbnail(src: Path, dest: Path, size: int) -> None:
    suffix = src.suffix.lower()
    try:
        if suffix in IMAGE_EXTS:
            from PIL import Image
            with Image.open(src) as im:
                im.load()
                if im.mode in ("RGBA", "LA", "P"):
                    im = im.convert("RGB")
                im.thumbnail((size, size), Image.LANCZOS)
                atomic_pil(im, dest, format="JPEG", quality=82, optimize=True, progressive=True)
        elif suffix in VIDEO_EXTS or suffix in ANIMATED_EXTS:
            if shutil.which("ffmpeg") is None:
                _write_placeholder_thumb(dest, size)
            else:
                tmp_ff = dest.with_name("." + dest.name + ".atmp")
                cmd = [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", "0", "-i", str(src),
                    "-frames:v", "1",
                    "-vf", f"scale='min({size},iw)':'min({size},ih)':force_original_aspect_ratio=decrease",
                    "-q:v", "3",
                    str(tmp_ff),
                ]
                try:
                    subprocess.run(cmd, check=True, capture_output=True, timeout=30)
                    tmp_ff.rename(dest)
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                    tmp_ff.unlink(missing_ok=True)
                    _write_placeholder_thumb(dest, size)
        else:
            _write_placeholder_thumb(dest, size)
    except Exception:
        _write_placeholder_thumb(dest, size)


def _write_placeholder_thumb(dest: Path, size: int) -> None:
    try:
        from PIL import Image
        atomic_pil(
            Image.new("RGB", (max(16, size // 8), max(16, size // 8)), (24, 24, 24)),
            dest, format="JPEG", quality=70
        )
    except Exception:
        atomic_wb(dest, b"")


def iter_files(base: Path, root: Path) -> Iterable[Path]:
    for current, dirs, filenames in os.walk(base):
        current_path = Path(current)
        dirs[:] = [name for name in dirs if not skip_dir(current_path / name, root)]
        for filename in sorted(filenames):
            path = current_path / filename
            if path.is_file() and not skip_file(path, root):
                yield path


def _explore_ignore_patterns(root: Path) -> list:
    data = get_cached_settings(root)
    raw = (data.get("settings") or {}).get("UI", {}).get("Explore", {}).get("ignore_patterns", "")
    if not raw or not isinstance(raw, str):
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def _matches_ignore(name: str, patterns: list) -> bool:
    n = name.rstrip("/")
    return any(fnmatch.fnmatch(n, p.rstrip("/")) for p in patterns)


def skip_dir(path: Path, root: Path) -> bool:
    return _matches_ignore(path.name, _explore_ignore_patterns(root))


def skip_file(path: Path, root: Path) -> bool:
    if is_sensitive_file(path, root):
        return True
    return _matches_ignore(path.name, _explore_ignore_patterns(root))


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

    if not style:

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


    q = (query or "").strip().lower().lstrip("@")
    max_items = 60
    max_file_scan = 1200
    items: List[Dict[str, Any]] = []

    for d in list_definitions(root):
        for fn in d.get("functions", []) or []:
            label = fn
            if not q or q in label.lower():
                items.append({"kind": "definition", "label": f"@{label}", "value": f"@{label}", "detail": d.get("path", "")})


    for rel, path in iter_mention_files(root, q, limit=max_file_scan):
        if len(items) >= max_items:
            break
        if q and q not in rel.lower() and q not in path.name.lower():
            continue
        items.append({"kind": "file", "label": rel, "value": rel, "detail": path.suffix.lstrip(".") or "file"})

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
        except Exception:
            info["preview"] = path.read_text(encoding="utf-8", errors="ignore")[:4000]
    else:
        info["kind"] = "file"
    return info


def _image_dimensions(path: Path) -> Optional[Tuple[int, int]]:

    try:
        with path.open("rb") as fh:
            head = fh.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                width = int.from_bytes(head[16:20], "big")
                height = int.from_bytes(head[20:24], "big")
                return width, height
            if head[:3] == b"\xff\xd8\xff":
                fh.seek(0)
                fh.read(2)
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

                if head[12:16] == b"VP8X":
                    fh.seek(24)
                    w = int.from_bytes(fh.read(3), "little") + 1
                    h = int.from_bytes(fh.read(3), "little") + 1
                    return w, h
    except Exception:
        return None
    return None


def batch_summary(root: Path) -> Dict[str, Any]:
    path = rpaths.batch_path(root)
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
    started_at = time.time()
    proc = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=120)
    output = (proc.stdout or "") + (proc.stderr or "")
    record = {
        "id": run_id,
        "command": command,
        "configPath": relpath(root, config_path) if config_path else None,
        "status": "done" if proc.returncode == 0 else "failed",
        "returncode": proc.returncode,
        "output": output,
        "startedAt": started_at,
        "endedAt": time.time(),
        "dryRun": True,
    }
    write_run_record(root, record)
    return record


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
    write_run_record(root, record)
    cmd_str = " ".join(command[2:] if command[:2] == [sys.executable, "-c"] else command)
    log_line(f"run {run_id} · queued · {cmd_str}")
    threading.Thread(target=run_process, args=(server, run_id), daemon=True).start()
    return {"id": run_id, "status": "queued", "command": command, "configPath": record["configPath"]}


def _terminate_process(proc: subprocess.Popen[Any]) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            return


def cancel_run(server: RundeerWebServer, run_id: str) -> Dict[str, Any]:
    if not run_id:
        raise ValueError("missing run id")
    proc: Optional[subprocess.Popen[Any]] = None
    with server.runs_lock:
        record = server.runs.get(run_id)
        if record is None:
            record = load_run_record(server.project_root, run_id)
            server.runs[run_id] = record
        status = str(record.get("status") or "")
        if status in {"done", "failed", "cancelled"} or status.startswith("failed"):
            return dict(record)
        record["status"] = "cancelling"
        proc = getattr(server, "run_processes", {}).get(run_id)
        write_run_record(server.project_root, record)
    if proc is not None:
        _terminate_process(proc)
    with server.runs_lock:
        return dict(server.runs.get(run_id, record))


def run_process(server: RundeerWebServer, run_id: str) -> None:
    with server.runs_lock:
        record = server.runs[run_id]
        if record.get("status") in {"cancelling", "cancelled"}:
            record["status"] = "cancelled"
            record["returncode"] = None
            record["endedAt"] = time.time()
            record["output"] = (record.get("output") or "") + "\n[cancelled before start]\n"
            write_run_record(server.project_root, record)
            log_line(f"run {run_id} · cancelled")
            return
        command = list(record["command"])
        record["status"] = "running"
        write_run_record(server.project_root, record)
    proc = subprocess.Popen(command, cwd=server.project_root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, start_new_session=True)
    with server.runs_lock:
        server.run_processes[run_id] = proc
        if record.get("status") == "cancelling":
            _terminate_process(proc)
        record["pid"] = proc.pid
        write_run_record(server.project_root, record)
    output_parts: List[str] = []
    last_write = 0.0
    assert proc.stdout is not None
    for line in proc.stdout:
        output_parts.append(line)
        with server.runs_lock:
            record["output"] = "".join(output_parts)
            now = time.time()
            if now - last_write >= 0.5:
                write_run_record(server.project_root, record)
                last_write = now
    returncode = proc.wait()
    with server.runs_lock:
        server.run_processes.pop(run_id, None)
        was_cancelled = record.get("status") in {"cancelling", "cancelled"}
        record["returncode"] = returncode
        record["status"] = "cancelled" if was_cancelled else ("done" if returncode == 0 else "failed")
        record["endedAt"] = time.time()
        record["output"] = "".join(output_parts)
        if was_cancelled:
            record["output"] += "\n[cancelled]\n"
        write_run_record(server.project_root, record)
    status = "cancelled" if was_cancelled else ("done" if returncode == 0 else f"failed (rc={returncode})")
    log_line(f"run {run_id} · {status}")


def get_run(server: RundeerWebServer, run_id: str) -> Dict[str, Any]:
    with server.runs_lock:
        record = server.runs.get(run_id)
        if record is not None:
            return dict(record)
    record = load_run_record(server.project_root, run_id)
    with server.runs_lock:
        server.runs[run_id] = record
    return dict(record)


def save_run_display_log(server: RundeerWebServer, run_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if not run_id:
        raise ValueError("missing run id")
    display_output = payload.get("displayOutput", payload.get("output"))
    if not isinstance(display_output, str):
        raise ValueError("missing or invalid displayOutput")
    with server.runs_lock:
        record = server.runs.get(run_id)
        if record is None:
            record = load_run_record(server.project_root, run_id)
        record["displayOutput"] = display_output
        if isinstance(payload.get("displayTitle"), str):
            record["displayTitle"] = payload["displayTitle"]
        if isinstance(payload.get("displayMeta"), str):
            record["displayMeta"] = payload["displayMeta"]
        if isinstance(payload.get("displayStatus"), str):
            record["displayStatus"] = payload["displayStatus"]
        record["displayUpdatedAt"] = time.time()
        server.runs[run_id] = record
        write_run_record(server.project_root, record)
        return dict(record)


def list_runs(server: RundeerWebServer) -> List[Dict[str, Any]]:

    disk_runs = load_run_records(server.project_root)
    with server.runs_lock:
        for run_id, record in disk_runs.items():
            server.runs.setdefault(run_id, record)
        runs = list(server.runs.values())
    runs.sort(key=lambda r: r.get("startedAt") or 0, reverse=True)
    summaries: List[Dict[str, Any]] = []
    for r in runs[:50]:
        cmd = r.get("command") or []

        if cmd[:2] == [sys.executable, "-c"]:
            display = " ".join(cmd[3:])
        else:
            display = " ".join(cmd)
        summaries.append({
            "id": r.get("id"),
            "status": r.get("status"),
            "command": display,
            "startedAt": r.get("startedAt"),
            "endedAt": r.get("endedAt"),
            "returncode": r.get("returncode"),
            "outputTail": (r.get("displayOutput") or r.get("output") or "")[-400:],
        })
    return summaries


def new_run_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]


_BOOTSTRAP = (
    "import sys, os; "
    "_cwd = os.getcwd(); "
    "_parent = os.path.dirname(_cwd); "
    "sys.path = [p for p in sys.path if p not in ('', '.', _cwd)]; "
    "sys.path.insert(0, _parent); "
    "from rundeer.cli.commands import main; "
    "sys.exit(main(sys.argv[1:]))"
)


def rundeer_invoker() -> List[str]:


    return [sys.executable, "-c", _BOOTSTRAP]


def build_cli_command(root: Path, payload: Dict[str, Any], run_id: str, *, dry_run: bool) -> Tuple[List[str], Optional[Path]]:
    command_name = str(payload.get("command") or "image")
    if command_name not in COMMANDS:
        raise ValueError(f"unknown command: {command_name}")
    inputs_block = _section(payload, "inputs")
    run_dir = rpaths.runs_dir(root) / run_id
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


    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def _pick(payload: Dict[str, Any], section_key: str, sub_key: str, *flat_keys: str) -> Any:

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
    batch = _section(payload, "batch")
    image = _section(payload, "image")
    video = _section(payload, "video")
    references = _section(payload, "references")
    grid = _section(payload, "grid")
    chain = _section(payload, "chain")
    inputs = _section(payload, "inputs")
    grid_options = batch.get("grid_options") if isinstance(batch.get("grid_options"), dict) else {}

    ref_ids: Any = references.get("ids") if "ids" in references else payload.get("reference")
    if ref_ids is None and "references" in payload and not isinstance(payload.get("references"), dict):
        ref_ids = payload.get("references")

    output_dir = clean_str(output.get("dir")) or clean_str(payload.get("outputDir")) or rpaths.DEFAULT_OUTPUT_DIR_STR
    output_name = clean_str(output.get("name")) or clean_str(payload.get("outputName")) or "output"

    config: Dict[str, Any] = {
        "style": clean_str(payload.get("style")) or "Moebius",
        "subject": clean_str(payload.get("subject")) or "rundeer",
        "motion": clean_str(payload.get("motion")) or None,
        "input": clean_str(inputs.get("input")) or clean_str(payload.get("input")) or None,
        "output": {"dir": output_dir, "name": output_name},
        "batch": {
            "iterations": coerce_int(batch.get("iterations") if "iterations" in batch else payload.get("iterations"), 1),
            "concurrency": coerce_optional_int(batch.get("concurrency") if "concurrency" in batch else payload.get("concurrency")),
            "grid": _coerce_bool(batch.get("grid") if "grid" in batch else None, grid.get("enabled"), payload.get("grid"), default=False),
            "grid_only": _coerce_bool(batch.get("grid_only") if "grid_only" in batch else None, grid.get("only"), payload.get("gridOnly"), default=False),
            "grid_options": {
                "rows": clean_str(grid_options.get("rows")) or clean_str(grid.get("rows")) or clean_str(payload.get("gridRows")) or "auto",
                "columns": clean_str(grid_options.get("columns")) or clean_str(grid.get("columns")) or clean_str(payload.get("gridColumns")) or "auto",
                "padding": coerce_int(
                    grid_options.get("padding") if "padding" in grid_options
                    else grid.get("padding") if "padding" in grid
                    else payload.get("gridPadding"),
                    0,
                ),
                "bg_color": (
                    clean_str(grid_options.get("bg_color") or grid_options.get("bgColor"))
                    or clean_str(grid.get("bg_color") or grid.get("bg"))
                    or clean_str(payload.get("gridBgColor"))
                    or "#000000"
                ),
            },
            "chain": _coerce_bool(batch.get("chain") if "chain" in batch else None, chain.get("enabled"), payload.get("chain"), default=False),
            "chain_compose": _coerce_bool(batch.get("chain_compose") if "chain_compose" in batch else None, chain.get("compose"), payload.get("chainCompose"), default=False),
            "chain_threshold": coerce_int(
                batch.get("chain_threshold") if "chain_threshold" in batch
                else chain.get("threshold") if "threshold" in chain
                else payload.get("chainThreshold"),
                12,
            ),
            "chain_override": coerce_int(
                batch.get("chain_override") if "chain_override" in batch
                else chain.get("override") if "override" in chain
                else payload.get("chainOverride"),
                50,
            ),
            "chain_dilate": coerce_int(
                batch.get("chain_dilate") if "chain_dilate" in batch
                else chain.get("dilate") if "dilate" in chain
                else payload.get("chainDilate"),
                6,
            ),
            "chain_feather": coerce_int(
                batch.get("chain_feather") if "chain_feather" in batch
                else chain.get("feather") if "feather" in chain
                else payload.get("chainFeather"),
                8,
            ),
            "chain_min_region": coerce_int(
                batch.get("chain_min_region") if "chain_min_region" in batch
                else chain.get("min_region") if "min_region" in chain
                else chain.get("minRegion") if "minRegion" in chain
                else payload.get("chainMinRegion"),
                64,
            ),
        },
        "references": {
            "ids": coerce_refs(ref_ids),
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
