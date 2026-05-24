# Rundeer — Production Readiness Improvements

## 1. Add `pyproject.toml` for proper Python packaging

**Area:** Project infrastructure / packaging

The project currently relies on a bare `requirements.txt` and direct `python3 rundeer.py` invocation. There is no `pyproject.toml` (or `setup.py`/`setup.cfg`), which means the package cannot be installed via `pip install .`, has no declared version, exposes no console entry point, and cannot be published to a registry. This blocks standard deployment patterns — containerized installs use `pip install .` to get a reproducible, isolated environment with pinned transitive deps, and CI pipelines need a version to tag artifacts against.

Adding a `pyproject.toml` with a `[project.scripts]` entry (`rundeer = "src.rundeer.cli.commands:main"`) would let users run `rundeer image ...` directly after install, enable `pip install -e .` for development, declare the version in one canonical place, and unlock `pip freeze` / lockfile workflows for reproducible builds.

## 2. Introduce structured logging across the Python backend

**Area:** Observability / debugging / operational reliability

The entire `src/rundeer/` package has zero `import logging` statements. Core modules that handle API calls (`api.py`), rate limiting (`rate_limit.py`), batch execution (`batch.py`), config loading (`config.py`), media processing (`media.py`), and bootstrap (`bootstrap.py`) all operate silently — errors are either swallowed, raised, or printed to stdout with no severity, timestamp, or context. The web backend is the same outside a single logger in `ws_server.py`.

For a tool that sends paid API requests in batch and writes outputs to disk, this makes post-mortem debugging nearly impossible. A failed 50-image batch run leaves no trace of which calls succeeded, which hit rate limits, or where the failure actually occurred. Adding Python's stdlib `logging` module with a shared logger per module, a configurable log level (via `config.json` or `--verbose`), and file output to `.rundeer/data/logs/` would give users a reliable audit trail for every run without changing any external behavior.

## 3. Add a GitHub Actions CI pipeline

**Area:** CI/CD / quality gates

There is no `.github/workflows/` directory — the project has zero automated checks on push or PR. Meanwhile, `AGENTS.md` already documents four concrete validation commands (Python compile-all, CLI `--help` smoke test, dry-run generation, JS syntax check) and the repo includes a `pytest.ini`, but none of this runs automatically. Any contributor can push broken syntax, failing imports, or regressions with no gate to catch it.

A minimal `ci.yml` workflow running on push/PR that executes `python3 -m compileall -q src web rundeer.py`, `python3 rundeer.py --help`, `python3 rundeer.py web --help`, and `node --check` on all JS files would catch the most common breakages at near-zero cost. It can be extended later with pytest, ruff linting, and dry-run generation tests as the suite grows.

## 4. Add preflight validation before batch execution

**Area:** Reliability / user experience / cost protection

`GrokClient.__init__()` reads `VISION_API_KEY` via `os.environ.get()` and silently proceeds if it's `None` — the first real API call then fails with an opaque SDK auth error. The `BatchRunner.run()` submits all jobs to a `ThreadPoolExecutor` immediately, so a systemic problem (missing key, unwritable output directory, unreachable API host) causes every job to fail independently, each burning through its retry+backoff cycle before reporting the same root cause N times.

A preflight step before `BatchRunner.run()` would: (1) assert `VISION_API_KEY` is set and non-empty, (2) verify the output directory exists and is writable, (3) optionally fire a single lightweight API probe (e.g. a 1-image dry call or auth check) to confirm credentials are valid. Failing fast with a clear message before the first job is submitted saves users both time and API credits on large batches.

## 5. Add JSON Schema validation for `.rundeer/config.json`

**Area:** Configuration reliability / developer experience

The project config at `.rundeer/config.json` is loaded via `json.loads()` and then passed through `normalize_config()`, which fills defaults and transforms values — but never validates structure. Unknown keys are silently ignored, wrong types (e.g. `"duration": "ten"`) pass through until they hit a downstream `int()` cast or API rejection, and a typo like `aspet_ratio` instead of `aspect_ratio` simply means the setting never takes effect with no feedback whatsoever.

Adding a `.rundeer/config.schema.json` and a lightweight validation step (via `jsonschema` or a manual check in `normalize_config()`) would: catch misconfigurations at load time with a clear error message, enable IDE autocompletion and inline validation for anyone editing config with VS Code or similar, and serve as living documentation of all supported config keys and their types. The `$schema` pointer in `config.json` itself would make the validation zero-friction for editors.

