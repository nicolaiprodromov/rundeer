# Blender Shader Node Editor — Complete UI & Interaction Guide

This document explains the visual design, interaction model, and keyboard/mouse shortcuts of Blender's Shader Editor (node-based material authoring). It is derived from official Blender documentation and observed behavior in Blender 4.2+ / 5.x.

---

## 1. Overview: What the Shader Node Editor Is

Blender's **Shader Editor** is a visual node graph editor used to author materials for the Cycles and EEVEE renderers. Instead of a flat list of sliders, you build a **node tree** — a directed acyclic graph where:

- Each **node** performs a specific operation (texture sampling, math, BSDF shading, mixing, etc.).
- **Sockets** on nodes expose inputs and outputs.
- **Noodles** (curved connection lines) carry typed data from outputs to inputs.
- Data generally flows **left → right**.
- The final result feeds into a **Material Output** node (Surface / Volume / Displacement).

The editor provides immediate visual feedback: changes propagate to the 3D Viewport (in Material Preview or Rendered mode) in real time.

Key workspaces: **Shading** workspace (3D Viewport + Shader Editor + Properties). You can also change any area to **Shader Editor** via the editor type selector (top-left icon).

---

## 2. Anatomy of a Single Node — How Nodes Look

Every node follows a consistent, compact visual language designed for high information density and scannability.

### 2.1 Node Structure (Top → Bottom)

```
┌─────────────────────────────────────────────┐
│  ▶  Principled BSDF               [👁] [X]  │  ← Header / Title Bar
├─────────────────────────────────────────────┤
│                                             │
│  Base Color        ●──────────────┐         │
│                     │   [Color]   │         │  ← Input sockets (LEFT)
│  Subsurface       ●──────────────┤         │     (with default value widgets)
│                     │             │         │
│  Metallic          ●──┐          │         │
│                     │  │          │         │
│  Roughness         ●──┘          │         │
│                     │             │         │
│  Normal            ●──────────────┘         │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │          [Preview Thumbnail]          │  │  ← Optional per-node preview
│  └───────────────────────────────────────┘  │
│                                             │
│  BSDF          ●───────────────────────     │  ← Output socket (RIGHT)
└─────────────────────────────────────────────┘
```

### 2.2 Header (Title Bar)

- **Left**: Collapse triangle (▷/▼). Click or press **H** to collapse the node to just the header.
- **Center**: Node type name (e.g., "Principled BSDF"). You can assign a custom **Label** in the sidebar (N) for organization.
- **Right**: 
  - Eye icon (👁) toggles node preview thumbnail (if supported).
  - Mute/X icon or color tag (in groups).
- Nodes can be **colored** via the sidebar (right-click header → Node Color) or assigned random colors. Color tags on node groups tint the entire header.

### 2.3 Body / Properties Section

Contains the node's internal controls:

- **Sliders** (Roughness, Metallic, etc.)
- **Color pickers** (Base Color, Emission)
- **Dropdowns** / **Enum buttons** (Distribution method, etc.)
- **Checkboxes**
- **Color Ramps**, **Curves**, **Vector fields**
- Some nodes expose **multi-input sockets** (e.g., Add Shader, Mix Shader with multiple BSDFs).

Disconnected input sockets show their **default value widget** inline (a small color swatch, number field, or slider right next to the socket). When connected, the widget disappears and the value comes from upstream.

### 2.4 Sockets — The Connection Points

Sockets are small **colored circles** (or other shapes in newer Blender) on the left (inputs) and right (outputs) edges.

**Visual cues:**
- Filled circle = single value (or field in Geometry Nodes).
- In Geometry Nodes (and increasingly elsewhere): **diamond** = field (per-element varying), **vertical bar** or other glyphs for lists/grids.
- In Shader Editor the dominant cue is still **color + position**.

**Socket colors (data type encoding):**

