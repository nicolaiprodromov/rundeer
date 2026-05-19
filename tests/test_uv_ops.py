"""Smoke tests for core.uv_ops."""
from __future__ import annotations

import numpy as np
import pytest

from rundeer.core import uv_ops


def test_coordinate_uv_shape_and_range():
    arr = uv_ops.coordinate(64, 32, dpi=72, space="uv")
    assert arr.shape == (32, 64, 2)
    assert arr.dtype == np.float32
    # u increases left-to-right, v uses a bottom-left origin.
    assert 0.0 < arr[..., 0].min() < arr[..., 0].max() < 1.0
    assert 0.0 < arr[..., 1].min() < arr[..., 1].max() < 1.0
    # First column → low u, last column → high u
    assert arr[0, 0, 0] < arr[0, -1, 0]
    assert arr[0, 0, 1] > arr[-1, 0, 1]


def test_coordinate_screen_space():
    arr = uv_ops.coordinate(4, 3, space="screen")
    assert arr.shape == (3, 4, 2)
    assert arr[..., 0].max() == 3.0
    assert arr[..., 1].max() == 2.0
    assert arr[0, 0, 1] == 2.0
    assert arr[-1, 0, 1] == 0.0


def test_vector_op_add_scale_normalize():
    a = uv_ops.coordinate(8, 8)
    b = uv_ops.vector_op(a, None, "scale", scalar=2.0)
    assert np.allclose(b, a * 2.0)

    c = uv_ops.vector_op(a, a, "add")
    assert np.allclose(c, a * 2.0)

    n = uv_ops.vector_op(a, None, "normalize")
    norms = np.linalg.norm(n, axis=-1)
    # Non-zero rows must have unit length.
    nonzero = norms[norms > 1e-6]
    assert np.allclose(nonzero, 1.0, atol=1e-5)


def test_vector_op_unknown_raises():
    with pytest.raises(ValueError):
        uv_ops.vector_op(np.zeros((1, 1, 2), dtype=np.float32), None, "wat")


def test_vector_op_scale_uses_b_when_no_scalar():
    """Scale derives its factor from B (Vector primitive) when scalar is None."""
    a = uv_ops.coordinate(4, 4)
    # B is a constant vector primitive — first component becomes the factor.
    scaled = uv_ops.vector_op(a, [3.0, 3.0, 3.0], "scale", scalar=None)
    assert np.allclose(scaled, a * 3.0)
    # Scalar B works too.
    scaled2 = uv_ops.vector_op(a, 0.5, "scale", scalar=None)
    assert np.allclose(scaled2, a * 0.5)


def test_vector_op_multiply_with_vector_primitive():
    """A vector primitive in B should multiply per-component."""
    a = uv_ops.coordinate(4, 4)  # shape (4,4,2)
    result = uv_ops.vector_op(a, [2.0, 0.5, 1.0], "multiply", scalar=None)
    # First channel doubled, second halved (broadcasts; ignore 3rd).
    assert np.allclose(result[..., 0], a[..., 0] * 2.0)
    assert np.allclose(result[..., 1], a[..., 1] * 0.5)


def test_mapping_identity_and_rotate():
    uv = uv_ops.coordinate(16, 16)
    ident = uv_ops.mapping(uv)
    assert np.allclose(ident, uv, atol=1e-6)

    rot = uv_ops.mapping(uv, rotation=90.0)
    # 90° around (0.5, 0.5): u_new ≈ 1 - v_old, v_new ≈ u_old (within fp tol).
    expected_u = 1.0 - uv[..., 1]
    expected_v = uv[..., 0]
    assert np.allclose(rot[..., 0], expected_u, atol=1e-5)
    assert np.allclose(rot[..., 1], expected_v, atol=1e-5)


def _checker_image(size=4):
    img = np.zeros((size, size, 4), dtype=np.float32)
    for y in range(size):
        for x in range(size):
            img[y, x] = (x / (size - 1), y / (size - 1), 0.0, 1.0)
    return img


def test_sample_identity():
    img = _checker_image(8)
    uv = uv_ops.coordinate(8, 8)
    out = uv_ops.sample(img, uv, interp="bilinear", extension="clamp")
    assert out.shape == img.shape
    # Center should approximate center pixel of source.
    cy, cx = uv.shape[0] // 2, uv.shape[1] // 2
    assert np.allclose(out[cy, cx], img[cy, cx], atol=0.2)


