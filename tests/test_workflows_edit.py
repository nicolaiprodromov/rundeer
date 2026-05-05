import pytest
from rundeer.core.batch import JobState
from rundeer.workflows import edit as edit_mod


def test_edit_image_single_input_suffix(tmp_style, fake_client, fake_download, tmp_path, tmp_image):
    plan = edit_mod.build_jobs(
        type_="image", style="TestStyle", subject="make it gold", motion=None,
        inputs=[tmp_image], references=[], iterations=1,
        aspect_ratio="1:1", model=None, duration=4, resolution="480p",
        pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="e",
        cache_dir=tmp_path / "cache",
    )
    edit_mod.run(client=fake_client, plan=plan, concurrency=1,
                 reporter=lambda ev: None, grid=False, output_name="e")
    call = fake_client.calls[0]
    assert call["kind"] == "image"
    assert len(call["image_urls"]) == 1
    assert "subject to edit" in call["prompt"]


def test_edit_image_multi_has_style_suffix(tmp_style, fake_client, fake_download, tmp_path, tmp_image):
    plan = edit_mod.build_jobs(
        type_="image", style="TestStyle", subject="merge into ref world", motion=None,
        inputs=[tmp_image], references=[0, 1], iterations=1,
        aspect_ratio="1:1", model=None, duration=4, resolution="480p",
        pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="e",
        cache_dir=tmp_path / "cache",
    )
    edit_mod.run(client=fake_client, plan=plan, concurrency=1,
                 reporter=lambda ev: None, grid=False, output_name="e")
    call = fake_client.calls[0]
    assert len(call["image_urls"]) == 3
    assert "STYLE REFERENCES ONLY" in call["prompt"]


def test_edit_video_splits_image_and_refs(tmp_style, fake_client, fake_download, tmp_path, tmp_image):
    plan = edit_mod.build_jobs(
        type_="video", style="TestStyle", subject="night scene", motion="neon",
        inputs=[tmp_image], references=[0], iterations=1,
        aspect_ratio="16:9", model=None, duration=4, resolution="480p",
        pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="e",
        cache_dir=tmp_path / "cache",
    )
    edit_mod.run(client=fake_client, plan=plan, concurrency=1,
                 reporter=lambda ev: None, grid=False, output_name="e")
    call = [c for c in fake_client.calls if c["kind"] == "video"][0]
    assert call["image"] is not None
    assert call["reference_images"] is not None
    assert len(call["reference_images"]) == 1


def test_edit_enforces_5_image_cap(tmp_style, tmp_path, tmp_image):
    with pytest.raises(ValueError, match="5-image cap"):
        edit_mod.build_jobs(
            type_="image", style="TestStyle", subject="x", motion=None,
            inputs=[tmp_image, tmp_image, tmp_image], references=[0, 1, 2],
            iterations=1, aspect_ratio="1:1", model=None, duration=4, resolution="480p",
            pad_reference=True, ref_quality=60,
            output_dir_arg=str(tmp_path / "out"), output_name="e",
            cache_dir=tmp_path / "cache",
        )


def test_edit_requires_input(tmp_style, tmp_path):
    with pytest.raises(ValueError, match="requires at least one"):
        edit_mod.build_jobs(
            type_="image", style="TestStyle", subject="x", motion=None,
            inputs=[], references=[], iterations=1,
            aspect_ratio="1:1", model=None, duration=4, resolution="480p",
            pad_reference=True, ref_quality=60,
            output_dir_arg=str(tmp_path / "out"), output_name="e",
            cache_dir=tmp_path / "cache",
        )
