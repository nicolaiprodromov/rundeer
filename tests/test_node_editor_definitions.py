from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _node_editor_source() -> str:
    return (ROOT / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")


def test_definition_nodes_emit_clean_tokens_and_payload_maps_files():
    source = _node_editor_source()

    definition_start = source.index('case "definition": {')
    definition_end = source.index('case "reroute"', definition_start)
    definition_case = source[definition_start:definition_end]

    assert 'replace(/^@+/, "")' in definition_case
    assert 'if (args) token += `:${args}`;' in definition_case
    assert 'token += `:"${file}"`' not in definition_case

    helper_start = source.index("function collectDefinitionMapForCommand(nodeId)")
    helper_end = source.index("async function executeCommandNode", helper_start)
    helper = source[helper_start:helper_end]

    assert 'source.type === "definition"' in helper
    assert 'definitions[name] = file;' in helper
    assert "activeIncomingEdges(current)" in helper

    command_start = source.index("async function executeCommandNode")
    command_end = source.index("appendRunLog(`  ↳ ${command}", command_start)
    command_payload = source[command_start:command_end]

    assert "definitions: collectDefinitionMapForCommand(node.id)," in command_payload
    assert "definitions: []," not in command_payload