---
name: rundeer-cli
description: "Use when: a user asks to generate, edit, merge, extend, batch, benchmark, dry-run, configure, troubleshoot, automate, or build node-graph image/video workflows with the rundeer CLI, TUI, Nodes workbench, Explore view, or web API. Teaches command selection, graph nodes, bundles, .rundeer workspace rules, style brains, references, config precedence, env vars, outputs, grids, and completion checks. Prefer rundeer over hand-rolled API calls when the task maps to its commands."
argument-hint: "[goal, prompt, assets, or command]"
user-invocable: true
---

# Rundeer CLI Skill

Use this skill to operate Rundeer accurately and safely. Rundeer is a batch-first Python CLI with a modern browser node workbench for Grok Imagine image and video workflows.

## Mental Model

- The project root is always the current working directory.
- The first real command bootstraps `./.rundeer/` with config, outputs, cache, logs, benchmark templates, and a reusable skill template.
- CLI flags override config files. `--config=<path>` overrides `.rundeer/config.json`.
- Outputs default to `.rundeer/outputs`; encoded references cache under `.rundeer/cache`; graphs live under `.rundeer/graphs`; logs and web run state live under `.rundeer/logs` and `.rundeer/runs`.
- Style brains live under `brain/<Style>/`. The prompt file is named after the style, and `Reference/` images are selected by numeric filename prefix such as `0003_*.png`.
- `rundeer web --open` serves the current node workbench at `/`, `/nodes`, and `/explore`; the older form UI is available at `/classic` only as a fallback.
- Web command nodes call the same CLI engine through `/api/plan` for dry-runs and `/api/run` for live execution. Each web run writes a config snapshot to `.rundeer/runs/<run-id>/config.json`.

When working inside this repo, prefer `python3 rundeer.py ...` if the `rundeer` executable is not known to be installed. If the user is using an installed copy, `rundeer ...` is fine.

## Preflight

1. Identify the exact workflow: terminal command, node graph, Explore/file inspection, image, video, edit, merge, extend, batch, benchmark, or web run.
2. Check whether the requested action spends API credits. If yes, run or propose `--dry-run --no-tui` first unless the user explicitly asks for a live call.
3. Confirm required files exist for `--input`, `--start-frame`, `--source`, `--batch-file`, or custom config paths.
4. For live generation, make sure the project `.env` contains `VISION_API_KEY`. Definition scripts that call a language model need `MODEL_API_KEY`; both may use `BASE_URL`.
5. Keep the current working directory intentional. `.rundeer/` is not searched upward from parent directories.

## Command Decision Tree

| User goal | Command |
|---|---|
| Generate still images from a prompt | `rundeer image` |
| Generate text-to-video clips | `rundeer video` |
| Animate an exact starting image | `rundeer video --start-frame=<image>` |
| Edit an image | `rundeer edit --type=image --input=<image>` |
| Edit a video file | `rundeer edit --type=video --input=<video>` |
| Compose multiple images into one | `rundeer merge --input=a.png,b.png` |
| Continue an existing clip | `rundeer extend --source=<video-or-url>` |
| Run several configs in sequence | `rundeer batch --batch-file=<json>` |
| Build node graph workflows | `rundeer web --open` |
| Browse files and preview artifacts | `rundeer web --open`, then use Explore |
| Score spatial placement accuracy | `rundeer benchmark position` |

## Safe Operating Procedure

1. Start with the smallest useful batch: `--iterations=1` to `3` for live testing.
2. Add `--dry-run --no-tui` to inspect style, subject, prompt resolution, references, job count, output paths, concurrency, and definitions.
3. In the Nodes workbench, enable the command node's `Dry Run` checkbox before running an unfamiliar graph.
4. If the dry run is correct, remove `--dry-run` or uncheck `Dry Run`. Keep `--no-tui` for automation or logs that need to be captured.
5. Use `--output-name=<slug>` and a clear output directory for runs the user will compare later.
6. After completion, report output paths, grid path if present, failures, and any warnings from the command.

