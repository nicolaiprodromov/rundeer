"""Opt-in live smoke test against the configured image API.

Run with:
    RUNDEER_LIVE=1 VISION_API_KEY=... pytest -m live tests/test_live_smoke.py
"""
import os
import pytest

pytestmark = pytest.mark.live


@pytest.fixture(autouse=True)
def _require_live_flag():
    if os.environ.get("RUNDEER_LIVE") != "1":
        pytest.skip("RUNDEER_LIVE!=1; skipping live smoke test")
    if not os.environ.get("VISION_API_KEY"):
        pytest.skip("VISION_API_KEY not set; skipping live smoke test")


def test_live_image_generation(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from rundeer.cli import main
    rc = main([
        "image", "--style=Moebius", "--subject=deer",
        "--iterations=1", "--aspect-ratio=1:1", "--no-tui",
        "--output-dir", str(tmp_path / "out"),
    ])
    assert rc == 0
    outputs = list((tmp_path / "out").glob("output_*.png"))
    assert len(outputs) == 1
    assert outputs[0].stat().st_size > 0
