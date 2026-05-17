import json
import sys
from pathlib import Path

from rundeer.web.server import (
    build_cli_command,
    build_run_config,
    chat_completions_url,
    extract_frames,
    filter_prompt_image_urls,
    filter_prompt_messages,
    filter_prompt,
    list_folder,
    load_settings,
    save_settings,
)


class _FakeHTTPResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps({
            "choices": [{"message": {"content": "filtered prompt"}}]
        }).encode("utf-8")


def test_save_settings_preserves_config_and_normalizes(tmp_path):
    root = tmp_path
    config_path = root / ".rundeer" / "config.json"
    config_path.parent.mkdir()
    config_path.write_text(json.dumps({"style": "Moebius", "subject": "deer"}), encoding="utf-8")

    result = save_settings(root, {
        "settings": {
            "rate_limits": {"enabled": True, "per_second": "2", "per_minute": 0},
            "web": {"artifact_view": "tree", "artifact_size": "lg", "output_panel_open": False},
        }
    })

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["style"] == "Moebius"
    assert saved["subject"] == "deer"
    assert saved["rate_limits"]["per_second"] == 2
    assert saved["rate_limits"]["per_minute"] is None
    assert saved["web"]["artifact_view"] == "tree"
    assert saved["web"]["output_panel_open"] is False
    assert result["settings"]["rate_limits"]["enabled"] is True


def test_load_settings_returns_defaults(tmp_path):
    settings = load_settings(tmp_path)["settings"]

    assert settings["rate_limits"]["enabled"] is False
    assert settings["web"]["artifact_view"] == "grid"


def test_chat_completions_url_accepts_root_or_v1_base():
    assert chat_completions_url("https://api.x.ai") == "https://api.x.ai/v1/chat/completions"
    assert chat_completions_url("https://api.x.ai/v1") == "https://api.x.ai/v1/chat/completions"
    assert chat_completions_url("api.x.ai/v1/") == "https://api.x.ai/v1/chat/completions"
    assert chat_completions_url("https://api.x.ai/v1/chat/completions") == "https://api.x.ai/v1/chat/completions"


def test_filter_prompt_uses_normalized_v1_base_url(tmp_path, monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout=60):
        seen["url"] = req.full_url
        seen["body"] = json.loads(req.data.decode("utf-8"))
        seen["auth"] = req.headers.get("Authorization")
        return _FakeHTTPResponse()

    monkeypatch.setenv("MODEL_API_KEY", "model-key")
    monkeypatch.setenv("MODEL_NAME", "grok-4.3")
    monkeypatch.setenv("BASE_URL", "https://api.x.ai/v1")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    result = filter_prompt(tmp_path, {
        "prompt": "make it better",
        "instructions": "tighten",
        "model_name": "stale-node-model",
    })

    assert result == {"filtered_prompt": "filtered prompt"}
    assert seen["url"] == "https://api.x.ai/v1/chat/completions"
    assert seen["body"]["model"] == "grok-4.3"
    assert seen["auth"] == "Bearer model-key"


