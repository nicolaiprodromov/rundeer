# Product

## Register

product

## Users

rundeer is for artists, prompt engineers, visual workflow builders, and technically confident creators who generate many AI images or videos before choosing a direction. They are comfortable with a terminal, but the current primary surface is the browser workbench: a node graph for building runs, an Explore view for inspecting files and artifacts, and a run dock for watching graph execution.

The core user is iterating in a project folder, often with credits or rate limits in mind. They want to test a prompt safely, compare a batch, preserve style continuity, and move from still image to video, edit, merge, extend, benchmark, or batch execution without losing the thread.

## Product Purpose

rundeer turns a single creative direction into repeatable media runs. It organizes style brains under `brain/`, resolves references by numeric id, stores outputs and logs under `.rundeer/`, and exposes the same command engine through CLI commands, a curses TUI, the node workbench, and the Explore file previewer.

Success means the user reaches the first useful artifact quickly, understands where every output went, can reproduce the run with config or dry-run output, and can keep iterating without rebuilding the workflow from scratch.

## Brand Personality

Precise, nocturnal, and studio-native. The interface should feel like a working instrument for people who are already in motion: dark, concentrated, tactile, and a little cinematic, but never decorative for its own sake.

The voice is direct and operational. It can have personality in the wordmark, terminal banner, and small status moments, but labels and errors should stay terse, specific, and useful.

## Anti-references

Do not make Rundeer feel like a SaaS landing page, a chat prompt toy, a pastel creator app, or a generic AI dashboard. Avoid oversized marketing hero sections, bubbly card grids, glassmorphism, neon-on-black cyberpunk cliches, purple-blue gradient wash, ornamental illustrations, and empty tutorial ceremony.

Do not separate the CLI and webapp into different brands. The terminal banner, curses TUI, Nodes workbench, and Explore view should feel like the same instrument at different zoom levels.

## Design Principles

1. **Batch-first confidence.** Favor interfaces that make the run plan, count, output path, and risk visible before the user spends credits.
2. **Show the workspace.** Keep styles, references, files, outputs, logs, and graph state close to the primary action instead of hiding them in detached documentation.
3. **Graphs are the studio surface.** Treat command nodes, prompt nodes, loop bundles, preview nodes, and run docks as the main product vocabulary for complex workflows.
4. **One language across terminal and web.** Reuse the same dark warm neutrals, sharp panels, monospaced status language, and pink-to-violet deer identity across CLI, TUI, graph, Explore, and fallback form surfaces.
5. **Power without ceremony.** Advanced controls should be present and scannable, with graph wiring and inline preview doing the teaching instead of onboarding walls.
6. **Artifacts are the memory.** Every run should leave inspectable outputs, logs, and config breadcrumbs so the user can compare, repeat, or extend it later.

## Accessibility & Inclusion

Aim for WCAG AA contrast for text and controls. Do not rely on color alone for job state: pair color with labels, icons, counts, and log text. Preserve keyboard workflows in the Nodes workbench, Explore view, and terminal. Respect reduced motion for animated headers, pulsing nodes, and transitions. Keep terminal fallbacks readable without ANSI color, and support `--no-tui` for automation, CI, and non-interactive shells.