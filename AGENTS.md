# RUNDEER PROJECT RULES

You are a coding agent working on the Rundeer project.

## What Rundeer is

Rundeer is in `alpha pre-launch phase`. *Only you and the user have access to this codebase at the moment.*

Rundeer is a CLI-backed, node-based, visual programming workbench for *AI-enhanced image and video generation/creation/editing*. The main goal of rundeer is to support professional artists in the development of high quality audio-visual content with granular control & high throughput 

Rundeer allows for complex & emergent procedural workflows by giving the user the ability to generate/manipulate/mix/edit images and videos, create highly customized agents, and combine everything in node graphs that

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
- DO NOT CODE FALLBACKS OR PRESERVE ANY OLD FUNCTIONALITY. When the user requests features, because we are in a pre-release phase, there is no need to preserve old functionality, legacy code or to create fallbacks and live migrations. Old graphs in `.rundeer/data/graphs/` and other data, logs, configs or whatever that might break after code changes must be adapted or the user must be warned directly about this. REPEAT: DO NOT CODE FALLBACKS OR LIVE MIGRATIONS, DO NOT PRESERVE ANY OLD FUNCTIONALITY AND NO LEGACY CODE PRESERVATION.
- IF you come to the conclusion you must test something in the rundeer webapp frontend, you must CLOSE the server when you are done, do not leave dangling processes that the user might forget to close.

## Workflow

1. Run `npx -y repomix@latest -c repomix.config.json` from the repository root.
2. Use `.repomix/rundeer-context.xml` for the initial whole-project map. Use the output of repomix to understand the project and task.
3. Dive deep into the section/s the user is talking about in the repomix output file that contains the entire codebaset, so you can manage context while reasoning. only read from actual files when doing actual coding. VERY IMPORTANT to read from the repomix file output in .repomix/rundeer while planning and reasoning and figuring out what to do not from the actual codebase!!!
4. Reason about the task.
5. Make a clear ordered TODO plan with the exact steps to resolve.
6. **Execute code changes or complete the task**. Whenever possible, delegate parallel tasks to subagents to read sections or to implement parts of the task.
7. ~~Test your implementation with smoke tests and actual testing. When working on the frontend you must use playwright and actually make sure the app is still functional and that what was implemented works. Be careful to never work in an existing graph when trying things with nodes, make a new graph and delete it after or keep it if it's useful for the user to see something you made.~~ - THIS STEP SHOULD BE DONE ONLY IF THE USER ASKS DIRECTLY FOR TESTING, IF THE USER DOES NOT MENTION TESTING DIRECTLY SKIP THIS PART
8. Final response to user must include all touched files and explanation of the reasoning behind the task.
9. Throughout the task you should update the user on your reasoning and understanding of the task and what you are currently doing.

## Working Style
1. ALWAYS read the current codebase repomix context first when thinking, then ALWAYS read the actual files before editing.
2. Use `src/rundeer/core/paths.py` for `.rundeer` paths.
3. DO NOT CODE FALLBACKS AND HALF-BAKED PATCHES. The user is an experienced coder and only needs the implementation to be done, if any fallbacks or safety for production ready code is needed to keep the app alive you will be told before, there is no need to code extra fallbacks to "not break the app", focus on building good, not on maintaining old conventions and structures.
4. For UI work, use `impeccable.md` as the onboarding map and consult `.grok/skills/impeccable/SKILL.md` when the task is frontend design, UX, visual polish, responsive behavior, or interaction quality. Respect `PRODUCT.md` and `DESIGN.md` for product register, audience, visual tokens, typography, colors, and interaction principles.
5. DO NOT CODE FALLBACKS OR PRESERVE ANY OLD FUNCTIONALITY. When the user requests features, because we are in a pre-release phase, there is no need to preserve old functionality, legacy code or to create fallbacks and live migrations. Old graphs in `.rundeer/data/graphs/` and other data, logs, configs or whatever that might break after code changes must be adapted or the user must be warned directly about this. REPEAT: DO NOT CODE FALLBACKS OR LIVE MIGRATIONS, DO NOT PRESERVE ANY OLD FUNCTIONALITY AND NO LEGACY CODE PRESERVATION.
6. VERY IMPORTANT: When a new feature or functionality is requested by the user, you must isolate this code and make it modular enough to be easily integrated in different parts of the code in the future.
7. Use small names for variables and functions, the idea is to reduce human readability, while maintaining agent readbility, in order to keep token level as low as possible, while still retaining good semantics for you to be able to code correctly.
8. Use the repomix as a way to manage session token usage and get the best performance and best code.

## Useful Validation
- Python syntax: `python3 -m compileall -q src web rundeer.py __init__.py`.
- CLI smoke test: `python3 rundeer.py --help`.
- Dry-run generation smoke test: `python3 rundeer.py image --dry-run --no-tui --iterations=1`.
- Web command smoke test: `python3 rundeer.py web --help`.
- JavaScript syntax when web static code changes: `rg --files -g '*.js' -g '*.mjs' | xargs -r -n 1 node --check`.

### Most Important Reminders:
1. CODE IN AN ISOLATED AND MODULAR MANNER - most functionality might be reused or bootstrapped via config files, separation of concerns is a must!
2. DO NOT CODE FALLBACKS OR PRESERVE ANY OLD FUNCTIONALITY - we are in alpha, pre-release phase and we do not wish to preserve any legacy functionality that will inflate the codebase needlesly, if a breaking change is required go all in, the user will usually request atomic tasks that present small chance of breaking the app fully.
3. TOKEN MANAGEMENT. SMALL AND GOOD CODE.
