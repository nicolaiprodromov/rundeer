<div align="center">
    <img src="docs/gg.png" alt="rundeer" width="780">
    <h1>rundeer</h1>
    <p><strong>Batch-first AI image and video generation for artists, prompt engineers, and visual workflow hackers.</strong></p>
    <p>
        <a href="#quickstart"><img alt="version" src="https://img.shields.io/badge/version-0.2.0-ff60ff?style=flat"></a>
        <a href="#requirements"><img alt="python" src="https://img.shields.io/badge/python-3.10%2B-3776AB?style=flat&logo=python&logoColor=white"></a>
        <a href="#commands"><img alt="image and video" src="https://img.shields.io/badge/image%20%2B%20video-API-222222?style=flat"></a>
        <a href="#testing"><img alt="pytest" src="https://img.shields.io/badge/tests-pytest-0A9EDC?style=flat&logo=pytest&logoColor=white"></a>
        <a href="#commands"><img alt="CLI, TUI, and web" src="https://img.shields.io/badge/interface-CLI%20%2B%20TUI%20%2B%20web-6B50FF?style=flat"></a>
    </p>
    <p>
        <a href="#quickstart">Quickstart</a> /
        <a href="#commands">Commands</a> /
        <a href="#configuration">Configuration</a> /
        <a href="#advanced-workflows">Advanced Workflows</a> /
        <a href="#testing">Testing</a>
    </p>
</div>

`rundeer` is a production-minded Python CLI for AI image and video generation. It turns a single creative direction into batches of images or videos, keeps style prompts and references organized, shows live progress in a terminal UI, and saves everything into a predictable local workspace.

It is built for iteration: generate more than one thing, compare the set, keep the strongest output, then edit, merge, extend, benchmark, or run the next batch.

|  |  |
|---|---|
| Batch generation | Run many image or video jobs from one prompt with concurrency, retries, dry-runs, and indexed output names. |
| Style brains | Store reusable style prompts under `brain/`, attach reference images by numeric id, and keep subject text separate from house style. |
| Full media loop | Generate images, generate videos, animate a start frame, edit images, edit videos, merge up to five images, and extend existing clips. |
| Terminal-native workflow | Use the animated curses TUI, plain logs, or a local browser console started from the CLI. |
| Reproducible workspace | Auto-bootstrap `.rundeer/` with config, outputs, cache, logs, benchmark templates, and a reusable agent skill. |
| Research hooks | Score spatial accuracy with a built-in position benchmark that writes JSON logs and CSV summaries. |

## Quickstart

<div align="center">
    <img src="docs/webapp1.png" alt="rundeer" width="780">
</div>

```bash
# clone repo
git clone https://github.com/nicolaiprodromov/rundeer.git
cd rundeer

# fill in the env file with your own api keys
cp .env.example .env

# install rundeer
./rundeer.sh or ./rundeer.bat

# launch rundeer webapp
rundeer web

# or run the cli
rundeer image
```

The first real run creates `.rundeer/` in the current directory. Outputs default to `.rundeer/outputs`, references are cached in `.rundeer/cache`, and run artifacts live under `.rundeer/logs`.

Use `--dry-run` whenever you want to inspect the resolved prompt, job count, output paths, references, and definitions without spending API credits:

```bash
rundeer video --style=Moebius --subject="a station at sunrise" --motion="slow dolly in" --iterations=3 --dry-run --no-tui
```

## Commands

| Want to... | Run |
|---|---|
| Generate a batch of images | `python3 rundeer.py image` |
| Generate text-to-video or image-to-video | `python3 rundeer.py video` |
| Edit an image or video | `python3 rundeer.py edit --type=image` or `--type=video` |
| Compose several images into one | `python3 rundeer.py merge` |
| Continue an existing video clip | `python3 rundeer.py extend` |
| Execute many configs in sequence | `python3 rundeer.py batch` |
| Operate runs from a local web console | `python3 rundeer.py web --open` |
| Run a model placement benchmark | `python3 rundeer.py benchmark position` |

### Image Batch

```bash
python3 rundeer.py image \
    --style=Moebius \
    --subject="a lunar botanist repairing a glass greenhouse" \
    --reference=0,3,7 \
    --iterations=8 \
    --aspect-ratio=1:1 \
    --resolution=2k \
    --grid
```

`--reference` selects images from `brain/<Style>/Reference/` by filename prefix, such as `0003_*.png`. References are treated as style references, not content instructions.

### Video Batch

```bash
python3 rundeer.py video \
    --style=Moebius \
    --subject="a quiet marketplace suspended above the clouds" \
    --motion="wide establishing shot, then a slow push toward the main bridge" \
    --duration=6 \
    --resolution=720p \
    --aspect-ratio=16:9 \
    --iterations=3
```