## Common Flags

```bash
--style=<name>           # style folder under brain/, default Moebius
--subject=<text>         # fills [subject] in the style prompt
--motion=<text>          # fills [motion] for video/edit/extend flows
--iterations=<n>         # number of jobs in the batch
--aspect-ratio=<ratio>   # 1:1, 16:9, 9:16, etc.
--resolution=<r>         # images: 1k or 2k; videos: 480p, 720p, 1080p
--reference=<ids>        # style references from brain/<Style>/Reference/
--input=<paths>          # comma-separated input assets
--output-dir=<path>      # defaults to .rundeer/outputs
--output-name=<name>     # base file name, index is appended
--grid / --no-grid       # build an image or video grid
--concurrency=<n>        # default 10 for image, 1 for video
--config=<path>          # use a JSON config file
--dry-run                # no API calls
--no-tui                 # plain logs instead of curses
--verbose                # debug prompts, params, and paths
```

## Recipes

### Image Dry Run

```bash
rundeer image \
  --style=Moebius \
  --subject="a lunar botanist repairing a glass greenhouse" \
  --reference=0,3,7 \
  --iterations=3 \
  --aspect-ratio=1:1 \
  --grid \
  --dry-run \
  --no-tui
```

### Image Batch

```bash
rundeer image \
  --style=Moebius \
  --subject="a courier crossing a desert megacity" \
  --iterations=8 \
  --aspect-ratio=16:9 \
  --resolution=2k \
  --grid
```

### Text-to-Video

```bash
rundeer video \
  --style=Moebius \
  --subject="a quiet marketplace suspended above clouds" \
  --motion="wide establishing shot, then a slow push toward the bridge" \
  --duration=6 \
  --resolution=720p \
  --aspect-ratio=16:9 \
  --iterations=3
```

### Image-to-Video

```bash
rundeer video \
  --style=Moebius \
  --subject="the still frame comes alive" \
  --start-frame=./frames/hero.png \
  --motion="subtle wind, drifting dust, restrained camera movement" \
  --duration=6
```

When `--start-frame` is present, Rundeer ignores `--reference` and `--input` for video because the API does not allow start-frame and reference-image modes together.

### Image Edit

```bash
rundeer edit --type=image \
  --input=./input/portrait.png \
  --style=Moebius \
  --subject="turn the jacket into polished chrome, keep the pose intact" \
  --iterations=4 \
  --grid
```

### Chained Image Edit

Use config for chain settings, then run `edit`:

```json
{
  "batch": {
    "iterations": 5,
    "chain": true,
    "chain_compose": true
  }
}
```

Chained edits must run sequentially. Rundeer forces concurrency to `1` when chaining.

### Merge Images

```bash
rundeer merge \
  --input=./character.png,./environment.png \
  --subject="place the character naturally into the environment with matched light" \
  --aspect-ratio=16:9 \
  --iterations=5
```

### Extend Video

```bash
rundeer extend \
  --source=./clips/shot_01.mp4 \
  --subject="the camera pulls back to reveal the full skyline" \
  --motion="continue the same movement, preserve continuity" \
  --duration=6
```

### Batch File

```json
{
  "sleep": 60,
  "batch": [
    { "command": "image", "config": "runs/lookdev_01.json" },
    { "command": "video", "config": "runs/shot_01.json" }
  ]
}
```

```bash
rundeer batch --batch-file=.rundeer/batch.json --dry-run --no-tui
```

### Web Workbench

```bash
rundeer web --host=127.0.0.1 --port=8787 --open
```

Use `--port=0` if the default port is occupied. The current webapp is the node workbench, not the older form-first console.

Routes:

- `/`, `/nodes`, `/explore`: current workbench.
- `/classic`: legacy form UI fallback.

Nodes view:

