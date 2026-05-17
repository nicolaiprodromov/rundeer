"""Tests for the agent brain graph: seeding, compilation, persistence,
and self-modify tool patches."""
from __future__ import annotations

from pathlib import Path

from rundeer.web.agent.brain_graph import (
    compile_brain_graph,
    load_or_seed_brain_graph,
    load_runtime_config,
    save_brain_graph,
)
from rundeer.web.agent.tools_impl import brain_mutate


def test_seed_default_graph_has_required_singletons(tmp_path: Path):
    g = load_or_seed_brain_graph(tmp_path)
    types = {n.get("type") for n in g["nodes"].values()}
    assert "agent" in types
    assert "brain" in types
    assert "preview" in types
    assert any(n.get("type") == "text-input" for n in g["nodes"].values())
    assert any(n.get("type") == "tool-flag" for n in g["nodes"].values())
    brain_id = next(n["id"] for n in g["nodes"].values() if n.get("type") == "brain")
    agent_id = next(n["id"] for n in g["nodes"].values() if n.get("type") == "agent")
    preview_id = next(n["id"] for n in g["nodes"].values() if n.get("type") == "preview")
    assert any(e.get("fromNode") == brain_id and e.get("toNode") == agent_id and e.get("toSocket") == "brain" for e in g["edges"])
    assert any(e.get("fromNode") == brain_id and e.get("toNode") == preview_id and e.get("toSocket") == "in" for e in g["edges"])


def test_load_or_seed_replaces_legacy_brain_graph(tmp_path: Path):
    agent_dir = tmp_path / ".rundeer" / "agent"
    agent_dir.mkdir(parents=True)
    (agent_dir / "brain.graph.json").write_text(
        '{"nodes":{"old":{"id":"old","type":"system-prompt-root","props":{}}},"edges":[]}',
        encoding="utf-8",
    )
    g = load_or_seed_brain_graph(tmp_path)
    types = {n.get("type") for n in g["nodes"].values()}
    assert "system-prompt-root" not in types
    assert {"agent", "brain"}.issubset(types)


def test_compile_includes_enabled_tools_only(tmp_path: Path):
    g = load_or_seed_brain_graph(tmp_path)
    for n in g["nodes"].values():
        if n.get("type") == "tool-flag" and (n.get("props") or {}).get("tool_name") == "read_file":
            n["props"]["enabled"] = False
            break
    compiled = compile_brain_graph(g)
    assert "read_file" in compiled.tool_overrides
    assert compiled.tool_overrides["read_file"].enabled is False


def test_compiled_prompt_includes_every_seeded_section(tmp_path: Path):
    g = load_or_seed_brain_graph(tmp_path)
    compiled = compile_brain_graph(g).system_prompt
    expected_headings = [
        "# Intro",
        "# How you work",
        "# Graph model (node-editor canvas)",
        "# Style brains",
        "# Safety & gating",
        "# Tone",
    ]
    positions = [compiled.find(heading) for heading in expected_headings]
    assert all(pos >= 0 for pos in positions)
    assert positions == sorted(positions)


def test_preview_text_renderer_does_not_truncate_brain_output():
    js = (Path(__file__).parents[1] / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")
    assert "pre.textContent = value.slice" not in js
    assert "buildReadonlyMarkdownViewer(node, value" in js
    assert "renderInlineMarkdown(text, markdownNodeId" in js


def test_save_and_reload_round_trip(tmp_path: Path):
    g = load_or_seed_brain_graph(tmp_path)
    compiled = save_brain_graph(tmp_path, g)
    assert compiled.system_prompt
    runtime = load_runtime_config(tmp_path)
    assert runtime.system_prompt == compiled.system_prompt


def test_set_tool_flag_emits_brain_patch(tmp_path: Path):
    load_or_seed_brain_graph(tmp_path)
    res = brain_mutate.set_tool_flag(root=tmp_path, tool_name="read_file", enabled=False)
    assert res["patch_target"] == "brain"
    op = res["patch"][0]
    assert op["op"] == "set_props"
    assert op["props"]["enabled"] is False


def test_set_system_prompt_section_validates_id(tmp_path: Path):
    load_or_seed_brain_graph(tmp_path)
    res = brain_mutate.set_system_prompt_section(root=tmp_path, section_id="missing", body="x")
    assert "error" in res


def test_add_system_prompt_section_creates_node_and_edge(tmp_path: Path):
    load_or_seed_brain_graph(tmp_path)
    res = brain_mutate.add_system_prompt_section(root=tmp_path, body="Be terse.")
    assert res["patch_target"] == "brain"
    ops = res["patch"]
    assert any(op["op"] == "add_node" and op["node"]["type"] == "text-input" for op in ops)
    assert any(op["op"] == "add_edge" for op in ops)


def test_set_agent_setting_rejects_unknown_key(tmp_path: Path):
    load_or_seed_brain_graph(tmp_path)
    res = brain_mutate.set_agent_setting(root=tmp_path, key="hax", value=1)
    assert "error" in res


def test_set_agent_setting_updates_agent_node(tmp_path: Path):
    load_or_seed_brain_graph(tmp_path)
    res = brain_mutate.set_agent_setting(root=tmp_path, key="temperature", value=0.4)
    assert res["patch_target"] == "brain"
    assert res["patch"][0]["op"] == "set_props"
    assert res["patch"][0]["props"]["temperature"] == 0.4