## 6. Handle graceful interruption (Ctrl+C) during batch runs

**Area:** Reliability / user experience / data preservation

The CLI entrypoint (`commands.py`) and `BatchRunner` have zero handling for `KeyboardInterrupt` or OS signals. When a user presses Ctrl+C during a long batch run, the `ThreadPoolExecutor` is interrupted mid-flight with undefined cleanup — in-progress downloads may leave partial files, completed jobs have no summary, and there's no record of which jobs finished vs. which were abandoned. The `BatchRunner.cancel()` method and `is_cancelled()` check exist but are never wired to a signal handler from the CLI.

Registering a `signal.SIGINT` handler (or wrapping the run in a `try/except KeyboardInterrupt`) that calls `runner.cancel()`, waits briefly for in-flight jobs to finish, and then prints a summary of completed vs. cancelled jobs would make interruption safe and predictable. Users running a 50-image batch who realize they need to adjust a prompt can Ctrl+C without guessing which outputs are valid and which are truncated.

## 7. Persist CLI run history to `.rundeer/data/runs/`

**Area:** Operational visibility / run reproducibility

The CLI `_execute()` function (in `commands.py`) runs a batch, displays a live summary via the TUI reporter, and exits. All per-job metadata — prompts, parameters, success/failure, timing, output paths, error messages — lives transiently in the `Job` dataclass during execution and is then discarded. The web side already has `write_run_record()` / `load_run_records()` for persisting run history, but the CLI writes nothing.

After a batch completes, there's no way to answer "what prompt did I use for that run last Tuesday" or "which jobs failed and why" without re-running the batch. Writing a JSON manifest per CLI run to `.rundeer/data/runs/` (reusing the path conventions from `paths.py`) with the command, resolved config, per-job status, timestamps, and output paths would enable post-mortem analysis, run comparison, and lay the groundwork for batch resume on failure.

## 8. Add cache management — reporting, size limits, and cleanup

**Area:** Operational hygiene / disk space management

The caching layer (reference image encoding in `media.py`, UV ops in `uv_ops.py`, filter-prompt thumbnails in `server.py`) writes content-addressed files to `.rundeer/data/cache/` with no size tracking, no eviction policy, no TTL, and no cleanup command. A moderately active project already has 700 MB+ in this directory, and the number only grows — every reference encoding, media crop/resize, and UV operation writes a permanent cached file that is never deleted.

There is no `rundeer cache` subcommand (or equivalent) to report total cache size, list stale entries, or prune old files. Adding a `rundeer cache stats` command that reports total size and file count, a `rundeer cache clear` command that removes all or aged entries, and an optional `max_cache_mb` setting in `config.json` that triggers LRU eviction when exceeded would prevent unbounded disk growth and give users control over a directory they currently don't even know exists.

## 9. Create a foundational test suite for core modules

**Area:** Testing / regression safety / confidence in changes

The project has a `pytest.ini` configured with `testpaths = tests` and a `live` marker for API-hitting tests — but the `tests/` directory does not exist. There are zero test files anywhere in the repository. Core logic like `normalize_config()`, `fill_prompt()`, `resolve_subject()`, `parse_references()`, `_parse_env_line()`, rate limiter window evaluation, and batch job state transitions is all untested. These are pure functions with well-defined inputs/outputs that are trivial to test offline without any API keys.

Creating a `tests/` directory with even a small initial suite — `test_config.py` covering `normalize_config()` and `normalize_rate_limits()`, `test_prompt.py` covering `fill_prompt()` and `resolve_subject()`, and `test_rate_limit.py` covering `RateLimiter._evaluate()` with a fake clock — would catch regressions in the most-changed logic and establish a pattern for adding tests alongside future changes. The `pytest.ini` and `live` marker are already wired; the only missing piece is actual test code.

## 10. Add a Dockerfile for reproducible containerized deployment

**Area:** Deployment / infrastructure / onboarding

The project has no `Dockerfile`, `docker-compose.yml`, or any container configuration. Rundeer requires a dual-runtime environment — Python 3.x with native dependencies (`Pillow`, `numpy`, `scikit-image`) plus Node.js for `repomix` and JS syntax checks — which makes manual environment setup error-prone across different OS/distro combinations. There's currently no documented path from "clone the repo" to "running instance" beyond `pip install -r requirements.txt` and hoping the right system libraries for Pillow/numpy are present.

