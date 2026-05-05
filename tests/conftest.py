"""Shared fixtures for rundeer tests."""
import io
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image


# Ensure the package parent is importable so `import rundeer` works.
PACKAGE_PARENT = Path(__file__).resolve().parents[2]
if str(PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_PARENT))


@pytest.fixture
def png_bytes():
    img = Image.new("RGB", (64, 48), (200, 100, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def tmp_image(tmp_path, png_bytes):
    p = tmp_path / "sample.png"
    p.write_bytes(png_bytes)
    return p


@pytest.fixture
def tmp_style(tmp_path, png_bytes, monkeypatch):
    """Create a fake style directory under a fake brain/ and point config.brain_dir to it."""
    brain = tmp_path / "brain"
    style = brain / "TestStyle"
    ref = style / "Reference"
    ref.mkdir(parents=True)
    (style / "teststyle.md").write_text(
        "Draw [subject] doing [motion] in TestStyle.", encoding="utf-8"
    )
    for i in range(3):
        (ref / f"{i:04d}_test.png").write_bytes(png_bytes)

    from rundeer.core import config as cfg
    monkeypatch.setattr(cfg, "brain_dir", lambda: brain)
    return style


class _Resp:
    def __init__(self, url):
        self.url = url


class FakeGrokClient:
    """Drop-in for rundeer.api.GrokClient."""

    def __init__(self, image_url="https://example.com/img.png",
                 video_url="https://example.com/video.mp4",
                 image_error=None, video_error=None):
        self.image_url = image_url
        self.video_url = video_url
        self.image_error = image_error
        self.video_error = video_error
        self.calls = []

    def generate_image(self, *, prompt, model, n=1, aspect_ratio="1:1", image_urls=None, resolution=None):
        self.calls.append({"kind": "image", "prompt": prompt, "model": model, "n": n,
                           "aspect_ratio": aspect_ratio, "image_urls": image_urls,
                           "resolution": resolution})
        if self.image_error:
            raise self.image_error
        return [_Resp(self.image_url) for _ in range(n)]

    def generate_video(self, *, prompt, model, duration=6, aspect_ratio="16:9",
                        resolution="720p", image=None, reference_images=None):
        self.calls.append({"kind": "video", "prompt": prompt, "model": model,
                           "duration": duration, "aspect_ratio": aspect_ratio,
                           "resolution": resolution, "image": image,
                           "reference_images": reference_images})
        if self.video_error:
            raise self.video_error
        return _Resp(self.video_url)

    def extend_video(self, *, prompt, source, model, duration=6):
        self.calls.append({"kind": "extend", "prompt": prompt, "source": source,
                           "model": model, "duration": duration})
        if self.video_error:
            raise self.video_error
        return _Resp(self.video_url)


@pytest.fixture
def fake_client():
    return FakeGrokClient()


@pytest.fixture
def fake_download(monkeypatch, png_bytes):
    """Stub out image/video downloads to avoid network."""
    from rundeer.core import media

    def fake_download_and_save_image(url, dest, timeout=60):
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(png_bytes)
        return dest

    def fake_download_url(url, dest, timeout=60):
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(b"fakevideo")
        return dest

    monkeypatch.setattr(media, "download_and_save_image", fake_download_and_save_image)
    monkeypatch.setattr(media, "download_url", fake_download_url)
    # Also patch in workflow modules that imported them
    from rundeer.workflows import image_gen, video_gen, edit as edit_mod, extend as extend_mod, merge as merge_mod
    for mod in (image_gen, edit_mod, merge_mod):
        if hasattr(mod, "download_and_save_image"):
            monkeypatch.setattr(mod, "download_and_save_image", fake_download_and_save_image)
    for mod in (video_gen, edit_mod, extend_mod):
        if hasattr(mod, "download_url"):
            monkeypatch.setattr(mod, "download_url", fake_download_url)
