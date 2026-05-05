"""Media helpers: image padding, compression, encoding, grid composition."""
from __future__ import annotations

import io
import math
import shutil
import subprocess
import base64
import hashlib
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image

from rundeer.core.config import parse_aspect_ratio


def pad_to_aspect_ratio(image_path: Path, target_ratio: float) -> Tuple[bytes, str]:
    img = Image.open(image_path)
    src_w, src_h = img.size
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        raw = Path(image_path).read_bytes()
        suffix = image_path.suffix.lstrip(".").lower()
        mime = "image/png" if suffix == "png" else "image/jpeg"
        return raw, mime

    if src_ratio < target_ratio:
        new_w = round(src_h * target_ratio)
        new_h = src_h
    else:
        new_w = src_w
        new_h = round(src_w / target_ratio)

    canvas = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 0))
    offset_x = (new_w - src_w) // 2
    offset_y = (new_h - src_h) // 2
    canvas.paste(img.convert("RGBA"), (offset_x, offset_y))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue(), "image/png"


def compress_image(raw: bytes, quality: int) -> bytes:
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def encode_image(
    image_path: Path,
    aspect_ratio: str = "1:1",
    pad: bool = True,
    quality: int = 85,
    cache_dir: Optional[Path] = None,
) -> str:
    """Encode an image to a base64 data URI. Optionally caches by content+params hash."""
    key = None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        h = hashlib.sha256()
        h.update(Path(image_path).read_bytes())
        h.update(f"{aspect_ratio}|{pad}|{quality}".encode())
        key = cache_dir / f"{h.hexdigest()}.uri"
        if key.exists():
            return key.read_text(encoding="utf-8")

    if pad:
        target_ratio = parse_aspect_ratio(aspect_ratio)
        raw, _ = pad_to_aspect_ratio(image_path, target_ratio)
    else:
        raw = Path(image_path).read_bytes()

    raw = compress_image(raw, quality)
    data = base64.b64encode(raw).decode("utf-8")
    uri = f"data:image/jpeg;base64,{data}"

    if key:
        key.write_text(uri, encoding="utf-8")
    return uri


def make_image_grid(
    output_dir: Path,
    output_name: str,
    count: int,
    *,
    rows=None,
    cols=None,
    padding: int = 0,
    bg_color: str = "#000000",
) -> Optional[Path]:
    paths = [output_dir / f"{output_name}_{i:02d}.png" for i in range(1, count + 1)]
    images = [Image.open(p) for p in paths if p.exists()]
    if not images:
        return None

    n = len(images)
    if cols is None or cols == "auto":
        cols = math.ceil(math.sqrt(n))
    else:
        cols = int(cols)
    if rows is None or rows == "auto":
        rows = math.ceil(n / cols)
    else:
        rows = int(rows)

    cell_w = max(img.width for img in images)
    cell_h = max(img.height for img in images)

    # Parse hex color (#rrggbb)
    bg = bg_color.lstrip("#")
    bg_rgb = tuple(int(bg[i:i+2], 16) for i in (0, 2, 4))

    total_w = cols * cell_w + (cols + 1) * padding
    total_h = rows * cell_h + (rows + 1) * padding

    grid = Image.new("RGB", (total_w, total_h), bg_rgb)
    for idx, img in enumerate(images):
        col = idx % cols
        row = idx // cols
        x = padding + col * (cell_w + padding) + (cell_w - img.width) // 2
        y = padding + row * (cell_h + padding) + (cell_h - img.height) // 2
        grid.paste(img, (x, y))

    grid_path = output_dir / f"{output_name}_grid.png"
    grid.save(grid_path, format="PNG", optimize=True)
    return grid_path


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def make_video_grid(
    output_dir: Path,
    output_name: str,
    count: int,
    *,
    rows=None,
    cols=None,
) -> Optional[Path]:
    """Stitch videos into a grid using ffmpeg xstack. Returns None if ffmpeg missing or no inputs."""
    if not has_ffmpeg():
        return None
    paths = [output_dir / f"{output_name}_{i:02d}.mp4" for i in range(1, count + 1)]
    paths = [p for p in paths if p.exists()]
    if not paths:
        return None
    if len(paths) == 1:
        return paths[0]

    n = len(paths)
    if cols is None or cols == "auto":
        cols = math.ceil(math.sqrt(n))
    else:
        cols = int(cols)
    if rows is None or rows == "auto":
        rows = math.ceil(n / cols)
    else:
        rows = int(rows)

    # Build xstack layout
    layout_parts = []
    for i in range(n):
        r, c = divmod(i, cols)
        x = "+".join(["0"] + [f"w{j}" for j in range(r * cols, r * cols + c)]) if c > 0 else "0"
        y = "+".join(["0"] + [f"h{j}" for j in range(0, r * cols, cols)]) if r > 0 else "0"
        layout_parts.append(f"{x}_{y}")
    layout = "|".join(layout_parts)

    cmd = ["ffmpeg", "-y"]
    for p in paths:
        cmd.extend(["-i", str(p)])
    # Pad missing cells with black if not a perfect grid
    filter_inputs = "".join(f"[{i}:v]" for i in range(n))
    filter_complex = f"{filter_inputs}xstack=inputs={n}:layout={layout}[v]"
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
    ])
    grid_path = output_dir / f"{output_name}_grid.mp4"
    cmd.append(str(grid_path))

    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError:
        return None
    return grid_path


def download_url(url: str, dest: Path, timeout: int = 60) -> Path:
    import requests
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = requests.get(url, timeout=timeout).content
    dest.write_bytes(data)
    return dest


def download_and_save_image(url: str, dest: Path, timeout: int = 60) -> Path:
    """Download image URL and re-save as optimized PNG."""
    import requests
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = requests.get(url, timeout=timeout).content
    img = Image.open(io.BytesIO(data))
    img.save(dest, format="PNG", optimize=True)
    return dest
