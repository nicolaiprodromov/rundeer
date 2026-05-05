# Noir Silver Gelatin — LUT Reference

## Overview

The noir silver gelatin LUT emulates the look of classic Hollywood black-and-white photography and cinematography from the 1930s–1950s, specifically the look of high-silver-content orthochromatic-to-panchromatic transition era imagery. Think Citizen Kane, Double Indemnity, Sunset Boulevard. Deep, dramatic shadows, brilliant highlights with a metallic silver sheen, and a tonal palette that reads as "black and white cinema" rather than merely "desaturated color."

---

## Desaturation Method

**Channel mixer (luminance-preserving):**

| Source Channel | Weight |
|----------------|--------|
| Red            | 0.45   |
| Green          | 0.40   |
| Blue           | 0.15   |

**Rationale:** The red-heavy mix gives skin tones a bright, flattering rendering (as in panchromatic film with a yellow/orange filter applied). It darkens blue skies naturally, bringing out clouds. Slightly favors warm over cool, which reads as classic B&W photography rather than modern digital desaturation.

---

## Tone Curve Characteristics

### Shadows (0–20% luminance)
- **Toe:** Abrupt, hard crush. Shadows in noir are intentionally black — no significant toe lift.
- **Shadow floor:** True black, slightly below 0 IRE clamped. Inky, opaque.
- **Paper base simulation:** The global white point shifts to a warm ivory (#F5F0E8 equivalent), so "white" is not RGB(255,255,255) but a cream tone.

### Midtones (20–70% luminance)
- **Gamma:** 0.90 — slightly steeper than linear; punchy separation between mid-shadow and mid-highlight.
- **Silver tone:** Midtone neutrals read as a cool silver-grey rather than warm grey. The silver tone is the defining quality.
- **Skin:** Rendered bright and smooth — the red-weighted channel mixer ensures faces hold luminance well.

### Highlights (70–100% luminance)
- **Shoulder:** Gentle but not long. Highlights clip to the warm ivory white point cleanly.
- **Specular highlights:** Pure specular points (windows, jewelry, wet surfaces) hold a brilliant metallic silver quality.
- **Contrast:** Overall print-density contrast is approximately +0.15 gamma from a neutral baseline.

---

## Additional Treatments

### Vignette
- Radial falloff, centered slightly above center (to simulate period lens characteristics).
- Corner darkening: approximately -1.0 EV at corners, feathered widely.
- Creates the theatrical frame-within-a-frame quality of noir lighting design.

### Paper Base Tint
- Global white point: warm ivory. RGB approximately (245, 240, 232).
- Shadow base: neutral black (no blue/sepia wash — this is silver, not cyanotype or sepia).

### Grain
- Fine-to-medium silver halide grain, heavier than modern stock.
- Luminance-weighted: coarser in shadows and upper mids, finer in highlights.
- σ=0.018 in shadows, σ=0.009 in highlights. Medium radius (~1.5px at 2K).

---

## Use Cases

- Period drama set in the 1930s–1950s.
- Flashback sequences conveying memory or the past.
- Hard-boiled crime, detective, and noir genres.
- Dream sequences where a desaturated aesthetic signals unreality.
- Character studies with dramatic, sculptural lighting.

---

## Pairing Notes

- **Works best with:** Hard directional side-lighting, venetian blind shadow patterns, high-contrast practical light sources.
- **Avoid:** Soft, diffused lighting — the hard shadow crush will lose too much detail.
- **Complementary effects:** Lens vignette, subtle halation around practical lights, slight horizontal scan-line texture for film-projected feel.
- **Reference films:** *Citizen Kane* (Toland, 1941), *Double Indemnity* (Seitz, 1944), *The Third Man* (Krasker, 1949), *Sunset Boulevard* (Seitz, 1950).
