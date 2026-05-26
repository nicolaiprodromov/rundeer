from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from web.nodes._shared.helpers import _coerce_vector2, _coerce_vector2_list, _media_result, _payload_paths, safe_project_path


def canvas_media_node(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    rels = _payload_paths(payload.get("images") or payload.get("paths") or payload.get("input"))
    if not rels:
        raise ValueError("images is required")
    size = _coerce_vector2(payload.get("size"), (1024, 1024))
    positions = _coerce_vector2_list(payload.get("positions"), len(rels))
    while len(positions) < len(rels):
        positions.append((0, 0))
    paths: List[Path] = []
    for rel in rels:
        path = safe_project_path(root, rel)
        if not path.is_file():
            raise FileNotFoundError(rel)
        paths.append(path)
    from rundeer.core.media import canvas_images
    dest = canvas_images(root, paths, positions, (max(1, size[0]), max(1, size[1])))
    return _media_result(root, dest, width=max(1, size[0]), height=max(1, size[1]))
