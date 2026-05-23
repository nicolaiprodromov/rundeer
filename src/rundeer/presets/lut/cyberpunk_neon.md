# Cyberpunk Neon — LUT Reference

## Overview

The Cyberpunk Neon LUT translates any image into the visual vocabulary of dystopian near-future noir: rain-slicked streets, garish neon signage, deep darkness punctuated by vivid electric light. The aesthetic draws from *Blade Runner 2049*, *Ghost in the Shell* (1995 and 2017), *Akira*, and contemporary visual works in the cyberpunk canon. The key tension is **extreme darkness contrasted with hyper-saturated neon light** — almost nothing exists between near-black and blazing neon.

---

## Tone Curve Characteristics

### Shadows (0–25% luminance)
- **Crush:** Hard, aggressive shadow crush. Everything below approximately 15% luminance collapses to near-black.
- **Shadow floor:** True black with no base lift. Blacks are dense and absolute.
- **Shadow color:** Deep blue-purple (#0A0612 equivalent). Shadows are never truly neutral — always carry a slight cool violet.
- **Rationale:** The darkness of cyberpunk is total. Shadows swallow space; only neon cuts through.

### Midtones (25–60% luminance)
- **Range compression:** Midtones are significantly compressed — the mid-grey range is narrow.
- **Color:** Deep desaturated purple-blue. Midtones read as cool, dark, and atmospheric rather than informational.
- **Skin in midtones:** Should appear slightly sickly, cooled — naturalistic skin warmth is deliberately undercut.

### Highlights (60–100% luminance)
- **Expansion:** Highlights are allowed to bloom and glow — bright areas push toward overexposure.
- **Neon hue injection:** Highlights pick up strong color casts depending on light source proximity:
  - **Cyan/turquoise neon:** +0.30 saturation in the cyan-blue range (160°–220°)
  - **Magenta/pink neon:** +0.35 saturation in the red-magenta range (300°–360°/0°–15°)
  - **Amber/orange sodium:** +0.20 in orange (20°–50°)
- **Bloom:** Bright highlights carry a soft glow radius (~15px at 2K) of their own hue color.

---

## Per-Channel Adjustments

| Channel | Shadow     | Midtone     | Highlight           |
|---------|------------|-------------|---------------------|
| Red     | -0.05      | -0.08       | +0.25 (in warm zones)|
| Green   | -0.06      | -0.04       | +0.08               |
| Blue    | +0.04      | +0.10       | +0.30               |

---

## Saturation (Hue-Specific)

| Hue Range         | Saturation Delta | Notes                                    |
|-------------------|------------------|------------------------------------------|
| Cyan (160°–200°)  | +0.40            | Electric cyan neon — primary hue         |
| Magenta (300°–15°)| +0.45            | Hot pink neon — secondary hue            |
| Purple (250°–300°)| +0.30            | Deep violet atmospheric midtones          |
| Amber (20°–50°)   | +0.25            | Sodium vapor and warm practical light     |
| Neutral grey      | -0.20            | Desaturate the non-neon midfield         |
| Green (80°–160°)  | -0.15            | Reduce naturalistic greens               |

---

## Chromatic Fringing

- **High-contrast edges:** Add 0.5–1.0px lateral chromatic aberration on bright-to-dark transitions.
- **Color:** Red channel +0.5px rightward, blue channel +0.5px leftward.
- **Intensity:** Subtle — suggests lens quality consistent with the aesthetic without being distracting.

---

## Atmospheric Haze

- **Neon scatter:** Add a very faint colored mist layer (blended at ~8% opacity) matching the dominant neon hue of the scene. Simulates aerosol/rain scatter of neon light.
- **Depth haze:** Faint cool blue-purple atmospheric scatter increases with depth.

---

## Grain

- **Type:** Digital sensor noise rather than film grain — the aesthetic is digital/surveillance, not filmic.
- **Character:** Fine luminance noise σ=0.010, with occasional larger hot pixels suggesting cheap sensor.
- **Chroma noise:** Very slight magenta-cyan chroma noise in dark areas (~15% of luma noise amplitude).

---

## Use Cases

- Science fiction films, games, and animations in the cyberpunk aesthetic.
- Night city environment plates and establishing shots.
- Character portraits in neon-lit urban contexts.
- Title cards and promotional imagery for sci-fi properties.
- Music video and commercial aesthetics.

---

## Pairing Notes

- **Works best with:** Night exteriors, rain-wet surfaces, strong practical light sources in-frame.
- **Avoid:** Daylight scenes — the shadow crush will obliterate detail.
- **Complementary effects:** Rain streaks, anamorphic horizontal lens flare, wet surface reflections, chromatic aberration.
- **Reference works:** *Blade Runner* (1982), *Blade Runner 2049* (2017), *Ghost in the Shell* (1995), *Akira* (1988), *The Matrix* (1999).
