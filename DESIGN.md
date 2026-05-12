---
name: "rundeer"
description: "A batch-first studio instrument for AI image and video generation."
colors:
  bg: "oklch(13.5% 0.006 80)"
  bg-deep: "oklch(10% 0.005 80)"
  surface: "oklch(16% 0.007 80)"
  surface-2: "oklch(19% 0.008 80)"
  surface-3: "oklch(23% 0.009 80)"
  line: "oklch(28% 0.010 80)"
  line-strong: "oklch(38% 0.012 80)"
  text: "oklch(94% 0.005 80)"
  text-soft: "oklch(82% 0.007 80)"
  muted: "oklch(66% 0.008 80)"
  quiet: "oklch(48% 0.008 80)"
  whisper: "oklch(36% 0.008 80)"
  gold: "oklch(83% 0.130 88)"
  gold-soft: "oklch(72% 0.090 88)"
  gold-deep: "oklch(45% 0.090 80)"
  violet: "oklch(70% 0.135 304)"
  violet-soft: "oklch(58% 0.105 304)"
  category-primitives: "oklch(72% 0.180 235)"
  category-prompt: "oklch(72% 0.210 315)"
  category-commands: "oklch(84% 0.190 82)"
  category-loop: "oklch(76% 0.180 165)"
  category-output: "oklch(74% 0.180 35)"
  socket-text: "oklch(74% 0.180 235)"
  socket-image: "oklch(84% 0.190 82)"
  socket-video: "oklch(72% 0.210 315)"
  socket-number: "oklch(76% 0.180 165)"
  socket-boolean: "oklch(78% 0.190 45)"
  socket-definition: "oklch(76% 0.170 185)"
  socket-filepath: "oklch(80% 0.180 58)"
  socket-any: "oklch(75% 0.035 80)"
  deer-pink: "#ff60ff"
  deer-violet: "#6b50ff"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Sohne, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.95rem"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "0"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 380
    lineHeight: 1.6
    letterSpacing: "0.005em"
  mono:
    fontFamily: "Geist Mono, SF Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.02em"
rounded:
  sm: "2px"
  md: "4px"
spacing:
  space-2: "4px"
  space-3: "8px"
  space-4: "12px"
  space-5: "16px"
  space-6: "24px"
  space-7: "32px"
  space-8: "48px"
  space-9: "64px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.bg-deep}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "34px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "{spacing.space-5}"
  input:
    backgroundColor: "{colors.bg-deep}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
---

# Design System: rundeer

## 1. Overview

**Creative North Star: "The Night Studio Console"**

rundeer is a dark, concentrated node workbench for generating visual media in batches. The design should feel like a local studio instrument: dense enough for repeated use, sharp enough for technical trust, and expressive only where identity or state needs it.

The Nodes view, Explore view, curses TUI, plain terminal output, and legacy `/classic` form are one visual system. The browser surfaces use warm-tinted dark neutrals, thin structural lines, compact controls, and a restrained gold action color. The terminal carries the same identity through monospaced status text and a pink-to-violet deer banner.

The system rejects SaaS gloss, marketing page composition, rounded card sprawl, decorative glass, and generic neon cyberpunk styling. Rundeer should look like a tool a serious visual workflow hacker leaves open beside their editor.

**Key Characteristics:**
- Dense, operational panels with clear state and minimal ceremony.
- Graph-first workflows with sockets, bundles, loops, previews, and run logs as core affordances.
- Warm dark neutrals, gold primary action, violet as rare execution energy.
- Compact typography with a distinctive wordmark and monospaced status language.
- Sharp radii, thin borders, and tonal layering instead of soft card shadows.

## 2. Colors

The palette is a restrained product palette: warm near-black surfaces, quiet ochre-gold action, and a pink-to-violet identity gradient reserved for the deer logo and terminal banner.

### Primary
- **Cadmium Gold** (`oklch(83% 0.130 88)`): primary run actions, focused selection, and high-confidence positive states.
- **Soft Gold** (`oklch(72% 0.090 88)`): links, secondary emphasis, hover states, and lightweight affordance hints.
- **Deep Gold** (`oklch(45% 0.090 80)`): text selection, pressed states, and low-light emphasis backgrounds.

### Secondary
- **Execution Violet** (`oklch(70% 0.135 304)`): active node execution, rare highlights, and cross-media energy states.
- **Soft Violet** (`oklch(58% 0.105 304)`): muted active glow and secondary execution feedback.

### Tertiary
- **Deer Pink** (`#ff60ff`): start of the CLI/TUI/web deer identity gradient.
- **Deer Violet** (`#6b50ff`): end of the deer identity gradient and the strongest brand color. Keep it off routine controls.

