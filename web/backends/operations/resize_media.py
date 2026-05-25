from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from web.backends._helpers import _coerce_vector2, _media_result, safe_project_path


def resize_media_node(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    rel = str(payload.get("path") or payload.get("input") or "").strip()
    if not rel:
        raise ValueError("path is required")
    size = _coerce_vector2(payload.get("size"), (512, 512))
    mode = str(payload.get("mode") or "contain").strip().lower()
    src = safe_project_path(root, rel)
    if not src.is_file():
        raise FileNotFoundError(rel)
    from rundeer.core.media import resize_media
    dest = resize_media(root, src, (max(1, size[0]), max(1, size[1])), mode=mode)
    return _media_result(root, dest, width=max(1, size[0]), height=max(1, size[1]))
