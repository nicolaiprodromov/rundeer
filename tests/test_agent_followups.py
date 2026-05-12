from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path
from typing import Any, List

import pytest

from test_agent_conversation import FakeAcompletion, _chunk, _tool_delta


@pytest.fixture
def project(tmp_path: Path) -> Path:
    (tmp_path / ".rundeer").mkdir()
    return tmp_path


@pytest.fixture
def settings():
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


def _new_conv(settings: Any, project: Path, fake_server: FakeServer):
    from rundeer.web.agent.conversation import Conversation
    from rundeer.web.agent.persistence import new_conversation
    rec = new_conversation(project, model=settings.model, title="test")
    return Conversation.from_record(settings, project, fake_server, rec)


def test_mutate_turn_waits_for_client_snapshot_echo(monkeypatch, settings, project, fake_server):
    """The next model step after a graph patch should see the browser-echoed
    graph snapshot, not the stale pre-patch snapshot."""
    import rundeer.web.agent.conversation as conv_mod

    conv = _new_conv(settings, project, fake_server)
    snapshots_at_llm_call: List[set[str]] = []

    fake = FakeAcompletion([
        [
            _chunk(tool_calls=[_tool_delta(0, call_id="c1", name="add_node",
                                            arguments=json.dumps({
                                                "node_id": "n1",
                                                "type": "text-input",
                                                "x": 10,
                                                "y": 20,
                                            }))]),
            _chunk(finish_reason="tool_calls"),
        ],
        [_chunk(content="done", finish_reason="stop")],
    ])

    async def wrapped_acompletion(**kwargs):
        snapshots_at_llm_call.append(set((conv.snapshot.get("nodes") or {}).keys()))
        return await fake(**kwargs)

    monkeypatch.setattr(conv_mod.litellm, "acompletion", wrapped_acompletion)

    async def go():
        loop = asyncio.get_running_loop()
        async for ev in conv.run_turn("add a text node"):
            if ev["type"] == "graph_patch":
                loop.call_later(0.02, conv.update_snapshot, {
                    "nodes": {"n1": {"id": "n1", "type": "text-input", "x": 10, "y": 20, "props": {}}},
                    "edges": [],
                })

    asyncio.run(go())
    assert snapshots_at_llm_call[0] == set()
    assert snapshots_at_llm_call[1] == {"n1"}
    assert "n1" in conv.last_seen_snapshot["nodes"]


def test_system_prompt_caches_stable_sections(monkeypatch, tmp_path: Path):
    import rundeer.web.agent.system_prompt as prompt_mod

    brain_root = tmp_path / "brain"
    ref_dir = brain_root / "Moebius" / "Reference"
    ref_dir.mkdir(parents=True)
    (ref_dir / "a.jpg").write_bytes(b"jpg")
    monkeypatch.setattr(prompt_mod, "brain_dir", lambda: brain_root)
    prompt_mod._brain_summary_cached.cache_clear()
    prompt_mod._tool_summary.cache_clear()

    first = prompt_mod.build_system_prompt(tmp_path, project_name="rundeer")
    second = prompt_mod.build_system_prompt(tmp_path, project_name="rundeer")

    assert first == second
    assert prompt_mod._brain_summary_cached.cache_info().hits >= 1
    assert prompt_mod._tool_summary.cache_info().hits >= 1


def test_system_prompt_lists_real_common_socket_ids():
    import rundeer.web.agent.system_prompt as prompt_mod

    assert "text-input.out" in prompt_mod.CORE_PROMPT
    assert "cmd-image.subject" in prompt_mod.CORE_PROMPT
    assert "cmd-image.trigger" in prompt_mod.CORE_PROMPT
    assert "cmd-image.out" in prompt_mod.CORE_PROMPT
    assert "preview.in" in prompt_mod.CORE_PROMPT
    assert "cmd-image.run" not in prompt_mod.CORE_PROMPT


def _connection_graph() -> dict[str, Any]:
    return {
        "nodes": {
            "prompt1": {"id": "prompt1", "type": "text-input", "x": 0, "y": 100, "props": {}},
            "trigger1": {"id": "trigger1", "type": "run-trigger", "x": 0, "y": 0, "props": {}},
            "image1": {"id": "image1", "type": "cmd-image", "x": 280, "y": 80, "props": {}},
            "preview1": {"id": "preview1", "type": "preview", "x": 560, "y": 80, "props": {}},
        },
        "edges": [],
    }


def test_connect_nodes_normalizes_common_socket_label_guesses():
    from rundeer.web.agent.tools_impl.graph_mutate import connect_nodes_tool

    graph = _connection_graph()
    cases = [
        (("prompt1", "output", "image1", "subject"), ("out", "subject")),
        (("trigger1", "run", "image1", "run"), ("run", "trigger")),
        (("image1", "image", "preview1", "image"), ("out", "in")),
    ]
    for (from_node, from_socket, to_node, to_socket), (expected_from, expected_to) in cases:
        result = connect_nodes_tool(
            graph=graph,
            from_node=from_node,
            from_socket=from_socket,
            to_node=to_node,
            to_socket=to_socket,
        )
        assert "error" not in result
        op = result["patch"][0]
        assert op["op"] == "add_edge"
        assert op["fromSocket"] == expected_from
        assert op["toSocket"] == expected_to


def test_connect_nodes_rejects_unusable_sockets_without_patch():
    from rundeer.web.agent.tools_impl.graph_mutate import connect_nodes_tool

    graph = _connection_graph()
    unknown = connect_nodes_tool(
        graph=graph,
        from_node="prompt1",
        from_socket="missing",
        to_node="image1",
        to_socket="subject",
    )
    incompatible = connect_nodes_tool(
        graph=graph,
        from_node="prompt1",
        from_socket="out",
        to_node="image1",
        to_socket="trigger",
    )

    assert "unknown output socket" in unknown["error"]
    assert "patch" not in unknown
    assert "incompatible socket types" in incompatible["error"]
    assert "patch" not in incompatible


def test_connect_nodes_tool_receives_graph_snapshot():
    from rundeer.web.agent.tools import TOOLS_BY_NAME

    assert TOOLS_BY_NAME["connect_nodes"].needs_graph is True


def test_node_editor_preserves_agent_node_ids_and_props():
    source = (Path(__file__).resolve().parents[1] / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")
    assert "function genNodeId(preferredId = null)" in source
    assert "const id = genNodeId(opts.id);" in source
    assert "Object.assign(props, opts.props || {});" in source
    assert "const actualId = addNode" in source
    assert "window.AgentChat._idAliases[op.id] = actualId;" in source
    assert "(p) => p.id === k" in source
    assert "function genId(prefix)" not in source


def test_agent_client_pushes_snapshot_immediately_after_patch():
    source = (Path(__file__).resolve().parents[1] / "web" / "static" / "agent.js").read_text(encoding="utf-8")
    patch_case = source[source.index('case "graph_patch":'):source.index('case "confirm_request":')]
    assert "cfg.applyGraphPatch" in patch_case
    assert "pushSnapshot(true);" in patch_case
