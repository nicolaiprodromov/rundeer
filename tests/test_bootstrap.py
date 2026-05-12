import json

from rundeer.scaffold.bootstrap import ensure_rundeer_dir


def test_creates_structure(tmp_path):
    root = ensure_rundeer_dir(tmp_path)
    assert (root / "config.json").exists()
    assert (root / "outputs").is_dir()
    assert (root / "logs").is_dir()
    assert (root / "cache").is_dir()
    assert (root / "skill").is_dir()
    assert (root / "skill" / "SKILL.md").exists()


def test_idempotent(tmp_path):
    ensure_rundeer_dir(tmp_path)
    (tmp_path / ".rundeer" / "config.json").write_text("CUSTOM")
    ensure_rundeer_dir(tmp_path)
    assert (tmp_path / ".rundeer" / "config.json").read_text() == "CUSTOM"


def test_default_config_includes_command_node_sections(tmp_path):
    root = ensure_rundeer_dir(tmp_path)
    config = json.loads((root / "config.json").read_text(encoding="utf-8"))

    assert config["batch"]["grid_options"]["rows"] == "auto"
    assert config["batch"]["grid_only"] is False
    assert config["batch"]["chain_threshold"] == 12
    assert config["image"]["resolution"] is None
    assert config["video"]["output_dir"] is None