For image-to-video, pass an exact first frame. The API does not allow start-frame mode and reference-image mode at the same time, so rundeer ignores references when `--start-frame` is present.

```bash
python3 rundeer.py video \
    --style=Moebius \
    --subject="the still frame comes alive" \
    --start-frame=./frames/hero.png \
    --motion="subtle wind, drifting dust, restrained camera movement" \
    --duration=6
```

### Edits And Merges

```bash
python3 rundeer.py edit --type=image \
    --input=./input/portrait.png \
    --style=Moebius \
    --subject="turn the jacket into polished chrome, keep the pose intact" \
    --iterations=4 \
    --grid
```

```bash
python3 rundeer.py merge \
    --input=./character.png,./environment.png \
    --subject="place the character naturally into the environment with matched light" \
    --aspect-ratio=16:9 \
    --iterations=5
```

Image edits and merges can send at most five images total. rundeer checks that up front so an invalid run fails before the API call.

### Video Extension

```bash
python3 rundeer.py extend \
    --source=./clips/shot_01.mp4 \
    --subject="the camera pulls back to reveal the full skyline" \
    --motion="continue the same movement, preserve continuity" \
    --duration=6
```

`--source` accepts a local video path or a remote URL.

## Configuration

CLI flags win over config files. If no config path is provided, rundeer reads `.rundeer/config.json` in the current directory. Relative output paths resolve from that same project root.

```json
{
    "style": "Moebius",
    "subject": "a deer-shaped courier in a ruined city",
    "motion": "slow cinematic pan",
    "input": null,
    "output": {
        "dir": ".rundeer/outputs",
        "name": "output"
    },
    "batch": {
        "iterations": 5,
        "concurrency": null,
        "grid": true,
        "grid_options": {
            "rows": "auto",
            "columns": "auto",
            "padding": 10,
            "bg_color": "#000000"
        }
    },
    "references": {
        "ids": [0, 3],
        "pad": true,
        "quality": 85
    },
    "image": {
        "model": "your-image-model",
        "aspect_ratio": "1:1",
        "resolution": "1k"
    },
    "video": {
        "model": "your-video-model",
        "aspect_ratio": "16:9",
        "duration": 6,
        "resolution": "720p",
        "concurrency": 1
    }
}
```

rundeer loads environment values only from the project-root `.env` file. It does not read parent `.env` files, or `.rundeer/.env`. Use `VISION_API_KEY` for image and video generation, `MODEL_API_KEY` for definition scripts that call language models, and `BASE_URL` as the shared API endpoint.

## Styles And References

A style brain is a folder under `brain/` with a Markdown prompt named after the style. The prompt can use `[subject]` and `[motion]` placeholders, while reference images live in `Reference/` and are selected by numeric prefix.

## Advanced Workflows

### Dynamic Definitions

Config files can map `@name` tokens to local Python functions. rundeer resolves those tokens just before each job executes, so definitions can introduce per-job variation or call external services.

```json
{
    "subject": "a symbolic artifact called @random_symbol, expanded with @fractal:prompt:3",
    "definitions": {
        "random_symbol": ".rundeer/def/random_symbol.py",
        "fractal": ".rundeer/def/fractal.py"
    }
}
```

Definition functions read secrets from the environment after the local `.env` file is loaded, so project secrets stay beside the config that uses them.

### Chained Edits

Set `batch.chain` to `true` to feed each edit result into the next iteration. For image edits, `batch.chain_compose` can preserve untouched pixels with mask-based compositing, reducing drift during long edit chains.

### Batch Files

`rundeer batch` reads `.rundeer/batch.json` or `--batch-file=<path>` and runs each listed config in order. Entries may be strings or objects with `config` and `command` fields.

```json
{
    "sleep": 60,
    "batch": [
        { "command": "image", "config": "runs/lookdev_01.json" },
        { "command": "video", "config": "runs/shot_01.json" }
    ]
}
```

## Benchmark

> [!WARNING] 
> WIP

## Requirements

- Python 3.10 or newer.
- A provider API key in the local `.env` file for real generation calls.
- `ffmpeg` for video grids. Individual video outputs still download without it.
- Python dependencies from `requirements.txt`: `docopt`, `Pillow`, `requests`, `numpy`, `scikit-image`, and the provider SDK.

## Testing

```bash
python3 -m pytest
```

The live smoke test is opt-in because it calls the real API. Set credentials in `.env`, then:

```bash
RUNDEER_LIVE=1 python3 -m pytest -m live tests/test_live_smoke.py
```

## Contributing

Keep changes small, testable, and aligned with the CLI-first workflow. For feature work, add focused tests under `tests/` and verify the relevant command with `--dry-run` before calling the live API.