| Color          | Data Type          | Typical Meaning                              | Example Nodes                          |
|----------------|--------------------|----------------------------------------------|----------------------------------------|
| Bright Green   | Shader             | BSDF / Emission / Volume / Background        | Principled BSDF, Mix Shader, Emission  |
| Yellow         | Color              | RGB(A) values, textures                      | Image Texture, RGB, Hue/Saturation     |
| Purple / Blue  | Vector             | 3D vectors, normals, coordinates, tangents   | Normal Map, Texture Coordinate, Bump   |
| Gray           | Float / Value      | Scalars (0–1 roughness, factors, etc.)       | Math, Value, Noise Texture (Fac)       |
| Lime Green     | Integer            | Whole numbers                                | Integer, Index, some menu outputs      |
| Pink / Magenta | Boolean            | True/False, switches                         | Switch, Compare, Boolean Math          |
| Light Blue     | String             | Text / names (rare in shaders)               | String nodes (mostly Geometry Nodes)   |
| Orange         | Object / Collection| Data-block references                        | Object Info, Collection Info           |
| Sea Green      | Geometry           | Mesh/Point/Volume/Curve/Instances (GN)       | Join Geometry, Set Position            |
| Special        | Matrix             | 4×4 transform matrix (new in 4.2 GN)         | Transform Geometry, etc.               |

**Important rule**: You can usually only connect **same-color** sockets. Blender shows implicit conversions in some cases (float → color, color → shader via Emission), but shader sockets (bright green) are strict — you must use **Mix Shader** or **Add Shader** to combine them.

**Socket interaction:**
- Hover shows tooltip with name + type + current value.
- **Ctrl + Click** on some sockets allows renaming (especially in groups).
- **Ctrl + H** hides unused sockets (great for decluttering).
- Multi-input sockets (e.g., Add Shader) accept many connections; later ones are summed.

---

## 3. Noodles — How Connections Look and Behave

**Noodles** are the curved lines that connect nodes. They are the primary visual language of data flow.

### 3.1 Visual Design

- **Shape**: Smooth **Bézier curves** with control points that produce elegant arcs.
- **Curvature**: Controlled by theme setting "Noodle Curving" (Preferences → Themes → Node Editor). Higher values = more dramatic bends (helps avoid overlap in dense graphs). Lower values = straighter lines.
- **Color**: Always inherits the **color of the source (output) socket**. This makes it trivial to scan a complex tree and see "all the green noodles are shader flow", "yellow are color textures", etc.
- **Thickness**: Theme-controlled. Usually thin-medium with anti-aliasing.
- **Selected state**: Noodles highlight (often brighter or thicker) when the source or destination node is selected.
- **Invalid connections**: Drawn in **bright red** with explanatory tooltips ("Cannot connect Color to Shader", etc.).

### 3.2 Interaction with Noodles

- **Creating**: LMB-drag from an output socket (right side) to a compatible input socket (left side of another node). Compatible sockets highlight on hover.
- **Disconnecting**: Grab the noodle near an **input** socket and drag it away, then release.
- **Repositioning existing links**: Hold **Ctrl** while dragging from an output — you can move where existing noodles land without creating new ones.
- **Cutting (Link Cut tool)**:
  - **Ctrl + RMB** drag a line across any noodles → deletes them.
  - Toolbar also has a dedicated "Link Cut" tool (scissors icon).
- **Muting links**: **Ctrl + Alt + RMB** drag across noodles (they turn red-dashed and are bypassed).
- **Auto-insert**: Drag a node onto an existing noodle — Blender dims the noodle and inserts the node when you release (if types are compatible).

### 3.3 Reroute Nodes

For complex routing without crossing, Blender provides **Reroute** nodes (small dots on a noodle). They act as waypoints:

- Add via **Shift + A → Reroute** or the Add Reroute tool in the toolbar.
- They have exactly one input and one output of any type.
- Great for organizing "highways" of data that fan out to many consumers.

Node Wrangler has a shortcut (`/`) that adds reroutes to all outputs of selected nodes.

---

## 4. Navigation & View Controls

The node editor viewport behaves like a 2D canvas.

| Action                    | Input                          | Notes |
|---------------------------|--------------------------------|-------|
| Pan                       | Middle Mouse Button (MMB) drag | Smooth panning |
| Zoom                      | Mouse Wheel or Ctrl + MMB drag | Scroll to zoom in/out |
| Frame Selected            | Numpad `.` (period)            | Zooms and centers on selection |
| Frame All                 | `Home`                         | Shows entire node tree |
| Reset Zoom / View         | Numpad `1` (in some contexts)  | Varies by editor |
| Toggle Toolbar            | `T`                            | Left sidebar with tools |
| Toggle Sidebar            | `N`                            | Right panel: node props, material settings |