def test_sample_uses_bottom_left_uv_origin():
    img = np.zeros((2, 2, 4), dtype=np.float32)
    img[0, 0] = [1.0, 0.0, 0.0, 1.0]  # top-left
    img[1, 0] = [0.0, 1.0, 0.0, 1.0]  # bottom-left
    uv = np.array([[[0.0, 0.0], [0.0, 1.0]]], dtype=np.float32)

    out = uv_ops.sample(img, uv, interp="nearest", extension="clamp")

    assert np.allclose(out[0, 0], img[1, 0])
    assert np.allclose(out[0, 1], img[0, 0])


def test_sample_extension_modes():
    img = _checker_image(4)
    # uv pointing outside [0,1]: 1.5 → clamp→edge, repeat→wraps, mirror→reflects.
    uv = np.full((1, 1, 2), 1.5, dtype=np.float32)
    clamp = uv_ops.sample(img, uv, extension="clamp")
    repeat = uv_ops.sample(img, uv, extension="repeat")
    mirror = uv_ops.sample(img, uv, extension="mirror")
    assert clamp.shape == (1, 1, 4)
    # Clamp picks the edge pixel; repeat and mirror should differ from clamp.
    assert not np.allclose(clamp, repeat)
    assert not np.allclose(clamp, mirror)


def test_mix_scalar_fast_path():
    # No spatial maps → returns a list (color), not an ndarray.
    out = uv_ops.mix(0.5, [0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0, 1.0], mode="mix")
    assert isinstance(out, list)
    assert np.allclose(out, [0.5, 0.5, 0.5, 1.0])


def test_mix_overlay_image():
    a = np.zeros((4, 4, 3), dtype=np.float32) + 0.2
    b = np.zeros((4, 4, 3), dtype=np.float32) + 0.8
    factor = np.ones((4, 4, 1), dtype=np.float32)  # all-b
    out = uv_ops.mix(factor, a, b, mode="overlay")
    assert isinstance(out, np.ndarray)
    assert out.shape == (4, 4, 3)
    # overlay at a=0.2 (<0.5): 2*0.2*0.8 = 0.32
    assert np.allclose(out, 0.32, atol=1e-5)


def test_mix_mismatched_spatial_shapes_resize():
    uv = uv_ops.coordinate(4, 4)
    img = _checker_image(16)
    out = uv_ops.mix(0.5, uv, img, mode="mix")
    assert isinstance(out, np.ndarray)
    assert out.shape == (16, 16, 4)


def test_save_map_roundtrip(tmp_path):
    arr = uv_ops.coordinate(8, 8)
    npy, png = uv_ops.save_map(arr, tmp_path, "test")
    assert npy.exists()
    assert png.exists()
    loaded = uv_ops.load_map(npy)
    assert np.allclose(loaded, arr)


def test_vector_op_image_times_uv_per_pixel():
    """Multiplying an image by a UV map runs per-pixel (Blender-shader parity)."""
    img = _checker_image(8)  # (8,8,4)
    uv = uv_ops.coordinate(8, 8)  # (8,8,2)
    out = uv_ops.vector_op(img, uv, "multiply")
    # Output spatial shape matches the larger side (here equal); channel
    # count is truncated to the smaller (2).
    assert out.shape == (8, 8, 2)
    # Channel 0 should equal img[..,0] * uv[..,0].
    assert np.allclose(out[..., 0], img[..., 0] * uv[..., 0], atol=1e-5)
    assert np.allclose(out[..., 1], img[..., 1] * uv[..., 1], atol=1e-5)


def test_vector_op_scalar_times_image():
    img = _checker_image(4)
    out = uv_ops.vector_op(img, 2.0, "multiply")
    # Scalar broadcasts: every channel doubled.
    assert out.shape == img.shape
    assert np.allclose(out, img * 2.0)


def test_vector_op_mismatched_spatial_shapes_resize():
    """When A and B disagree on H/W, the smaller side is NN-resized up."""
    big = uv_ops.coordinate(16, 16)   # (16,16,2)
    small = uv_ops.coordinate(4, 4)   # (4,4,2)
    out = uv_ops.vector_op(big, small, "add")
    # Output adopts the larger spatial extent.
    assert out.shape == (16, 16, 2)


def test_vector_op_add_image_and_uv_yields_image_shape():
    img = _checker_image(8)
    uv = uv_ops.coordinate(16, 16)
    out = uv_ops.vector_op(img, uv, "add")
    # Larger spatial side (16) wins; channel count truncates to min (2).
    assert out.shape == (16, 16, 2)
