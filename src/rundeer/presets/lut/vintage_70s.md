# Vintage 1970s Photochemical — LUT Reference

## Overview

The 1970s photochemical look is defined not by any single film stock, but by the accumulated artifacts of the entire workflow of that era: lower-precision color negative stocks (Eastmancolor, early Kodak 5247), Technicolor and Rank Cintel optical printing, aging C-41 color prints with faded dye layers, and projection through slightly de-silvered Bausch & Lomb lenses. The result is a distinctive aesthetic: faded blacks, oversaturated warm tones, greenish-yellow shadows, and a general sense of photochemical fatigue that is now deeply associated with the decade's visual culture.

---

## The Faded Dye Problem: Foundation of the Look

Photographic color dyes fade unevenly over time. **Cyan dye** (responsible for reds) fades fastest. **Magenta dye** fades at medium rate. **Yellow dye** is most stable. The result of aged 1970s prints:

- **Reds** shift toward orange-yellow (cyan dye loss).
- **Shadows** shift toward warm dark brown (cyan and magenta both reduced in darks).
- **Highlights** shift toward yellow-green (yellow dye is all that remains fully).
- **Blues** become cyan-blue then pale (magenta dye supporting blue is partially gone).

This is the primary driver of the "1970s look."

---

## Tone Curve Characteristics

### Shadows (0–20% luminance)
- **Black point lift:** +20–25 IRE. The most important characteristic. Blacks are warm, milky dark brown rather than true black.
- **Shadow color:** Warm dark brown-orange. RGB approximation at black: (45, 28, 18).
- **Minimum density:** Never reaches zero — the dye fading floor prevents true black.

### Midtones (20–75% luminance)
- **Gamma:** 0.88 — slightly compressed. The era's film stocks had lower dynamic range than modern stock.
- **Skin tones:** Pushed toward orange-amber. Actors from this era often appear slightly more orange than accurate.
- **Color character:** Warm, slightly oversaturated in the red-orange range, desaturated in blues-greens.

### Highlights (75–100% luminance)
- **Highlight shift:** Toward yellow-green. Whites take on a faint straw-yellow (#FFFAD0 equivalent).
- **Clip characteristic:** Highlights clip with a slight magenta fringe (from partial magenta dye retention at high densities).
- **Halation:** Subtle warm halation bloom around practical lights — optical printing artifacts.

---

## Per-Channel Adjustments

| Channel | Shadow Floor | Midtone Gamma | Highlight Tint |
|---------|-------------|---------------|----------------|
| Red     | +30 IRE     | +0.08         | 0.0            |
| Green   | +20 IRE     | +0.05         | +0.10          |
| Blue    | +10 IRE     | -0.06         | -0.12          |

**Net effect:** Warm dark floor in shadows (red dominant), yellow-green cast in highlights (green dominant, blue-deficient).

---

## Saturation Profile

| Hue Range         | Saturation Delta | Notes                                     |
|-------------------|------------------|-------------------------------------------|
| Red-orange (0°–50°) | +0.15          | The warm tones push vivid                 |
| Yellow (50°–80°)   | +0.12           | Greenish-yellow highlight bias             |
| Green (80°–160°)   | -0.08           | Greens desaturate and yellow              |
| Cyan (160°–200°)   | -0.18           | Significant cyan dye loss — cyans fade    |
| Blue (200°–260°)   | -0.15           | Blues shift toward cyan, less saturated   |
| Violet (260°–300°) | -0.10           | Muted                                     |

---

## Optical Artifacts

### Halation
- Warm bloom (~8px radius, ~6% opacity) around bright light sources.
- Simulates optical print-down halation from the era's camera negative.

### Color Banding
- Very faint horizontal banding (2% opacity) in smooth gradients — optical printing registration artifact.
- Visible only in skies and clear background gradients.

### Softness
- Slight overall softness from period lenses and optical printing. Apply a very mild diffusion (σ=0.4) to the luminance channel.

---

## Grain

- **Type:** Coarser than modern film. C-41 color grain clusters in the shadows.
- **Character:** Luminance-weighted, medium-coarse grain with slight color grain (magenta-green clumping in shadows).
- **Suggested values:** σ=0.022 in shadows, σ=0.011 in highlights. Grain radius ~2px at 2K.

---

## Use Cases

- Period drama set in the 1970s or evoking that decade's aesthetic.
- Nostalgic or memory-flashback sequences.
- Low-budget exploitation film aesthetic.
- Any content intended to evoke the visual culture of the Vietnam era, disco era, or New Hollywood cinema.

---

## Pairing Notes

- **Works best with:** Wide-angle compositions, natural interior light, practical lights as source.
- **Complementary effects:** Slightly degraded audio (telephone-bandwidth EQ aesthetically matched), film gate weave, light flicker.
- **Reference works:** *Chinatown* (Zsigmond, 1974), *Apocalypse Now* (Storaro, 1979), *Taxi Driver* (Chapman, 1976), *The Godfather* (Willis, 1972).