The background grid is subtle and fully themeable. Nodes support **both freeform positioning and grid snapping**:

- By default, node placement is freeform (no forced grid).
- Grid snapping can be enabled persistently via the header **Snap** popover (magnet icon) or the "Snap to Grid" option.
- During any transform (`G`/`R`/`S`), hold **Ctrl** to temporarily enable grid snapping for that operation.
- Alignment tools (Shift+= in Node Wrangler, etc.) provide additional layout assistance.

---

## 5. Selection Techniques

| Action                    | Shortcut              | Behavior |
|---------------------------|-----------------------|----------|
| Select node               | LMB                   | Replaces selection |
| Multi-select toggle       | Shift + LMB           | Add/remove from selection |
| Select All                | `A`                   | Selects every node in the tree |
| Deselect All              | Alt + `A` (or double-tap `A`) | Clear selection |
| Invert Selection          | Ctrl + `I`            | Flips current selection |
| Box Select                | `B` + LMB drag        | Classic rectangular marquee |
| Circle Select             | `C` + LMB drag        | Brush-style selection (wheel to resize) |
| Lasso Select              | Ctrl + Alt + LMB drag | Freehand selection |
| Select Linked (inputs)    | `L`                   | Selects all nodes feeding into the selected one |
| Select Linked (outputs)   | Shift + `L`           | Selects all downstream nodes |
| Find / Search             | Ctrl + `F`            | Search nodes by name or label |

**Pro tip**: After selecting a node, `L` or `Shift+L` is extremely fast for tracing data flow in large trees.

---

## 6. Adding Nodes

| Method                              | Shortcut / Gesture                  | Result |
|-------------------------------------|-------------------------------------|--------|
| Open Add Menu                       | Shift + `A`                         | Categorized searchable menu (Input, Output, Shader, Texture, Color, Vector, Converter, Group, etc.) |
| Quick search                        | Type after Shift+A                  | Filters the menu instantly |
| Context-sensitive add + connect     | LMB-drag from any socket into empty space | Opens Add menu filtered to compatible nodes; releasing auto-connects |
| Drag node onto existing noodle      | LMB-drag node on top of a noodle    | Inserts node (if types match) |
| Node Wrangler: Lazy Connect         | Alt + RMB drag between two nodes    | Connects nearest compatible sockets automatically |

When you drag from a socket, Blender shows a `+` cursor indicating "create and connect".

---

## 7. Moving, Transforming, and Organizing Nodes

### 7.1 Basic Transform — The Modal System

Blender's node transforms (`G`, `R`, `S`) use a **modal operator** model. This is one of the most important interaction patterns to understand.

#### How the Modal Transform Works

1. Select one or more nodes.
2. Press `G` (Grab/Move), `R` (Rotate), or `S` (Scale).
3. Blender immediately enters a **live preview mode**:
   - Move your mouse — the node(s) follow in real time (freeform by default).
   - You can also type precise numeric values (e.g. `G` → `50` → Enter moves 50 units on the X axis; `S` → `0.5` → Enter scales to 50%).
4. **Confirm or cancel**:
   - **Left-click** (or press Enter/Return) → **confirms** the new position/rotation/scale and exits the modal.
   - **Right-click** or **Esc** → **cancels** the operation; the node(s) instantly return to their original transform.
5. During the modal you can hold modifier keys:
   - **Ctrl** → Temporarily enable **grid snapping** (nodes jump to the visible background grid).
   - **Shift** → Fine / slow-motion movement for precise placement.
   - **X** or **Y** (after starting the modal) → Lock movement to that axis only.

This same modal pattern (mouse to preview → LMB/Enter to accept → RMB/Esc to cancel) applies consistently across Blender (3D Viewport, UV Editor, etc.).

#### Freeform vs Grid Placement

Nodes support **both** positioning modes:

- **Freeform (default)**: Nodes can be placed at any pixel position. This gives maximum flexibility for organic layouts.
- **Grid snapping**: 
  - Enable persistently via the header **Snap** popover (magnet icon) → "Snap to Grid".
  - Or hold **Ctrl** only while transforming for temporary snapping.
