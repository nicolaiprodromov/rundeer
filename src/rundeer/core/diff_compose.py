



















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
































    prev = Image.open(prev_path).convert("RGB")
    edit = Image.open(raw_edit_path).convert("RGB")
    if edit.size != prev.size:
        edit = edit.resize(prev.size, Image.LANCZOS)

    a = np.asarray(prev, dtype=np.int16)
    b = np.asarray(edit, dtype=np.int16)
    diff = np.max(np.abs(a - b), axis=2).astype(np.uint8)





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

