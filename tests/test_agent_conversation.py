"""End-to-end mocked LLM test of the agent conversation loop.

We stub out `litellm.acompletion` with a fake async iterator that emits
realistic deltas: text tokens, a tool_call to `list_dir`, and a final
assistant message. We then verify:
  - tokens stream as events,
  - tool_call / tool_result get fired,
  - graph_patch is emitted when a mutate tool is called,
  - destructive confirm gate works,
  - vision attach injects an image into history,
  - persistence captures the messages,
  - user-edit diff note is emitted between turns,
  - cancel halts the loop.
"""
from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any, AsyncIterator, Dict, List

import pytest


# ── Helpers to build fake LiteLLM stream chunks ─────────────────────────
def _chunk(*, content=None, tool_calls=None, finish_reason=None):
    """Build a chunk shaped like litellm's streaming response."""
    delta = SimpleNamespace(content=content, tool_calls=tool_calls)
    choice = SimpleNamespace(delta=delta, finish_reason=finish_reason)
    return SimpleNamespace(choices=[choice])


def _tool_delta(idx, *, call_id=None, name=None, arguments=None):
    fn = SimpleNamespace(name=name, arguments=arguments)
    return SimpleNamespace(index=idx, id=call_id, function=fn)


class FakeAcompletion:
    """Replaces `litellm.acompletion`. Each call pops a scripted response."""
    def __init__(self, scripts: List[List[Any]]):
        self._scripts = list(scripts)
        self.calls: List[Dict[str, Any]] = []

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if not self._scripts:
            raise RuntimeError("no more scripted responses")
        script = self._scripts.pop(0)

        async def _gen():
            for c in script:
                await asyncio.sleep(0)
                yield c
        return _gen()


# ── Common fixtures ──────────────────────────────────────────────────────
@pytest.fixture
def project(tmp_path: Path) -> Path:
    (tmp_path / "a.txt").write_text("hello a")
    (tmp_path / "b.txt").write_text("hello b")
    (tmp_path / ".rundeer").mkdir()
    return tmp_path


@pytest.fixture
def settings(project: Path):
    from rundeer.web.agent.config import AgentSettings
    return AgentSettings(
        enabled=True,
        model="xai/fake-model",
        api_key="fake",
        fallback_models=[],
        max_tool_iterations=4,
    )


class FakeServer:
    def __init__(self, root: Path):
        self.project_root = root
        self.runs = {}
        self.runs_lock = threading.Lock()


@pytest.fixture
def fake_server(project: Path):
    return FakeServer(project)


def _new_conv(settings, project, fake_server):
    from rundeer.web.agent.conversation import Conversation
    from rundeer.web.agent.persistence import new_conversation
    rec = new_conversation(project, model=settings.model, title="test")
    return Conversation.from_record(settings, project, fake_server, rec)

async def _drain(conv, user_text, **kw):
    out = []
    async for ev in conv.run_turn(user_text, **kw):
        out.append(ev)
    return out


# ─────────────────────────────────────────────────────────────────────────
def test_simple_text_turn(monkeypatch, settings, project, fake_server):
    """Plain text response with no tool calls produces token + done events."""
    import rundeer.web.agent.conversation as conv_mod

    fake = FakeAcompletion([[
        _chunk(content="Hello"),
        _chunk(content=" there"),
        _chunk(content="!", finish_reason="stop"),
    ]])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)
    events = asyncio.run(_drain(conv, "hi"))

    kinds = [e["type"] for e in events]
    assert "message_start" in kinds
    tokens = [e for e in events if e["type"] == "token"]
    assert "".join(t["delta"] for t in tokens) == "Hello there!"
    assert kinds[-1] == "done"
    # Persisted assistant msg
    assert conv.messages[-1]["role"] == "assistant"
    assert "Hello there!" in (conv.messages[-1]["content"] or "")


def test_tool_call_read_file(monkeypatch, settings, project, fake_server):
    """A tool_call to read_file should be executed and a tool_result emitted."""
    import rundeer.web.agent.conversation as conv_mod

    fake = FakeAcompletion([
        # First completion: model decides to call read_file
        [
            _chunk(tool_calls=[_tool_delta(0, call_id="c1", name="read_file", arguments='{"path":"a.txt"}')]),
            _chunk(finish_reason="tool_calls"),
        ],
        # Second completion: model responds after tool result
        [
            _chunk(content="The file says hello a", finish_reason="stop"),
        ],
    ])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)
    events = asyncio.run(_drain(conv, "read a.txt"))

    tool_calls = [e for e in events if e["type"] == "tool_call"]
    tool_results = [e for e in events if e["type"] == "tool_result"]
    assert len(tool_calls) == 1
    assert tool_calls[0]["name"] == "read_file"
    assert len(tool_results) == 1
    assert tool_results[0]["status"] == "ok"
    assert "hello a" in json.dumps(tool_results[0]["result"])
    assert events[-1]["type"] == "done"
    assert len(fake.calls) == 2