- The background grid is always visible and its density/spacing is controlled by the theme and zoom level. Good shader artists often keep snapping off for creative layout, then use Ctrl-snap or alignment tools for final polish.

#### The Basic Transform Table

| Action           | Shortcut              | Notes |
|------------------|-----------------------|-------|
| Move / Grab      | `G` (or LMB-drag node body) | Enters modal: move mouse to preview, LMB/Enter to confirm, RMB/Esc to cancel. Hold Ctrl for grid snap. |
| Rotate           | `R`                   | Same modal behavior. Rarely used on single nodes; useful when rotating groups of nodes for visual organization. |
| Scale            | `S`                   | Same modal behavior. Affects overall node size (mostly width in practice). |
| Resize Width     | LMB-drag left or right edge of node | Direct non-modal resize; only horizontal. Height is automatic based on content. |
| While in modal   | `F`                   | Toggle attachment to a parent Frame. |
| While in modal   | `Alt`                 | Toggle "auto-offset" (pushes neighboring nodes left/right to make room). |
| While in modal   | `T`                   | Toggle auto-offset direction. |
| Axis lock        | `X` or `Y` (in modal) | Constrain movement to one axis. |
| Numeric input    | Type digits (in modal)| e.g. `G 120 Enter` moves exactly 120 units on X. |

**Best practice**: Use freeform for initial creative arrangement, then enable grid snapping (or hold Ctrl) when you want nodes to align cleanly for readability.

### 7.2 Duplication & Copy/Paste

- **Shift + D**: Duplicate selected nodes (connections are preserved where possible).
- **Alt + D**: Duplicate linked (for node groups — creates instance).
- **Ctrl + C / Ctrl + V**: Copy and paste nodes between trees or materials.
- **Shift + S**: Swap node type (tries to keep connections by matching socket names).

### 7.3 Delete & Bypass

- **X** or **Delete**: Delete selected nodes.
- **Ctrl + Delete**: Delete with reconnect — Blender attempts to wire inputs directly to outputs (bypassing the deleted node).
- **Ctrl + X**: Cut nodes (same reconnect behavior).

### 7.4 Muting & Collapsing

- **M**: Mute selected nodes. The node header turns red; noodles pass straight through (data is unchanged).
- **H**: Collapse selected nodes to header only (great for hiding complexity).
- **Ctrl + H**: Hide all unused sockets on selected nodes.

Muted nodes are extremely useful for A/B testing variants without rewiring.

---

## 8. Connecting & Disconnecting — The Core Workflow

### 8.1 Making Connections

1. **Classic**: LMB-click an output socket (right side), drag to a compatible input socket (left side of target node), release.
2. **Auto-connect selected**: Select multiple nodes and press **J** — Blender tries to match open sockets automatically.
3. **Replace existing**: **Shift + J** does the same but overwrites any existing connections.
4. **Reposition links**: Hold **Ctrl** while dragging from an output socket — you can "pick up" where existing noodles land.
5. **Swap similar links**: Hold **Alt** while moving a link.

### 8.2 Quick Output-to-Material-Output

- **Shift + Alt + LMB** on a node: Connects its primary output directly to the Material Output (or Group Output in a group). Extremely useful for quick previews.

### 8.3 Disconnecting

- Grab the noodle **near the input socket** and drag it away.
- Use the Link Cut tool (**Ctrl + RMB** drag across noodles).
- **Alt + LMB** drag on a selected node: Detaches the node from all its connections while moving it.

### 8.4 Special Cases

- **Shader sockets** (bright green) can only be combined with Mix Shader or Add Shader. Math nodes will not accept them.
- **Multi-input sockets** accept many connections; order usually does not matter (they are summed or mixed).
- Some nodes have **hidden sockets** that appear when you connect something unusual (e.g., vector inputs on texture nodes).

---

## 9. Node Wrangler — The Essential Productivity Add-on

**Node Wrangler** (bundled, enable in Edit → Preferences → Add-ons) adds dozens of high-value shortcuts and is considered mandatory by most professional shader artists.

### 9.1 Key Node Wrangler Shortcuts

