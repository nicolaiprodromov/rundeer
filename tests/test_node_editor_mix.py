from pathlib import Path

import numpy as np

from rundeer.core import uv_ops
from rundeer.web import uv_api


ROOT = Path(__file__).resolve().parents[1]


def _mix_node_source() -> str:
    source = (ROOT / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")
    start = source.index('type: "mix", label: "Mix"')
    end = source.index('type: "preview", label: "Preview"', start)
    return source[start:end]


def test_mix_node_uses_single_prop_sockets_for_factor_and_colors():
    mix_source = _mix_node_source()

    assert "inputs: []" in mix_source
    assert '{ id: "factor", label: "Factor", type: "any" }' not in mix_source
    assert 'id: "color_a"' not in mix_source
    assert 'id: "color_b"' not in mix_source
    assert 'id: "factor", label: "Factor", kind: "range"' in mix_source
    assert 'id: "a", label: "A", kind: "color"' in mix_source
    assert 'id: "b", label: "B", kind: "color"' in mix_source
    assert mix_source.count('socketType: "any"') == 3
    assert "passthroughWired: true" in mix_source


def test_mix_node_is_live_updated_during_preview_refresh():
    source = (ROOT / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")

    assert 'const LIVE_UPDATE_TYPES = new Set(["mix"]);' in source
    assert 'const liveNodes = Object.values(graph.nodes).filter((n) => LIVE_UPDATE_TYPES.has(n.type)' in source
    assert 'await resolveNode(node.id, cache, {}, resolveOpts);' in source
    assert 'if ((!opts.lite && !opts.liteCommands) || LIVE_UPDATE_TYPES.has(node.type))' in source
    resolve_start = source.index("async function resolveNode(")
    run_graph_tail = source[source.rindex('"some nodes failed"', 0, resolve_start):resolve_start]
    assert "schedulePreviewRefresh();" in run_graph_tail


def test_mix_endpoint_uses_image_factor_as_map(tmp_path: Path):
    factor = np.array(
        [
            [[0.0, 0.0, 0.0, 1.0], [1.0, 0.0, 0.0, 1.0]],
            [[0.25, 0.0, 0.0, 1.0], [0.75, 0.0, 0.0, 1.0]],
        ],
        dtype=np.float32,
    )
    factor_path = uv_ops.save_image(factor, tmp_path, "factor_map")
    factor_rel = factor_path.relative_to(tmp_path).as_posix()

    result = uv_api.mix(
        tmp_path,
        {
            "factor": {"path": factor_rel},
            "a": {"color": [0.0, 0.0, 0.0, 1.0]},
            "b": {"color": [1.0, 1.0, 1.0, 1.0]},
            "mode": "mix",
        },
    )

    assert result["width"] == 2
    assert result["height"] == 2
    out = uv_ops.load_image_rgba(tmp_path / result["path"])
    expected = factor[..., :1]
    assert out.shape == (2, 2, 4)
    assert np.allclose(out[..., :3], np.repeat(expected, 3, axis=-1), atol=1 / 255)
    assert np.allclose(out[..., 3], 1.0, atol=1 / 255)