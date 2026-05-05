"""Benchmark workflows.

Currently implements the ``position`` benchmark: render a deterministic
ground-truth image (white background + colored geometric shape(s) at
known pixel positions), ask the configured image model to reproduce it
from a templated prompt, and score the result with a blend of:

* SSIM against the reference image
* centroid position delta (in pixels)
* size ratio (detected vs expected area)
* IoU vs ground-truth shape mask
* color fidelity (CIEDE2000 ΔE in CIELAB)

Cases may declare a single ``shape`` or a list of ``shapes``; per-shape
metrics are averaged into the case score. A per-iteration JSON log and
a CSV summary are written under ``.rundeer/logs/benchmark/position/``.
"""
from __future__ import annotations

import csv
import io
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from PIL import Image, ImageDraw

from rundeer.core.api import GrokClient


# ---------- color helpers ---------------------------------------------------

_NAMED_COLORS: Dict[Tuple[int, int, int], str] = {
    (0, 0, 0): "black",
    (255, 255, 255): "white",
    (255, 0, 0): "red",
    (0, 128, 0): "green",
    (0, 255, 0): "bright green",
    (0, 0, 255): "blue",
    (255, 255, 0): "yellow",
    (255, 165, 0): "orange",
    (128, 0, 128): "purple",
    (0, 255, 255): "cyan",
    (255, 0, 255): "magenta",
    (255, 192, 203): "pink",
    (128, 128, 128): "gray",
    (165, 42, 42): "brown",
}