| Shortcut                  | Action | Why It's Great |
|---------------------------|--------|----------------|
| **Ctrl + T**              | Add Texture Coordinate + Mapping nodes to selected shader node | Instant UV setup |
| **Shift + Ctrl + T**      | Principled Texture Setup — drag multiple image textures onto a Principled BSDF | Auto-detects Base Color, Roughness, Normal, Metallic from filenames |
| **Shift + Ctrl + LMB**    | Preview selected node's output (temporary wire to Material Output) | Click repeatedly to cycle outputs. Best debugging tool |
| **Alt + RMB** drag        | Lazy Connect — connects nearest compatible sockets between two nodes | No need to hit exact sockets |
| **Shift + Ctrl + RMB** drag | Lazy Mix — auto-inserts MixRGB or Math node between two nodes | Fast branching |
| **Ctrl + = / * / - / / ** | Merge selected nodes with Add/Multiply/Subtract/Divide/etc. | Instant math merging |
| **Shift + =**             | Align selected nodes horizontally or vertically | Clean layout |
| **`/`**                   | Add reroute to every output of selected nodes | Instant "bus" routing |
| **Alt + R**               | Reload all image textures on selected nodes | Fast texture iteration |
| **Shift + Ctrl + C**      | Copy node labels | Propagate labels |
| **Alt + X**               | Delete unused nodes | Cleanup |
| **Backspace**             | Reset selected nodes to default values (keeps connections) | Quick reset |

Node Wrangler also adds a **Shift + W** pie menu and a rich sidebar panel.

---

## 10. Organizing Large Trees — Frames, Groups, Reroutes

### 10.1 Frames (Visual Containers)

- Select several nodes and press **Ctrl + J** → creates a **Frame** node that visually groups them.
- Frames can be colored and labeled.
- Nodes inside a frame can be moved together (unless you press **F** while dragging to detach).
- Frames do not affect execution — purely organizational.

### 10.2 Node Groups (Reusable Subgraphs)

- Select nodes and press **Ctrl + G** → creates a **Node Group**.
- The group appears as a single node with exposed inputs/outputs (Group Input / Group Output nodes inside).
- Press **Tab** to enter the group (edit internals) or exit.
- Groups support **color tags** (4.2+) that tint the header for quick visual scanning.
- Groups can be nested.
- **Alt + D** duplicates a linked instance (changes inside propagate to all uses).

This is the primary mechanism for building a personal shader library.

### 10.3 Reroutes (Already Covered)

Use them liberally. A well-rerouted tree is dramatically easier to read than one with long crossing noodles.

---

## 11. Sidebar (N) and Overlays

Press **N** to open the right sidebar:

- **Node** tab: Label, custom color, mute, parent frame, custom properties.
- **Item** tab: Node-specific settings (sometimes duplicates body controls).
- **Tool** tab: Active tool options.
- **View** tab: Display settings (previews, wire colors, timings).

**Overlays** (top-right of the editor header) control:
- Node previews on/off
- Wire colors (match socket colors)
- Reroute auto-labels
- Annotations
- Timing overlays (performance)

---

## 12. Complete Shortcut Reference Table

### Navigation & View
- MMB drag — Pan
- Wheel / Ctrl+MMB — Zoom
- Numpad `.` — Frame Selected
- `Home` — Frame All
- `T` — Toggle Toolbar
- `N` — Toggle Sidebar

### Selection
- LMB — Select
- Shift+LMB — Multi-select
- `A` — Select All
- Alt+`A` — Deselect All
- Ctrl+`I` — Invert Selection
- `B` — Box Select
- `C` — Circle Select
- `L` — Select Linked (inputs)
- Shift+`L` — Select Linked (outputs)
- Ctrl+`F` — Find Node

### Adding
- Shift+`A` — Add Menu
- Drag socket → empty space — Context Add + Auto-connect

### Transform (Modal — Mouse to Preview, LMB/Enter to Confirm, RMB/Esc to Cancel)
- `G` — Grab/Move (modal): move mouse to preview, LMB/Enter confirms, RMB/Esc cancels. Hold Ctrl for grid snap during move.
- `R` — Rotate (modal): same confirm/cancel behavior.
- `S` — Scale (modal): same confirm/cancel behavior.
- Drag node edge — Resize Width only (non-modal).
- (in modal) `F` — Toggle Frame attachment.
- (in modal) `Alt` — Toggle auto-offset (pushes neighbors).
- (in modal) `T` — Toggle auto-offset direction.
- (in modal) `X` / `Y` — Lock to axis.
- (in modal) Type numbers — Precise transform (e.g. `G 80 Enter`).

