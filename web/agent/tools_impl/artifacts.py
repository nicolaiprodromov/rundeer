
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional


def list_artifacts_tool(root: Path, *, extra_dirs: Optional[List[str]] = None, max_results: int = 60) -> Dict[str, Any]:

    from rundeer.web.server import list_artifacts

    cap = max(5, min(int(max_results), 200))
    items = list_artifacts(root, extra_dirs=extra_dirs or [])
    return {"count": min(len(items), cap), "artifacts": items[:cap]}


def artifact_meta_tool(root: Path, *, path: str) -> Dict[str, Any]:
    from rundeer.web.server import artifact_meta
    if not path:
        return {"error": "missing path"}
    try:
        return artifact_meta(root, path)
    except Exception as exc:
        return {"error": str(exc), "path": path}


def list_runs_tool(server: Any) -> Dict[str, Any]:
    from rundeer.web.server import list_runs
    return {"runs": list_runs(server)}


def get_run_tool(server: Any, *, run_id: str) -> Dict[str, Any]:
    from rundeer.web.server import get_run
    if not run_id:
        return {"error": "missing run_id"}
    try:
        rec = get_run(server, run_id)
    except FileNotFoundError:
        return {"error": f"unknown run: {run_id}"}
    return {
        "id": rec.get("id"),
        "status": rec.get("status"),
        "returncode": rec.get("returncode"),
        "command": rec.get("command"),
        "configPath": rec.get("configPath"),
        "startedAt": rec.get("startedAt"),
        "endedAt": rec.get("endedAt"),
        "output_tail": (rec.get("output") or "")[-4000:],
    }
