from rundeer.core.batch import JobState
from rundeer.workflows import video_gen


def test_video_text_to_video(tmp_style, fake_client, fake_download, tmp_path):
    plan = video_gen.build_jobs(
        style="TestStyle", subject="deer", motion="slow pan",
        references=[], iterations=2, aspect_ratio="16:9",
        model="grok-imagine-video", duration=4, resolution="480p",
        start_frame=None, pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="v",
        cache_dir=tmp_path / "cache",
    )
    assert plan["has_start_frame"] is False
    result = video_gen.run(
        client=fake_client, plan=plan, concurrency=1,
        reporter=lambda ev: None, grid=False, output_name="v",
    )
    assert all(j.state == JobState.DONE for j in result["jobs"])
    video_calls = [c for c in fake_client.calls if c["kind"] == "video"]
    assert len(video_calls) == 2
    assert video_calls[0]["image"] is None
    assert video_calls[0]["reference_images"] is None
    assert "slow pan" in video_calls[0]["prompt"]


def test_video_image_to_video_with_refs(tmp_style, fake_client, fake_download, tmp_path, tmp_image):
    plan = video_gen.build_jobs(
        style="TestStyle", subject="deer", motion=None,
        references=[0, 1], iterations=1, aspect_ratio="16:9",
        model="grok-imagine-video", duration=4, resolution="480p",
        start_frame=tmp_image, pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="v",
        cache_dir=tmp_path / "cache",
    )
    assert plan["has_start_frame"] is True
    video_gen.run(
        client=fake_client, plan=plan, concurrency=1,
        reporter=lambda ev: None, grid=False, output_name="v",
    )
    call = [c for c in fake_client.calls if c["kind"] == "video"][0]
    assert call["image"] is not None
    assert call["image"].startswith("data:image/jpeg;base64,")
    assert call["reference_images"] is not None
    assert len(call["reference_images"]) == 2


def test_video_grid_skipped_when_no_ffmpeg(tmp_style, fake_client, fake_download, tmp_path, monkeypatch):
    from rundeer.workflows import video_gen as vg
    monkeypatch.setattr(vg, "has_ffmpeg", lambda: False)

    plan = vg.build_jobs(
        style="TestStyle", subject="deer", motion=None,
        references=[], iterations=2, aspect_ratio="16:9",
        model="grok-imagine-video", duration=4, resolution="480p",
        start_frame=None, pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="v",
        cache_dir=tmp_path / "cache",
    )
    result = vg.run(
        client=fake_client, plan=plan, concurrency=1,
        reporter=lambda ev: None, grid=True, output_name="v",
    )
    assert result["grid"] is None
