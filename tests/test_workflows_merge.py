import pytest
from rundeer.core.batch import JobState
from rundeer.workflows import merge as merge_mod


def test_merge_happy(tmp_style, fake_client, fake_download, tmp_path, tmp_image):
    b = tmp_path / "b.png"; b.write_bytes(tmp_image.read_bytes())
    plan = merge_mod.build_jobs(
        style="TestStyle", subject="compose", inputs=[tmp_image, b],
        iterations=2, aspect_ratio="16:9", model="grok-imagine-image",
        pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="m",
        cache_dir=tmp_path / "cache",
    )
    merge_mod.run(client=fake_client, plan=plan, concurrency=2,
                  reporter=lambda ev: None, grid=False, output_name="m")
    calls = [c for c in fake_client.calls if c["kind"] == "image"]
    assert len(calls) == 2
    assert len(calls[0]["image_urls"]) == 2
    assert "Combine the provided images" in calls[0]["prompt"]


def test_merge_cap(tmp_style, tmp_path, tmp_image):
    paths = []
    for i in range(6):
        p = tmp_path / f"{i}.png"; p.write_bytes(tmp_image.read_bytes()); paths.append(p)
    with pytest.raises(ValueError, match="up to 5"):
        merge_mod.build_jobs(
            style="TestStyle", subject="x", inputs=paths, iterations=1,
            aspect_ratio="1:1", model="grok-imagine-image",
            pad_reference=True, ref_quality=60,
            output_dir_arg=str(tmp_path / "out"), output_name="m",
            cache_dir=tmp_path / "cache",
        )


def test_merge_requires_input(tmp_style, tmp_path):
    with pytest.raises(ValueError, match="requires --input"):
        merge_mod.build_jobs(
            style="TestStyle", subject="x", inputs=[], iterations=1,
            aspect_ratio="1:1", model="grok-imagine-image",
            pad_reference=True, ref_quality=60,
            output_dir_arg=str(tmp_path / "out"), output_name="m",
            cache_dir=tmp_path / "cache",
        )
