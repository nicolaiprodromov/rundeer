import json
import sys

from rundeer.web.server import build_cli_command, build_run_config, load_settings, save_settings


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


def test_web_cli_command_uses_current_python(tmp_path):
    command, _config_path = build_cli_command(
        tmp_path,
        {"command": "image", "subject": "deer", "iterations": 1},
        "run-1",
        dry_run=True,
    )

    assert command[:2] == [sys.executable, "-c"]