def _hex_to_rgb(value: str) -> Tuple[int, int, int]:
    s = (value or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    if len(s) != 6:
        raise ValueError(f"invalid hex color: {value!r}")
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except ValueError as e:
        raise ValueError(f"invalid hex color: {value!r}") from e


def _color_name(hex_color: str) -> str:
    rgb = _hex_to_rgb(hex_color)
    if rgb in _NAMED_COLORS:
        return _NAMED_COLORS[rgb]
    return min(
        _NAMED_COLORS.items(),
        key=lambda kv: sum((a - b) ** 2 for a, b in zip(kv[0], rgb)),
    )[1]


# ---------- shape rendering -------------------------------------------------

def _size_wh(size: Any) -> Tuple[int, int]:
    if isinstance(size, (list, tuple)):
        if len(size) == 1:
            w = h = int(size[0])
        else:
            w, h = int(size[0]), int(size[1])
    else:
        w = h = int(size)
    return w, h


def _shape_size_desc(shape: Dict[str, Any]) -> str:
    kind = (shape.get("type") or "rectangle").lower()
    w, h = _size_wh(shape.get("size", 100))
    if kind in ("rectangle", "rect"):
        if w == h:
            return f"{w}x{h} pixels (a square)"
        return f"{w}x{h} pixels"
    if kind == "square":
        return f"{w}x{w} pixels"
    if kind in ("circle", "disc"):
        return f"{w} pixels in diameter"
    if kind == "ellipse":
        return f"{w}x{h} pixels (axes)"
    if kind == "triangle":
        return f"{w} pixels across (equilateral, point up)"
    return f"{w}x{h} pixels"


def _shape_type_label(shape: Dict[str, Any]) -> str:
    kind = (shape.get("type") or "rectangle").lower()
    if kind == "rect":
        return "rectangle"
    if kind == "disc":
        return "circle"
    return kind


def render_reference(
    width: int,
    height: int,
    background: str,
    shapes: List[Dict[str, Any]],
) -> Image.Image:
    """Render the ground-truth reference image."""
    img = Image.new("RGB", (width, height), _hex_to_rgb(background or "#FFFFFF"))
    draw = ImageDraw.Draw(img)
    for shape in shapes:
        _draw_shape(draw, shape)
    return img


def render_shape_mask(width: int, height: int, shape: Dict[str, Any]):
    """Render a binary mask of a single shape (numpy bool array, HxW)."""
    import numpy as np
    img = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(img)
    _draw_shape(draw, shape, fill=255)
    return np.asarray(img) > 127


def _draw_shape(draw: ImageDraw.ImageDraw, shape: Dict[str, Any], fill=None) -> None:
    kind = (shape.get("type") or "rectangle").lower()
    color = fill if fill is not None else _hex_to_rgb(shape.get("color", "#000000"))
    if "position" not in shape:
        raise ValueError(f"shape is missing 'position': {shape!r}")
    cx, cy = shape["position"]
    w, h = _size_wh(shape.get("size", 100))
    x0, y0 = cx - w / 2, cy - h / 2
    x1, y1 = cx + w / 2, cy + h / 2
    if kind in ("rectangle", "rect", "square"):
        draw.rectangle([x0, y0, x1, y1], fill=color)
    elif kind in ("circle", "disc", "ellipse"):
        draw.ellipse([x0, y0, x1, y1], fill=color)
    elif kind == "triangle":
        r = w / 2
        pts = []
        for k in range(3):
            ang = -math.pi / 2 + k * (2 * math.pi / 3)
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
        draw.polygon(pts, fill=color)
    else:
        raise ValueError(f"unsupported shape type: {kind!r}")


# ---------- SSIM ------------------------------------------------------------

def compute_ssim(reference: Image.Image, generated: Image.Image) -> float:
    """Multi-channel SSIM. Resizes generated to reference dims if needed."""
    try:
        import numpy as np  # noqa: WPS433
        from skimage.metrics import structural_similarity as ssim_fn  # noqa: WPS433
    except ImportError as e:
        raise RuntimeError(
            "benchmark requires numpy and scikit-image; install with: "
            "pip install numpy scikit-image"
        ) from e

    if generated.size != reference.size:
        generated = generated.resize(reference.size, Image.LANCZOS)
    a = np.asarray(reference.convert("RGB"))
    b = np.asarray(generated.convert("RGB"))
    return float(ssim_fn(a, b, channel_axis=-1, data_range=255))


# ---------- shape detection / position scoring -----------------------------

def _color_mask(arr, target_rgb: Tuple[int, int, int], background_rgb: Tuple[int, int, int]):
    """Return boolean mask of pixels closer to target color than background."""
    import numpy as np
    t = np.asarray(target_rgb, dtype=np.float64)
    b = np.asarray(background_rgb, dtype=np.float64)
    pix = arr.astype(np.float64)
    dt = np.linalg.norm(pix - t, axis=-1)
    db = np.linalg.norm(pix - b, axis=-1)
    # closer to target than background AND meaningfully different from background
    return (dt < db) & (db > 24.0)


def _all_components(mask) -> List[Dict[str, Any]]:
    """Return list of components with centroid, area, bbox, mask slice info."""
    from skimage.measure import label, regionprops
    comps: List[Dict[str, Any]] = []
    if not mask.any():
        return comps
    lbl = label(mask, connectivity=2)
    for p in regionprops(lbl):
        comps.append({
            "label": int(p.label),
            "area": int(p.area),
            "centroid_yx": (float(p.centroid[0]), float(p.centroid[1])),
            "bbox": (int(p.bbox[0]), int(p.bbox[1]), int(p.bbox[2]), int(p.bbox[3])),
            "label_image": lbl,
        })
    return comps


def detect_shape(
    image: Image.Image,
    target_color: str,
    background_color: str,
    target_size: Tuple[int, int],
    *,
    near_xy_ref: Optional[Tuple[float, float]] = None,
    ref_image_size: Optional[Tuple[int, int]] = None,
) -> Optional[Dict[str, Any]]:
    """Detect a target-colored blob; return centroid, bbox, area, mask.

    When multiple connected components of the target color exist (e.g. in
    multi-shape cases), pass ``near_xy_ref`` and ``ref_image_size`` to
    select the component whose centroid is closest to the expected pixel
    position. Otherwise the largest component is returned.

    Returns ``None`` when no plausible blob is found.
    """
    import numpy as np

    arr = np.asarray(image.convert("RGB"))
    H, W, _ = arr.shape
    target_rgb = _hex_to_rgb(target_color)
    bg_rgb = _hex_to_rgb(background_color or "#FFFFFF")

    mask = _color_mask(arr, target_rgb, bg_rgb)
    min_pixels = max(16, int(0.0005 * H * W))
    if int(mask.sum()) < min_pixels:
        return None

    comps = [c for c in _all_components(mask) if c["area"] >= min_pixels]
    if not comps:
        return None

    if near_xy_ref is not None and ref_image_size is not None:
        ref_w, ref_h = ref_image_size
        nx = near_xy_ref[0] * (W / ref_w)
        ny = near_xy_ref[1] * (H / ref_h)
        chosen = min(
            comps,
            key=lambda c: math.hypot(c["centroid_yx"][1] - nx, c["centroid_yx"][0] - ny),
        )
    else:
        chosen = max(comps, key=lambda c: c["area"])

    sel_mask = chosen["label_image"] == chosen["label"]
    ys, xs = np.where(sel_mask)
    cx = float(xs.mean())
    cy = float(ys.mean())
    x0, y0 = int(xs.min()), int(ys.min())
    x1, y1 = int(xs.max()), int(ys.max())
    bbox_w = x1 - x0 + 1
    bbox_h = y1 - y0 + 1
    expected_area = max(1, target_size[0] * target_size[1])

    return {
        "centroid": [cx, cy],
        "bbox": [x0, y0, x1, y1],
        "bbox_size": [bbox_w, bbox_h],
        "area_px": int(sel_mask.sum()),
        "area_ratio": float(sel_mask.sum()) / float(expected_area),
        "image_size": [W, H],
        "_mask": sel_mask,  # numpy bool array, not JSON-serialized
        "_arr": arr,        # raw RGB array, kept for color/IoU scoring
    }


def _serializable_detection(det: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if det is None:
        return None
    return {k: v for k, v in det.items() if not k.startswith("_")}


def score_position(
    expected_xy: Tuple[float, float],
    expected_size: Tuple[int, int],
    detection: Optional[Dict[str, Any]],
    image_size: Tuple[int, int],
) -> Dict[str, Any]:
    """Compute position / size deltas and per-axis sub-scores.

    All deltas reported in pixels of the *reference* coordinate space.
    Sub-scores are in [0, 1]; combine into a final score externally.
    """
    W, H = image_size
    diag = math.hypot(W, H)

    if detection is None:
        return {
            "detected": False,
            "centroid_delta_px": None,
            "centroid_delta_norm": None,
            "size_ratio": None,
            "position_score": 0.0,
            "size_score": 0.0,
        }

    # Map detected centroid (in generated resolution) into reference resolution.
    det_w, det_h = detection["image_size"]
    sx, sy = W / det_w, H / det_h
    det_cx = detection["centroid"][0] * sx
    det_cy = detection["centroid"][1] * sy

    dx = det_cx - expected_xy[0]
    dy = det_cy - expected_xy[1]
    delta = math.hypot(dx, dy)
    delta_norm = delta / diag if diag else 0.0

    # Position score: 1 at delta=0, 0 at delta>=image diagonal/4 (a quarter of
    # the canvas is "completely off"). Smooth linear falloff.
    position_score = max(0.0, 1.0 - (delta / (diag * 0.25)))

    # Size score from area ratio (1.0 = perfect; halves at 2x or 0.5x).
    ar = detection.get("area_ratio") or 0.0
    if ar <= 0:
        size_score = 0.0
    else:
        # log-scale symmetric: score = 2^(-|log2(ar)|)
        size_score = float(2.0 ** (-abs(math.log2(ar))))

    return {
        "detected": True,
        "detected_centroid_ref": [round(det_cx, 2), round(det_cy, 2)],
        "centroid_delta_px": round(delta, 2),
        "centroid_delta_xy": [round(dx, 2), round(dy, 2)],
        "centroid_delta_norm": round(delta_norm, 4),
        "size_ratio": round(ar, 3),
        "bbox_ref": [round(c * (sx if i % 2 == 0 else sy), 1)
                     for i, c in enumerate(detection["bbox"])],
        "position_score": round(position_score, 4),
        "size_score": round(size_score, 4),
    }


def compute_iou(
    expected_mask,
    detection: Optional[Dict[str, Any]],
    ref_image_size: Tuple[int, int],
) -> Optional[float]:
    """IoU between expected mask and detected blob mask, in reference coords.

    The detected mask (in generated resolution) is resampled to the
    reference resolution before comparison. Returns ``None`` when the
    shape was not detected.
    """
    if detection is None:
        return None
    import numpy as np
    det_mask = detection["_mask"]
    det_w, det_h = detection["image_size"]
    ref_w, ref_h = ref_image_size

    if (det_w, det_h) != (ref_w, ref_h):
        # Resample the bool mask via PIL to the reference resolution.
        m = Image.fromarray((det_mask.astype("uint8") * 255), mode="L")
        m = m.resize((ref_w, ref_h), Image.NEAREST)
        det_arr = np.asarray(m) > 127
    else:
        det_arr = det_mask.astype(bool)

    exp = expected_mask.astype(bool)
    inter = int(np.logical_and(exp, det_arr).sum())
    union = int(np.logical_or(exp, det_arr).sum())
    if union == 0:
        return 0.0
    return float(inter) / float(union)


def compute_color_score(
    target_color: str,
    detection: Optional[Dict[str, Any]],
) -> Tuple[Optional[float], Optional[float]]:
    """Return (mean_deltaE_2000, color_score in [0,1]) for detected pixels.

    Score uses score = exp(-mean_dE / 20). At ΔE ≈ 14 score ≈ 0.5,
    at ΔE ≈ 30 score ≈ 0.22. ΔE values <= 2.3 are visually
    indistinguishable.
    """
    if detection is None:
        return None, None
    import numpy as np
    from skimage.color import rgb2lab, deltaE_ciede2000

    arr = detection["_arr"]
    mask = detection["_mask"]
    if not mask.any():
        return None, None

    pixels = arr[mask].astype(np.float64) / 255.0
    pixels = pixels.reshape(-1, 1, 3)
    target = np.asarray(_hex_to_rgb(target_color), dtype=np.float64) / 255.0
    target = target.reshape(1, 1, 3)

    lab_p = rgb2lab(pixels)
    lab_t = rgb2lab(target)
    de = deltaE_ciede2000(lab_p, lab_t)  # shape (N, 1)
    mean_de = float(de.mean())
    score = float(math.exp(-mean_de / 20.0))
    return round(mean_de, 3), round(score, 4)


def combined_score(metrics: Dict[str, Any], weights: Dict[str, float]) -> float:
    """Weighted blend of available sub-scores. Missing scores skip their term.

    Recognized weight keys: ssim, position, size, iou, color.
    """
    pairs = [
        ("ssim",     metrics.get("ssim")),
        ("position", metrics.get("position_score")),
        ("size",     metrics.get("size_score")),
        ("iou",      metrics.get("iou")),
        ("color",    metrics.get("color_score")),
    ]
    total = 0.0
    used = 0.0
    for key, val in pairs:
        if val is None:
            continue
        w = float(weights.get(key, 0.0) or 0.0)
        if w <= 0:
            continue
        total += w * float(val)
        used += w
    if used <= 0:
        return 0.0
    return float(total / used)


# ---------- prompt templating ----------------------------------------------

def _region_label(x_norm: float, y_norm: float) -> str:
    cols = ["left", "center", "right"]
    rows = ["top", "middle", "bottom"]
    col = cols[0 if x_norm < 1/3 else (1 if x_norm < 2/3 else 2)]
    row = rows[0 if y_norm < 1/3 else (1 if y_norm < 2/3 else 2)]
    if col == "center" and row == "middle":
        return "the exact center"
    if col == "center":
        return f"the {row}-center"
    if row == "middle":
        return f"the middle-{col}"
    return f"the {row}-{col}"


def _shape_descriptor(
    shape: Dict[str, Any],
    width: int,
    height: int,
) -> str:
    cx, cy = shape["position"]
    w, h = _size_wh(shape.get("size", 100))
    x_norm = float(cx) / float(width)
    y_norm = float(cy) / float(height)
    return (
        f"a solid {_color_name(shape.get('color', '#000000'))} "
        f"({shape.get('color', '#000000')}) {_shape_type_label(shape)}, "
        f"{_shape_size_desc(shape)}, with its CENTER at pixel "
        f"({int(cx)}, {int(cy)}) — "
        f"that is {x_norm * 100:.1f}% from the left and {y_norm * 100:.1f}% "
        f"from the top, in {_region_label(x_norm, y_norm)} of the image"
    )


def _build_template_vars(
    case: Dict[str, Any],
    shapes: List[Dict[str, Any]],
    width: int,
    height: int,
    background: str,
) -> Dict[str, str]:
    """Build template variables. Single-shape vars come from the first shape;
    ``{shapes_list}`` and ``{shape_count}`` describe all shapes for multi-shape cases.
    """
    primary = shapes[0]
    cx, cy = primary["position"]
    w, h = _size_wh(primary.get("size", 100))
    x_norm = float(cx) / float(width)
    y_norm = float(cy) / float(height)
    size_pct_w = 100.0 * w / width
    size_pct_h = 100.0 * h / height

    bullets = "\n".join(f"- {_shape_descriptor(s, width, height)}" for s in shapes)

    return {
        "shape_type": _shape_type_label(primary),
        "shape_color_name": _color_name(primary.get("color", "#000000")),
        "shape_color_hex": primary.get("color", "#000000"),
        "x": str(int(cx)),
        "y": str(int(cy)),
        "x_norm": f"{x_norm:.3f}",
        "y_norm": f"{y_norm:.3f}",
        "x_pct": f"{x_norm * 100:.1f}",
        "y_pct": f"{y_norm * 100:.1f}",
        "region": _region_label(x_norm, y_norm),
        "width": str(int(width)),
        "height": str(int(height)),
        "shape_width": str(int(w)),
        "shape_height": str(int(h)),
        "shape_size_pct_w": f"{size_pct_w:.1f}",
        "shape_size_pct_h": f"{size_pct_h:.1f}",
        "size_desc": _shape_size_desc(primary),
        "background_color_name": _color_name(background or "#FFFFFF"),
        "background_hex": background or "#FFFFFF",
        "case_name": str(case.get("name", "")),
        "shape_count": str(len(shapes)),
        "shapes_list": bullets,
    }


def _render_template(template: str, variables: Dict[str, str]) -> str:
    out = template
    for key, val in variables.items():
        out = out.replace("{" + key + "}", val)
    return out


# ---------- run loop --------------------------------------------------------

def _download_image(url: str, timeout: int = 60) -> Image.Image:
    data = requests.get(url, timeout=timeout).content
    return Image.open(io.BytesIO(data)).convert("RGB")


def run_position_benchmark(
    *,
    project_root: Path,
    config: Dict[str, Any],
    benchmark_cfg: Dict[str, Any],
    template: str,
    client: Optional[GrokClient],
    dry_run: bool = False,
) -> int:
    pos = benchmark_cfg.get("position") or {}
    if not pos:
        raise ValueError("benchmark.json is missing a 'position' section")

    cases: List[Dict[str, Any]] = list(pos.get("cases") or [])
    if not cases:
        raise ValueError("benchmark.json position.cases is empty")

    image_cfg = config.get("image", {}) if isinstance(config.get("image"), dict) else {}
    width = int(pos.get("width") or 1024)
    height = int(pos.get("height") or 1024)
    aspect_ratio = pos.get("aspect_ratio") or image_cfg.get("aspect_ratio") or config.get("aspect_ratio") or "1:1"
    resolution = pos.get("resolution") or image_cfg.get("resolution") or config.get("image_resolution") or "1k"
    model = pos.get("model") or image_cfg.get("model") or config.get("model") or "grok-imagine-image"
    iterations = int(pos.get("iterations", 1))
    background = pos.get("background", "#FFFFFF")
    weights = pos.get("score_weights") or {
        "ssim": 0.15,
        "position": 0.40,
        "size": 0.10,
        "iou": 0.25,
        "color": 0.10,
    }

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_root = project_root / ".rundeer" / "benchmark" / "position" / "outputs" / run_id
    log_dir = project_root / ".rundeer" / "logs" / "benchmark" / "position"
    out_root.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n== benchmark/position (run {run_id}) ==")
    print(f"Reference size: {width}x{height}  aspect={aspect_ratio}  resolution={resolution}  model={model}")
    print(f"Cases: {len(cases)}  iterations/case: {iterations}")
    print(f"Output:  {out_root}")
    print(f"Log:     {log_dir / (run_id + '.json')}")

    results: List[Dict[str, Any]] = []
    failures = 0

    for case_idx, case in enumerate(cases, start=1):
        name = case.get("name") or f"case_{case_idx:02d}"
        # Accept either `shape` (single) or `shapes` (list).
        if "shapes" in case and case["shapes"]:
            shapes = list(case["shapes"])
        elif case.get("shape") is not None:
            shapes = [case["shape"]]
        else:
            print(f"  [{name}] SKIP: no shape(s) defined")
            failures += 1
            continue

        bg = case.get("background", background)
        ref_img = render_reference(width, height, bg, shapes)
        ref_path = out_root / f"{name}_reference.png"
        ref_img.save(ref_path, format="PNG", optimize=True)

        tvars = _build_template_vars(case, shapes, width, height, bg)
        prompt = _render_template(template, tvars).strip()

        print(f"\n  [{name}] reference -> {ref_path.name} ({len(shapes)} shape(s))")
        print(f"  prompt: {prompt[:200]}{'...' if len(prompt) > 200 else ''}")

        for it in range(1, iterations + 1):
            gen_path = out_root / f"{name}_generated_{it:02d}.png"
            entry: Dict[str, Any] = {
                "case": name,
                "iteration": it,
                "prompt": prompt,
                "model": model,
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
                "reference_path": str(ref_path),
                "generated_path": str(gen_path),
                "shapes": shapes,
                "background": bg,
                "width": width,
                "height": height,
                "ssim": None,
                "score": None,
                "shape_metrics": None,
                "score_weights": weights,
                "error": None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            if dry_run:
                print(f"    iter {it}: DRY-RUN (would call {model})")
                results.append(entry)
                continue

            assert client is not None
            try:
                t0 = time.time()
                responses = client.generate_image(
                    prompt=prompt,
                    model=model,
                    n=1,
                    aspect_ratio=aspect_ratio,
                    resolution=resolution,
                )
                if not responses:
                    raise RuntimeError("empty response from image API")
                url = responses[0].url
                entry["result_url"] = url
                gen_img = _download_image(url)
                gen_img.save(gen_path, format="PNG", optimize=True)

                ssim_score = compute_ssim(ref_img, gen_img)
                entry["ssim"] = ssim_score

                # Per-shape detection + scoring.
                shape_metrics: List[Dict[str, Any]] = []
                shape_scores: List[float] = []
                for sh in shapes:
                    expected_size = _size_wh(sh.get("size", 100))
                    detection = detect_shape(
                        gen_img,
                        target_color=sh.get("color", "#000000"),
                        background_color=bg,
                        target_size=expected_size,
                        near_xy_ref=tuple(sh["position"]),
                        ref_image_size=(width, height),
                    )
                    pos_metrics = score_position(
                        expected_xy=tuple(sh["position"]),
                        expected_size=expected_size,
                        detection=detection,
                        image_size=(width, height),
                    )
                    expected_mask = render_shape_mask(width, height, sh)
                    iou = compute_iou(expected_mask, detection, (width, height))
                    mean_de, color_score = compute_color_score(sh.get("color", "#000000"), detection)

                    sm: Dict[str, Any] = {
                        "shape": sh,
                        "detected": pos_metrics["detected"],
                        "position_score": pos_metrics["position_score"],
                        "size_score": pos_metrics["size_score"],
                        "centroid_delta_px": pos_metrics.get("centroid_delta_px"),
                        "centroid_delta_xy": pos_metrics.get("centroid_delta_xy"),
                        "size_ratio": pos_metrics.get("size_ratio"),
                        "iou": round(iou, 4) if iou is not None else None,
                        "delta_e_2000_mean": mean_de,
                        "color_score": color_score,
                        "detected_centroid_ref": pos_metrics.get("detected_centroid_ref"),
                        "bbox_ref": pos_metrics.get("bbox_ref"),
                        "detection": _serializable_detection(detection),
                    }
                    # Per-shape combined (excludes SSIM, which is image-wide)
                    sm["combined_shape_score"] = combined_score(
                        {
                            "position_score": sm["position_score"],
                            "size_score": sm["size_score"],
                            "iou": sm["iou"],
                            "color_score": sm["color_score"],
                        },
                        weights,
                    )
                    shape_metrics.append(sm)
                    shape_scores.append(sm["combined_shape_score"])

                # Case-level metrics (means across shapes).
                def _mean(values: List[Optional[float]]) -> Optional[float]:
                    vs = [float(v) for v in values if v is not None]
                    return sum(vs) / len(vs) if vs else None

                avg_pos = _mean([s["position_score"] for s in shape_metrics])
                avg_size = _mean([s["size_score"] for s in shape_metrics])
                avg_iou = _mean([s["iou"] for s in shape_metrics])
                avg_color = _mean([s["color_score"] for s in shape_metrics])
                avg_delta = _mean([s["centroid_delta_px"] for s in shape_metrics])

                final = combined_score(
                    {
                        "ssim": ssim_score,
                        "position_score": avg_pos,
                        "size_score": avg_size,
                        "iou": avg_iou,
                        "color_score": avg_color,
                    },
                    weights,
                )

                entry["shape_metrics"] = shape_metrics
                entry["score"] = final
                entry["case_aggregates"] = {
                    "position_score": avg_pos,
                    "size_score": avg_size,
                    "iou": avg_iou,
                    "color_score": avg_color,
                    "centroid_delta_px": avg_delta,
                    "detected_count": sum(1 for s in shape_metrics if s["detected"]),
                    "shape_count": len(shape_metrics),
                }
                entry["elapsed_s"] = round(time.time() - t0, 2)

                detected_n = entry["case_aggregates"]["detected_count"]
                parts = [f"score={final:.4f}", f"SSIM={ssim_score:.3f}"]
                if avg_pos is not None:
                    parts.append(f"pos={avg_pos:.3f}")
                if avg_delta is not None:
                    parts.append(f"Δ={avg_delta:.1f}px")
                if avg_iou is not None:
                    parts.append(f"IoU={avg_iou:.3f}")
                if avg_color is not None:
                    parts.append(f"color={avg_color:.3f}")
                parts.append(f"detected={detected_n}/{len(shape_metrics)}")
                parts.append(f"({entry['elapsed_s']}s)")
                print(f"    iter {it}: " + " ".join(parts) + f" -> {gen_path.name}")
            except Exception as e:  # noqa: BLE001
                failures += 1
                entry["error"] = str(e)
                print(f"    iter {it}: FAILED {e}")
            results.append(entry)

    # Aggregate
    scored = [r for r in results if isinstance(r.get("score"), (int, float))]

    def _avg(key_path: List[str]) -> Optional[float]:
        vals: List[float] = []
        for r in scored:
            cur: Any = r
            for k in key_path:
                cur = cur.get(k) if isinstance(cur, dict) else None
                if cur is None:
                    break
            if isinstance(cur, (int, float)):
                vals.append(float(cur))
        return sum(vals) / len(vals) if vals else None

    avg_score = _avg(["score"])
    avg_ssim = _avg(["ssim"])
    avg_pos = _avg(["case_aggregates", "position_score"])
    avg_size = _avg(["case_aggregates", "size_score"])
    avg_iou = _avg(["case_aggregates", "iou"])
    avg_color = _avg(["case_aggregates", "color_score"])
    avg_delta = _avg(["case_aggregates", "centroid_delta_px"])
    detected_runs = sum(
        1 for r in scored
        if r.get("case_aggregates", {}).get("detected_count", 0) > 0
    )

    summary = {
        "run_id": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "width": width,
        "height": height,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "model": model,
        "iterations_per_case": iterations,
        "case_count": len(cases),
        "scored_count": len(scored),
        "detected_run_count": detected_runs,
        "failures": failures,
        "score_weights": weights,
        "average_score": avg_score,
        "average_ssim": avg_ssim,
        "average_position_score": avg_pos,
        "average_size_score": avg_size,
        "average_iou": avg_iou,
        "average_color_score": avg_color,
        "average_centroid_delta_px": avg_delta,
        "results": results,
    }
    log_path = log_dir / f"{run_id}.json"
    log_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")

    # Per-iteration CSV summary
    csv_path = log_dir / f"{run_id}.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "run_id", "case", "iteration", "shape_count",
            "score", "ssim",
            "position_score", "size_score", "iou", "color_score",
            "centroid_delta_px", "detected_count",
            "model", "resolution", "aspect_ratio",
            "reference_path", "generated_path", "error",
        ])
        for r in results:
            agg = r.get("case_aggregates") or {}
            w.writerow([
                run_id,
                r.get("case", ""),
                r.get("iteration", ""),
                agg.get("shape_count", ""),
                _fmt(r.get("score")),
                _fmt(r.get("ssim")),
                _fmt(agg.get("position_score")),
                _fmt(agg.get("size_score")),
                _fmt(agg.get("iou")),
                _fmt(agg.get("color_score")),
                _fmt(agg.get("centroid_delta_px")),
                agg.get("detected_count", ""),
                r.get("model", ""),
                r.get("resolution", ""),
                r.get("aspect_ratio", ""),
                r.get("reference_path", ""),
                r.get("generated_path", ""),
                r.get("error") or "",
            ])

    # Append to a rolling all-runs CSV for cross-run analysis.
    all_csv = log_dir / "all_runs.csv"
    write_header = not all_csv.exists()
    with all_csv.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if write_header:
            w.writerow([
                "run_id", "timestamp", "model", "resolution",
                "case_count", "iterations", "scored",
                "average_score", "average_ssim",
                "average_position_score", "average_size_score",
                "average_iou", "average_color_score",
                "average_centroid_delta_px",
            ])
        w.writerow([
            run_id, summary["timestamp"], model, resolution,
            len(cases), iterations, len(scored),
            _fmt(avg_score), _fmt(avg_ssim),
            _fmt(avg_pos), _fmt(avg_size),
            _fmt(avg_iou), _fmt(avg_color),
            _fmt(avg_delta),
        ])

    print(f"\nResults: {len(scored)} scored / {len(results)} runs / {failures} failures")
    print(f"  runs with at least one detection: {detected_runs} / {len(scored)}")
    if avg_score is not None:
        print(f"  average combined score:  {avg_score:.4f}")
    if avg_ssim is not None:
        print(f"  average SSIM:            {avg_ssim:.4f}")
    if avg_pos is not None:
        print(f"  average position score:  {avg_pos:.4f}")
    if avg_delta is not None:
        print(f"  average centroid delta:  {avg_delta:.1f} px")
    if avg_size is not None:
        print(f"  average size score:      {avg_size:.4f}")
    if avg_iou is not None:
        print(f"  average IoU:             {avg_iou:.4f}")
    if avg_color is not None:
        print(f"  average color score:     {avg_color:.4f}")
    print(f"Log:    {log_path}")
    print(f"CSV:    {csv_path}")
    print(f"Trend:  {all_csv}")

    return 0 if failures == 0 else 1


def _fmt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.4f}"
    return str(v)
