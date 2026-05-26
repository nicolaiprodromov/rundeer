from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from web.nodes._shared.helpers import _coerce_vector2, _media_result, safe_project_path


def crop_media_node(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    rel = str(payload.get("path") or payload.get("input") or "").strip()
    if not rel:
        raise ValueError("path is required")
    size = _coerce_vector2(payload.get("size"), (512, 512))
    position = _coerce_vector2(payload.get("position"), (0, 0))
    src = safe_project_path(root, rel)
    if not src.is_file():
        raise FileNotFoundError(rel)
    from rundeer.core.media import crop_media
    dest = crop_media(root, src, (max(1, size[0]), max(1, size[1])), position)
    return _media_result(root, dest, width=max(1, size[0]), height=max(1, size[1]))
