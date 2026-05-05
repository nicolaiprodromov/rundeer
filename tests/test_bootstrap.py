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
