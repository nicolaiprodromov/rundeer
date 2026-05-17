"""Smoke tests for the rundeer agent package."""
from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path

import pytest


# ─── config ──────────────────────────────────────────────────────────────
def test_agent_settings_defaults(tmp_path: Path, monkeypatch):
    from rundeer.web.agent.config import get_agent_settings, resolve_ws_port

    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("MODEL_NAME", raising=False)
    monkeypatch.delenv("BASE_URL", raising=False)

    s = get_agent_settings(tmp_path)
    assert s.enabled
    assert s.model == ""  # no MODEL_NAME in env -> empty, no silent fallback
    assert s.api_key is None
    assert resolve_ws_port(s, 8787) == 8788


def test_agent_settings_env_overrides(tmp_path: Path, monkeypatch):
    from rundeer.web.agent.config import get_agent_settings

    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.setenv("MODEL_NAME", "grok-4.3")
    s = get_agent_settings(tmp_path)
    assert s.api_key == "test-key"
    assert s.model == "grok-4.3"


# ─── sandbox ─────────────────────────────────────────────────────────────
def test_sandbox_rejects_dotenv(tmp_path: Path):
    from rundeer.web.agent.sandbox import SandboxError, resolve_within, assert_readable

    (tmp_path / ".env").write_text("KEY=secret")
    p = resolve_within(tmp_path, ".env")
    with pytest.raises(SandboxError):
        assert_readable(tmp_path, p)


def test_sandbox_rejects_escape(tmp_path: Path):
    from rundeer.web.agent.sandbox import SandboxError, resolve_within

    with pytest.raises(SandboxError):
        resolve_within(tmp_path, "../../etc/passwd")


def test_sandbox_allows_safe_path(tmp_path: Path):
    from rundeer.web.agent.sandbox import resolve_within

    (tmp_path / "hello.py").write_text("print('hi')")
    p = resolve_within(tmp_path, "hello.py")
    assert p.is_file()


# ─── tools registry ──────────────────────────────────────────────────────
def test_tools_registry_complete():
    from rundeer.web.agent.tools import ALL_TOOLS, TOOLS_BY_NAME, build_litellm_tools

    assert len(ALL_TOOLS) >= 20
    schemas = build_litellm_tools()
    assert len(schemas) == len(ALL_TOOLS)
    for s in schemas:
        assert s["type"] == "function"
        assert s["function"]["name"] in TOOLS_BY_NAME
        assert "parameters" in s["function"]


def test_agent_can_wire_bundle_modulo_socket():
    from rundeer.web.agent.tools_impl.graph_mutate import connect_nodes_tool

    graph = {
        "nodes": {
            "n1": {"type": "number-input", "props": {}},
            "n2": {"type": "folder-bundle", "props": {}},
        },
        "edges": [],
    }

    result = connect_nodes_tool(
        from_node="n1",
        from_socket="out",
        to_node="n2",
        to_socket="modulo",
        graph=graph,
    )

    assert result["patch"][0]["toSocket"] == "modulo"


def test_tools_read_file(tmp_path: Path):
    from rundeer.web.agent.tools import invoke_tool

    (tmp_path / "a.txt").write_text("hello world")
    result = invoke_tool("read_file", {"path": "a.txt"}, root=tmp_path, server=None, graph={})
    assert "hello world" in (result.get("content") or "")


def test_tools_list_dir_skips_sensitive(tmp_path: Path):
    from rundeer.web.agent.tools import invoke_tool

    (tmp_path / ".env").write_text("X=1")
    (tmp_path / "ok.txt").write_text("ok")
    result = invoke_tool("list_dir", {"path": "."}, root=tmp_path, server=None, graph={})
    names = [e.get("name") for e in result.get("entries") or []]
    assert "ok.txt" in names
    assert ".env" not in names


# ─── persistence ─────────────────────────────────────────────────────────
def test_persistence_roundtrip(tmp_path: Path):
    from rundeer.web.agent.persistence import (
        new_conversation, load_conversation, save_conversation, list_conversations, delete_conversation,
    )

    rec = new_conversation(tmp_path, model="xai/grok-4-latest", title="hello")
    assert rec["id"]
    rec["messages"].append({"role": "user", "content": "hi"})
    save_conversation(tmp_path, rec)

    loaded = load_conversation(tmp_path, rec["id"])
    assert loaded is not None
    assert loaded["messages"][-1]["content"] == "hi"

    items = list_conversations(tmp_path)
    assert any(c["id"] == rec["id"] for c in items)

    assert delete_conversation(tmp_path, rec["id"]) is True
    assert load_conversation(tmp_path, rec["id"]) is None


# ─── diff ────────────────────────────────────────────────────────────────
def test_diff_detects_edits():
    from rundeer.web.agent.diff import diff_graphs, has_changes

    prev = {"nodes": {"n1": {"type": "cmd-image", "x": 0, "y": 0, "props": {"prompt": "a"}}}, "edges": []}
    curr = {"nodes": {
        "n1": {"type": "cmd-image", "x": 0, "y": 0, "props": {"prompt": "b"}},
        "n2": {"type": "preview", "x": 100, "y": 0, "props": {}},
    }, "edges": [{"fromNode": "n1", "fromSocket": "out", "toNode": "n2", "toSocket": "in"}]}

    d = diff_graphs(prev, curr)
    assert has_changes(d)
    assert any(n["id"] == "n2" for n in d["added_nodes"])
    assert any(n["id"] == "n1" for n in d["modified_nodes"])
    assert len(d["added_edges"]) == 1


def test_diff_no_change_returns_empty():
    from rundeer.web.agent.diff import diff_graphs, has_changes

    snap = {"nodes": {"n1": {"type": "cmd-image", "x": 0, "y": 0, "props": {}}}, "edges": []}
    assert not has_changes(diff_graphs(snap, snap))


# ─── ws server smoke ─────────────────────────────────────────────────────
def test_ws_server_handshake(tmp_path: Path, monkeypatch):
    pytest.importorskip("websockets")
    from rundeer.web.agent.config import get_agent_settings
    from rundeer.web.agent.ws_server import AgentWSServer

    monkeypatch.setenv("MODEL_API_KEY", "dummy")

    class FakeServer:
        project_root = tmp_path
        runs = {}
        runs_lock = threading.Lock()

    settings = get_agent_settings(tmp_path)
    handle = AgentWSServer(server=FakeServer(), settings=settings, ws_port=0)
    handle.start()
    try:
        async def go():
            import websockets
            async with websockets.connect(f"ws://127.0.0.1:{handle.ws_port}") as ws:
                ready = json.loads(await ws.recv())
                assert ready["type"] == "ready"
                await ws.send(json.dumps({"type": "new_conversation"}))
                loaded = json.loads(await ws.recv())
                assert loaded["type"] == "conversation_loaded"
                await ws.send(json.dumps({"type": "list_conversations"}))
                lst = json.loads(await ws.recv())
                assert lst["type"] == "conversation_list"
                assert len(lst["items"]) >= 1
        asyncio.run(go())
    finally:
        handle.stop()


# ─── system prompt ───────────────────────────────────────────────────────
def test_system_prompt_includes_tools_and_voice(tmp_path: Path):
    from rundeer.web.agent.system_prompt import build_system_prompt

    text = build_system_prompt(tmp_path, project_name="demo")
    # Some core elements that should always be present
    assert "rundeer" in text.lower()
    assert "tool" in text.lower()
    # Sandbox notice
    assert ".env" in text or "secret" in text.lower() or "sandbox" in text.lower()