def test_mutate_emits_graph_patch(monkeypatch, settings, project, fake_server):
    """A mutate tool (add_node) should emit a graph_patch event with ops."""
    import rundeer.web.agent.conversation as conv_mod

    fake = FakeAcompletion([
        [
            _chunk(tool_calls=[_tool_delta(0, call_id="c1", name="add_node",
                                            arguments='{"type":"cmd-image","x":0,"y":0,"props":{"prompt":"hi"}}')]),
            _chunk(finish_reason="tool_calls"),
        ],
        [_chunk(content="Done.", finish_reason="stop")],
    ])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)
    events = asyncio.run(_drain(conv, "add an image node"))

    patches = [e for e in events if e["type"] == "graph_patch"]
    assert len(patches) == 1
    assert patches[0]["ops"][0]["op"] == "add_node"
    assert patches[0]["ops"][0]["type"] == "cmd-image"


def test_destructive_tool_requires_confirm_and_can_be_denied(monkeypatch, settings, project, fake_server):
    """clear_graph must produce a confirm_request; denial blocks execution."""
    import rundeer.web.agent.conversation as conv_mod

    fake = FakeAcompletion([
        [
            _chunk(tool_calls=[_tool_delta(0, call_id="c1", name="clear_graph", arguments='{}')]),
            _chunk(finish_reason="tool_calls"),
        ],
        [_chunk(content="OK, kept the graph.", finish_reason="stop")],
    ])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)

    async def go():
        out = []
        agen = conv.run_turn("clear it")
        async for ev in agen:
            out.append(ev)
            if ev["type"] == "confirm_request":
                # User denies
                conv.resolve_confirm({"approved": False})
        return out

    events = asyncio.run(go())
    confirm = [e for e in events if e["type"] == "confirm_request"]
    assert len(confirm) == 1
    results = [e for e in events if e["type"] == "tool_result"]
    assert len(results) == 1
    assert results[0]["status"] == "denied"
    # No graph_patch should have been emitted since denied
    assert not any(e["type"] == "graph_patch" for e in events)


def test_destructive_tool_approval_executes(monkeypatch, settings, project, fake_server):
    import rundeer.web.agent.conversation as conv_mod

    fake = FakeAcompletion([
        [
            _chunk(tool_calls=[_tool_delta(0, call_id="c1", name="clear_graph", arguments='{}')]),
            _chunk(finish_reason="tool_calls"),
        ],
        [_chunk(content="Cleared.", finish_reason="stop")],
    ])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)

    async def go():
        out = []
        async for ev in conv.run_turn("clear it"):
            out.append(ev)
            if ev["type"] == "confirm_request":
                conv.resolve_confirm({"approved": True})
        return out

    events = asyncio.run(go())
    patches = [e for e in events if e["type"] == "graph_patch"]
    assert len(patches) == 1
    assert patches[0]["ops"][0]["op"] in ("clear_graph", "clear")


def test_user_edit_diff_injected(monkeypatch, settings, project, fake_server):
    """Snapshot change between turns should emit a graph_diff_note."""
    import rundeer.web.agent.conversation as conv_mod

    fake = FakeAcompletion([
        [_chunk(content="t1", finish_reason="stop")],
        [_chunk(content="t2", finish_reason="stop")],
    ])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)
    # First turn: empty graph
    conv.update_snapshot({"nodes": {}, "edges": []})
    asyncio.run(_drain(conv, "hi"))

    # User adds a node between turns
    conv.update_snapshot({
        "nodes": {"n1": {"type": "cmd-image", "x": 0, "y": 0, "props": {}}},
        "edges": [],
    })

    events = asyncio.run(_drain(conv, "now what?"))
    diff_notes = [e for e in events if e["type"] == "graph_diff_note"]
    assert len(diff_notes) == 1
    assert any(n["id"] == "n1" for n in diff_notes[0]["diff"]["added_nodes"])


def test_vision_attach_injects_image(monkeypatch, settings, project, fake_server):
    """view_image result with a data URL should add an image user message."""
    import rundeer.web.agent.conversation as conv_mod

    # Create an image file (PNG-ish minimum bytes; tool just base64s)
    img = project / "pic.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 50)

    fake = FakeAcompletion([
        [
            _chunk(tool_calls=[_tool_delta(0, call_id="c1", name="view_image",
                                            arguments=json.dumps({"path": "pic.png"}))]),
            _chunk(finish_reason="tool_calls"),
        ],
        [_chunk(content="Saw it.", finish_reason="stop")],
    ])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)
    asyncio.run(_drain(conv, "look at pic.png"))

    # After the tool, history should contain a user message with image_url
    user_image_msgs = []
    for m in conv.messages:
        if m.get("role") != "user":
            continue
        content = m.get("content")
        if isinstance(content, list):
            for b in content:
                if isinstance(b, dict) and b.get("type") == "image_url":
                    user_image_msgs.append(b)
    assert user_image_msgs, "expected a vision-attached user message"
    assert user_image_msgs[0]["image_url"]["url"].startswith("data:image/")


