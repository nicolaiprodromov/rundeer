# Rundeer Project Rules

You are working on the Rundeer project repository.

## What Rundeer Is
Rundeer is a CLI-backed visual workbench for batch-first AI image and video generation. It turns creative directions into repeatable runs, keeps style brains and references organized, supports dry-runs before spending API credits, and exposes the same command engine through CLI commands and a browser node workbench.

Primary user workflows are image generation, video generation, image/video edit, merge, extend, batch execution.

## Current Structure
- Root entrypoints: `rundeer.py`, `__init__.py`, `__main__.py`.
- Non-web Python package code lives under `src/rundeer/`.
- CLI code lives under `src/rundeer/cli/`.
- Core code lives under `src/rundeer/core/`.
- Workflows live under `src/rundeer/workflows/`.
- Style brains live under `src/rundeer/brain/`.
- The web app lives under `web/`.
- Web static files live under `web/static/`.
- Web agent code lives under `web/agent/`.
- Project template/config files live under `.rundeer/`: `config.json`, `batch.json`, `benchmark.json`.
- Runtime data lives under `.rundeer/data/`: `agent/`, `benchmark/`, `cache/`, `graphs/`, `logs/`, `outputs/`, and `runs/`.
- Bootstrap and migration behavior lives in `src/rundeer/core/bootstrap.py`.
- Shared path conventions live in `src/rundeer/core/paths.py`.
- Repomix whole-project context is configured in `repomix.config.json` and writes `.repomix/rundeer-context.xml`.

## Hard Rules
- **NEVER stage/add, commit or push**. *Git operations are off the table, only read operations are allowed.*
- At the start of every Rundeer task, before searching, reading, editing, or planning, run `npx -y repomix@latest -c repomix.config.json` from the repository root and use `.repomix/rundeer-context.xml` as the first orientation map.
- Never write code comments.
- Never write docstrings.
- Never add inline explanatory comments in any language.
- Do not preserve a new comment or docstring you created accidentally; remove it before finishing.
- Keep edits consistent with the existing no-comments/no-docstrings cleanup.
- Do not move web app code out of `web/`.
- Do not put non-web CLI/core/workflow code outside `src/rundeer/`.
- Do not write runtime data directly under `.rundeer/`; use `.rundeer/data/` through `src/rundeer/core/paths.py`.
- Do not restore deleted tests or unrelated user changes unless explicitly asked.
- DO NOT SAY YOU FINISHED WITHOUT TRIPLE CHECKING THAT YOU HAVE ACCOMPLISHED EVERY REQUIREMENT OF THE TASK.

## Workflow

1. Run `npx -y repomix@latest -c repomix.config.json` from the repository root.
2. Use `.repomix/rundeer-context.xml` for the initial whole-project map. Use the output of repomix to understand the project and task.
3. Dive deep into the section/s the user is talking about.
4. Reason about the task.
5. Make a clear ordered TODO plan with the exact steps to resolve.
6. **Execute code changes or complete the task**. Whenever possible, delegate parallel tasks to subagents to read sections or to implement parts of the task.
7. Test your implementation with smoke tests and actual testing. When working on the frontend you must use playwright and actually make sure the app is still functional and that what was implemented works. Be careful to never work in an existing graph when trying things with nodes, make a new graph and delete it after or keep it if it's useful for the user to see something you made.
8. Final response to user must include all touched files and explanation of the reasoning behind the task.
9. Throughout the task you should update the user on your reasoning and understanding of the task and what you are currently doing.

## Working Style
1. Read the current files before editing, especially if the worktree is dirty.
2. Use existing helpers and conventions.
3. Use `src/rundeer/core/paths.py` for `.rundeer` paths.
4. Use `src/rundeer/core/bootstrap.py` for bootstrap and migration behavior.

## Useful Validation
- Python syntax: `python3 -m compileall -q src web rundeer.py __init__.py`.
- CLI smoke test: `python3 rundeer.py --help`.
- Dry-run generation smoke test: `python3 rundeer.py image --dry-run --no-tui --iterations=1`.
- Web command smoke test: `python3 rundeer.py web --help`.
- JavaScript syntax when web static code changes: `rg --files -g '*.js' -g '*.mjs' | xargs -r -n 1 node --check`.

## Frontend Design Context
For UI work, use `impeccable.md` as the onboarding map and consult `.grok/skills/impeccable/SKILL.md` when the task is frontend design, UX, visual polish, responsive behavior, or interaction quality.

Treat Rundeer as a product UI and operational media workflow tool, not a landing page. Keep the web app dense, dark, precise, graph-native, and built for repeated action. Respect `PRODUCT.md` and `DESIGN.md` for product register, audience, visual tokens, typography, colors, and interaction principles.