def test_filter_prompt_messages_include_image_context():
    messages = filter_prompt_messages("describe it", "extract details", ["data:image/png;base64,abc"])

    assert messages[0] == {"role": "system", "content": "extract details"}
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == [
        {"type": "text", "text": "describe it"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
    ]


def test_filter_prompt_encodes_local_images(tmp_path, png_bytes):
    image_path = tmp_path / "sample.png"
    image_path.write_bytes(png_bytes)

    urls = filter_prompt_image_urls(tmp_path, ["sample.png"])

    assert len(urls) == 1
    assert urls[0].startswith("data:image/jpeg;base64,")


def test_filter_prompt_posts_multimodal_body(tmp_path, monkeypatch, png_bytes):
    image_path = tmp_path / "sample.png"
    image_path.write_bytes(png_bytes)
    seen = {}

    def fake_urlopen(req, timeout=60):
        seen["body"] = json.loads(req.data.decode("utf-8"))
        return _FakeHTTPResponse()

    monkeypatch.setenv("MODEL_API_KEY", "model-key")
    monkeypatch.setenv("MODEL_NAME", "grok-4.3")
    monkeypatch.setenv("BASE_URL", "https://api.x.ai/v1")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    result = filter_prompt(tmp_path, {
        "prompt": "turn this into an image prompt",
        "instructions": "use visual facts from the image",
        "images": ["sample.png"],
        "model_name": "stale-node-model",
    })

    assert result == {"filtered_prompt": "filtered prompt"}
    assert seen["body"]["model"] == "grok-4.3"
    content = seen["body"]["messages"][1]["content"]
    assert content[0] == {"type": "text", "text": "turn this into an image prompt"}
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_web_run_config_inherits_persisted_rate_limits(tmp_path):
    config_path = tmp_path / ".rundeer" / "config.json"
    config_path.parent.mkdir()
    config_path.write_text(json.dumps({
        "rate_limits": {"enabled": True, "per_minute": 12},
    }), encoding="utf-8")

    config = build_run_config(tmp_path, {"subject": "map", "iterations": 1})

    assert config["rate_limits"] == {
        "enabled": True,
        "per_second": None,
        "per_minute": 12,
        "per_hour": None,
        "per_day": None,
    }


def test_web_run_config_accepts_config_shaped_sections(tmp_path):
    config = build_run_config(tmp_path, {
        "command": "edit",
        "style": "Goya",
        "subject": "restore the face",
        "motion": "slow push",
        "output": {"dir": "renders", "name": "take"},
        "batch": {
            "iterations": 3,
            "concurrency": 2,
            "grid": True,
            "grid_only": True,
            "grid_options": {"rows": 1, "columns": 3, "padding": 12, "bg_color": "#112233"},
            "chain": True,
            "chain_compose": True,
            "chain_threshold": 9,
            "chain_override": 44,
            "chain_dilate": 5,
            "chain_feather": 7,
            "chain_min_region": 32,
        },
        "references": {"ids": "1,2", "pad": False, "quality": 70},
        "image": {"model": "grok-imagine-image-pro", "aspect_ratio": "3:2", "resolution": "2k"},
        "video": {
            "model": "grok-imagine-video",
            "aspect_ratio": "9:16",
            "duration": 8,
            "resolution": "1080p",
            "concurrency": 1,
            "output_dir": "video-renders",
        },
    })

    assert config["style"] == "Goya"
    assert config["output"] == {"dir": "renders", "name": "take"}
    assert config["batch"]["iterations"] == 3
    assert config["batch"]["concurrency"] == 2
    assert config["batch"]["grid"] is True
    assert config["batch"]["grid_only"] is True
    assert config["batch"]["grid_options"]["padding"] == 12
    assert config["batch"]["grid_options"]["bg_color"] == "#112233"
    assert config["batch"]["chain"] is True
    assert config["batch"]["chain_compose"] is True
    assert config["batch"]["chain_min_region"] == 32
    assert config["references"] == {"ids": [1, 2], "pad": False, "quality": 70}
    assert config["image"] == {"model": "grok-imagine-image-pro", "aspect_ratio": "3:2", "resolution": "2k"}
    assert config["video"]["aspect_ratio"] == "9:16"
    assert config["video"]["resolution"] == "1080p"
    assert config["video"]["output_dir"] == "video-renders"


def test_web_cli_command_uses_current_python(tmp_path):
    command, _config_path = build_cli_command(
        tmp_path,
        {"command": "image", "subject": "deer", "iterations": 1},
        "run-1",
        dry_run=True,
    )

    assert command[:2] == [sys.executable, "-c"]


def test_list_folder_applies_modulo_after_range(tmp_path):
    frame_dir = tmp_path / "frames"
    frame_dir.mkdir()
    for idx in range(1, 8):
        (frame_dir / f"frame_{idx:02d}.png").write_bytes(b"png")

    result = list_folder(tmp_path, {
        "path": ["frames"],
        "kind": ["image"],
        "start": ["2"],
        "end": ["6"],
        "modulo": ["2"],
    })

    assert result["paths"] == ["frames/frame_02.png", "frames/frame_04.png", "frames/frame_06.png"]
    assert result["count"] == 3


def test_extract_frames_uses_modulo_filter(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"video")
    seen = {}

    def fake_run(cmd, check, capture_output):
        seen["cmd"] = cmd
        out_pattern = Path(cmd[-1])
        out_pattern.parent.mkdir(parents=True, exist_ok=True)
        for idx in range(1, 4):
            (out_pattern.parent / f"frame_{idx:06d}.png").write_bytes(b"png")

    monkeypatch.setattr("rundeer.web.server.shutil.which", lambda name: "/usr/bin/ffmpeg")
    monkeypatch.setattr("rundeer.web.server.subprocess.run", fake_run)

    result = extract_frames(tmp_path, video, fps=None, start=2, end=8, fmt="png", modulo=3)

    cmd = seen["cmd"]
    assert cmd[cmd.index("-vf") + 1] == "select='gte(n\\,1)*lte(n\\,7)*eq(mod(n-1\\,3)\\,0)',setpts=N/FRAME_RATE/TB"
    assert cmd[cmd.index("-frames:v") + 1] == "3"
    assert [Path(path).name for path in result["paths"]] == ["frame_000001.png", "frame_000002.png", "frame_000003.png"]
    assert result["count"] == 3