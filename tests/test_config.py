from rundeer.core.config import (
    parse_references, parse_inputs, parse_aspect_ratio, fill_prompt, resolve_references,
    resolve_style_dir, resolve_definitions, normalize_config,
)


def test_parse_references_string():
    assert parse_references("0,1,2", {}) == [0, 1, 2]
    assert parse_references("0 3 7", {}) == [0, 3, 7]


def test_parse_references_list():
    assert parse_references([5, 6], {}) == [5, 6]


def test_parse_references_caps_at_5():
    assert parse_references("0,1,2,3,4,5,6", {}) == [0, 1, 2, 3, 4]


def test_parse_references_int():
    assert parse_references(3, {}) == [3]


def test_parse_references_from_config():
    assert parse_references(None, {"references": [1, 2]}) == [1, 2]
    assert parse_references(None, {"reference": 4}) == [4]


def test_parse_references_empty():
    assert parse_references(None, {}) == []


def test_parse_inputs(tmp_path):
    a = tmp_path / "a.png"; a.write_bytes(b"x")
    b = tmp_path / "b.png"; b.write_bytes(b"y")
    paths = parse_inputs(f"{a},{b}")
    assert [p.name for p in paths] == ["a.png", "b.png"]


def test_parse_inputs_missing(tmp_path):
    import pytest
    with pytest.raises(FileNotFoundError):
        parse_inputs(str(tmp_path / "nope.png"))


def test_parse_inputs_none():
    assert parse_inputs(None) == []


def test_parse_aspect_ratio():
    assert parse_aspect_ratio("16:9") == 16 / 9
    assert parse_aspect_ratio("1:1") == 1.0


def test_fill_prompt():
    out = fill_prompt("hi [subject] moving [motion]", "deer", "slowly")
    assert out == "hi deer moving slowly"


def test_fill_prompt_missing_motion():
    out = fill_prompt("[subject]", "deer")
    assert out == "deer"


def test_fill_prompt_empty_template_keeps_subject():
    # Regression: an empty style template used to swallow the subject and
    # produce an empty prompt, leading to an opaque API error.
    assert fill_prompt("", "deer crossing a desert") == "deer crossing a desert"


def test_fill_prompt_template_without_placeholder_keeps_subject():
    out = fill_prompt("style notes only, no token here", "courier")
    assert "courier" in out
    assert "style notes only" in out


def test_normalize_rate_limits():
    cfg = normalize_config({
        "rate_limits": {
            "enabled": True,
            "per_second": "1",
            "per_minute": 30,
            "per_hour": 0,
            "per_day": "",
        }
    })

    assert cfg["rate_limits"] == {
        "enabled": True,
        "per_second": 1,
        "per_minute": 30,
        "per_hour": None,
        "per_day": None,
    }


def test_normalize_rate_limit_aliases():
    cfg = normalize_config({
        "rateLimiter": {
            "perSecond": "1",
            "perMinute": "30",
            "perHour": None,
            "perDay": 700,
        }
    })

    assert cfg["rate_limits"] == {
        "enabled": True,
        "per_second": 1,
        "per_minute": 30,
        "per_hour": None,
        "per_day": 700,
    }


def test_normalize_web_settings_defaults_and_overrides():
    cfg = normalize_config({"web": {"artifact_view": "tree", "dock_expanded": "true"}})

    assert cfg["web"]["artifact_view"] == "tree"
    assert cfg["web"]["artifact_size"] == "md"
    assert cfg["web"]["dock_expanded"] is True


def test_rate_limit_per_second_caps_cli_concurrency():
    from rundeer.cli.commands import _resolve_common

    args = {
        "--style": None,
        "--subject": None,
        "--iterations": None,
        "--aspect-ratio": None,
        "--model": None,
        "--output-dir": None,
        "--output-name": None,
        "--concurrency": None,
        "--grid": False,
        "--no-grid": False,
        "--no-tui": True,
        "--dry-run": False,
        "--verbose": False,
    }
    common = _resolve_common(args, {
        "rate_limits": {"enabled": True, "per_second": 1, "per_minute": 30},
    })

    assert common["concurrency"] == 1


def test_resolve_style_dir_error(tmp_style):
    import pytest
    with pytest.raises(FileNotFoundError):
        resolve_style_dir("NoSuchStyle")


def test_resolve_references(tmp_style):
    paths = resolve_references(tmp_style, [0, 1])
    assert len(paths) == 2
    assert all(p.exists() for p in paths)


def test_definitions_read_project_env_only(tmp_path, monkeypatch):
    monkeypatch.delenv("RUNDEER_TEST_LOCAL_SECRET", raising=False)
    workspace = tmp_path / "workspace"
    project = workspace / "projects" / "demo"
    def_dir = project / ".rundeer" / "def"
    (workspace / ".devcontainer").mkdir(parents=True)
    def_dir.mkdir(parents=True)
    (workspace / ".devcontainer" / ".env").write_text(
        "RUNDEER_TEST_LOCAL_SECRET=from_devcontainer\n", encoding="utf-8"
    )
    (project / ".env").write_text(
        "RUNDEER_TEST_LOCAL_SECRET=from_local\n", encoding="utf-8"
    )
    (def_dir / "env_echo.py").write_text(
        "import os\n\n"
        "def env_echo():\n"
        "    return os.environ.get('RUNDEER_TEST_LOCAL_SECRET', '')\n",
        encoding="utf-8",
    )

    out = resolve_definitions(
        "secret @env_echo",
        {"env_echo": ".rundeer/def/env_echo.py"},
        project,
    )

    assert out == "secret from_local"


def test_ancestor_and_rundeer_env_files_are_ignored(tmp_path, monkeypatch):
    monkeypatch.delenv("RUNDEER_TEST_IGNORED_SECRET", raising=False)
    workspace = tmp_path / "workspace"
    project = workspace / "projects" / "demo"
    def_dir = project / ".rundeer" / "def"
    (workspace / ".devcontainer").mkdir(parents=True)
    def_dir.mkdir(parents=True)
    (workspace / ".env").write_text(
        "RUNDEER_TEST_IGNORED_SECRET=from_parent\n", encoding="utf-8"
    )
    (workspace / ".devcontainer" / ".env").write_text(
        "RUNDEER_TEST_IGNORED_SECRET=from_devcontainer\n", encoding="utf-8"
    )
    (project / ".rundeer" / ".env").write_text(
        "RUNDEER_TEST_IGNORED_SECRET=from_rundeer\n", encoding="utf-8"
    )
    (def_dir / "env_echo.py").write_text(
        "import os\n\n"
        "def env_echo():\n"
        "    return os.environ.get('RUNDEER_TEST_IGNORED_SECRET', '')\n",
        encoding="utf-8",
    )

    out = resolve_definitions(
        "secret @env_echo",
        {"env_echo": ".rundeer/def/env_echo.py"},
        project,
    )

    assert out == "secret "


def test_project_env_overrides_process_env(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNDEER_TEST_DEF_SECRET", "from_process")
    project = tmp_path / "demo"
    def_dir = project / ".rundeer" / "def"
    def_dir.mkdir(parents=True)
    (project / ".env").write_text(
        "RUNDEER_TEST_DEF_SECRET=from_file\n", encoding="utf-8"
    )
    (def_dir / "env_echo.py").write_text(
        "import os\n\n"
        "def env_echo():\n"
        "    return os.environ.get('RUNDEER_TEST_DEF_SECRET', '')\n",
        encoding="utf-8",
    )

    out = resolve_definitions(
        "secret @env_echo",
        {"env_echo": ".rundeer/def/env_echo.py"},
        project,
    )

    assert out == "secret from_file"