A multi-stage `Dockerfile` (build stage installing Python deps and Node.js, slim runtime stage copying artifacts) would give users a single `docker build && docker run` path to a working Rundeer instance, make CI reproducible by running tests inside the same container, and provide the base for deployment to any container platform. A `docker-compose.yml` mapping a local project directory into the container as a volume would let users keep `.rundeer/` state across restarts.

## 11. Add a `rundeer doctor` command for environment health checks

**Area:** Onboarding / troubleshooting / developer experience

When a dependency is missing — `ffmpeg` not on PATH, `VISION_API_KEY` unset, `.rundeer/` not bootstrapped, `Pillow` import failing due to missing system libraries — the user discovers it only when a specific workflow hits the missing piece, often deep into a batch run. `ffmpeg` availability is checked inline in `server.py` and `media.py` with `shutil.which("ffmpeg")`, but only at the moment of use. Other dependencies like `scikit-image` (used in `diff_compose.py`, `benchmark.py`, `uv_ops.py`) and `numpy` are never checked proactively.

A `rundeer doctor` subcommand that runs a checklist — Python version, required package imports (`Pillow`, `numpy`, `skimage`, `requests`), `ffmpeg`/`ffprobe` on PATH, `.env` file present with `VISION_API_KEY` set, `.rundeer/` bootstrapped with valid `config.json`, write permissions on output and cache directories — and prints a pass/fail summary would eliminate the most common "why isn't this working" support questions and give new users confidence their environment is correctly set up before their first run.

## 12. Abstract the image/video generation provider behind an interface

**Area:** Architecture / extensibility / long-term viability

`GrokClient` in `api.py` is a concrete class that directly imports `from xai_sdk import Client` and is referenced 27 times across every workflow module (`image_gen.py`, `video_gen.py`, `edit.py`, `merge.py`, `extend.py`, `benchmark.py`), the CLI (`commands.py`), and `_common.py`. There is no base class, no protocol, no factory function — every workflow directly type-hints `GrokClient` and calls its `.generate_image()` or `.generate_video()` methods.

This means supporting a second generation provider (Stable Diffusion API, DALL-E, Flux, or a local ComfyUI backend) would require touching every workflow file. Extracting a `GenerationProvider` protocol (or ABC) with `generate_image()` and `generate_video()` methods, having `GrokClient` implement it, and routing construction through a factory that reads the provider name from `config.json` would decouple workflows from the SDK entirely. New providers become a single new class plus a config entry, with zero workflow changes.

## 13. Recover orphaned runs on web server restart

**Area:** Reliability / data integrity / web workbench robustness

The web server spawns a daemon thread per run (`start_run()` in `server.py`) that writes its status to `.rundeer/data/runs/`. If the server process is killed or restarted while runs are in progress, those on-disk records retain `"status": "running"` permanently — the backing subprocess is gone but nothing marks the run as interrupted. `list_runs()` loads these stale records from disk and presents them as active in the UI, where they sit indefinitely: they can't complete (no process), can't be meaningfully cancelled (no PID to signal), and can't be re-triggered.

Adding a recovery sweep at server startup that scans all persisted run records, detects any with `"status"` still `"running"` or `"queued"`, and transitions them to `"interrupted"` (or `"failed"` with a message like `"server restarted during execution"`) would prevent ghost runs from accumulating in the run dock and give users a clear signal that those runs need to be re-launched.

## 14. Protect previous outputs from silent overwrite on re-run

**Area:** Data safety / creative workflow integrity

Output file paths are fully deterministic — `{output_name}_{01}.png`, `{output_name}_{02}.png`, etc. — built from the config's `output` name and a zero-padded iteration index. Both `download_and_save_image()` and `download_url()` in `media.py` write directly to the destination path with no existence check, no backup, and no rename. Re-running the same config (or even the same command twice) silently overwrites every output from the previous run, with no recovery possible.

For a creative tool where comparing multiple runs of the same prompt is a core workflow, this is a quiet data loss risk. Adding a timestamp or short run-id segment to the output directory name (e.g. `outputs/moebius_20250712_143022/`) or implementing a `--overwrite` / `--no-overwrite` flag (defaulting to safe, which renames or errors on conflict) would preserve previous work by default while keeping the naming predictable. The dry-run plan already shows output paths, so users would see the disambiguated path before committing.

## 15. Wire up basic authentication for the web server

**Area:** Security / multi-user safety / network deployment

