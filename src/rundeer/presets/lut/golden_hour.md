# Golden Hour / Magic Hour — LUT Reference

## Overview

Magic hour (also called golden hour) is the approximately 20–40 minute window after sunrise or before sunset when the sun is at 0°–6° above the horizon. The low sun angle, atmospheric path length, and Rayleigh scattering combine to produce: warm amber-orange direct sunlight, long soft shadow fills from the open sky (blue-violet), and a uniquely cinematic quality of light that is simultaneously the hardest and most flattering to photograph. This LUT replicates those lighting conditions and can be used to transform images taken at any time of day into the magic hour look.

---

## Tone Curve Characteristics

### Shadows (0–30% luminance)
- **Shadow fill color:** Cool blue-violet. Open sky fill at magic hour has a noticeable blue-purple cast, providing complementary contrast to the warm direct light.
- **Shadow lift:** +8 IRE — shadows are gently opened. Magic hour shadows are long and soft, never fully black.
- **Shadow saturation:** Moderate. The blue-violet fill is present but not overwhelming.

### Midtones (30–75% luminance)
- **Dominant hue:** Warm amber-gold (CCT approximately 2800–3500K equivalent).
- **Skin tones:** This is the LUT's greatest strength. Warm directional light at magic hour is universally flattering on skin — warm, rich, glowing.
- **Foliage:** Takes on a golden backlit quality — top surfaces warm amber, shadow sides cool blue-green.
- **General gamma:** 0.95 — slightly gentler than neutral, giving the characteristically soft feel of diffused directional sunlight.

### Highlights (75–100% luminance)
- **Highlight color:** Warm cream with a slight peach cast (#FFF0D8 equivalent at clipping).
- **Shoulder:** Gentle, long roll-off — magic hour light has a soft, hazy quality due to atmospheric scatter.
- **Bloom:** A very subtle warm glow bloom on the brightest highlights (+10px radius, warm orange, ~5% opacity) simulates atmospheric halation.

---

## Per-Channel Adjustments

| Channel | Shadow Offset | Midtone Gamma | Highlight Tint |
|---------|---------------|---------------|----------------|
| Red     | +6 IRE        | +0.12         | +0.08 (warm cream)|
| Green   | +4 IRE        | +0.06         | +0.02          |
| Blue    | +8 IRE        | -0.04         | -0.06          |

**Net effect:** Warm amber direct light, cool blue shadow fill — the defining contrast of magic hour.

---

## Sky Gradient

For images containing visible sky:
- **Horizon (0°–15° elevation):** Deep orange-red (#FF6B2B). At true magic hour, the horizon sky is almost as warm as the sun itself.
- **30°–60° elevation:** Transitions through amber → warm gold → soft blue-yellow.
- **Zenith (overhead):** Deep warm cobalt (#4A6FA5) — the sky overhead remains somewhat blue but is warmed from the ambient.

---

## Atmospheric Haze

- **Background haze:** Faint warm atmospheric scatter increases with depth. Distant objects shift toward warm golden-grey.
- **Aerial perspective:** Objects at distance de-saturate slightly and warm (opposite of midday aerial perspective which is cool-blue).
- **Haze opacity:** ~15% at 1km simulated depth, ~40% at 5km.

---

## Saturation

| Hue Range        | Saturation Delta | Notes                                    |
|------------------|------------------|------------------------------------------|
| Red-orange (0°–50°)| +0.20          | Sun, warm surfaces, skin                 |
| Yellow (50°–80°) | +0.18            | Golden tones enriched                    |
| Green (80°–160°) | -0.05            | Slightly desaturated — backlit foliage   |
| Cyan-blue (160°–240°)| +0.08       | Sky and shadow fill, moderate            |
| Violet (240°–300°)| +0.12           | Shadow fill hue, slightly enriched        |

---

## Use Cases

- Transforming flat midday footage into the golden hour look in post.
- Romantic drama, period films, westerns, nature documentaries.
- Portrait and character work — universally flattering.
- Landscape and establishing shots that require emotional warmth.
- Any scene requiring a sense of nostalgia, beauty, or transience.

---

## Pairing Notes

- **Works best with:** Outdoor settings with a visible light direction. Hard shadows from a single dominant source.
- **Combine with:** Lens flare (warm streak at magic hour), very slight warm grain, subtle vignette.
- **Avoid for:** Interior scenes without a window light source, night scenes.
- **Reference works:** *The Revenant* (Lubezki, 2015), *Days of Heaven* (Almendros, 1978 — the most famous magic hour film ever made), *Once Upon a Time in the West* (Tonti, 1968).
