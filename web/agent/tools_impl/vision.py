"""Vision: load a project image as base64 for vision-capable LLMs."""
from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from typing import Any, Dict

from ..sandbox import assert_readable, resolve_within, safe_rel


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
DEFAULT_MAX_BYTES = 1_800_000  # ~1.8 MB after base64 → safely under most provider caps


def view_image_tool(
    root: Path,
    *,
    path: str,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> Dict[str, Any]:
    """Return a data URL the model can consume as a vision input.

    The conversation loop attaches the returned image to the next assistant
    turn as a user-role image message so the model can actually see it.
    """
    target = resolve_within(root, path)
    assert_readable(root, target)
    if not target.is_file():
        return {"error": f"not a file: {path}"}
    suffix = target.suffix.lower()
    if suffix not in IMAGE_EXTS:
        return {"error": f"not a supported image type: {suffix}"}
    size = target.stat().st_size
    cap = max(50_000, min(int(max_bytes), 5_000_000))
    if size > cap:
        return {
            "error": f"image too large ({size} bytes > cap {cap}); request artifact_meta instead",
            "path": safe_rel(root, target),
            "size": size,
        }
    data = target.read_bytes()
    mime = mimetypes.guess_type(target.name)[0] or "image/png"
    b64 = base64.b64encode(data).decode("ascii")
    return {
        "path": safe_rel(root, target),
        "size": size,
        "mime": mime,
        "data_url": f"data:{mime};base64,{b64}",
        # The conversation loop reads this and attaches it as a vision input
        # in the NEXT user message; the model sees the image alongside the
        # tool result.
        "_attach_vision": True,
    }
