import io
from PIL import Image
from rundeer.core.media import (
    pad_to_aspect_ratio, compress_image, encode_image, make_image_grid,
    crop_media, resize_media, canvas_images,
)


def test_pad_no_change_when_close(tmp_image):
    raw, mime = pad_to_aspect_ratio(tmp_image, 64 / 48)
    assert mime in ("image/png", "image/jpeg")
    assert raw == tmp_image.read_bytes()


def test_pad_widens(tmp_path):
    img = Image.new("RGB", (40, 80), (0, 0, 0))
    p = tmp_path / "tall.png"; img.save(p)
    raw, mime = pad_to_aspect_ratio(p, 1.0)
    out = Image.open(io.BytesIO(raw))
    assert out.size == (80, 80)


def test_pad_heightens(tmp_path):
    img = Image.new("RGB", (80, 40), (0, 0, 0))
    p = tmp_path / "wide.png"; img.save(p)
    raw, _ = pad_to_aspect_ratio(p, 1.0)
    out = Image.open(io.BytesIO(raw))
    assert out.size == (80, 80)


def test_compress_image(png_bytes):
    out = compress_image(png_bytes, 70)
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"


def test_encode_image_data_uri(tmp_image):
    uri = encode_image(tmp_image, "1:1", pad=True, quality=60)
    assert uri.startswith("data:image/jpeg;base64,")


def test_encode_image_cache(tmp_image, tmp_path):
    cache = tmp_path / "cache"
    uri1 = encode_image(tmp_image, "1:1", pad=True, quality=60, cache_dir=cache)
    uri2 = encode_image(tmp_image, "1:1", pad=True, quality=60, cache_dir=cache)
    assert uri1 == uri2
    assert any(cache.iterdir())


def test_make_image_grid(tmp_path):
    img = Image.new("RGB", (32, 32), (10, 20, 30))
    for i in range(1, 5):
        img.save(tmp_path / f"out_{i:02d}.png")
    grid = make_image_grid(tmp_path, "out", 4)
    assert grid is not None and grid.exists()
    g = Image.open(grid)
    assert g.size == (64, 64)  # 2x2 of 32x32


def test_make_image_grid_empty(tmp_path):
    assert make_image_grid(tmp_path, "out", 0) is None


def test_crop_media_uses_bottom_left_position(tmp_path):
    img = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
    for y in range(4):
        for x in range(4):
            img.putpixel((x, y), (x * 40, y * 40, 0, 255))
    src = tmp_path / "source.png"
    img.save(src)

    out_path = crop_media(tmp_path, src, (2, 2), (1, 1))
    out = Image.open(out_path).convert("RGBA")

    assert out.size == (2, 2)
    assert out.getpixel((0, 1)) == img.getpixel((1, 2))
    assert out.getpixel((0, 0)) == img.getpixel((1, 1))


def test_resize_media_contain_pads_to_target(tmp_path):
    src = tmp_path / "wide.png"
    Image.new("RGBA", (4, 2), (200, 20, 10, 255)).save(src)

    out_path = resize_media(tmp_path, src, (4, 4), mode="contain")
    out = Image.open(out_path).convert("RGBA")

    assert out.size == (4, 4)
    assert out.getpixel((1, 1))[3] == 255
    assert out.getpixel((0, 0))[3] == 0


def test_canvas_images_uses_bottom_left_positions(tmp_path):
    src = tmp_path / "tile.png"
    Image.new("RGBA", (2, 2), (10, 200, 40, 255)).save(src)

    out_path = canvas_images(tmp_path, [src], [(1, 1)], (4, 4))
    out = Image.open(out_path).convert("RGBA")

    assert out.size == (4, 4)
    assert out.getpixel((1, 2)) == (10, 200, 40, 255)
    assert out.getpixel((0, 3))[3] == 0