### Node Category Accents
- **Primitive Blue** (`oklch(72% 0.180 235)`): Primitive category headers, palette sections, and node dots.
- **Prompt Violet** (`oklch(72% 0.210 315)`): Prompt category headers, palette sections, and node dots.
- **Command Gold** (`oklch(84% 0.190 82)`): Command category headers, palette sections, and node dots.
- **Loop Green** (`oklch(76% 0.180 165)`): Loop category headers, palette sections, and node dots.
- **Output Coral** (`oklch(74% 0.180 35)`): Output category headers, palette sections, and node dots.

These accents are intentionally more vivid than the routine product palette. Use them as category identity in the node editor: node headers, left palette category rows, Shift+A menu sections, and category dots should all share the same accent value. Do not substitute socket-type colors for category identity.

### Socket Type Accents
- **Text Blue** (`oklch(74% 0.180 235)`)
- **Image Gold** (`oklch(84% 0.190 82)`)
- **Video Violet** (`oklch(72% 0.210 315)`)
- **Number Green** (`oklch(76% 0.180 165)`)
- **Boolean Amber** (`oklch(78% 0.190 45)`)
- **Definition Cyan** (`oklch(76% 0.170 185)`)
- **File Path Orange** (`oklch(80% 0.180 58)`)
- **Any Neutral** (`oklch(75% 0.035 80)`)

Socket accents should be saturated enough to read quickly on the graph canvas. They encode data type, not category. Bundle sockets use stronger versions of their media color.

### Neutral
- **Studio Black** (`oklch(10% 0.005 80)`): deepest browser and terminal surface.
- **Warm Console** (`oklch(13.5% 0.006 80)`): main app background.
- **Panel Charcoal** (`oklch(16% 0.007 80)`): default panel fill.
- **Raised Panel** (`oklch(19% 0.008 80)`): controls, selected surfaces, and node bodies.
- **Working Metal** (`oklch(23% 0.009 80)`): stronger panel headers and active internal surfaces.
- **Quiet Line** (`oklch(28% 0.010 80)`): default separators and control borders.
- **Strong Line** (`oklch(38% 0.012 80)`): focusable panel divisions and stronger outlines.
- **Paper Text** (`oklch(94% 0.005 80)`): primary text.
- **Soft Text** (`oklch(82% 0.007 80)`): secondary text and input values.
- **Muted Text** (`oklch(66% 0.008 80)`): metadata and inactive labels.
- **Quiet Text** (`oklch(48% 0.008 80)`): placeholders and low-priority state.
- **Whisper Text** (`oklch(36% 0.008 80)`): dividers, micro-labels, and disabled affordances.

### Named Rules

**The Deer Gradient Rule.** Use the pink-to-violet gradient for the deer identity only. Do not apply it to text headlines, buttons, cards, or backgrounds.

In browser UI, prefer colored ASCII characters, a rendered image asset, or a purpose-built logo treatment for the deer identity rather than gradient-filled ordinary text.

**The Gold Is a Tool Rule.** Gold marks actions, links, focus, or success. It is not decoration.

## 3. Typography

**Display Font:** Bricolage Grotesque, with Sohne and system sans fallbacks.
**Body Font:** Hanken Grotesk, with system sans fallbacks.
**Label/Mono Font:** Geist Mono, with SF Mono, JetBrains Mono, and ui-monospace fallbacks.

**Character:** The pairing is compact and workmanlike, with a slightly irregular display voice for the wordmark and a calm body face for dense controls. Geist Mono gives status, paths, keyboard hints, and terminal-like details their own texture.

### Hierarchy
- **Display** (700, `1.95rem`, `0.92`): wordmark and rare top-level identity moments.
- **Headline** (600 to 700, `18px` to `24px`, `1.05`): panel titles, selected node names, and compact page-level headings.
- **Title** (600, `14px` to `16px`, `1.25`): section titles, toolbar groups, and fieldset legends.
- **Body** (380 to 500, `14px`, `1.6`): form labels, explanatory rows, file previews, and panel content.
- **Label** (500 to 600, `10px` to `12px`, `0.12em` to `0.18em` uppercase): stat labels, rail labels, palette headings, and compact metadata.
- **Mono Status** (400 to 600, `11px` to `12px`, `1.35`): paths, command output, keyboard hints, run ids, and log timestamps.

### Named Rules

**The Compact Product Type Rule.** Do not use hero-scale typography or viewport-scaled type inside the app shell. Rundeer is a tool surface, so headings stay tight and proportional to panels.

**The Path Readability Rule.** File paths, run ids, command fragments, and log tails use the mono stack with truncation, not decorative wrapping.

## 4. Elevation

