from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _node_editor_source() -> str:
    return (ROOT / "web" / "static" / "node-editor.js").read_text(encoding="utf-8")


def test_single_preview_images_load_eagerly_when_transformed():
    source = _node_editor_source()
    start = source.index("function makeBundleMedia")
    end = source.index("function makeBrokenLabel", start)
    media_source = source[start:end]

    assert 'img.loading = "eager";' in media_source
    assert 'img.loading = "lazy";' not in media_source


def test_zoomed_preview_pan_is_clamped_after_media_load():
    source = _node_editor_source()

    assert "function clampPreviewPanToStage" in source
    assert "const pan = clampPreviewPanToStage(node, stage, media);" in source

    start = source.index("function makePreviewZoomStage")
    end = source.index("function makePreviewZoomControls", start)
    stage_source = source[start:end]

    assert 'media.addEventListener("load", refreshPan, { once: true });' in stage_source
    assert 'media.addEventListener("loadedmetadata", refreshPan, { once: true });' in stage_source
    assert "queueMicrotask(refreshPan);" in stage_source