### Duplicate / Delete
- Shift+`D` — Duplicate
- Alt+`D` — Duplicate Linked (groups)
- `X` / Delete — Delete
- Ctrl+Delete — Delete + Reconnect
- Ctrl+`X` — Cut + Reconnect
- Ctrl+`C` / Ctrl+`V` — Copy / Paste

### Connect / Disconnect
- LMB-drag output → input — Connect
- `J` — Auto-connect selected nodes
- Shift+`J` — Auto-connect + Replace
- Ctrl+drag output — Reposition existing links
- Alt+drag link — Swap links
- Drag link off input — Disconnect
- Ctrl+RMB drag across noodles — Link Cut
- Ctrl+Alt+RMB drag — Mute Links
- Shift+Alt+LMB on node — Connect to Material Output

### Node State
- `M` — Mute / Unmute
- `H` — Collapse / Expand node
- Ctrl+`H` — Hide / Show unused sockets
- Shift+`S` — Swap Node Type

### Organization
- Ctrl+`J` — Create Frame around selection
- Ctrl+`G` — Create Node Group
- Tab — Enter / Exit Group
- (Node Wrangler) `/` — Add Reroutes to outputs

### Node Wrangler Power Shortcuts
- Ctrl+`T` — Add Texture Coord + Mapping
- Shift+Ctrl+`T` — Principled Texture Setup (drag images)
- Shift+Ctrl+LMB — Preview node output
- Alt+RMB drag — Lazy Connect
- Shift+Ctrl+RMB drag — Lazy Mix
- Ctrl+= / * / - — Merge with math operation
- Shift+`=` — Align nodes
- `Alt`+`R` — Reload images
- Backspace — Reset node values

---

## 13. Design Philosophy & UX Patterns

Blender's node editor prioritizes:

1. **Immediate visual feedback** — Every change is visible; noodles and colors make data types obvious at a glance.
2. **High information density** — Nodes are compact; previews and socket widgets pack a lot of state into small space.
3. **Left-to-right flow** — Matches Western reading direction; makes trees scannable.
4. **Color as type system** — The strongest cue for compatibility. Red = error is universal.
5. **Non-destructive experimentation** — Mute (`M`), bypass-delete, Node Wrangler preview, and easy duplication encourage trying variants.
6. **Progressive disclosure** — Collapse (`H`), hide sockets (`Ctrl+H`), and groups (`Ctrl+G`) let you hide complexity until needed.
7. **Contextual acceleration** — Dragging from sockets, Shift+Alt+LMB, and Node Wrangler's lazy tools reduce the number of precise clicks required.

The system scales from simple "Principled BSDF + Image Texture" materials to hundreds-of-nodes procedural monsters while remaining readable.

---

## 14. Workflow Tips for Daily Use

- Always start with the default **Principled BSDF → Material Output** pair.
- Use **Node Wrangler's Shift+Ctrl+T** (drag textures) for 80% of real-world texturing.
- Use **Shift+Ctrl+LMB** constantly to preview intermediate nodes — this is the #1 debugging technique.
- Keep trees left-to-right with gentle vertical rhythm; use reroutes and frames to prevent "spaghetti".
- Name important nodes (sidebar Label) and color-code groups.
- For complex materials, extract reusable subgraphs into Node Groups early.
- When you have many similar variants, mute nodes (`M`) rather than deleting — you can toggle them back instantly.
- Learn the **Link Cut** gesture (Ctrl+RMB) — it is faster than selecting and deleting links individually.
- In the Shading workspace, keep the 3D Viewport in Material Preview mode while you work; it gives the best balance of speed and fidelity.

---

## 15. Where to Go Next

- Official Manual: https://docs.blender.org/manual/en/latest/editors/shader_editor.html
- Node Editor Reference: https://docs.blender.org/manual/en/latest/interface/controls/nodes/
- Node Wrangler docs: https://docs.blender.org/manual/en/latest/addons/node/node_wrangler.html
- Blender 4.2+ release notes for the latest socket shape and theme improvements.

---

*Document generated for reference and onboarding. All shortcuts and behaviors verified against Blender 4.2–5.1 documentation and common community practice.*