rundeer uses tonal layering first and shadows second. Most depth comes from dark surface steps, thin borders, sticky headers, grid backgrounds, and active-state outlines. Shadows are reserved for floating nodes, overlays, and selected graph elements that must separate from the canvas.

### Shadow Vocabulary
- **Node Rest** (`0 10px 26px oklch(0% 0 0 / 0.22)`): default floating node cards on the graph canvas.
- **Node Selected** (`0 0 0 1px color-mix(in oklch, var(--gold) 40%, transparent), 0 4px 24px color-mix(in oklch, var(--gold) 14%, transparent)`): selected graph nodes and focus-visible spatial objects.
- **Execution Glow** (`0 0 12px color-mix(in oklch, var(--violet) 25%, transparent)`): active node execution only.

### Named Rules

**The Flat Until Floating Rule.** Panels, fields, rails, and docks stay flat. Shadows appear when an element floats over the canvas or needs drag-and-drop separation.

## 5. Components

### Buttons
- **Shape:** sharp product rectangles with a `2px` radius.
- **Primary:** gold fill, studio-black text, compact height, and icon-plus-label where the action benefits from a symbol.
- **Hover / Focus:** border or background shift with fast easing. Focus must be visible without relying on color alone.
- **Ghost:** transparent or surface-tinted with muted text, used for secondary commands like reload, settings, save, load, and panel toggles.

### Chips
- **Style:** small mono or label text on dark tonal surfaces with a thin border.
- **State:** active chips use gold text or border, not filled saturated pills.

### Cards / Containers
- **Corner Style:** `2px` to `4px`, never pill-like.
- **Background:** panels use `surface`, `surface-2`, and `surface-3` steps rather than bright fills.
- **Shadow Strategy:** no routine card shadows. Use tonal layering and borders.
- **Border:** `1px` quiet line by default; strong line only for active/focused states.
- **Internal Padding:** compact 4pt rhythm, usually `12px`, `16px`, or `24px` depending on density.

### Inputs / Fields
- **Style:** dark recessed fill, thin border, compact height, and strong mono readability for paths and ids.
- **Focus:** gold border or ring treatment with no layout shift.
- **Error / Disabled:** pair color with clear text and state labels. Disabled fields should reduce contrast but remain legible.

### Navigation
- **Style:** left rails, top tabs, and bottom toolbars are structural, not decorative. Active state uses gold or text contrast with stable dimensions. View switching between Explore and Nodes keeps the same masthead vocabulary.

### Explore View

Explore uses a split-pane file browser with a resizable preview area. Keep filtering, expand/collapse, open-in-tab, and copy-path controls compact. Previews should prioritize the artifact or file content over explanatory text.

### Terminal And TUI Banner

The terminal identity is the ASCII deer plus pink-to-violet foreground gradient. When ANSI is unavailable, the plain text fallback must still read cleanly. The curses TUI, plain reporter, Nodes workbench, and run dock should share status names and counts wherever possible.

### Node Graph

Node graph UI uses Blender-style affordances: palette on the left, canvas in the center, properties on the right when available, bottom toolbar, grid-backed workspace, socket wires, selected node glow, and a floating run dock. Keep node dimensions stable so execution states and labels do not shift the graph. Bundle wires, Loop nodes, and Preview collapse are product features, not decorative extras.

Node category color is structural. Headers, category menu rows, Shift+A menu sections, and category dots use the same vivid category accent. Socket colors remain type information and should not replace the category palette.

## 6. Do's and Don'ts

### Do:
- **Do** use the warm OKLCH neutral scale from `styles.css` for browser surfaces.
- **Do** keep primary actions rare and gold, especially `Run`, `Run Graph`, and focused run controls.
- **Do** use the same status vocabulary across CLI, TUI, and web: queued, uploading, submitted, polling, downloading, done, failed, cancelled.
- **Do** expose run outputs, file context, generated configs, graph state, and logs close to the action.
- **Do** use compact panels and predictable controls for repeated workflows.
- **Do** verify responsive behavior by restructuring panels instead of shrinking text with viewport width.

### Don't:
- **Don't** use gradient text. The deer identity can use colored characters or image treatment, ordinary text cannot.
- **Don't** use colored side-stripe borders on cards, alerts, list items, or nodes.
- **Don't** add glassmorphism, bokeh, blobs, ornamental SVGs, or blurred decorative cards.
- **Don't** turn the product into a landing page or tutorial carousel. Onboarding belongs in graph defaults, inline hints, previews, empty states, and first successful dry-runs.
- **Don't** make the CLI and webapp feel like separate products.
- **Don't** overuse violet or the pink-to-violet identity gradient for routine UI chrome.