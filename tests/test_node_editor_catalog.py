from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _node_editor_source() -> str:
    return (ROOT / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")


def _catalog_section(source: str, category: str, next_category: str) -> str:
    start = source.index(f'category: "{category}"')
    end = source.index(f'category: "{next_category}"', start)
    return source[start:end]


def test_operations_category_contains_moved_ops_and_random():
    source = _node_editor_source()
    primitives = _catalog_section(source, "Primitives", "Operations")
    operations = _catalog_section(source, "Operations", "Layout")

    assert 'type: "compress-image"' not in primitives
    assert 'type: "blur-image"' not in primitives
    assert 'type: "math-op"' not in primitives
    assert 'type: "text-op"' not in primitives

    for node_type in ["compress-image", "blur-image", "crop-media", "resize-media", "math-op", "text-op", "random"]:
        assert f'type: "{node_type}"' in operations
    assert 'options: ["none", "fill", "stretch", "contain"]' in operations
    assert 'options: ["integer", "float", "string"]' in operations
    assert 'options: ["alphanumeric", "alpha", "lower_alpha", "upper_alpha", "numeric", "hex", "special", "ascii"]' in operations


def test_prompt_node_has_no_api_key_override():
    source = _node_editor_source()
    prompt_section = _catalog_section(source, "Prompt", "Commands")

    assert 'type: "prompt", label: "Prompt"' in prompt_section
    assert '{ id: "instructions", label: "Instructions", type: "text" }' in prompt_section
    direct_prompt = prompt_section[:prompt_section.index('type: "prompt-filter"')]
    assert '{ id: "prompt", label: "Prompt In", type: "text" }' in direct_prompt
    assert '{ id: "input", label: "Context Images", type: "image", multi: true }' in direct_prompt
    assert '{ id: "instructions"' not in direct_prompt
    assert "model_api_key" not in source
    assert "API Key override" not in source


def test_prompt_api_uses_environment_key_only():
    server_source = (ROOT / "web" / "server.py").read_text(encoding="utf-8")

    assert 'payload.get("model_api_key")' not in server_source
    assert "model_api_key prop" not in server_source


def test_uv_render_is_labeled_render_without_renaming_type():
    source = _node_editor_source()
    output_section = _catalog_section(source, "Output", "Agent Brain")

    assert 'type: "uv-render", label: "Render"' in output_section
    assert 'label: "UV Render"' not in source


def test_canvas_node_is_preview_style_with_position_vectors():
    source = _node_editor_source()
    output_section = _catalog_section(source, "Output", "Agent Brain")

    assert 'type: "canvas", label: "Canvas"' in output_section
    assert '{ id: "images", label: "Image", type: "image", multi: true }' in output_section
    assert '{ id: "positions", label: "Position", type: "vector", multi: true }' in output_section
    assert 'const PREVIEW_TYPES = new Set(["preview", "file", "uv-render", "coordinate", "canvas"]);' in source
    assert 'if (Array.isArray(v) && sock.type !== "vector") values.push(...v); else values.push(v);' in source

def test_vector2_coercion_handles_dict_shapes_and_warns_on_path_inputs():
    source = _node_editor_source()

    # Parity with Python's `_coerce_vector2`: accept {x,y}, {value}, {color}, {scalar}.
    assert 'function _coerceVector2Value(' in source
    assert '"x" in v || "y" in v' in source
    assert '"value" in v' in source
    assert '"color" in v' in source
    assert '"scalar" in v' in source

    # Helper that flags wired sockets carrying file paths (e.g. a UV .npy from
    # a spatial vector-op) so users see a warning instead of silent defaults.
    assert 'function _vectorSocketUnparseableSource(' in source

    # The three nodes that consume vector sockets must call the helper.
    assert 'Crop size socket received' in source
    assert 'Crop position socket received' in source
    assert 'Resize size socket received' in source
    assert 'Canvas size socket received' in source
    assert 'Canvas position[' in source
