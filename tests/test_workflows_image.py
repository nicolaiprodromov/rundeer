from rundeer.core.batch import JobState
from rundeer.workflows import image_gen


def test_image_build_jobs(tmp_style, fake_client, fake_download, tmp_path):
    plan = image_gen.build_jobs(
        style="TestStyle", subject="deer", references=[],
        iterations=3, aspect_ratio="1:1", model="grok-imagine-image",
        pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="x",
        cache_dir=tmp_path / "cache",
    )
    assert len(plan["jobs"]) == 3
    assert plan["ref_count"] == 0
    assert "deer" in plan["prompt"]


def test_image_with_refs_appends_style_suffix(tmp_style, tmp_path):
    plan = image_gen.build_jobs(
        style="TestStyle", subject="deer", references=[0, 1],
        iterations=1, aspect_ratio="1:1", model="grok-imagine-image",
        pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="x",
        cache_dir=tmp_path / "cache",
    )
    assert plan["ref_count"] == 2
    assert "STYLE REFERENCES ONLY" in plan["prompt"]


def test_image_run_happy_path(tmp_style, fake_client, fake_download, tmp_path):
    plan = image_gen.build_jobs(
        style="TestStyle", subject="deer", references=[],
        iterations=2, aspect_ratio="1:1", model="grok-imagine-image",
        pad_reference=True, ref_quality=60,
        output_dir_arg=str(tmp_path / "out"), output_name="x",
        cache_dir=tmp_path / "cache",
    )
    result = image_gen.run(
        client=fake_client, plan=plan, concurrency=2,
        reporter=lambda ev: None, grid=True, output_name="x",
    )
    assert all(j.state == JobState.DONE for j in result["jobs"])
    assert result["grid"] is not None
    assert result["grid"].exists()
    # 2 API calls made
    assert sum(1 for c in fake_client.calls if c["kind"] == "image") == 2