- **Primitives**: String, Number, Boolean, Vector, File, String Join.
- **Operations**: Compress, Blur, Math, String Op, Random.
- **Prompt**: Prompt, Prompt Filter, Definition.
- **Commands**: Image, Video, Edit, Merge, Extend.
- **Bundle**: Bundle, Create Bundle, Sample Bundle.
- **Loop**: Loop Decompose and Loop Output. Use matching `loop_id` values to iterate bundles.
- **Coordinates**: Coordinate, Mapping.
- **Vector**: Vector, Mix.
- **Output**: Preview, Render. Preview displays upstream image, video, text, or bundles inline and can collapse upstream graph chains.

Important graph behavior:

- Command props are also input sockets. Wired values override static fields.
- Command nodes with `iterations > 1` produce bundles.
- Loop Output resolves the bundle feeding the matching Loop Decompose once, then resolves the loop body per item.
- Lite preview refresh reuses heavy node results so previews do not re-spend credits.
- Run Graph resolves terminal command nodes and connected Preview nodes, then streams output into the floating run dock.

Explore view:

- Split-pane file tree and preview panel.
- Supports workspace filtering, expand/collapse, open-in-tab, copy path, and previews for supported media and text artifacts.
- Useful for inspecting `.rundeer/outputs`, `.rundeer/graphs`, configs, logs, docs, and generated assets.

## Config Rules

Highest precedence wins:

1. CLI flags.
2. `--config=<path>` JSON.
3. `./.rundeer/config.json` in the current working directory.
4. Built-in defaults.

Important sections in `.rundeer/config.json`:

- `output.dir`, `output.name`
- `batch.iterations`, `batch.concurrency`, `batch.grid`, `batch.grid_only`, `batch.grid_options`
- `batch.chain`, `batch.chain_compose`, `batch.chain_threshold`, `batch.chain_override`, `batch.chain_dilate`, `batch.chain_feather`, `batch.chain_min_region`
- `references.ids`, `references.pad`, `references.quality`
- `image.model`, `image.aspect_ratio`, `image.resolution`
- `video.model`, `video.aspect_ratio`, `video.duration`, `video.resolution`, `video.concurrency`
- `rate_limits.enabled`, `rate_limits.per_second`, `rate_limits.per_minute`, `rate_limits.per_hour`, `rate_limits.per_day`
- `web.artifact_view`, `web.artifact_size`, `web.dock_expanded`, panel open settings
- `definitions`, mapping `@name` tokens to local Python files

## Definitions

Config can map `@name` tokens to Python functions. Rundeer resolves them per job before execution.

```json
{
  "subject": "a symbolic artifact called @random_symbol",
  "definitions": {
    "random_symbol": ".rundeer/def/random_symbol.py"
  }
}
```

Definition scripts read environment after the project `.env` is loaded. Unknown `@tokens` remain unchanged.

## Pitfalls

- `--dry-run` is always safe and makes no API calls.
- Image edit and merge flows accept at most five total images.
- Image-to-video `--start-frame` cannot be combined with references or extra inputs.
- Video grids require `ffmpeg`; individual video files still download if grid building is unavailable.
- Video URLs expire, so Rundeer downloads results immediately.
- The TUI falls back in non-TTY environments. Use `--no-tui` for automation.
- `.env` is read only from the project root, not parent directories and not `.rundeer/.env`.
- References are style guidance, not content instructions. Keep the subject explicit.

## Completion Checks

For dry-runs, confirm the command printed the expected style, subject, iterations, output directory, concurrency, grid setting, definitions preview, and job count.

For live runs, confirm:

- Exit code is `0`, or failures are clearly reported.
- Output files exist under the reported output directory.
- Grid path exists when `--grid` succeeded.
- Any ignored references, missing start frames, invalid inputs, or API warnings are relayed to the user.
- The final response includes the command used and the important output paths.

For graph runs, also confirm the run dock reached `done`, terminal command nodes no longer show failed state, produced artifacts appear in Explore or `/api/artifacts`, and the relevant `.rundeer/runs/<run-id>/config.json` reflects the graph inputs.