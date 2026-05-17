import os
import pytest
from rundeer.cli import commands as cli


def test_help_exits_zero(capsys):
    rc = cli.main(["--help"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "rundeer" in out


def test_version(capsys):
    rc = cli.main(["--version"])
    assert rc == 0
    assert "rundeer" in capsys.readouterr().out


def test_unknown_command(capsys):
    rc = cli.main(["nope"])
    assert rc == 2


def test_web_uses_env_ports(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text(
        "PORT=8787\nAGENT_PORT=8788\nMODEL_NAME=grok-4.3\nMODEL_API_KEY=test\nBASE_URL=https://api.x.ai/v1\n",
        encoding="utf-8",
    )
    captured = {}

    def fake_serve(**kwargs):
        captured.update(kwargs)
        return 0

    import rundeer.web.server as server

    monkeypatch.setattr(server, "serve", fake_serve)
    rc = cli.main(["web", "--open"])
    assert rc == 0
    assert captured["port"] == 8787
    assert captured["agent_port"] == 8788


def test_dry_run_image_no_api(tmp_style, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    # Ensure no VISION_API_KEY needed since dry-run shouldn't create a client
    rc = cli.main(["image", "--style=TestStyle", "--subject=deer",
                   "--iterations=2", "--dry-run", "--no-tui"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "dry-run" in out
    assert "Jobs: 2" in out


def test_dry_run_video_no_api(tmp_style, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    rc = cli.main(["video", "--style=TestStyle", "--subject=deer",
                   "--iterations=1", "--duration=4", "--dry-run", "--no-tui"])
    assert rc == 0
    assert "Jobs: 1" in capsys.readouterr().out


def test_video_start_frame_rejects_video_file(tmp_style, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"not an image")

    rc = cli.main(["video", "--style=TestStyle", "--subject=deer",
                   f"--start-frame={clip}", "--dry-run", "--no-tui"])

    assert rc == 2
    assert "--start-frame must be an image file" in capsys.readouterr().err


def test_dry_run_merge_requires_input(tmp_style, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    rc = cli.main(["merge", "--style=TestStyle", "--subject=x",
                   "--dry-run", "--no-tui"])
    assert rc == 2  # ValueError from missing --input


def test_dry_run_extend_requires_source(tmp_style, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    rc = cli.main(["extend", "--style=TestStyle", "--subject=x",
                   "--dry-run", "--no-tui"])
    assert rc == 2
