"""UV/vector map operations for the node-editor's pixel pipeline.

All maps are stored as float32 numpy arrays. Spatial maps are shaped
``(H, W, C)`` where ``C`` is 1, 2, 3 or 4. UV maps specifically use
``C == 2`` with channel 0 = u, channel 1 = v, both nominally in
``[0, 1]`` with the origin at the bottom-left.

Pixel images are stored as float32 ``(H, W, 4)`` in ``[0, 1]`` RGBA.

Each persisted map is written as ``.rundeer/cache/uv/<sha1>.npy`` with a
sidecar ``.preview.png`` so the existing artifact-preview machinery can
display it.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence, Tuple

import numpy as np
from PIL import Image


# ── Cache helpers ───────────────────────────────────────────────────────

CACHE_SUBDIR = Path(".rundeer") / "cache" / "uv"


def _cache_dir(project_root: Path) -> Path:
    d = project_root / CACHE_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _hash_key(*parts: Any) -> str:
    h = hashlib.sha1()
    for p in parts:
        h.update(json.dumps(p, sort_keys=True, default=str).encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


def _relpath(project_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return str(path)


# ── Preview rendering ───────────────────────────────────────────────────

def _map_to_preview_rgb(arr: np.ndarray) -> np.ndarray:
    """Convert any (H, W, C) float map to an 8-bit RGB preview."""
    if arr.ndim == 2:
        arr = arr[..., None]
    h, w, c = arr.shape
    if c == 1:
        v = np.clip(arr[..., 0], 0.0, 1.0)
        rgb = np.stack([v, v, v], axis=-1)
    elif c == 2:
        # UV preview: R=u, G=v, B=0 (Blender-ish).
        u = np.clip(arr[..., 0], 0.0, 1.0)
        v = np.clip(arr[..., 1], 0.0, 1.0)
        rgb = np.stack([u, v, np.zeros_like(u)], axis=-1)
    elif c == 3:
        rgb = np.clip(arr, 0.0, 1.0)
    else:  # 4+ channels — drop alpha for the preview swatch.
        rgb = np.clip(arr[..., :3], 0.0, 1.0)
    return (rgb * 255.0 + 0.5).astype(np.uint8)


# ── IO ──────────────────────────────────────────────────────────────────

def save_map(arr: np.ndarray, project_root: Path, tag: str) -> Tuple[Path, Path]:
    """Persist ``arr`` (float32) and a preview PNG.

    Returns ``(npy_path, preview_path)``.
    """
    arr = np.ascontiguousarray(arr.astype(np.float32, copy=False))
    key = _hash_key(tag, arr.shape, float(arr.mean() if arr.size else 0.0), float(arr.std() if arr.size else 0.0), arr.tobytes()[:512])
    cache = _cache_dir(project_root)
    npy = cache / f"{tag}_{key}.npy"
    png = cache / f"{tag}_{key}.preview.png"
    if not npy.exists():
        np.save(npy, arr)
    if not png.exists():
        Image.fromarray(_map_to_preview_rgb(arr), mode="RGB").save(png)
    return npy, png


def save_image(arr: np.ndarray, project_root: Path, tag: str) -> Path:
    """Persist a float32 (H, W, 4) RGBA image as PNG and return its path."""
    if arr.ndim == 2:
        arr = arr[..., None]
    if arr.shape[-1] == 1:
        arr = np.repeat(arr, 3, axis=-1)
    if arr.shape[-1] == 3:
        alpha = np.ones(arr.shape[:2] + (1,), dtype=arr.dtype)
        arr = np.concatenate([arr, alpha], axis=-1)
    arr = np.clip(arr, 0.0, 1.0)
    key = _hash_key(tag, arr.shape, arr.tobytes()[:512])
    cache = _cache_dir(project_root)
    png = cache / f"{tag}_{key}.png"
    if not png.exists():
        u8 = (arr * 255.0 + 0.5).astype(np.uint8)
        Image.fromarray(u8, mode="RGBA").save(png)
    return png


def load_map(path: Path) -> np.ndarray:
    """Load a persisted ``.npy`` map, or fall back to reading an image."""
    p = Path(path)
    if p.suffix.lower() == ".npy":
        arr = np.load(p)
        return arr.astype(np.float32, copy=False)
    return load_image_rgba(p)


def load_image_rgba(path: Path) -> np.ndarray:
    """Load any image as float32 RGBA in [0, 1]."""
    img = Image.open(Path(path)).convert("RGBA")
    return np.asarray(img, dtype=np.float32) / 255.0


# ── Coordinate ──────────────────────────────────────────────────────────

def coordinate(width: int, height: int, dpi: int = 72, space: str = "uv") -> np.ndarray:
    """Return a fresh UV map of shape ``(height, width, 2)``.

    ``space="uv"`` → u,v in ``[0, 1]``. ``space="screen"`` → pixel coords
    (u in ``[0, width)``, v in ``[0, height)``).
    """
    width = max(1, int(width))
    height = max(1, int(height))
    if space == "screen":
        u = np.arange(width, dtype=np.float32)
        v = np.arange(height - 1, -1, -1, dtype=np.float32)
    else:
        # uv space, +0.5 offset for pixel centers.
        u = (np.arange(width, dtype=np.float32) + 0.5) / float(width)
        v = 1.0 - ((np.arange(height, dtype=np.float32) + 0.5) / float(height))
    uu, vv = np.meshgrid(u, v)
    out = np.stack([uu, vv], axis=-1).astype(np.float32)
    # dpi is metadata-only for now; preserved for the round-trip but not
    # baked into the array itself.
    _ = int(dpi)
    return out


# ── Vector math ─────────────────────────────────────────────────────────

VECTOR_OPS = {
    "add", "subtract", "multiply", "divide",
    "scale", "dot", "cross", "normalize", "length",
    "floor", "fract", "min", "max", "mix",
}


def _nn_resize(arr: np.ndarray, target_h: int, target_w: int) -> np.ndarray:
    """Nearest-neighbor resize a ``(H, W, C)`` array to ``(target_h, target_w, C)``.

    Cheap and predictable — used when two spatial operands disagree on shape
    in a per-pixel vector op (e.g. mixing a 1024×1024 UV map with a 512×512
    image). The smaller side is up-sampled to the larger.
    """
    h, w = arr.shape[0], arr.shape[1]
    if h == target_h and w == target_w:
        return arr
    ys = (np.arange(target_h, dtype=np.float32) + 0.5) * (h / float(target_h))
    xs = (np.arange(target_w, dtype=np.float32) + 0.5) * (w / float(target_w))
    yi = np.clip(ys.astype(np.int64), 0, h - 1)
    xi = np.clip(xs.astype(np.int64), 0, w - 1)
    return arr[yi[:, None], xi[None, :]]


def _broadcast(a: Any, b: Any, *, fill_b: float = 0.0) -> Tuple[np.ndarray, np.ndarray]:
    """Coerce a/b to ndarrays of the same (H, W, C) shape.

    Scalars become (1,1,1); colors (3- or 4-tuples) become (1,1,C). When
    both sides carry a non-trivial channel count that disagrees, the
    larger side is truncated to the smaller — so a 3-component Vector
    primitive can multiply a 2-channel UV map per-component.

    When both sides carry distinct spatial extents (e.g. a UV map and an
    image of different sizes), the smaller side is nearest-neighbor
    resized up to the larger so the per-pixel op operates on a common
    grid. This is what makes vector-op work as a true Blender-style
    shader operator regardless of whether you feed it a UV, an image,
    a vector primitive, or a scalar.
    """
    a_arr = _as_array(a)
    b_arr = _as_array(b, default_scalar=fill_b)
    # Promote both to 3D.
    if a_arr.ndim == 0:
        a_arr = a_arr.reshape(1, 1, 1)
    if b_arr.ndim == 0:
        b_arr = b_arr.reshape(1, 1, 1)
    if a_arr.ndim == 1:
        a_arr = a_arr.reshape(1, 1, -1)
    if b_arr.ndim == 1:
        b_arr = b_arr.reshape(1, 1, -1)
    if a_arr.ndim == 2:
        a_arr = a_arr[..., None]
    if b_arr.ndim == 2:
        b_arr = b_arr[..., None]
    # Align channel counts: if both sides have >1 channels and disagree,
    # truncate the longer one. (1-channel sides broadcast naturally.)
    ac, bc = a_arr.shape[-1], b_arr.shape[-1]
    if ac > 1 and bc > 1 and ac != bc:
        keep = min(ac, bc)
        a_arr = a_arr[..., :keep]
        b_arr = b_arr[..., :keep]
    # Align spatial extents: only when both sides are non-trivial maps
    # (1×1 stays as a broadcast scalar). Resize the smaller to the larger.
    a_h, a_w = a_arr.shape[0], a_arr.shape[1]
    b_h, b_w = b_arr.shape[0], b_arr.shape[1]
    a_spatial = (a_h > 1 or a_w > 1)
    b_spatial = (b_h > 1 or b_w > 1)
    if a_spatial and b_spatial and (a_h != b_h or a_w != b_w):
        target_h = max(a_h, b_h)
        target_w = max(a_w, b_w)
        if (a_h, a_w) != (target_h, target_w):
            a_arr = _nn_resize(a_arr, target_h, target_w)
        if (b_h, b_w) != (target_h, target_w):
            b_arr = _nn_resize(b_arr, target_h, target_w)
    return a_arr, b_arr


def _as_array(v: Any, *, default_scalar: float = 0.0) -> np.ndarray:
    if v is None:
        return np.float32(default_scalar)
    if isinstance(v, np.ndarray):
        return v.astype(np.float32, copy=False)
    if isinstance(v, (list, tuple)):
        return np.asarray(v, dtype=np.float32)
    return np.float32(v)


def vector_op(a: Any, b: Any, op: str, scalar: Optional[float] = None) -> np.ndarray:
    """Apply a vector operation. ``a`` and ``b`` may be scalars, colors, or maps.

    Operates on (a, b) by default. ``scalar`` is an optional legacy knob
    that overrides ``b`` for ``scale``/``mix`` (kept for back-compat); when
    ``scalar`` is None, those ops derive their factor from ``b``'s first
    component (or 1.0 when ``b`` is also missing).
    """
    op = (op or "add").lower()
    if op not in VECTOR_OPS:
        raise ValueError(f"unknown vector op: {op}")

    a_arr = _as_array(a)
    if a_arr.ndim < 3:
        # promote to (1,1,C) at minimum so per-pixel ops stay sane
        if a_arr.ndim == 0:
            a_arr = a_arr.reshape(1, 1, 1)
        elif a_arr.ndim == 1:
            a_arr = a_arr.reshape(1, 1, -1)
        else:
            a_arr = a_arr[..., None]

    # Derive the per-op scalar: explicit `scalar` arg wins, else fall back
    # to b's first component (broadcasting a Vector primitive (x, y, z)
    # naturally turns "scale by [2,2,2]" into "scale by 2").
    if scalar is not None:
        s = float(scalar)
    elif b is None:
        s = 1.0
    elif isinstance(b, (int, float)):
        s = float(b)
    elif isinstance(b, (list, tuple)) and len(b) > 0:
        s = float(b[0])
    elif isinstance(b, np.ndarray) and b.size > 0:
        s = float(np.asarray(b).reshape(-1)[0])
    else:
        s = 1.0

    if op == "normalize":
        norm = np.linalg.norm(a_arr, axis=-1, keepdims=True)
        norm = np.where(norm == 0, 1.0, norm)
        return (a_arr / norm).astype(np.float32)
    if op == "length":
        return np.linalg.norm(a_arr, axis=-1, keepdims=True).astype(np.float32)
    if op == "floor":
        return np.floor(a_arr).astype(np.float32)
    if op == "fract":
        return (a_arr - np.floor(a_arr)).astype(np.float32)
    if op == "scale":
        return (a_arr * s).astype(np.float32)

    a_arr, b_arr = _broadcast(a_arr, b, fill_b=(s if op in {"multiply", "divide"} else 0.0))

    if op == "add":
        return (a_arr + b_arr).astype(np.float32)
    if op == "subtract":
        return (a_arr - b_arr).astype(np.float32)
    if op == "multiply":
        return (a_arr * b_arr).astype(np.float32)
    if op == "divide":
        denom = np.where(b_arr == 0, 1.0, b_arr)
        return (a_arr / denom).astype(np.float32)
    if op == "min":
        return np.minimum(a_arr, b_arr).astype(np.float32)
    if op == "max":
        return np.maximum(a_arr, b_arr).astype(np.float32)
    if op == "dot":
        # Broadcast to common channel count first.
        ch = max(a_arr.shape[-1], b_arr.shape[-1])
        a_p = np.broadcast_to(a_arr, a_arr.shape[:-1] + (ch,)) if a_arr.shape[-1] == 1 else a_arr
        b_p = np.broadcast_to(b_arr, b_arr.shape[:-1] + (ch,)) if b_arr.shape[-1] == 1 else b_arr
        return np.sum(a_p * b_p, axis=-1, keepdims=True).astype(np.float32)
    if op == "cross":
        # Cross only defined for 3-component vectors; pad with zeros if needed.
        def _to3(arr: np.ndarray) -> np.ndarray:
            if arr.shape[-1] == 3:
                return arr
            if arr.shape[-1] == 2:
                pad = np.zeros(arr.shape[:-1] + (1,), dtype=arr.dtype)
                return np.concatenate([arr, pad], axis=-1)
            return np.broadcast_to(arr, arr.shape[:-1] + (3,))
        a3 = _to3(a_arr)
        b3 = _to3(b_arr)
        return np.cross(a3, b3).astype(np.float32)
    if op == "mix":
        # Use `scalar` as the lerp factor when no per-pixel factor is wired.
        t = np.clip(s, 0.0, 1.0)
        return ((1.0 - t) * a_arr + t * b_arr).astype(np.float32)
    raise AssertionError("unreachable")


# ── Mapping (Blender-style point transform) ─────────────────────────────

def mapping(
    uv: np.ndarray,
    location: Sequence[float] = (0.0, 0.0),
    rotation: float = 0.0,
    scale: Sequence[float] = (1.0, 1.0),
    pivot: Sequence[float] = (0.5, 0.5),
) -> np.ndarray:
    """Apply scale → rotate → translate to a UV map (around ``pivot``).

    ``rotation`` is in degrees. The result has the same shape as ``uv``.
    """
    uv = uv.astype(np.float32, copy=False)
    if uv.ndim != 3 or uv.shape[-1] < 2:
        raise ValueError("mapping requires a (H, W, 2+) UV map")
    u = uv[..., 0]
    v = uv[..., 1]
    px, py = float(pivot[0]), float(pivot[1])
    sx, sy = float(scale[0]), float(scale[1])
    lx, ly = float(location[0]), float(location[1])
    theta = np.deg2rad(float(rotation))
    cos_t, sin_t = np.cos(theta), np.sin(theta)

    # Translate to pivot
    du = u - px
    dv = v - py
    # Scale
    du = du * sx
    dv = dv * sy
    # Rotate
    ru = du * cos_t - dv * sin_t
    rv = du * sin_t + dv * cos_t
    # Translate back from pivot, then by location
    out_u = ru + px + lx
    out_v = rv + py + ly

    extras = uv[..., 2:] if uv.shape[-1] > 2 else None
    out = np.stack([out_u.astype(np.float32), out_v.astype(np.float32)], axis=-1)
    if extras is not None:
        out = np.concatenate([out, extras], axis=-1)
    return out


# ── Sampling ────────────────────────────────────────────────────────────

def _apply_extension(coord: np.ndarray, size: int, mode: str) -> np.ndarray:
    if mode == "repeat":
        return np.mod(coord, size)
    if mode == "mirror":
        period = 2 * size
        c = np.mod(coord, period)
        return np.where(c >= size, period - 1 - c, c)
    # clamp
    return np.clip(coord, 0.0, size - 1)


def sample(
    pixel: np.ndarray,
    uv_map: np.ndarray,
    interp: str = "bilinear",
    extension: str = "clamp",
) -> np.ndarray:
    """Sample ``pixel`` (H_p, W_p, C) at the UV coordinates in ``uv_map``.

    UV coords are in ``[0, 1]`` with origin bottom-left. Output shape matches
    ``uv_map``'s spatial shape with the pixel image's channel count.
    """
    if pixel.ndim == 2:
        pixel = pixel[..., None]
    h_p, w_p = pixel.shape[:2]
    u = uv_map[..., 0] * (w_p - 1)
    v = (1.0 - uv_map[..., 1]) * (h_p - 1)
    u = _apply_extension(u, w_p, extension)
    v = _apply_extension(v, h_p, extension)

    if interp == "nearest":
        ui = np.clip(np.round(u).astype(np.int64), 0, w_p - 1)
        vi = np.clip(np.round(v).astype(np.int64), 0, h_p - 1)
        return pixel[vi, ui].astype(np.float32)

    # Bilinear
    u0 = np.floor(u).astype(np.int64)
    v0 = np.floor(v).astype(np.int64)
    u1 = u0 + 1
    v1 = v0 + 1
    du = (u - u0).astype(np.float32)[..., None]
    dv = (v - v0).astype(np.float32)[..., None]

    u0c = np.clip(u0, 0, w_p - 1)
    u1c = np.clip(u1, 0, w_p - 1)
    v0c = np.clip(v0, 0, h_p - 1)
    v1c = np.clip(v1, 0, h_p - 1)

    p00 = pixel[v0c, u0c]
    p10 = pixel[v0c, u1c]
    p01 = pixel[v1c, u0c]
    p11 = pixel[v1c, u1c]
    top = p00 * (1.0 - du) + p10 * du
    bot = p01 * (1.0 - du) + p11 * du
    return (top * (1.0 - dv) + bot * dv).astype(np.float32)


# ── Mix ─────────────────────────────────────────────────────────────────

MIX_MODES = {"mix", "add", "multiply", "screen", "overlay"}


def _is_spatial(arr: np.ndarray) -> bool:
    return arr.ndim == 3 and (arr.shape[0] > 1 or arr.shape[1] > 1)


def _promote_to(target_shape: Tuple[int, int], arr: np.ndarray, channels: int) -> np.ndarray:
    """Promote ``arr`` to ``(target_shape[0], target_shape[1], channels)``."""
    if arr.ndim == 0:
        arr = arr.reshape(1, 1, 1)
    if arr.ndim == 1:
        arr = arr.reshape(1, 1, -1)
    if arr.ndim == 2:
        arr = arr[..., None]
    h, w, c = arr.shape
    if c == 1 and channels > 1:
        arr = np.broadcast_to(arr, (h, w, channels))
    elif c < channels:
        pad = np.ones((h, w, channels - c), dtype=arr.dtype)
        arr = np.concatenate([arr, pad], axis=-1)
    elif c > channels:
        arr = arr[..., :channels]
    if (h, w) != target_shape:
        target_h, target_w = target_shape
        if h == 1 and w == 1:
            arr = np.broadcast_to(arr, (target_h, target_w, channels))
        elif (h in (1, target_h)) and (w in (1, target_w)):
            arr = np.broadcast_to(arr, (target_h, target_w, channels))
        else:
            arr = _nn_resize(arr, target_h, target_w)
    return np.asarray(arr, dtype=np.float32)


def _blend(a: np.ndarray, b: np.ndarray, mode: str) -> np.ndarray:
    if mode == "add":
        return a + b
    if mode == "multiply":
        return a * b
    if mode == "screen":
        return 1.0 - (1.0 - a) * (1.0 - b)
    if mode == "overlay":
        lo = 2.0 * a * b
        hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b)
        return np.where(a < 0.5, lo, hi)
    # "mix" returns b — the caller lerps with the factor.
    return b


def mix(
    factor: Any,
    a: Any,
    b: Any,
    mode: str = "mix",
    clamp_factor: bool = True,
) -> Any:
    """Blender-style mix.

    If none of the inputs is a 2D map, returns a plain Python list/float
    (the scalar/color fast path). Otherwise returns a float32 (H, W, C)
    array.
    """
    mode = (mode or "mix").lower()
    if mode not in MIX_MODES:
        raise ValueError(f"unknown mix mode: {mode}")
    f_arr = _as_array(factor)
    a_arr = _as_array(a)
    b_arr = _as_array(b)

    f_is_map = isinstance(f_arr, np.ndarray) and f_arr.ndim >= 2 and (
        f_arr.size > 1 and (f_arr.ndim == 3 and (f_arr.shape[0] > 1 or f_arr.shape[1] > 1) or (f_arr.ndim == 2 and (f_arr.shape[0] > 1 or f_arr.shape[1] > 1)))
    )
    a_is_map = isinstance(a_arr, np.ndarray) and a_arr.ndim >= 2 and _is_spatial(a_arr if a_arr.ndim == 3 else a_arr[..., None])
    b_is_map = isinstance(b_arr, np.ndarray) and b_arr.ndim >= 2 and _is_spatial(b_arr if b_arr.ndim == 3 else b_arr[..., None])

    if not (f_is_map or a_is_map or b_is_map):
        # Scalar/color fast path.
        a_v = np.atleast_1d(a_arr).astype(np.float32)
        b_v = np.atleast_1d(b_arr).astype(np.float32)
        f_v = float(np.clip(f_arr if clamp_factor else f_arr, 0.0, 1.0)) if clamp_factor else float(f_arr)
        # Promote to common channel count.
        c = max(a_v.size, b_v.size)
        if a_v.size < c:
            a_v = np.pad(a_v, (0, c - a_v.size), constant_values=1.0 if c == 4 else 0.0)
        if b_v.size < c:
            b_v = np.pad(b_v, (0, c - b_v.size), constant_values=1.0 if c == 4 else 0.0)
        blended = _blend(a_v, b_v, mode) if mode != "mix" else b_v
        out = (1.0 - f_v) * a_v + f_v * blended
        return [float(x) for x in out]

    # Map path: find target spatial shape and channel count.
    candidates = [arr for arr in (f_arr, a_arr, b_arr) if isinstance(arr, np.ndarray) and arr.ndim >= 2]
    target_h = max((c.shape[0] for c in candidates), default=1)
    target_w = max((c.shape[1] for c in candidates), default=1)
    channels = 1
    for cand in (a_arr, b_arr):
        if isinstance(cand, np.ndarray):
            if cand.ndim == 3:
                channels = max(channels, cand.shape[-1])
            elif cand.ndim == 1:
                channels = max(channels, cand.shape[0])
    channels = max(channels, 3)  # default to RGB

    A = _promote_to((target_h, target_w), a_arr, channels)
    B = _promote_to((target_h, target_w), b_arr, channels)
    F = _promote_to((target_h, target_w), f_arr, 1)
    if clamp_factor:
        F = np.clip(F, 0.0, 1.0)
    blended = _blend(A, B, mode) if mode != "mix" else B
    out = (1.0 - F) * A + F * blended
    return out.astype(np.float32)