def test_cancel_mid_turn(monkeypatch, settings, project, fake_server):
    """Cancelling during streaming should halt and yield 'cancelled'."""
    import rundeer.web.agent.conversation as conv_mod

    async def slow_gen():
        for tok in ["a", "b", "c", "d", "e"]:
            await asyncio.sleep(0.005)
            yield _chunk(content=tok)

    class SlowFake:
        calls = []

        async def __call__(self, **kw):
            SlowFake.calls.append(kw)
            return slow_gen()

    monkeypatch.setattr(conv_mod.litellm, "acompletion", SlowFake())

    conv = _new_conv(settings, project, fake_server)

    async def go():
        out = []
        agen = conv.run_turn("stream please")
        async for ev in agen:
            out.append(ev)
            if ev["type"] == "token" and ev["delta"] == "b":
                conv.cancel()
        return out

    events = asyncio.run(go())
    assert any(e["type"] == "cancelled" for e in events)


def test_persistence_after_turn(monkeypatch, settings, project, fake_server):
    """The conversation record on disk must reflect the messages."""
    import rundeer.web.agent.conversation as conv_mod
    from rundeer.web.agent.persistence import load_conversation

    fake = FakeAcompletion([[_chunk(content="persisted", finish_reason="stop")]])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)
    asyncio.run(_drain(conv, "save me"))

    rec = load_conversation(project, conv.record["id"])
    assert rec is not None
    assert rec["messages"][-1]["role"] == "assistant"
    assert "persisted" in (rec["messages"][-1]["content"] or "")
    assert rec["messages"][0]["role"] == "user"


def test_input_truncation_for_huge_results(monkeypatch, settings, project, fake_server):
    """Massive tool results should be truncated before going back to the model."""
    import rundeer.web.agent.conversation as conv_mod

    huge = "X" * 200_000
    (project / "huge.txt").write_text(huge)

    fake = FakeAcompletion([
        [
            _chunk(tool_calls=[_tool_delta(0, call_id="c1", name="read_file",
                                            arguments=json.dumps({"path": "huge.txt"}))]),
            _chunk(finish_reason="tool_calls"),
        ],
        [_chunk(content="seen", finish_reason="stop")],
    ])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    conv = _new_conv(settings, project, fake_server)
    asyncio.run(_drain(conv, "read huge.txt"))

    tool_msg = next(m for m in conv.messages if m.get("role") == "tool")
    assert len(tool_msg["content"]) <= 32_000


def test_ws_full_turn_with_mock(monkeypatch, tmp_path: Path):
    """Full WS roundtrip: connect, send user_message, observe streamed events."""
    pytest.importorskip("websockets")
    import rundeer.web.agent.conversation as conv_mod
    from rundeer.web.agent.config import AgentSettings
    from rundeer.web.agent.ws_server import AgentWSServer

    fake = FakeAcompletion([[_chunk(content="hi from ws", finish_reason="stop")]])
    monkeypatch.setattr(conv_mod.litellm, "acompletion", fake)

    class S:
        project_root = tmp_path
        runs = {}
        runs_lock = threading.Lock()

    settings = AgentSettings(model="xai/fake", api_key="fake")
    handle = AgentWSServer(server=S(), settings=settings, ws_port=0)
    handle.start()
    try:
        async def go():
            import websockets
            async with websockets.connect(f"ws://127.0.0.1:{handle.ws_port}") as ws:
                ready = json.loads(await ws.recv())
                assert ready["type"] == "ready"
                await ws.send(json.dumps({
                    "type": "user_message",
                    "text": "say hi",
                    "graph": {"nodes": {}, "edges": []},
                }))
                seen = []
                # Drain until done
                async def drain():
                    while True:
                        msg = json.loads(await ws.recv())
                        seen.append(msg)
                        if msg["type"] in ("done", "error"):
                            return
                await asyncio.wait_for(drain(), timeout=5)
                return seen
        events = asyncio.run(go())
    finally:
        handle.stop()

    kinds = [e["type"] for e in events]
    assert "conversation_loaded" in kinds
    assert "token" in kinds
    assert kinds[-1] == "done"
    tokens = [e["delta"] for e in events if e["type"] == "token"]
    assert "".join(tokens) == "hi from ws"
