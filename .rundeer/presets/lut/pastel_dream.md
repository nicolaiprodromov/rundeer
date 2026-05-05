# Pastel Dream — LUT Reference

## Overview

The Pastel Dream LUT creates a soft, ethereal, dreamlike aesthetic characterized by lifted blacks, reduced contrast, muted colors pushed toward soft pastels, and a gentle diffused quality. The look bridges several photographic traditions: overexposed Ektachrome slide film, the soft-focus glamour photography of the 1970s–80s shot through Tiffen diffusion filters, and the contemporary "soft girl" or "cottagecore" aesthetic of modern digital photography. The result is tender, nostalgic, and intentionally beautiful in a fragile, impermanent way.

---

## Foundation: Black Lift and Contrast Reduction

The single most important characteristic of the pastel dream look is **lifted blacks**.

- **Black point:** Lifted to approximately +35–40 IRE. True black does not exist in this look.
- **White point:** Slightly lowered to approximately 90 IRE. No harsh white.
- **Overall contrast:** Approximately 0.60× normal — the tonal range is compressed to a soft, low-contrast window.
- **Result:** The image never feels dark or heavy; everything floats in a mid-tone register.

---

## Tone Curve Characteristics

### Shadows (lifted base, 35–50% effective luminance)
- **Shadow color:** Soft lavender-purple. RGB of lifted shadow floor: approximately (90, 82, 105).
- **Character:** Shadows become color rather than darkness. The lavender shadow is the defining color of this LUT.
- **Shadow saturation:** Moderate — enough to read as clearly lavender-purple, not just grey.

### Midtones (50–75% effective luminance)
- **Predominant color:** Rose-pink desaturated toward blush. Skin takes on a soft peach-rose quality.
- **Global color temperature:** Shifted very slightly warm (+200K equivalent), but the pink-lavender palette overrides simple warmth.
- **Saturation:** All colors move toward pastel — not desaturated to grey, but pushed toward the pastel version of themselves.

### Highlights (75–90% effective luminance)
- **Highlight color:** Milky cream (#FFF8F2 equivalent). Warm, soft, never harsh.
- **Bloom:** A very soft warm diffusion bloom (σ=3, 6% opacity) around all highlights — simulates diffusion filter halation.
- **White rendering:** No pure white exists. The entire luminance range sits below a soft ceiling.

---

## Pastel Hue Mapping

| Source Hue      | Pastel Target      | Saturation Delta |
|-----------------|--------------------|------------------|
| Red → Blush     | Soft rose-pink     | -0.25           |
| Orange → Peach  | Peach cream        | -0.20           |
| Yellow → Cream  | Warm ivory         | -0.22           |
| Green → Sage    | Muted sage green   | -0.28           |
| Cyan → Mint     | Soft mint green    | -0.25           |
| Blue → Periwinkle | Soft periwinkle  | -0.18           |
| Violet → Lavender| Soft lavender     | -0.15           |
| Magenta → Lilac | Soft lilac-pink    | -0.20           |

The transformation moves all hues toward the pastel register while retaining their fundamental hue identity.

---

## Diffusion Treatment

### Global Soft Focus
- Luminance channel very slight gaussian diffusion: σ=0.6, blended at 8% over the sharp layer.
- Simulates shooting through a Tiffen Pro-Mist 1/4 or similar diffusion filter.

### Halation
- Warm bloom around all bright areas: σ=12px, opacity 5%, color: #FFE8DC (warm cream-pink).
- All light sources and window sources should carry a gentle atmospheric glow.

### Edge Softness
- High-contrast edges are very slightly softened with a bilateral blur — the look avoids harsh lines.

---

## Grain / Texture

- **Type:** Very fine, barely perceptible grain — suggests delicacy rather than coarseness.
- **Color grain:** A faint warm-pink chroma noise in the lifted shadow range (σ=0.006 at shadow level).
- **Luminance grain:** σ=0.006 uniform — present but almost subliminal.

---

## Use Cases

- Romance and love stories, coming-of-age films, memory sequences.
- Fashion and beauty editorial with a tender, feminine aesthetic.
- Children's content, fantasy sequences, fairy tale or storybook visuals.
- Music videos in the contemporary "dream pop" or "bedroom pop" aesthetic.
- Opening title sequences for gentle, nostalgic narratives.

---

## Pairing Notes

- **Works best with:** Soft natural light (overcast days, indirect window light, soft boxes). Subjects in pastel or muted clothing.
- **Avoid for:** Horror, action, crime — the look is incompatible with tension.
- **Complementary effects:** Light lens flare (a pink-gold streak), flower bokeh, dappled window light overlay.
- **Reference aesthetics:** Sophia Coppola's *The Virgin Suicides* (1999), *Moonrise Kingdom* (Anderson, 2012), contemporary lo-fi music video production, Petra Collins photography.
