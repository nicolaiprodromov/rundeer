import pytest
from rundeer.core.batch import JobState
from rundeer.workflows import extend as extend_mod


def test_extend_local_path(tmp_style, fake_client, fake_download, tmp_path):
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"fakevideo")
    plan = extend_mod.build_jobs(
        style="TestStyle", subject="continue", motion=None,
        source=str(src), iterations=1, model="grok-imagine-video",
        duration=4, output_dir_arg=str(tmp_path / "out"), output_name="v",
    )
    extend_mod.run(client=fake_client, plan=plan, concurrency=1,
                   reporter=lambda ev: None, grid=False, output_name="v")
    call = fake_client.calls[0]
    assert call["kind"] == "extend"
    assert call["source"].startswith("data:video/mp4;base64,")


def test_extend_url_passthrough(tmp_style, fake_client, fake_download, tmp_path):
    plan = extend_mod.build_jobs(
        style="TestStyle", subject="continue", motion=None,
        source="https://example.com/x.mp4", iterations=1,
        model="grok-imagine-video", duration=4,
        output_dir_arg=str(tmp_path / "out"), output_name="v",
    )
    extend_mod.run(client=fake_client, plan=plan, concurrency=1,
                   reporter=lambda ev: None, grid=False, output_name="v")
    call = fake_client.calls[0]
    assert call["source"] == "https://example.com/x.mp4"


def test_extend_requires_source(tmp_style, tmp_path):
    with pytest.raises(ValueError, match="requires --source"):
        extend_mod.build_jobs(
            style="TestStyle", subject="x", motion=None, source="",
            iterations=1, model="grok-imagine-video", duration=4,
            output_dir_arg=str(tmp_path / "out"), output_name="v",
        )
