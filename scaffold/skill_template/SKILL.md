---
name: rundeer
description: Use this skill whenever the user asks to generate, edit, extend, compose, batch, benchmark, dry-run, or build node-graph image/video workflows via rundeer and the Grok Imagine API. rundeer is a CLI-backed visual workbench around xAI's grok-imagine-image and grok-imagine-video models with browser Nodes and Explore views, batch generation, style references, multi-image edits/merges, image-to-video, video extension, grids, and a `.rundeer/` folder always rooted in the current working directory. Always prefer rundeer over hand-rolled API calls when the task maps onto one of its commands.
---

# rundeer — batch-first Grok Imagine CLI

`rundeer` is the production CLI and browser node workbench for generating and editing visual media with the Grok Imagine API. It is **batch-first** (iterate to find the best output) and auto-bootstraps a `.rundeer/` folder in the current working directory on first run.

## When to use rundeer

Use rundeer for any of these tasks:

- Generate a batch of images/videos in a given style.
- Iterate on a subject with style references for consistency.
- Edit an image or video with natural-language instructions.
- Merge / compose up to 5 images into a single output.
- Animate a still image (image-to-video with a starting frame).
- Extend an existing video clip.
- Produce a contact-sheet grid from a batch.
- Build or run a visual node graph in `rundeer web --open`.
- Inspect project files, run configs, and artifacts in the Explore view.

## Subcommands (decision tree)

| Want to... | Use |
|---|---|
| Generate N images from a prompt (optionally + style refs) | `rundeer image` |
| Generate N videos from a prompt (text- or image-to-video) | `rundeer video` |
| Edit an existing image or video with instructions | `rundeer edit --type=image\|video` |
| Combine/compose 2–5 images into one | `rundeer merge` |
| Extend a video further | `rundeer extend` |
| Build node graphs or browse artifacts | `rundeer web --open` |
| Score model placement accuracy | `rundeer benchmark position` |

## Global flags (available on every subcommand)

```
--style=<name>           Style folder under rundeer/brain/ (e.g. Moebius).
--subject=<text>         Fills the [subject] placeholder in the style prompt.
--iterations=<n>         Number of outputs in the batch.
--aspect-ratio=<w:h>     e.g. 1:1, 16:9, 9:16.
--model=<name>           Override the default model.
--output-dir=<path>      Where to save outputs (default: ./.rundeer/outputs).
--output-name=<name>     Base filename (index auto-appended).
--grid / --no-grid       Build a grid (PNG for images, MP4 via ffmpeg for videos).
--concurrency=<n>        Parallel workers (default 10 for image, 1 for video).
--config=<path>          Config JSON (default ./.rundeer/config.json).
--no-tui                 Disable curses TUI; use plain logging.
--dry-run                Print the resolved plan and exit without API calls.
```

## Cookbook

### 1. Text-to-image batch in a style
```
rundeer image --style=Moebius --subject="a deer in a misty forest" \
    --iterations=10 --aspect-ratio=1:1 --grid
```

### 2. Image batch with style references
```
rundeer image --style=Moebius --subject="cyberpunk samurai" \
    --reference=0,3,7 --iterations=8 --grid
```

### 3. Text-to-video batch
```
rundeer video --style=Moebius --subject="a deer walking through mist" \
    --motion="slow cinematic dolly shot" --duration=6 --resolution=720p \
    --aspect-ratio=16:9 --iterations=3
```

### 4. Image-to-video (animate a still)
```
rundeer video --style=Moebius --subject="still frame coming alive" \
    --start-frame=./portraits/01.png --motion="subtle wind, birds drift by" \
    --duration=6 --resolution=720p
```

### 5. Edit an image
```
rundeer edit --type=image --input=./photo.jpg \
    --subject="transform to golden-hour oil painting" --iterations=4 --grid
```

### 6. Multi-image edit with style references
```
rundeer edit --type=image --input=./subject.jpg --reference=0,1 \
    --subject="place the subject into the reference's world" --iterations=4
```
(Inputs + refs must total ≤ 5. Slot 1 = subject, slots 2..N = style-only.)

### 7. Edit a video
```
rundeer edit --type=video --input=./clip_first_frame.jpg \
    --subject="change time to night, add neon rain" \
    --duration=6 --resolution=720p
```

### 8. Merge / compose images
```
rundeer merge --input=./character.png,./background.jpg \
    --subject="place the character in the scene, matching light" \
    --iterations=5 --aspect-ratio=16:9
```

### 9. Extend a video
```
rundeer extend --source=./clip.mp4 \
    --subject="continuation: the camera pulls back to reveal a vast landscape" \
    --duration=6
```

### 10. Dry-run to inspect the plan
```
rundeer video --style=Moebius --subject="test" --iterations=3 --dry-run
```

### 11. Open the node workbench
```
rundeer web --open
```

The current browser UI serves Nodes and Explore at `/`, `/nodes`, and `/explore`. The older form-based UI is available at `/classic` as a fallback.

In Nodes, command props are also sockets, so wired values override static values. Command nodes with `iterations > 1` produce bundles. Use Loop · Decompose and Loop · Output with matching `loop_id` values to process bundle items. Use Preview nodes to display upstream image, video, text, or bundle values inline.

## Config precedence (highest wins)

1. CLI flags.
2. `--config=<path>` JSON file.
3. `./.rundeer/config.json` (auto-created on first run).
4. Built-in defaults.

### Sample `.rundeer/config.json`
```json
{
  "style": "Moebius",
  "subject": "rundeer",
  "motion": null,

  "output":     { "dir": ".rundeer/outputs", "name": "output" },
  "batch":      { "iterations": 5, "concurrency": null, "grid": true },
  "references": { "ids": [], "pad": true, "quality": 85 },

  "image": { "model": "grok-imagine-image", "aspect_ratio": "1:1" },
  "video": {
    "model": "grok-imagine-video",
    "aspect_ratio": "16:9",
    "duration": 6,
    "resolution": "720p",
    "concurrency": 1
  }
}
```

## Pitfalls & gotchas

- **5-image cap**: For `edit` and `merge`, `inputs + references ≤ 5`. rundeer errors up front if you exceed it.
- **Image edits can't use the API's separate `reference_images`**: on the image endpoint rundeer packs inputs + refs into a single `image_urls` list and tells the model slot 1 is the subject and slots 2..N are style-only. For video edits, it uses the proper `image` + `reference_images` split.
- **Video grid needs ffmpeg**: `--grid` on video subcommands stitches outputs via `ffmpeg xstack`. If `ffmpeg` isn't available, rundeer warns and skips the grid — individual clips still download.
- **Video URLs expire**: rundeer downloads each result immediately. Don't rely on the returned URLs being available later.
- **TUI falls back automatically**: in non-TTY environments (CI, pipes) or with `--no-tui`, rundeer prints plain status lines with the same information.
- **`--dry-run` makes no API calls**: always safe for verifying prompt, refs, and output paths before spending credits.
- **Default concurrency** is 10 for image, 1 for video. Raise video concurrency cautiously; each clip is expensive.
- **Web runs are CLI runs**: the node workbench writes a config snapshot to `.rundeer/runs/<run-id>/config.json` and calls the same CLI command engine through `/api/plan` or `/api/run`.

## Prompt tips

- For images, lean on descriptive cinematic language; the style prompt already loads the house style.
- For videos, split intent between `--subject` (what's in the scene) and `--motion` (how the camera/action evolves) — the style prompt has a `[motion]` placeholder.
- Style references guide look but should not dictate content — rundeer adds a suffix making this explicit.
