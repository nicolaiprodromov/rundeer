












from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import unquote

import numpy as np

from rundeer.core import uv_ops




def _safe_path(root: Path, rel: str) -> Path:
    raw = unquote(rel or "")
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = root / raw
    path = candidate.resolve()
    resolved_root = root.resolve()
    if path != resolved_root and resolved_root not in path.parents:
        raise PermissionError("path escapes rundeer project")
    return path


def _relpath(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)




def _resolve_input(root: Path, value: Any) -> Any:








    if value is None or value == "":
        return None
    if isinstance(value, dict):
        if "path" in value and value["path"]:
            return uv_ops.load_map(_safe_path(root, str(value["path"])))
        if "scalar" in value:
            return float(value["scalar"])
        if "color" in value:
            return [float(x) for x in value["color"]]
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, (list, tuple)):
        return [float(x) for x in value]
    if isinstance(value, str):

        return uv_ops.load_map(_safe_path(root, value))
    return value


def _shape_meta(arr: np.ndarray) -> Dict[str, int]:
    if arr.ndim == 2:
        return {"width": int(arr.shape[1]), "height": int(arr.shape[0])}
    if arr.ndim >= 3:
        return {"width": int(arr.shape[1]), "height": int(arr.shape[0])}
    return {"width": 1, "height": 1}




def coordinate(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    width = int(payload.get("width") or 1024)
    height = int(payload.get("height") or 1024)
    dpi = int(payload.get("dpi") or 72)
    space = str(payload.get("space") or "uv")
    arr = uv_ops.coordinate(width, height, dpi=dpi, space=space)
    npy, png = uv_ops.save_map(arr, root, "coord")
    return {
        "path": _relpath(root, npy),
        "preview": _relpath(root, png),
        "image": _relpath(root, png),
        **_shape_meta(arr),
    }


def vector(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    a = _resolve_input(root, payload.get("a"))
    b = _resolve_input(root, payload.get("b"))
    op = str(payload.get("op") or "add")
    scalar = payload.get("scalar")
    scalar_v: Optional[float] = float(scalar) if scalar is not None and scalar != "" else None
    arr = uv_ops.vector_op(a, b, op, scalar=scalar_v)
    npy, png = uv_ops.save_map(arr, root, f"vec_{op}")
    result: Dict[str, Any] = {
        "path": _relpath(root, npy),
        "preview": _relpath(root, png),
        "image": _relpath(root, png),
        **_shape_meta(arr),
    }



    if arr.ndim >= 3 and arr.shape[0] == 1 and arr.shape[1] == 1:
        result["value"] = arr[0, 0].tolist()
    return result


def mapping(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    uv = _resolve_input(root, payload.get("uv"))
    if uv is None or not isinstance(uv, np.ndarray):
        raise ValueError("mapping: 'uv' input is required")
    arr = uv_ops.mapping(
        uv,
        location=(float(payload.get("location_x") or 0.0), float(payload.get("location_y") or 0.0)),
        rotation=float(payload.get("rotation") or 0.0),
        scale=(float(payload.get("scale_x") or 1.0), float(payload.get("scale_y") or 1.0)),
        pivot=(float(payload.get("pivot_x") or 0.5), float(payload.get("pivot_y") or 0.5)),
    )
    npy, png = uv_ops.save_map(arr, root, "map")
    return {
        "path": _relpath(root, npy),
        "preview": _relpath(root, png),
        "image": _relpath(root, png),
        **_shape_meta(arr),
    }


def _value_is_map(v: Any) -> bool:
    return isinstance(v, np.ndarray) and v.ndim >= 2 and (v.shape[0] > 1 or v.shape[1] > 1)


def mix(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    factor = _resolve_input(root, payload.get("factor"))
    a = _resolve_input(root, payload.get("a"))
    b = _resolve_input(root, payload.get("b"))
    mode = str(payload.get("mode") or "mix")
    clamp = bool(payload.get("clamp") if payload.get("clamp") is not None else True)


    if factor is None:
        factor = 0.5
    if a is None:
        a = [0.0, 0.0, 0.0, 1.0]
    if b is None:
        b = [1.0, 1.0, 1.0, 1.0]

    result = uv_ops.mix(factor, a, b, mode=mode, clamp_factor=clamp)
    if isinstance(result, np.ndarray):

        png = uv_ops.save_image(result, root, f"mix_{mode}")
        return {
            "path": _relpath(root, png),
            **_shape_meta(result),
        }

    return {"color": list(result)}


def render(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    pixel_in = payload.get("pixel")
    uv_in = payload.get("uv")
    if not pixel_in:
        raise ValueError("render: 'pixel' input is required")
    if not uv_in:
        raise ValueError("render: 'uv' input is required")
    pixel_path = _safe_path(root, str(pixel_in)) if isinstance(pixel_in, str) else _safe_path(root, str(pixel_in.get("path") or ""))
    uv_path = _safe_path(root, str(uv_in)) if isinstance(uv_in, str) else _safe_path(root, str(uv_in.get("path") or ""))

    pixel = uv_ops.load_image_rgba(pixel_path)
    uv_map = uv_ops.load_map(uv_path)
    if uv_map.ndim != 3 or uv_map.shape[-1] < 2:
        raise ValueError("render: 'uv' input must be a 2-channel UV map")

    interp = str(payload.get("interp") or "bilinear")
    extension = str(payload.get("extension") or "clamp")
    out = uv_ops.sample(pixel, uv_map, interp=interp, extension=extension)
    png = uv_ops.save_image(out, root, "render")
    return {
        "path": _relpath(root, png),
        **_shape_meta(out),
    }