The web server (`web/server.py`) exposes 30+ API endpoints — including `/api/run` (executes CLI commands as subprocesses), `/api/settings` (reads/writes config), `/api/graphs/delete`, `/api/file` (reads arbitrary project files), and `/api/filter-prompt` (sends API keys to external services) — with zero authentication on any route. The `.env.example` already defines `RDZERO_USERNAME`, `RDZERO_PASS`, and `RDZERO_AUTH=false`, suggesting auth was planned, but these variables are referenced by zero Python or JavaScript files — the feature was stubbed in config and never implemented.

While the server defaults to `127.0.0.1` (localhost only), users can pass `--host 0.0.0.0` to expose it on the network, at which point the entire API surface is accessible to anyone on the LAN with no credentials. Implementing the auth that `.env.example` already sketches — reading `RDZERO_AUTH`, and when enabled, requiring HTTP Basic Auth (or a session token) validated against `RDZERO_USERNAME`/`RDZERO_PASS` before serving any non-static route — would close the gap between the existing config contract and the actual server behavior.

## 16. Embed generation metadata into output image files

**Area:** Creative workflow / asset management / provenance tracking

`download_and_save_image()` in `media.py` downloads the API response, opens it with Pillow, and re-saves as PNG — but writes zero metadata. The output file carries no record of what prompt, model, aspect ratio, style brain, reference images, iteration index, or timestamp produced it. Once an image leaves the output directory (shared, renamed, moved to a collection), its provenance is permanently lost.

For a creative tool where comparing generations and iterating on prompts is the core loop, this is a significant gap. Tools like ComfyUI and AUTOMATIC1111 set the standard by embedding full generation parameters in PNG text chunks (`tEXt` / `iTXt`), making every output self-documenting. Adding a `PngInfo` metadata block with `prompt`, `model`, `style`, `aspect_ratio`, `references`, and `rundeer_version` to the `img.save()` call — Pillow supports this natively via `PIL.PngImagePlugin.PngInfo` — would make every generated image carry its own recipe, queryable by any tool that reads PNG metadata (including file managers, Lightroom, and `exiftool`).

## 17. Enforce a server-side limit on concurrent generation runs

**Area:** Resource safety / operational stability / API cost control

The web server's `start_run()` function spawns a new `threading.Thread` + `subprocess.Popen` for every `/api/run` POST request with zero concurrency control. There is a `_THUMB_SEM` semaphore protecting thumbnail generation from parallelism exhaustion, but no equivalent gate for actual generation runs. If the user triggers multiple graph executions simultaneously — or a graph with several command nodes fires runs in rapid succession — each run launches an independent subprocess that makes its own API calls, downloads results, and writes to disk concurrently. The per-run rate limiter only governs calls within a single `BatchRunner`, so N concurrent runs bypass the intended rate limits by a factor of N, potentially blowing through API quotas, saturating download bandwidth, and thrashing disk I/O on the output directory.

Adding a configurable `max_concurrent_runs` setting (via `config.json` or a web settings field, defaulting to a conservative value like 3) backed by a `threading.Semaphore` on the server would queue excess runs instead of launching them all at once. The run record already tracks `"status": "queued"` — the only missing piece is a gate between "queued" and "actually spawning the subprocess" that respects a concurrency ceiling. This would prevent accidental resource exhaustion, make rate limit behavior predictable across multiple runs, and protect API spend on busy workbench sessions.

## 18. Add a `--json` output mode to CLI commands for machine-readable results

**Area:** Automation / CI integration / scripting / ecosystem interop

All CLI command output is exclusively human-formatted — either the curses TUI (`_BatchReporter`) or plain-text lines (`PlainReporter`). The `_print_plan()` function prints the dry-run plan as formatted text to stdout, and the summary prints `done`/`failed` counts with raw paths. There is no structured output option. A script or CI step calling `rundeer image ...` has to parse unstructured terminal text to extract output paths, error messages, or success/failure status — a fragile approach that breaks whenever formatting changes.

Meanwhile, the web server's `/api/plan` and `/api/run` endpoints already return structured JSON with `id`, `status`, `command`, `output`, `startedAt`, `endedAt`, and `returncode` fields. The data model for machine-readable output exists — it's just not exposed on the CLI path. Adding a `--json` flag (across `image`, `video`, `edit`, `extend`, `merge`, `batch`) that writes a single JSON object to stdout containing the resolved plan, per-job status, output paths, timings, and errors would make Rundeer composable with shell pipelines, CI/CD artifact collection, monitoring tools, and any wrapper script that needs to know what happened without screen-scraping.