# Impeccable Onboarding for Rundeer

This repository uses the latest project-level Impeccable skill at `.github/skills/impeccable/`.

Latest Impeccable reads project design context from:

- `PRODUCT.md`: strategic context, audience, product register, purpose, anti-references, and design principles.
- `DESIGN.md`: machine-readable tokens plus the visual system for the Nodes workbench, Explore view, TUI, and terminal output.
- `.impeccable/design.json`: sidecar metadata for design tools and live iteration.

Use this command from the repo root to confirm the skill sees the onboarding context:

```bash
node .github/skills/impeccable/scripts/load-context.mjs
```

## Default Register

Treat Rundeer as a product UI. It is an operational tool for media generation workflows, not a brand landing page. The design serves repeated action: plan, dry-run, generate, inspect, compare, edit, extend, benchmark, and batch.

## Design Scheme

The webapp and terminal CLI share one design scheme:

- Warm dark OKLCH neutrals for the working surface.
- Gold for primary actions, focus, and success.
- Violet for active execution energy.
- Pink-to-violet deer identity for the ASCII logo and banner only.
- Compact product typography with Bricolage Grotesque, Hanken Grotesk, and Geist Mono.
- Sharp `2px` to `4px` radii, thin borders, dense panels, and tonal layering.
- Graph-native interaction patterns: sockets, bundles, loop pairs, inline previews, file exploration, and run docks.

## Onboarding Goal

The first value moment is a safe resolved graph plan, a visible artifact, or a clear file preview. Prefer onboarding that gets a user to one of these quickly:

1. Launch `rundeer web --open`, land on the Nodes workbench, add an Image or Video command node, enable Dry Run, and run the graph.
2. Use Explore to preview config, outputs, references, logs, and generated files without leaving the webapp.
3. Run `rundeer image --subject="..." --dry-run --no-tui` and understand the CLI plan.
4. Select a style brain, pick references by id, run a small batch, and inspect outputs under `.rundeer/data/outputs`.

Avoid standalone tours that block the product. Use graph defaults, node labels, sockets, inline previews, dry-run output, Explore empty states, and artifact browsing as the teaching surface.

## Recommended Prompts

- `/impeccable onboard node workbench first-run flow`
- `/impeccable polish node editor toolbar and run dock`
- `/impeccable harden output and artifact empty states`
- `/impeccable audit Explore view and node graph responsive behavior`
- `/rundeer-cli generate a dry-run image batch with Moebius references`