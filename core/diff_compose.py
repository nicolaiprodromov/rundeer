"""Mask-based compositing to avoid generational loss in chained edits.

When the same image is repeatedly fed through an image-edit model, every
round-trip re-encodes every pixel and accumulates artifacts (color drift,
oversharpening, JPEG-like noise). After a few iterations the result is
visibly degraded even in regions the user never asked to touch.

This module isolates the pixels the model *actually* changed -- the
deliberate edit -- and composites only those pixels onto the previous,
clean image. Regions that weren't edited are kept bit-for-bit from the
prior iteration (or, transitively, from the original input), so they are
never re-encoded and cannot accumulate loss.

To keep *previously added* elements from also degrading across iterations,
the caller can pass a cumulative ``frozen_mask`` (a uint8 numpy array,
same HxW as the image): pixels already in this mask are excluded from
the per-iteration edit mask, so once an element has been added at
iteration N it is locked in place from iteration N+1 onward. The
function returns the updated cumulative mask.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ImageFilter
from skimage.measure import label
from skimage.morphology import closing, dilation, disk


def composite_edit(
    prev_path: Path,
    raw_edit_path: Path,
    output_path: Path,
    *,
    threshold: int = 12,
    override_threshold: int = 50,
    dilate: int = 6,
    feather: int = 8,
    min_region_area: int = 64,
    frozen_mask: Optional[np.ndarray] = None,
    verbose: bool = False,
) -> dict:
    """Composite ``raw_edit`` onto ``prev`` using an auto-derived edit mask.

    Parameters
    ----------
    prev_path:
        The "clean" image fed into the model this iteration (the previous
        composite, or the original input on the first iteration).
    raw_edit_path:
        The raw image the model returned.
    output_path:
        Where to write the masked composite (PNG).
    threshold:
        Per-pixel max-channel difference (0-255) above which a pixel in a
        non-frozen region is considered changed.
    override_threshold:
        Per-pixel difference above which a pixel inside a *frozen* region
        is treated as a deliberate new edit drawn over the old one
        (and therefore allowed through). Below this, frozen pixels are
        kept verbatim. Should be substantially larger than ``threshold``
        so re-render drift on existing elements stays blocked but a new
        symbol painted on top still shows up.
    dilate, feather, min_region_area:
        Mask post-processing knobs.
    frozen_mask:
        Optional HxW boolean/uint8 array of pixels that have been edited
        in a prior iteration.

    Returns
    -------
    dict with: ``changed_fraction``, ``regions``, and ``frozen_mask``
    (the updated cumulative mask, ready to feed into the next call).
    """
    prev = Image.open(prev_path).convert("RGB")
    edit = Image.open(raw_edit_path).convert("RGB")
    if edit.size != prev.size:
        edit = edit.resize(prev.size, Image.LANCZOS)

    a = np.asarray(prev, dtype=np.int16)
    b = np.asarray(edit, dtype=np.int16)
    diff = np.max(np.abs(a - b), axis=2).astype(np.uint8)

    # Per-pixel threshold: a frozen region must clear the (much higher)
    # ``override_threshold`` to be touched again, so re-render drift on
    # previously added elements stays blocked but a new symbol painted
    # over an existing one is still accepted.
    if frozen_mask is not None:
        fm = np.asarray(frozen_mask, dtype=bool)
        if fm.shape != diff.shape:
            fm = np.zeros(diff.shape, dtype=bool)
    else:
        fm = np.zeros(diff.shape, dtype=bool)

    thr_map = np.where(fm, int(override_threshold), int(threshold)).astype(np.int16)
    mask = diff > thr_map

    if mask.any():
        mask = closing(mask, disk(2))
        if dilate > 0:
            mask = dilation(mask, disk(int(dilate)))

    regions = 0
    if mask.any() and min_region_area > 0:
        lbl = label(mask, connectivity=2)
        if lbl.max() > 0:
            counts = np.bincount(lbl.ravel())
            keep = counts >= int(min_region_area)
            keep[0] = False
            mask = keep[lbl]
            regions = int(keep.sum())

    alpha_img = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    if feather > 0 and mask.any():
        alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(float(feather)))

    out = Image.composite(edit, prev, alpha_img)
    out.save(output_path, format="PNG")

    new_frozen = mask | fm

    if verbose:
        sys.stderr.write(
            f"[compose] changed={mask.mean()*100:.2f}% "
            f"regions={regions} frozen={new_frozen.mean()*100:.2f}%\n"
        )

    return {
        "changed_fraction": float(mask.mean()) if mask.size else 0.0,
        "regions": regions,
        "frozen_mask": new_frozen,
    }

