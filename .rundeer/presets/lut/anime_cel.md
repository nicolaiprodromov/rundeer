# Anime Cel — LUT Reference

## Overview

The anime cel LUT emulates the visual character of hand-painted animation cels from the golden era of Japanese theatrical animation (approximately 1980–2000), specifically the production style of studios like Toei, Madhouse, and early Gainax. The defining quality is **flat color fills with hard tonal transitions** — a deliberate departure from photographic gradients toward the ink-and-paint workflow of traditional cel animation. Think *Akira* (1988), *Ghost in the Shell* (1995), *Princess Mononoke* (1997).

---

## Core Processing Method: Color Quantization

### Shadow Band (0–30% luminance)
- **Shadow color:** One flat, unified shadow tone per color region. Determined by hue: cool blue-grey for neutral areas, deep navy for dark clothing, deep earth for skin shadows.
- **Transition:** Hard step function (no feathering). The shadow-to-midtone boundary is a clean, drawn edge.
- **In practice:** All luminance values in 0–30% range collapse to a single shadow fill value.

### Midtone Band (30–70% luminance)
- **Base color fill:** The "lit" base color of the cel — the predominant color of the object.
- **Saturation:** Pushed +0.20 globally. All colors become bolder and more deliberate than photographic source.
- **Transition to highlights:** Slightly soft (2px radius) — painted highlights in anime are drawn, not airbrushed, but have a small amount of blending at the edge.

### Highlight Band (70–100% luminance)
- **Highlight color:** Bright, often near-white specular for plastic/metal/eyes. Skin highlights use a clean warm peach.
- **Specular pop:** Brilliant hard white specular on eyes, wet surfaces, and metallic objects — characteristic anime "eye shine."
- **Second highlight layer:** Many objects carry a secondary half-tone highlight between midtone and specular (especially hair and clothing). This is a distinct third band.

---

## Per-Hue Saturation Adjustments

| Hue Range       | Saturation Delta | Notes                                             |
|-----------------|------------------|---------------------------------------------------|
| Skin (orange)   | +0.18            | Warm, bold skin tones                             |
| Hair (variable) | +0.22            | Hair colors are oversaturated by design in anime   |
| Clothing        | +0.20            | Uniform fills, deliberate palette choices          |
| Sky             | +0.15            | Flat cel-painted sky gradients (two-tone)         |
| Shadow neutral  | -0.05            | Shadows are slightly desaturated to read as dark  |

---

## Line Enhancement

- **Edge detection:** Sobel or Canny edge pass at high threshold, reinforcing existing contrast edges.
- **Line weight:** 1–2px dark outline at major boundary edges (object-to-background, major form separations).
- **Color of lines:** Deep navy-black (#1A1A2E) rather than pure black — matches the ink color used in cel outlining.
- **Fine lines:** Hair strands, clothing folds retain fine internal line work at 0.5px weight.

---

## Background Treatment

- **Backgrounds** in anime are often more painterly and detailed than the character cels layered over them. Apply less quantization to background areas (preserve gradient washes in skies, atmospheric depth).
- **Cel layer separation:** Characters should appear to sit as flat cel layers slightly in front of a more painted background.

---

## Grain / Texture

- **No grain.** Cel animation has no grain. Apply a very subtle paper/gouache texture at ≤2% opacity if the background is a painted background plate, otherwise none.

---

## Use Cases

- Rotoscoping / anime-style character conversion of photographic subjects.
- Animated film production: converting 3D renders to look hand-painted.
- Title cards, promotional imagery in anime style.
- Stylized cutscenes for games in the anime aesthetic.

---

## Pairing Notes

- **Works best with:** Clean, well-lit source images with distinct regions of flat color.
- **Avoid:** Highly textured surfaces (bark, cobblestone) — quantization destroys fine texture and looks wrong.
- **Complementary effects:** Add a slight halation glow around bright light sources (anime "lens flare" is often a soft glow rather than streak-based).
- **Reference works:** *Akira* (1988), *Ghost in the Shell* (1995), *Neon Genesis Evangelion* (1995–96), *Princess Mononoke* (1997), *Cowboy Bebop* (1998).
