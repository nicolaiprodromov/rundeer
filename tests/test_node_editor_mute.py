from __future__ import annotations

from pathlib import Path

from rundeer.web.agent.brain_graph import compile_brain_graph


ROOT = Path(__file__).resolve().parents[1]


def test_node_editor_has_muted_node_execution_contract():
    source = (ROOT / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")
    css = (ROOT / "web" / "static" / "node-editor.css").read_text(encoding="utf-8")

    assert "function toggleNodeMuted" in source
    assert "nodeMuteButtonMarkup" in source
    assert "Mute node" in source
    assert "e.key === \"m\" || e.key === \"M\"" in source
    assert "muted: Boolean(n.muted)" in source
    assert "muted: Boolean(migrated.muted)" in source
    assert "activeIncomingEdges(nodeId, sock.id)" in source
    assert "const muted = isEdgeMuted(edge);" in source
    assert "if (isNodeMuted(n)) return false;" in source

    assert ".ne-node.is-muted" in css
    assert ".ne-node-mute" in css
    assert ".ne-connections path.is-muted" in css


def test_node_editor_preserves_active_string_editor_signature_after_typing():
    source = (ROOT / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")
    helper_start = source.index("function preserveActiveStringEditorSignature")
    helper = source[helper_start:source.index("function refreshStringEditorsForNode", helper_start)]
    setter = source[source.index("function setNodePropValue"):helper_start]

    assert "preserveActiveStringEditorSignature(nodeId, sourceControl);" in setter
    assert "sourceControl?.classList?.contains(\"ne-string-editor\")" in helper
    assert "sourceControl.dataset.mode === \"edit\"" in helper
    assert "active.classList?.contains(\"ne-string-textarea\")" in helper
    assert "el.dataset.signature = nodeSignature(node);" in helper


def test_brain_graph_compiler_ignores_muted_nodes():
    graph = {
        "nodes": {
            "brain": {"id": "brain", "type": "brain", "x": 200, "y": 0, "props": {}},
            "bundle": {"id": "bundle", "type": "create-bundle", "x": 100, "y": 0, "props": {}},
            "muted_text": {
                "id": "muted_text",
                "type": "text-input",
                "x": 0,
                "y": 0,
                "muted": True,
                "props": {"value": "muted section"},
            },
            "live_text": {
                "id": "live_text",
                "type": "text-input",
                "x": 0,
                "y": 10,
                "props": {"value": "live section"},
            },
            "muted_tool": {
                "id": "muted_tool",
                "type": "tool-flag",
                "x": 0,
                "y": 20,
                "muted": True,
                "props": {"tool_name": "read_file", "enabled": False},
            },
        },
        "edges": [
            {"fromNode": "bundle", "fromSocket": "out", "toNode": "brain", "toSocket": "sections"},
            {"fromNode": "muted_text", "fromSocket": "out", "toNode": "bundle", "toSocket": "items"},
            {"fromNode": "live_text", "fromSocket": "out", "toNode": "bundle", "toSocket": "items"},
            {"fromNode": "muted_tool", "fromSocket": "out", "toNode": "brain", "toSocket": "tools"},
        ],
    }

    compiled = compile_brain_graph(graph)

    assert compiled.system_prompt == "live section"
    assert "read_file" not in compiled.tool_overrides