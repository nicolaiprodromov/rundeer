
from __future__ import annotations

import io
import math
import shutil
import subprocess
import base64
import hashlib
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageOps

from rundeer.core.config import parse_aspect_ratio
from rundeer.core.paths import cache_dir


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


IMAGE_TRANSFORM_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
VIDEO_TRANSFORM_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def _cache_path(root: Path, subdir: str, stem: str, suffix: str, *key_parts: object) -> Path:
    target_cache_dir = cache_dir(root, subdir)
    target_cache_dir.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha1()
    for part in key_parts:
        h.update(str(part).encode("utf-8"))
        h.update(b"\x00")
    safe_stem = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in stem).strip("._") or "media"
    return target_cache_dir / f"{safe_stem}_{h.hexdigest()[:12]}{suffix}"


def _source_key(src: Path) -> str:
    stat = src.stat()
    return f"{src.resolve()}|{stat.st_mtime_ns}|{stat.st_size}"


def _save_rgba_png(image: Image.Image, dest: Path) -> Path:
    image.save(dest, format="PNG", optimize=True)
    return dest


def crop_media(root: Path, src: Path, size: Tuple[int, int], position: Tuple[int, int]) -> Path:

    width, height = max(1, int(size[0])), max(1, int(size[1]))
    x, y = int(round(position[0])), int(round(position[1]))
    ext = src.suffix.lower()
    if ext in IMAGE_TRANSFORM_EXTS:
        dest = _cache_path(root, "media", src.stem, ".png", "crop", _source_key(src), width, height, x, y)
        with Image.open(src) as im:
            im.load()
            source = im.convert("RGBA")
            top = source.height - y - height
            canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            left_src = max(0, x)
            top_src = max(0, top)
            right_src = min(source.width, x + width)
            bottom_src = min(source.height, top + height)
            if right_src > left_src and bottom_src > top_src:
                cropped = source.crop((left_src, top_src, right_src, bottom_src))
                canvas.alpha_composite(cropped, (left_src - x, top_src - top))
            return _save_rgba_png(canvas, dest)
    if ext in VIDEO_TRANSFORM_EXTS:
        if not has_ffmpeg():
            raise RuntimeError("ffmpeg not found on PATH; install ffmpeg to crop videos")
        dest = _cache_path(root, "media", src.stem, ".mp4", "crop", _source_key(src), width, height, x, y)
        y_expr = f"ih-{y}-{height}"
        vf = f"crop={width}:{height}:{x}:{y_expr},setsar=1"
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(dest),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {(proc.stderr or '').strip()[:400]}")
        return dest
    raise ValueError(f"unsupported media extension: {ext or '(none)'}")


def _resize_image(source: Image.Image, size: Tuple[int, int], mode: str) -> Image.Image:
    width, height = max(1, int(size[0])), max(1, int(size[1]))
    source = source.convert("RGBA")
    mode = (mode or "contain").lower()
    if mode == "stretch":
        return source.resize((width, height), Image.LANCZOS)
    if mode == "fill":
        return ImageOps.fit(source, (width, height), method=Image.LANCZOS, centering=(0.5, 0.5))
    if mode == "none":
        fitted = source.copy()
        fitted.thumbnail((width, height), Image.LANCZOS)
        return fitted
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    fitted = source.copy()
    fitted.thumbnail((width, height), Image.LANCZOS)
    x = (width - fitted.width) // 2
    y = (height - fitted.height) // 2
    canvas.alpha_composite(fitted, (x, y))
    return canvas


def resize_media(root: Path, src: Path, size: Tuple[int, int], mode: str = "contain") -> Path:





    width, height = max(1, int(size[0])), max(1, int(size[1]))
    mode = (mode or "contain").lower()
    if mode not in {"none", "fill", "stretch", "contain"}:
        raise ValueError(f"unknown resize mode: {mode}")
    ext = src.suffix.lower()
    if ext in IMAGE_TRANSFORM_EXTS:
        dest = _cache_path(root, "media", src.stem, ".png", "resize", _source_key(src), width, height, mode)
        with Image.open(src) as im:
            im.load()
            return _save_rgba_png(_resize_image(im, (width, height), mode), dest)
    if ext in VIDEO_TRANSFORM_EXTS:
        if not has_ffmpeg():
            raise RuntimeError("ffmpeg not found on PATH; install ffmpeg to resize videos")
        dest = _cache_path(root, "media", src.stem, ".mp4", "resize", _source_key(src), width, height, mode)
        if mode == "stretch":
            vf = f"scale={width}:{height},setsar=1"
        elif mode == "fill":
            vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"
        elif mode == "none":
            vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,setsar=1"
        else:
            vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(dest),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {(proc.stderr or '').strip()[:400]}")
        return dest
    raise ValueError(f"unsupported media extension: {ext or '(none)'}")


def canvas_images(root: Path, image_paths: List[Path], positions: List[Tuple[int, int]], size: Tuple[int, int]) -> Path:

    width, height = max(1, int(size[0])), max(1, int(size[1]))
    key_parts: List[object] = ["canvas", width, height]
    for path, pos in zip(image_paths, positions):
        key_parts.extend([_source_key(path), int(pos[0]), int(pos[1])])
    dest = _cache_path(root, "media", "canvas", ".png", *key_parts)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for idx, path in enumerate(image_paths):
        if path.suffix.lower() not in IMAGE_TRANSFORM_EXTS:
            raise ValueError(f"unsupported canvas image extension: {path.suffix.lower() or '(none)'}")
        x, y = positions[idx] if idx < len(positions) else (0, 0)
        with Image.open(path) as im:
            im.load()
            layer = im.convert("RGBA")
        left = int(round(x))
        top = height - int(round(y)) - layer.height
        src_left = max(0, -left)
        src_top = max(0, -top)
        src_right = min(layer.width, width - left)
        src_bottom = min(layer.height, height - top)
        if src_right <= src_left or src_bottom <= src_top:
            continue
        cropped = layer.crop((src_left, src_top, src_right, src_bottom))
        canvas.alpha_composite(cropped, (max(0, left), max(0, top)))
    return _save_rgba_png(canvas, dest)


def make_video_grid(
    output_dir: Path,
    output_name: str,
    count: int,
    *,
    rows=None,
    cols=None,
) -> Optional[Path]:

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

    import requests
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = requests.get(url, timeout=timeout).content
    img = Image.open(io.BytesIO(data))
    img.save(dest, format="PNG", optimize=True)
    return dest
