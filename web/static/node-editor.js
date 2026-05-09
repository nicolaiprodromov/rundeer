// rundeer node editor — Blender-style node graph controller.
// Features: modal G/R/S transforms, preview nodes, collapse-under-preview,
// autosave (localStorage + JSON file), Node-Wrangler shortcuts, past-runs panel.

"use strict";

// ─── Socket type registry ────────────────────────────────────────────────────

const SOCKET_TYPES = {
  text:         { color: "#60b4ff", label: "String" },
  image:        { color: "#d4aa50", label: "Image" },
  video:        { color: "#9b72d4", label: "Video" },
  number:       { color: "#8a9a8a", label: "Number" },
  definition:   { color: "#52c49a", label: "Definition" },
  filepath:     { color: "#d48b50", label: "File Path" },
  "image-bundle": { color: "#e8b860", label: "Image Bundle" },
  "video-bundle": { color: "#b58cdf", label: "Video Bundle" },
  any:          { color: "#cccccc", label: "Any" },
};

function baseType(t) {
  if (t === "image-bundle") return "image";
  if (t === "video-bundle") return "video";
  return t;
}

function canConnect(typeA, typeB) {
  if (!typeA || !typeB) return false;
  if (typeA === typeB) return true;
  if (typeA === "any" || typeB === "any") return true;
  // bundle  <->  scalar of same media kind
  if (baseType(typeA) === baseType(typeB)) return true;
  if ((typeA === "filepath" || typeA === "text") && (typeB === "filepath" || typeB === "text")) return true;
  return false;
}

// Returns true when a node's output socket carries a *bundle* (array of
// values) rather than a single value. Used to show bundle markers on the
// socket dot and to render bundle wires as dashed.
function outputProducesBundle(nodeId, sockId) {
  const n = graph.nodes[nodeId];
  if (!n) return false;
  if (n.type === "loop-output") return true;
  if (n.lastResult && n.lastResult.value !== undefined && Array.isArray(n.lastResult.value)) return true;
  if (COMMAND_TYPES.has(n.type)) {
    const directIters = Number(n.props.iterations || 1);
    if (directIters > 1) return true;
    // iterations may also be wired in from an upstream node — peek at the
    // source's static value so the bundle marker is still drawn pre-run.
    const wired = graph.edges.find((e) => e.toNode === nodeId && e.toSocket === "iterations");
    if (wired) {
      const src = graph.nodes[wired.fromNode];
      let v;
      if (src?.lastResult && !Array.isArray(src.lastResult.value)) v = src.lastResult.value;
      if (v == null && src?.type === "number-input") v = src.props?.value;
      const n_iter = Number(v);
      if (Number.isFinite(n_iter) && n_iter > 1) return true;
    }
  }
  const def = NODE_BY_TYPE[n.type];
  const sock = def?.outputs?.find((s) => s.id === sockId);
  if (sock && /-bundle$/.test(sock.type || "")) return true;
  return false;
}

// ─── Node catalog ────────────────────────────────────────────────────────────

const NODE_CATALOG = [
  {
    category: "Primitives",
    nodes: [
      {
        type: "text-input", label: "String", desc: "Multi-line string value",
        inputs: [],
        outputs: [{ id: "out", label: "String", type: "text" }],
        props: [{ id: "value", label: "Value", kind: "textarea", default: "", placeholder: "Enter text…" }],
      },
      {
        type: "number-input", label: "Number", desc: "Numeric value",
        inputs: [],
        outputs: [{ id: "out", label: "Number", type: "number" }],
        props: [{ id: "value", label: "Value", kind: "number", default: 1 }],
      },
      {
        type: "image-input", label: "Image File", desc: "Path to an image file",
        inputs: [],
        outputs: [{ id: "out", label: "Image", type: "image" }],
        props: [{ id: "path", label: "Path", kind: "text", default: "", placeholder: "path/to/image.png" }],
      },
      {
        type: "video-input", label: "Video File", desc: "Path to a video file",
        inputs: [],
        outputs: [{ id: "out", label: "Video", type: "video" }],
        props: [{ id: "path", label: "Path", kind: "text", default: "", placeholder: "path/to/video.mp4" }],
      },
      {
        type: "filepath-input", label: "File Path", desc: "Generic file path",
        inputs: [],
        outputs: [{ id: "out", label: "Path", type: "filepath" }],
        props: [{ id: "path", label: "Path", kind: "text", default: "", placeholder: ".rundeer/batch.json" }],
      },
      {
        type: "text-join", label: "String Join", desc: "Concatenate two values as strings",
        inputs: [
          { id: "a", label: "A", type: "any" },
          { id: "b", label: "B", type: "any" },
        ],
        outputs: [{ id: "out", label: "Joined", type: "text" }],
        props: [{ id: "sep", label: "Separator", kind: "text", default: " ", placeholder: " " }],
      },
      {
        type: "compress-image", label: "Compress Image", desc: "Reduce image file size for chained edits",
        inputs: [{ id: "in", label: "Image", type: "image" }],
        outputs: [{ id: "out", label: "Compressed", type: "image" }],
        props: [
          { id: "quality", label: "Quality (0–100)", kind: "range", min: 1, max: 100, step: 1, default: 75 },
          { id: "max_dimension", label: "Max Dimension (px, 0=keep)", kind: "number", default: 0 },
        ],
      },
      {
        type: "math-op", label: "Math", desc: "Numeric operation",
        inputs: [
          { id: "a", label: "A", type: "number" },
          { id: "b", label: "B", type: "number" },
        ],
        outputs: [{ id: "out", label: "Result", type: "number" }],
        props: [
          { id: "op", label: "Operation", kind: "select", options: ["add", "subtract", "multiply", "divide", "modulo", "power", "min", "max"], default: "add" },
        ],
      },
      {
        type: "text-op", label: "String Op", desc: "String transformation (also converts numbers to strings)",
        inputs: [
          { id: "a", label: "A", type: "any" },
          { id: "b", label: "B", type: "any" },
        ],
        outputs: [{ id: "out", label: "Result", type: "text" }],
        props: [
          { id: "op", label: "Operation", kind: "select", options: ["to_string", "replace", "upper", "lower", "trim", "slice", "to_int", "to_float", "length", "format"], default: "to_string" },
          { id: "extra", label: "Extra (replace=with, slice=start:end, format=tpl with {a}/{b})", kind: "text", default: "" },
        ],
      },
    ],
  },
  {
    category: "Prompt",
    nodes: [
      {
        type: "prompt-filter", label: "Prompt Filter", desc: "Use a model to transform a prompt",
        inputs: [
          { id: "prompt", label: "Prompt In", type: "text" },
          { id: "instructions", label: "Instructions", type: "text" },
        ],
        outputs: [{ id: "out", label: "Prompt Out", type: "text" }],
        props: [
          { id: "model_name", label: "Model Name", kind: "text", default: "grok-3-mini-fast" },
          { id: "model_api_key", label: "API Key override", kind: "text", default: "", placeholder: "uses env MODEL_API_KEY" },
        ],
      },
      {
        type: "definition", label: "Definition", desc: "Emit a rundeer @definition token",
        inputs: [{ id: "args", label: "Args", type: "text" }],
        outputs: [{ id: "out", label: "@token", type: "text" }],
        props: [
          { id: "name", label: "Definition Name", kind: "text", default: "", placeholder: "my_definition" },
          { id: "file", label: "Definition File", kind: "text", default: "", placeholder: ".rundeer/def/my_def.py" },
        ],
      },
    ],
  },
  {
    category: "Commands",
    nodes: [
      {
        type: "cmd-image", label: "Image", desc: "Generate images through a style brain",
        inputs: [
          { id: "subject", label: "Subject", type: "text" },
          { id: "input", label: "Reference Images", type: "image", multi: true },
        ],
        outputs: [{ id: "out", label: "Run →", type: "image" }],
        props: [
          { id: "style", label: "Style", kind: "text", default: "", placeholder: "Moebius" },
          { id: "iterations", label: "Iterations", kind: "number", default: 1 },
          { id: "reference_ids", label: "Style Reference IDs", kind: "text", default: "", placeholder: "e.g. 0,1,2" },
          { id: "output_dir", label: "Output Dir", kind: "text", default: ".rundeer/outputs" },
          { id: "output_name", label: "Output Name", kind: "text", default: "output" },
          { id: "model", label: "Model", kind: "text", default: "" },
          { id: "aspect_ratio", label: "Aspect Ratio", kind: "text", default: "" },
          { id: "resolution", label: "Resolution", kind: "text", default: "" },
          { id: "grid", label: "Build Grid", kind: "checkbox", default: false },
          { id: "dry_run", label: "Dry Run", kind: "checkbox", default: false },
        ],
      },
      {
        type: "cmd-video", label: "Video", desc: "Generate video clips",
        inputs: [
          { id: "subject", label: "Subject", type: "text" },
          { id: "motion", label: "Motion", type: "text" },
          { id: "start_frame", label: "Start Frame", type: "image" },
          { id: "input", label: "Reference Images", type: "image", multi: true },
        ],
        outputs: [{ id: "out", label: "Run →", type: "video" }],
        props: [
          { id: "style", label: "Style", kind: "text", default: "" },
          { id: "iterations", label: "Iterations", kind: "number", default: 1 },
          { id: "reference_ids", label: "Style Reference IDs", kind: "text", default: "", placeholder: "e.g. 0,1,2" },
          { id: "duration", label: "Duration (s)", kind: "number", default: 6 },
          { id: "output_dir", label: "Output Dir", kind: "text", default: ".rundeer/outputs" },
          { id: "output_name", label: "Output Name", kind: "text", default: "output" },
          { id: "aspect_ratio", label: "Aspect Ratio", kind: "text", default: "" },
          { id: "dry_run", label: "Dry Run", kind: "checkbox", default: false },
        ],
      },
      {
        type: "cmd-edit", label: "Edit", desc: "Apply targeted edits",
        inputs: [
          { id: "input", label: "Input Images", type: "image", multi: true },
          { id: "subject", label: "Edit Instructions", type: "text" },
        ],
        outputs: [{ id: "out", label: "Run →", type: "image" }],
        props: [
          { id: "style", label: "Style", kind: "text", default: "" },
          { id: "edit_type", label: "Type", kind: "select", options: ["image", "video"], default: "image" },
          { id: "iterations", label: "Iterations", kind: "number", default: 1 },
          { id: "output_dir", label: "Output Dir", kind: "text", default: ".rundeer/outputs" },
          { id: "output_name", label: "Output Name", kind: "text", default: "output" },
          { id: "dry_run", label: "Dry Run", kind: "checkbox", default: false },
        ],
      },
      {
        type: "cmd-merge", label: "Merge", desc: "Composite multiple images",
        inputs: [
          { id: "input", label: "Input Images", type: "image", multi: true },
          { id: "subject", label: "Subject", type: "text" },
        ],
        outputs: [{ id: "out", label: "Run →", type: "image" }],
        props: [
          { id: "style", label: "Style", kind: "text", default: "" },
          { id: "output_dir", label: "Output Dir", kind: "text", default: ".rundeer/outputs" },
          { id: "output_name", label: "Output Name", kind: "text", default: "output" },
          { id: "dry_run", label: "Dry Run", kind: "checkbox", default: false },
        ],
      },
      {
        type: "cmd-extend", label: "Extend", desc: "Extend an existing video clip",
        inputs: [
          { id: "source", label: "Source Clip", type: "video" },
          { id: "subject", label: "Subject", type: "text" },
          { id: "motion", label: "Motion", type: "text" },
        ],
        outputs: [{ id: "out", label: "Run →", type: "video" }],
        props: [
          { id: "style", label: "Style", kind: "text", default: "" },
          { id: "output_dir", label: "Output Dir", kind: "text", default: ".rundeer/outputs" },
          { id: "output_name", label: "Output Name", kind: "text", default: "output" },
          { id: "dry_run", label: "Dry Run", kind: "checkbox", default: false },
        ],
      },
    ],
  },
  {
    category: "Loop",
    nodes: [
      {
        type: "loop-decompose", label: "Loop · Decompose", desc: "Iterate over each item of a bundle",
        inputs: [{ id: "bundle", label: "Bundle", type: "any" }],
        outputs: [
          { id: "item", label: "Item", type: "any" },
          { id: "index", label: "Index", type: "number" },
          { id: "count", label: "Count", type: "number" },
        ],
        props: [
          { id: "loop_id", label: "Loop ID", kind: "text", default: "loop1", placeholder: "unique loop name" },
        ],
      },
      {
        type: "loop-output", label: "Loop · Output", desc: "Collect each iteration's value back into a bundle",
        inputs: [{ id: "item", label: "Item", type: "any" }],
        outputs: [{ id: "out", label: "Bundle", type: "any" }],
        props: [
          { id: "loop_id", label: "Loop ID", kind: "text", default: "loop1", placeholder: "matches Decompose" },
        ],
      },
    ],
  },
  {
    category: "Output",
    nodes: [
      {
        type: "preview", label: "Preview", desc: "Display upstream image, video, or string inline. Auto-refreshes from upstream values; click ⟳ to force refresh.",
        inputs: [{ id: "in", label: "In", type: "any" }],
        outputs: [{ id: "out", label: "Out", type: "any" }],
        props: [],
        defaultWidth: 320,
        defaultHeight: 260,
        resizable: true,
      },
    ],
  },
];

const NODE_BY_TYPE = Object.fromEntries(
  NODE_CATALOG.flatMap((cat) => cat.nodes.map((n) => [n.type, { ...n, category: cat.category }]))
);

const PREVIEW_TYPES = new Set(["preview"]);
const LEGACY_PREVIEW_TYPES = new Set(["preview-image", "preview-video", "preview-text"]);
const COMMAND_TYPES = new Set(["cmd-image", "cmd-video", "cmd-edit", "cmd-merge", "cmd-extend"]);

// ─── Graph state ─────────────────────────────────────────────────────────────

const graph = {
  nodes: {},   // id → { id, type, x, y, props, width, lastResult, hidden, collapsedBy }
  edges: [],
  _nextId: 1,
};

function genId() { return `n${graph._nextId++}`; }
function genEdgeId() { return `e${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

// ─── Viewport ────────────────────────────────────────────────────────────────

const vp = { x: 0, y: 0, zoom: 1 };

function applyViewport() {
  document.getElementById("nodeCanvas").style.transform =
    `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
  document.getElementById("zoomDisplay").textContent = `${Math.round(vp.zoom * 100)}%`;
}

function screenToCanvas(sx, sy) {
  const rect = document.getElementById("canvasWrap").getBoundingClientRect();
  return {
    x: (sx - rect.left - vp.x) / vp.zoom,
    y: (sy - rect.top - vp.y) / vp.zoom,
  };
}

// ─── Interaction state ───────────────────────────────────────────────────────

const ix = {
  draggingNode: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  resizing: null,
  panning: false,
  panStartX: 0, panStartY: 0,
  panVpX: 0, panVpY: 0,
  wire: null,
  boxStart: null,
  selection: new Set(),
  // Modal transform (Blender G/R/S)
  modal: null,           // { kind: "G"|"R"|"S", startMouse:{x,y}, snapshots:Map<id,{x,y}> }
  // Cut tool (Ctrl+RMB drag)
  cutting: null,         // { points: [{x,y}, ...] }
  // Mouse tracking for Shift+A
  lastMouseScreen: { x: 0, y: 0 },
  lastMouseCanvas: { x: 0, y: 0 },
};

// ─── Graph mutations ─────────────────────────────────────────────────────────

function addNode(type, canvasX, canvasY, opts = {}) {
  // Synthetic palette entry: "loop" creates a Decompose + Output pair
  // sharing a fresh, unique loop_id so users insert the loop as one block.
  if (type === "loop") {
    return addLoopPair(canvasX, canvasY, opts);
  }
  const def = NODE_BY_TYPE[type];
  if (!def) return null;
  const id = genId();
  const props = {};
  for (const p of def.props || []) props[p.id] = p.default ?? "";
  // Adding a bare Decompose (e.g. via legacy graph load or undo): assign a
  // unique loop_id and auto-add the matching Output node.
  const isStandaloneDecompose = (type === "loop-decompose" && !opts.skipPair);
  if (isStandaloneDecompose) {
    props.loop_id = nextLoopId();
  }
  graph.nodes[id] = {
    id, type, x: canvasX, y: canvasY, props,
    width: def.defaultWidth || 220,
    height: def.defaultHeight || null,
    collapsed: false,
  };
  if (isStandaloneDecompose) {
    const outDef = NODE_BY_TYPE["loop-output"];
    const outProps = {};
    for (const p of outDef.props || []) outProps[p.id] = p.default ?? "";
    outProps.loop_id = props.loop_id;
    const outId = genId();
    graph.nodes[outId] = {
      id: outId, type: "loop-output",
      x: canvasX + 360, y: canvasY, props: outProps,
      width: outDef.defaultWidth || 220,
      height: outDef.defaultHeight || null,
      collapsed: false,
    };
  }
  renderGraph();
  if (!opts.skipSelect) selectOnly(id);
  scheduleAutosave();
  return id;
}

// Create a Loop · Decompose + Loop · Output pair sharing a fresh loop_id.
// Returns the id of the Decompose node (the anchor users will probably
// click first).
function addLoopPair(canvasX, canvasY, opts = {}) {
  const loopId = nextLoopId();
  const decDef = NODE_BY_TYPE["loop-decompose"];
  const decProps = {};
  for (const p of decDef.props || []) decProps[p.id] = p.default ?? "";
  decProps.loop_id = loopId;
  const decId = genId();
  graph.nodes[decId] = {
    id: decId, type: "loop-decompose",
    x: canvasX, y: canvasY, props: decProps,
    width: decDef.defaultWidth || 220, collapsed: false,
  };
  const outDef = NODE_BY_TYPE["loop-output"];
  const outProps = {};
  for (const p of outDef.props || []) outProps[p.id] = p.default ?? "";
  outProps.loop_id = loopId;
  const outId = genId();
  graph.nodes[outId] = {
    id: outId, type: "loop-output",
    x: canvasX + 360, y: canvasY, props: outProps,
    width: outDef.defaultWidth || 220, collapsed: false,
  };
  renderGraph();
  if (!opts.skipSelect) selectOnly(decId);
  scheduleAutosave();
  return decId;
}

// Pick a loop_id that doesn't collide with any existing pair.
function nextLoopId() {
  const used = new Set(
    Object.values(graph.nodes)
      .filter((n) => n.type === "loop-decompose" || n.type === "loop-output")
      .map((n) => String(n.props.loop_id || ""))
  );
  let i = 1;
  while (used.has(`loop${i}`)) i++;
  return `loop${i}`;
}

function removeNode(id) {
  // Also un-hide anything this node was collapsing
  for (const other of Object.values(graph.nodes)) {
    if (other.collapsedBy === id) { other.collapsedBy = null; other.hidden = false; }
  }
  delete graph.nodes[id];
  graph.edges = graph.edges.filter((e) => e.fromNode !== id && e.toNode !== id);
  ix.selection.delete(id);
  renderGraph();
  renderProps(null);
  scheduleAutosave();
}

function removeSelectedNodes() {
  const ids = [...ix.selection].filter((id) => graph.nodes[id]);
  if (ids.length === 0) return 0;
  const doomed = new Set(ids);
  for (const id of doomed) {
    for (const other of Object.values(graph.nodes)) {
      if (other.collapsedBy === id) { other.collapsedBy = null; other.hidden = false; }
    }
    delete graph.nodes[id];
  }
  graph.edges = graph.edges.filter((e) => !doomed.has(e.fromNode) && !doomed.has(e.toNode));
  ix.selection.clear();
  renderGraph();
  renderProps(null);
  scheduleAutosave();
  return ids.length;
}

function socketTypeForProp(propDef) {
  if (propDef.kind === "number" || propDef.kind === "range") return "number";
  return "text";
}

function inputSocketDef(nodeId, socketId) {
  const def = NODE_BY_TYPE[graph.nodes[nodeId]?.type];
  if (!def) return null;
  const direct = (def.inputs || []).find((sock) => sock.id === socketId);
  if (direct) return direct;
  const propDef = (def.props || []).find((prop) => prop.id === socketId && prop.kind !== "checkbox");
  if (!propDef) return null;
  return { id: propDef.id, label: propDef.label, type: socketTypeForProp(propDef), multi: false };
}

function outputSocketDef(nodeId, socketId) {
  const def = NODE_BY_TYPE[graph.nodes[nodeId]?.type];
  if (!def) return null;
  return (def.outputs || []).find((sock) => sock.id === socketId) || null;
}

function pruneInvalidEdges() {
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((edge) => {
    const fromSock = outputSocketDef(edge.fromNode, edge.fromSocket);
    const toSock = inputSocketDef(edge.toNode, edge.toSocket);
    return Boolean(fromSock && toSock && canConnect(fromSock.type, toSock.type));
  });
  return before - graph.edges.length;
}

function removeEdge(edgeId) {
  graph.edges = graph.edges.filter((e) => e.id !== edgeId);
  renderGraph();
  scheduleAutosave();
  schedulePreviewRefresh();
}

function addEdge(fromNode, fromSocket, toNode, toSocket) {
  // Prevent self-loops
  if (fromNode === toNode) return;
  const fromSockDef = outputSocketDef(fromNode, fromSocket);
  const toSockDef = inputSocketDef(toNode, toSocket);
  if (!fromSockDef || !toSockDef || !canConnect(fromSockDef.type, toSockDef.type)) {
    setHint("incompatible socket types");
    setTimeout(clearHint, 1200);
    return;
  }
  const isMulti = Boolean(toSockDef?.multi);
  if (!isMulti) {
    // Replace any existing edge into the same input.
    graph.edges = graph.edges.filter((e) => !(e.toNode === toNode && e.toSocket === toSocket));
  } else {
    // Don't add a duplicate of the exact same connection.
    if (graph.edges.some((e) =>
      e.fromNode === fromNode && e.fromSocket === fromSocket &&
      e.toNode === toNode && e.toSocket === toSocket
    )) return;
  }
  graph.edges.push({ id: genEdgeId(), fromNode, fromSocket, toNode, toSocket });
  renderGraph();
  scheduleAutosave();
  schedulePreviewRefresh();
}

function selectOnly(id) {
  ix.selection.clear();
  if (id) ix.selection.add(id);
  updateSelectionVisuals();
  renderProps(id || null);
}

function updateSelectionVisuals() {
  document.querySelectorAll(".ne-node").forEach((el) => {
    el.classList.toggle("is-selected", ix.selection.has(el.dataset.nodeId));
  });
}

// ─── Upstream traversal (for preview collapse) ───────────────────────────────

function getUpstreamNodes(nodeId, visited = new Set()) {
  if (visited.has(nodeId)) return visited;
  visited.add(nodeId);
  for (const e of graph.edges) {
    if (e.toNode === nodeId) getUpstreamNodes(e.fromNode, visited);
  }
  return visited;
}

function applyCollapseStates() {
  // Reset transient collapse flags every render so toggling "collapsed" on/off
  // immediately reflects, without leaking state from a previous expansion.
  for (const n of Object.values(graph.nodes)) {
    n.collapsedBy = null;
    n.hidden = false;
  }
  // Apply: each collapsed preview hides every node upstream of it
  for (const n of Object.values(graph.nodes)) {
    if (PREVIEW_TYPES.has(n.type) && n.collapsed) {
      const upstream = getUpstreamNodes(n.id);
      upstream.delete(n.id);
      for (const upId of upstream) {
        const target = graph.nodes[upId];
        if (target) {
          target.collapsedBy = n.id;
          target.hidden = true;
        }
      }
    }
  }
}

function toggleCollapse(previewId) {
  const node = graph.nodes[previewId];
  if (!node || !PREVIEW_TYPES.has(node.type)) return;
  node.collapsed = !node.collapsed;
  renderGraph();
  // The CSS transition (~280ms) animates upstream node positions; re-draw
  // wires every frame so they track the moving sockets.
  animateConnectionsFor(320);
  scheduleAutosave();
}

let _animFrameUntil = 0;
let _animRunning = false;
function animateConnectionsFor(durationMs) {
  _animFrameUntil = Math.max(_animFrameUntil, performance.now() + durationMs);
  if (_animRunning) return;
  _animRunning = true;
  const tick = () => {
    renderConnections();
    if (performance.now() < _animFrameUntil) {
      requestAnimationFrame(tick);
    } else {
      _animRunning = false;
      renderConnections();
    }
  };
  requestAnimationFrame(tick);
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderGraph() {
  applyCollapseStates();
  renderNodes();
  renderLoopRegions();
  renderConnections();
}

function renderNodes() {
  const canvas = document.getElementById("nodeCanvas");
  const current = new Set(Object.keys(graph.nodes));

  canvas.querySelectorAll(".ne-node").forEach((el) => {
    if (!current.has(el.dataset.nodeId)) el.remove();
  });

  for (const [id, node] of Object.entries(graph.nodes)) {
    let el = canvas.querySelector(`[data-node-id="${id}"]`);
    if (!el) {
      el = buildNodeElement(id, node);
      canvas.appendChild(el);
    } else if (el.dataset.signature !== nodeSignature(node)) {
      // Rebuild if shape changed
      const replacement = buildNodeElement(id, node);
      el.replaceWith(replacement);
      el = replacement;
    }

    // Position: hidden nodes animate to their parent's position
    const target = node.hidden && node.collapsedBy && graph.nodes[node.collapsedBy]
      ? graph.nodes[node.collapsedBy]
      : null;
    if (target) {
      el.style.left = `${target.x + 20}px`;
      el.style.top = `${target.y + 20}px`;
      el.classList.add("is-collapsed-hidden");
    } else {
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.classList.remove("is-collapsed-hidden");
    }
    el.classList.toggle("is-selected", ix.selection.has(id));
    el.classList.toggle("is-preview", PREVIEW_TYPES.has(node.type));
  }
}

function nodeSignature(node) {
  // Used to detect when we need to rebuild DOM (e.g. preview content changes).
  // Including the per-path cache token forces the <img>/<video> to refresh
  // even when the upstream artifact path is unchanged between runs.
  const v = node.lastResult?.value || "";
  const tok = v ? (artifactURL._tokens?.[v] || "") : "";
  // Edges into this node affect socket layout (multi placeholders + prop-socket
  // disabled state), so encode them so the DOM rebuilds when wires change.
  const inSig = graph.edges
    .filter((e) => e.toNode === node.id)
    .map((e) => `${e.toSocket}<${e.fromNode}.${e.fromSocket}`)
    .sort()
    .join(",");
  // Bundle results render very differently (grid/slider) — encode shape too.
  const resultShape = Array.isArray(v) ? `arr:${v.length}` : "";
  return [
    node.type,
    node.lastResult?.kind || "",
    typeof v === "string" ? v : "",
    resultShape,
    tok,
    node.collapsed ? "c" : "e",
    node.previewMode || "",
    node.width || "",
    node.height || "",
    inSig,
  ].join("|");
}

function buildNodeElement(id, node) {
  const def = NODE_BY_TYPE[node.type];
  if (!def) return document.createElement("div");

  const el = document.createElement("div");
  el.className = "ne-node";
  el.dataset.nodeId = id;
  el.dataset.category = def.category;
  el.dataset.signature = nodeSignature(node);
  el.style.width = `${node.width || 220}px`;
  if (def.resizable && node.height) el.style.minHeight = `${node.height}px`;

  const typeColor = getNodeTypeColor(def);

  // Header
  const header = document.createElement("div");
  header.className = "ne-node-header";
  const isPreview = PREVIEW_TYPES.has(node.type);
  const collapseBtn = isPreview
    ? `<button class="ne-node-collapse" data-collapse="${id}" title="${node.collapsed ? "Expand upstream" : "Collapse upstream into this preview"}" type="button">${node.collapsed ? "▶" : "▼"}</button>`
    : "";
  const refreshBtn = isPreview
    ? `<button class="ne-node-refresh" data-refresh="${id}" title="Refresh preview from upstream" type="button">⟳</button>`
    : "";
  header.innerHTML = `
    <span class="ne-node-type-dot" style="background:${typeColor}"></span>
    <span class="ne-node-label">${escHtml(def.label)}</span>
    ${refreshBtn}
    ${collapseBtn}
    <button class="ne-node-close" data-close="${id}" title="Delete (X)" type="button">×</button>`;
  header.querySelector("[data-close]").addEventListener("click", (e) => {
    e.stopPropagation();
    removeNode(id);
  });
  const refreshEl = header.querySelector("[data-refresh]");
  if (refreshEl) {
    refreshEl.addEventListener("mousedown", (e) => e.stopPropagation());
    refreshEl.addEventListener("click", (e) => {
      e.stopPropagation();
      refreshPreview(id, { force: true });
    });
  }
  const collapseEl = header.querySelector("[data-collapse]");
  if (collapseEl) {
    collapseEl.addEventListener("mousedown", (e) => e.stopPropagation());
    collapseEl.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCollapse(id);
    });
  }
  header.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.dataset.close) return;
    e.stopPropagation();
    startNodeDrag(e, id);
  });
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "ne-node-body";

  // Static + dynamic input sockets.
  for (const sock of def.inputs || []) {
    if (sock.multi) {
      // Render one row per existing edge plus one empty placeholder row at
      // the bottom so the order of multi-image inputs is visible and the
      // user can keep adding more.
      const matches = graph.edges
        .filter((e) => e.toNode === id && e.toSocket === sock.id);
      matches.forEach((edge, i) => {
        body.appendChild(buildSocketRow(id, sock, true, { multiIndex: i + 1, edgeId: edge.id }));
      });
      body.appendChild(buildSocketRow(id, sock, true, {
        multiIndex: matches.length + 1, isMultiPlaceholder: true,
      }));
    } else {
      body.appendChild(buildSocketRow(id, sock, true));
    }
  }

  // Synthetic input sockets for editable props (so any prop can be wired
  // from another node). Skip checkboxes (boolean) — they stay UI-only.
  const inputIds = new Set((def.inputs || []).map((s) => s.id));
  const propSockets = [];
  for (const propDef of def.props || []) {
    if (inputIds.has(propDef.id)) continue;
    if (propDef.kind === "checkbox") continue;
    let stype = "text";
    if (propDef.kind === "number" || propDef.kind === "range") stype = "number";
    propSockets.push({
      id: propDef.id, label: propDef.label, type: stype, _isProp: true,
    });
  }
  for (const sock of propSockets) {
    body.appendChild(buildSocketRow(id, sock, true, { isPropSocket: true }));
  }

  // Preview content (rendered between inputs and outputs for preview nodes)
  if (PREVIEW_TYPES.has(node.type)) {
    body.appendChild(buildPreviewContent(node));
  }

  if ((def.inputs || []).length > 0 && (def.outputs || []).length > 0) {
    const div = document.createElement("div");
    div.className = "ne-node-props-divider";
    body.appendChild(div);
  }

  for (const sock of def.outputs || []) body.appendChild(buildSocketRow(id, sock, false));

  el.appendChild(body);

  // Resize handle for resizable nodes (preview nodes)
  if (def.resizable) {
    const handle = document.createElement("div");
    handle.className = "ne-node-resize";
    handle.title = "Drag to resize";
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      startNodeResize(e, id);
    });
    el.appendChild(handle);
  }

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains("ne-socket")) return;
    if (e.target.dataset.close) return;
    if (!ix.selection.has(id)) {
      if (e.shiftKey) {
        ix.selection.add(id);
        updateSelectionVisuals();
        renderProps(id);
      } else {
        selectOnly(id);
      }
    }
  });

  return el;
}

function buildPreviewContent(node) {
  const wrap = document.createElement("div");
  wrap.className = `ne-preview-content`;
  if (node.height) wrap.style.minHeight = `${Math.max(60, node.height - 110)}px`;

  const result = node.lastResult;
  if (!result || result.value === undefined || result.value === null || result.value === "") {
    wrap.innerHTML = `<div class="ne-preview-empty">no data yet — run the graph</div>`;
    return wrap;
  }

  // Bundle (array) — render grid OR slider based on node.previewMode.
  if (Array.isArray(result.value)) {
    const items = result.value.filter((v) => v != null && v !== "");
    if (items.length === 0) {
      wrap.innerHTML = `<div class="ne-preview-empty">empty bundle</div>`;
      return wrap;
    }
    const mode = node.previewMode === "slider" ? "slider" : "grid";
    const toolbar = document.createElement("div");
    toolbar.className = "ne-bundle-toolbar";
    toolbar.innerHTML =
      `<button class="ne-bundle-tab ${mode === "grid" ? "is-active" : ""}" data-mode="grid" type="button">grid</button>` +
      `<button class="ne-bundle-tab ${mode === "slider" ? "is-active" : ""}" data-mode="slider" type="button">slider</button>` +
      `<span class="ne-bundle-count">${items.length} items</span>`;
    toolbar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        node.previewMode = btn.dataset.mode;
        const el = document.querySelector(`[data-node-id="${node.id}"]`);
        if (el) el.dataset.signature = "stale";
        renderNodes();
        scheduleAutosave();
      });
    });
    wrap.appendChild(toolbar);

    if (mode === "grid") {
      const grid = document.createElement("div");
      grid.className = "ne-bundle-grid";
      for (const v of items) {
        grid.appendChild(makeBundleMedia(v, inferPreviewMediaKind(node, node.lastResult?.kind, v)));
      }
      wrap.appendChild(grid);
    } else {
      const slider = document.createElement("div");
      slider.className = "ne-bundle-slider";
      const stage = document.createElement("div");
      stage.className = "ne-bundle-stage";
      const range = document.createElement("input");
      range.type = "range";
      range.min = "0"; range.max = String(items.length - 1); range.value = "0";
      const counter = document.createElement("span");
      counter.className = "ne-bundle-counter";
      const showAt = (i) => {
        stage.innerHTML = "";
        stage.appendChild(makeBundleMedia(items[i], inferPreviewMediaKind(node, node.lastResult?.kind, items[i])));
        counter.textContent = `${i + 1} / ${items.length}`;
      };
      range.addEventListener("input", () => showAt(Number(range.value)));
      showAt(0);
      slider.appendChild(stage);
      const ctrls = document.createElement("div");
      ctrls.className = "ne-bundle-controls";
      ctrls.appendChild(range);
      ctrls.appendChild(counter);
      slider.appendChild(ctrls);
      wrap.appendChild(slider);
    }
    return wrap;
  }

  const value = String(result.value);
  const kind = inferPreviewMediaKind(node, result.kind, value);
  if (kind === "image") {
    wrap.appendChild(makeBundleMedia(value, "image"));
  } else if (kind === "video") {
    wrap.appendChild(makeBundleMedia(value, "video"));
  } else {
    const pre = document.createElement("pre");
    pre.className = "ne-preview-text";
    pre.textContent = value.slice(0, 1200);
    wrap.appendChild(pre);
  }
  return wrap;
}

// Decide how to render a non-bundle preview value: prefer the explicit
// result.kind set by runGraph, then infer from the upstream socket type, and
// finally fall back to the file extension.
function inferPreviewMediaKind(node, resultKind, value) {
  const k = String(resultKind || "").toLowerCase();
  if (k.startsWith("image")) return "image";
  if (k.startsWith("video")) return "video";
  if (k && k !== "any" && k !== "text") {
    if (k === "number" || k === "filepath") return "text";
  }
  // Walk back to whatever feeds the preview's `in` socket.
  const incoming = graph.edges.find((e) => e.toNode === node.id && e.toSocket === "in");
  if (incoming) {
    const srcDef = NODE_BY_TYPE[graph.nodes[incoming.fromNode]?.type];
    const srcSock = srcDef?.outputs?.find((s) => s.id === incoming.fromSocket);
    const t = baseType(srcSock?.type || "");
    if (t === "image" || t === "video") return t;
  }
  if (/\.(mp4|mov|webm|mkv)$/i.test(value)) return "video";
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(value)) return "image";
  return "text";
}

function makeBundleMedia(value, kindHint) {
  const hint = String(kindHint || "");
  // Accept legacy `preview-image` / `preview-video` strings as well as the
  // simple `image`/`video`/`text` kinds emitted by the merged preview.
  const isVideo = hint === "video" || hint === "preview-video" || /\.(mp4|mov|webm|mkv)$/i.test(String(value));
  if (isVideo) {
    const url = artifactURL(String(value));
    const vid = document.createElement("video");
    vid.className = "ne-preview-vid";
    vid.controls = true; vid.muted = true; vid.loop = true;
    vid.preload = "metadata";
    vid.src = url;
    vid.addEventListener("error", () => vid.replaceWith(makeBrokenLabel(value)));
    return vid;
  }
  const url = artifactURL(String(value));
  const img = document.createElement("img");
  img.className = "ne-preview-img";
  img.alt = "preview";
  img.loading = "lazy";
  img.src = url;
  img.addEventListener("error", () => img.replaceWith(makeBrokenLabel(value)));
  return img;
}

function makeBrokenLabel(originalPath) {
  const div = document.createElement("div");
  div.className = "ne-preview-empty";
  div.innerHTML = `<span style="opacity:0.7">artifact not found</span><br><code style="font-size:9.5px;color:var(--whisper);word-break:break-all;">${escHtml(originalPath || "—")}</code>`;
  return div;
}

function artifactURL(pathOrId) {
  // If it looks like a file path inside the project, route through /api/file.
  // Append a cache-busting token so re-runs refresh the displayed image.
  const s = String(pathOrId || "");
  if (!s) return "";
  if (s.startsWith("/api/") || s.startsWith("http")) return s;
  const token = (artifactURL._tokens && artifactURL._tokens[s]) || "";
  return `/api/file?path=${encodeURIComponent(s)}${token ? `&v=${token}` : ""}`;
}
artifactURL._tokens = {};
artifactURL.bump = function (path) {
  if (!path) return;
  artifactURL._tokens[path] = String(Date.now());
};

function getNodeTypeColor(def) {
  const sock = (def.outputs || [])[0] || (def.inputs || [])[0];
  if (sock && SOCKET_TYPES[sock.type]) return SOCKET_TYPES[sock.type].color;
  return SOCKET_TYPES.text.color;
}

function buildSocketRow(nodeId, sock, isInput, opts = {}) {
  const row = document.createElement("div");
  row.className = `ne-socket-row ${isInput ? "is-input" : "is-output"}`;
  if (sock.multi) row.dataset.multi = "true";
  if (opts.isMultiPlaceholder) row.dataset.placeholder = "true";
  if (opts.isPropSocket) row.dataset.propSocket = "true";
  const color = SOCKET_TYPES[sock.type]?.color || "#888";

  const dot = document.createElement("div");
  dot.className = "ne-socket";
  dot.dataset.nodeId = nodeId;
  dot.dataset.socketId = sock.id;
  dot.dataset.socketType = sock.type;
  dot.dataset.isOutput = isInput ? "0" : "1";
  if (opts.edgeId) dot.dataset.edgeId = opts.edgeId;
  if (opts.isMultiPlaceholder) dot.dataset.multiPlaceholder = "1";
  // Mark bundle-producing output sockets so CSS can render them visually
  // distinct (e.g. with a square inner glyph).
  if (!isInput && outputProducesBundle(nodeId, sock.id)) {
    dot.dataset.bundle = "1";
  }
  dot.style.background = color;
  dot.style.color = color;
  dot.title = `${sock.label} (${SOCKET_TYPES[sock.type]?.label || sock.type})`;

  const isConnected = isInput
    ? (opts.edgeId
        ? graph.edges.some((e) => e.id === opts.edgeId)
        : graph.edges.some((e) => e.toNode === nodeId && e.toSocket === sock.id))
    : graph.edges.some((e) => e.fromNode === nodeId && e.fromSocket === sock.id);
  if (isConnected && !opts.isMultiPlaceholder) dot.classList.add("is-connected");

  dot.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (isInput) {
      // If this row maps to a specific edge (multi sockets), pull THAT edge.
      // Otherwise behave as before (single-input replace).
      let existing = null;
      if (opts.edgeId) {
        existing = graph.edges.find((edge) => edge.id === opts.edgeId);
      } else if (!opts.isMultiPlaceholder) {
        const matches = graph.edges.filter((edge) => edge.toNode === nodeId && edge.toSocket === sock.id);
        existing = sock.multi ? matches[matches.length - 1] : matches[0];
      }
      if (existing) {
        graph.edges = graph.edges.filter((edge) => edge.id !== existing.id);
        const fromDef = NODE_BY_TYPE[graph.nodes[existing.fromNode]?.type];
        const fromSockDef = fromDef?.outputs?.find((s) => s.id === existing.fromSocket);
        renderGraph();
        startWire(e, existing.fromNode, existing.fromSocket, fromSockDef?.type || "any", true);
        return;
      }
    }
    startWire(e, nodeId, sock.id, sock.type, !isInput);
  });

  const label = document.createElement("span");
  label.className = "ne-socket-label";
  if (opts.multiIndex && !opts.isMultiPlaceholder) {
    const idx = document.createElement("span");
    idx.className = "ne-socket-index";
    idx.textContent = `${opts.multiIndex}.`;
    row.appendChild(idx);
  }
  label.textContent = opts.isMultiPlaceholder ? `+ add ${sock.label.toLowerCase()}` : sock.label;
  if (opts.isMultiPlaceholder) label.classList.add("is-placeholder");
  if (opts.isPropSocket) label.classList.add("is-prop-socket");

  if (isInput) { row.appendChild(dot); row.appendChild(label); }
  else { row.appendChild(label); row.appendChild(dot); }
  return row;
}

// ─── Connections ──────────────────────────────────────────────────────────────

function renderLoopRegions() {
  const layer = document.getElementById("loopRegions");
  if (!layer) return;
  layer.innerHTML = "";
  // Group decompose / output nodes by loop_id and draw a translucent rect
  // covering both, so users can see "what happens between" a loop pair.
  const groups = {};
  for (const [id, n] of Object.entries(graph.nodes)) {
    if (n.hidden) continue;
    if (n.type !== "loop-decompose" && n.type !== "loop-output") continue;
    const key = String(n.props.loop_id || "loop1");
    (groups[key] ||= { decompose: null, output: null }).hasAny = true;
    if (n.type === "loop-decompose") groups[key].decompose = id;
    else groups[key].output = id;
  }
  const wrapRect = document.getElementById("canvasWrap").getBoundingClientRect();
  for (const [loopId, pair] of Object.entries(groups)) {
    if (!pair.decompose || !pair.output) continue;
    const ids = [pair.decompose, pair.output];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nid of ids) {
      const el = document.querySelector(`[data-node-id="${nid}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x1 = (r.left - wrapRect.left - vp.x) / vp.zoom;
      const y1 = (r.top  - wrapRect.top  - vp.y) / vp.zoom;
      const x2 = (r.right  - wrapRect.left - vp.x) / vp.zoom;
      const y2 = (r.bottom - wrapRect.top  - vp.y) / vp.zoom;
      if (x1 < minX) minX = x1; if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2; if (y2 > maxY) maxY = y2;
    }
    if (!isFinite(minX)) continue;
    const pad = 22;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(minX - pad));
    rect.setAttribute("y", String(minY - pad - 14));
    rect.setAttribute("width",  String(Math.max(60, (maxX - minX) + pad * 2)));
    rect.setAttribute("height", String(Math.max(60, (maxY - minY) + pad * 2 + 14)));
    rect.setAttribute("rx", "12");
    rect.setAttribute("class", "ne-loop-region");
    rect.dataset.loopId = loopId;
    layer.appendChild(rect);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(minX - pad + 10));
    label.setAttribute("y", String(minY - pad - 2));
    label.setAttribute("class", "ne-loop-region-label");
    label.textContent = `loop · ${loopId}`;
    layer.appendChild(label);
  }
}

function renderConnections() {
  // Loop region overlays must update in lock-step with wires.
  renderLoopRegions();
  const g = document.getElementById("connectionEdges");
  g.innerHTML = "";

  for (const edge of graph.edges) {
    // Skip edges where either endpoint is hidden
    if (graph.nodes[edge.fromNode]?.hidden || graph.nodes[edge.toNode]?.hidden) continue;
    const fromPos = getSocketCanvasPos(edge.fromNode, edge.fromSocket, true);
    const toPos = getSocketCanvasPos(edge.toNode, edge.toSocket, false, edge.id);
    if (!fromPos || !toPos) continue;

    const fromDef = NODE_BY_TYPE[graph.nodes[edge.fromNode]?.type];
    const fromSock = fromDef?.outputs?.find((s) => s.id === edge.fromSocket);
    const color = SOCKET_TYPES[fromSock?.type]?.color || "#888";
    const isBundle = outputProducesBundle(edge.fromNode, edge.fromSocket);

    const path = makeBezierPath(fromPos, toPos);
    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", path);
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", isBundle ? "2.6" : "2.2");
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke-linecap", "round");
    if (isBundle) pathEl.setAttribute("stroke-dasharray", "6 4");
    pathEl.dataset.edgeId = edge.id;
    pathEl.style.opacity = "0.92";
    pathEl.style.cursor = "pointer";
    pathEl.style.pointerEvents = "stroke";
    pathEl.addEventListener("click", (e) => {
      e.stopPropagation();
      removeEdge(edge.id);
    });
    g.appendChild(pathEl);
  }
}

function getSocketCanvasPos(nodeId, socketId, isOutput, edgeId) {
  let dot = null;
  if (!isOutput && edgeId) {
    dot = document.querySelector(
      `[data-node-id="${nodeId}"] [data-socket-id="${socketId}"][data-edge-id="${edgeId}"]`
    );
  }
  if (!dot) {
    // Prefer non-placeholder dot.
    const all = document.querySelectorAll(
      `[data-node-id="${nodeId}"] [data-socket-id="${socketId}"][data-is-output="${isOutput ? "1" : "0"}"]`
    );
    for (const el of all) {
      if (!el.dataset.multiPlaceholder) { dot = el; break; }
    }
    if (!dot && all.length) dot = all[0];
  }
  if (!dot) return null;
  const dotRect = dot.getBoundingClientRect();
  const wrapRect = document.getElementById("canvasWrap").getBoundingClientRect();
  const sx = dotRect.left + dotRect.width / 2;
  const sy = dotRect.top + dotRect.height / 2;
  return {
    x: (sx - wrapRect.left - vp.x) / vp.zoom,
    y: (sy - wrapRect.top - vp.y) / vp.zoom,
  };
}

function makeBezierPath(from, to) {
  const dx = Math.max(Math.abs(to.x - from.x) * 0.5, 60);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y} ${to.x - dx} ${to.y} ${to.x} ${to.y}`;
}

// ─── Wire (drag from socket) ──────────────────────────────────────────────────

function startWire(e, nodeId, socketId, socketType, isFromOutput) {
  const pos = getSocketCanvasPos(nodeId, socketId, isFromOutput);
  if (!pos) return;
  ix.wire = { fromNode: nodeId, fromSocket: socketId, fromType: socketType, isOutput: isFromOutput, startX: pos.x, startY: pos.y };
  updateWireDraft(pos.x, pos.y, pos.x, pos.y);
  document.getElementById("wireDraft").style.display = "";
  highlightCompatibleSockets(socketType, isFromOutput);
}

function updateWireDraft(fromX, fromY, toX, toY) {
  const draft = document.getElementById("wireDraft");
  draft.setAttribute("d", makeBezierPath({ x: fromX, y: fromY }, { x: toX, y: toY }));
}

function highlightCompatibleSockets(fromType, fromIsOutput) {
  document.querySelectorAll(".ne-socket").forEach((dot) => {
    const dotIsOutput = dot.dataset.isOutput === "1";
    if (fromIsOutput !== dotIsOutput && canConnect(fromType, dot.dataset.socketType)) {
      dot.classList.add("is-compatible");
    }
  });
}

function clearCompatibleHighlights() {
  document.querySelectorAll(".ne-socket.is-compatible").forEach((el) => el.classList.remove("is-compatible"));
}

function endWire(targetNodeId, targetSocketId, targetType, targetIsOutput) {
  const w = ix.wire;
  ix.wire = null;
  clearCompatibleHighlights();
  document.getElementById("wireDraft").style.display = "none";
  document.getElementById("wireDraft").setAttribute("d", "");
  if (!w) return;
  if (w.isOutput === targetIsOutput) return;
  if (!canConnect(w.fromType, targetType)) return;

  if (w.isOutput) {
    addEdge(w.fromNode, w.fromSocket, targetNodeId, targetSocketId);
  } else {
    addEdge(targetNodeId, targetSocketId, w.fromNode, w.fromSocket);
  }
}

// ─── Lazy-connect (Alt+RightClick drag, Node Wrangler style) ─────────────────

function pickAutoConnectPair(fromNode, toNode) {
  const fromDef = NODE_BY_TYPE[graph.nodes[fromNode]?.type];
  const toDef = NODE_BY_TYPE[graph.nodes[toNode]?.type];
  if (!fromDef || !toDef) return null;
  for (const out of fromDef.outputs || []) {
    for (const inp of toDef.inputs || []) {
      if (canConnect(out.type, inp.type)) {
        const exists = graph.edges.some(
          (e) => !inp.multi && e.toNode === toNode && e.toSocket === inp.id
        );
        if (!exists) return { fromSocket: out.id, toSocket: inp.id };
      }
    }
  }
  return null;
}

function startLazyConnect(e, fromNodeId) {
  const fromNode = graph.nodes[fromNodeId];
  if (!fromNode) return;
  // Start the wire at the node's right edge midpoint.
  const startX = fromNode.x + (fromNode.width || 220);
  const startY = fromNode.y + 40;
  ix.lazyConnect = { fromNode: fromNodeId, startX, startY };
  ix.wire = { fromNode: fromNodeId, fromSocket: null, fromType: "any", isOutput: true, startX, startY };
  updateWireDraft(startX, startY, startX, startY);
  document.getElementById("wireDraft").style.display = "";
}

function endLazyConnect(e) {
  const lazy = ix.lazyConnect;
  ix.lazyConnect = null;
  ix.wire = null;
  document.getElementById("wireDraft").style.display = "none";
  document.getElementById("wireDraft").setAttribute("d", "");
  if (!lazy) return;
  // Find target node under cursor.
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const nodeEl = target?.closest(".ne-node");
  if (!nodeEl) return;
  const toNodeId = nodeEl.dataset.nodeId;
  if (!toNodeId || toNodeId === lazy.fromNode) return;
  const pair = pickAutoConnectPair(lazy.fromNode, toNodeId);
  if (!pair) {
    setHint("no compatible sockets");
    setTimeout(clearHint, 1200);
    return;
  }
  addEdge(lazy.fromNode, pair.fromSocket, toNodeId, pair.toSocket);
  setHint(`connected ${pair.fromSocket} \u2192 ${pair.toSocket}`);
  setTimeout(clearHint, 1200);
}

function cancelWire() {
  ix.wire = null;
  clearCompatibleHighlights();
  const draft = document.getElementById("wireDraft");
  draft.style.display = "none";
  draft.setAttribute("d", "");
}

// ─── Node dragging ───────────────────────────────────────────────────────────

function startNodeDrag(e, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  ix.draggingNode = nodeId;
  const c = screenToCanvas(e.clientX, e.clientY);
  ix.dragOffsetX = c.x - node.x;
  ix.dragOffsetY = c.y - node.y;
  if (!ix.selection.has(nodeId)) selectOnly(nodeId);
}

// ─── Node resize ─────────────────────────────────────────────────────────────

function startNodeResize(e, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  ix.resizing = {
    nodeId,
    startMouse: { x: e.clientX, y: e.clientY },
    startW: node.width || 260,
    startH: node.height || 220,
  };
  document.body.classList.add("is-resizing");
}

// ─── Modal transforms (Blender G/R/S) ─────────────────────────────────────────

function startModal(kind) {
  if (ix.selection.size === 0) {
    setHint("Select nodes first");
    return;
  }
  const snapshots = new Map();
  let cx = 0, cy = 0, n = 0;
  for (const id of ix.selection) {
    const node = graph.nodes[id];
    if (!node) continue;
    snapshots.set(id, { x: node.x, y: node.y });
    cx += node.x; cy += node.y; n++;
  }
  if (n === 0) return;
  cx /= n; cy /= n;

  ix.modal = {
    kind,
    startMouse: screenToCanvas(ix.lastMouseScreen.x, ix.lastMouseScreen.y),
    snapshots,
    pivot: { x: cx, y: cy },
    axis: null,           // "x" or "y"
  };
  setModalHint(kind);
  document.body.classList.add("is-modal");
}

function updateModal(e) {
  const m = ix.modal;
  if (!m) return;
  const cur = screenToCanvas(e.clientX, e.clientY);
  const dx = cur.x - m.startMouse.x;
  const dy = cur.y - m.startMouse.y;

  if (m.kind === "G") {
    let useX = dx, useY = dy;
    if (m.axis === "x") useY = 0;
    if (m.axis === "y") useX = 0;
    if (e.ctrlKey || e.metaKey) {
      // Snap to 20px grid
      useX = Math.round(useX / 20) * 20;
      useY = Math.round(useY / 20) * 20;
    }
    for (const [id, snap] of m.snapshots) {
      const node = graph.nodes[id];
      if (!node) continue;
      node.x = snap.x + useX;
      node.y = snap.y + useY;
    }
  } else if (m.kind === "S") {
    const distStart = Math.hypot(m.startMouse.x - m.pivot.x, m.startMouse.y - m.pivot.y) || 1;
    const distNow = Math.hypot(cur.x - m.pivot.x, cur.y - m.pivot.y);
    const factor = distNow / distStart;
    for (const [id, snap] of m.snapshots) {
      const node = graph.nodes[id];
      if (!node) continue;
      node.x = m.pivot.x + (snap.x - m.pivot.x) * factor;
      node.y = m.pivot.y + (snap.y - m.pivot.y) * factor;
    }
  } else if (m.kind === "R") {
    const startA = Math.atan2(m.startMouse.y - m.pivot.y, m.startMouse.x - m.pivot.x);
    const nowA = Math.atan2(cur.y - m.pivot.y, cur.x - m.pivot.x);
    const da = nowA - startA;
    const cosA = Math.cos(da), sinA = Math.sin(da);
    for (const [id, snap] of m.snapshots) {
      const node = graph.nodes[id];
      if (!node) continue;
      const rx = snap.x - m.pivot.x;
      const ry = snap.y - m.pivot.y;
      node.x = m.pivot.x + rx * cosA - ry * sinA;
      node.y = m.pivot.y + rx * sinA + ry * cosA;
    }
  }
  renderNodes();
  renderConnections();
}

function commitModal() {
  if (!ix.modal) return;
  ix.modal = null;
  document.body.classList.remove("is-modal");
  clearHint();
  scheduleAutosave();
}

function cancelModal() {
  if (!ix.modal) return;
  for (const [id, snap] of ix.modal.snapshots) {
    const node = graph.nodes[id];
    if (!node) continue;
    node.x = snap.x; node.y = snap.y;
  }
  ix.modal = null;
  document.body.classList.remove("is-modal");
  clearHint();
  renderNodes();
  renderConnections();
}

function setModalHint(kind) {
  const labels = { G: "Grab/move — LMB confirm · RMB/Esc cancel · X/Y constrain · Ctrl snap",
                   S: "Scale — LMB confirm · RMB/Esc cancel",
                   R: "Rotate — LMB confirm · RMB/Esc cancel" };
  setHint(labels[kind] || "");
}

function setHint(text) {
  const el = document.getElementById("modalHint");
  if (!el) return;
  el.textContent = text;
  el.style.display = text ? "" : "none";
}

function clearHint() { setHint(""); }

// ─── Canvas mouse events ─────────────────────────────────────────────────────

function onCanvasMousedown(e) {
  const wrap = document.getElementById("canvasWrap");
  if (e.target.closest(".ne-node")) return;
  if (e.target.classList.contains("ne-socket")) return;

  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    ix.panning = true;
    ix.panStartX = e.clientX; ix.panStartY = e.clientY;
    ix.panVpX = vp.x; ix.panVpY = vp.y;
    wrap.classList.add("is-panning");
    e.preventDefault();
    return;
  }

  // Ctrl+RMB → cut tool
  if (e.button === 2 && (e.ctrlKey || e.metaKey)) {
    const c = screenToCanvas(e.clientX, e.clientY);
    ix.cutting = { points: [c] };
    e.preventDefault();
    return;
  }

  if (e.button === 0) {
    const c = screenToCanvas(e.clientX, e.clientY);
    ix.boxStart = { canvasX: c.x, canvasY: c.y, screenX: e.clientX, screenY: e.clientY };
    if (!e.shiftKey) {
      ix.selection.clear();
      updateSelectionVisuals();
      renderProps(null);
    }
  }
}

function onMousemove(e) {
  ix.lastMouseScreen = { x: e.clientX, y: e.clientY };
  ix.lastMouseCanvas = screenToCanvas(e.clientX, e.clientY);

  if (ix.modal) { updateModal(e); return; }

  if (ix.resizing) {
    const r = ix.resizing;
    const node = graph.nodes[r.nodeId];
    if (node) {
      const dx = (e.clientX - r.startMouse.x) / vp.zoom;
      const dy = (e.clientY - r.startMouse.y) / vp.zoom;
      node.width = Math.max(180, Math.round(r.startW + dx));
      node.height = Math.max(140, Math.round(r.startH + dy));
      const el = document.querySelector(`[data-node-id="${r.nodeId}"]`);
      if (el) {
        el.style.width = `${node.width}px`;
        el.style.minHeight = `${node.height}px`;
        const content = el.querySelector(".ne-preview-content");
        if (content) content.style.minHeight = `${Math.max(60, node.height - 110)}px`;
      }
      renderConnections();
    }
    return;
  }

  if (ix.panning) {
    vp.x = ix.panVpX + (e.clientX - ix.panStartX);
    vp.y = ix.panVpY + (e.clientY - ix.panStartY);
    applyViewport();
    renderConnections();
    return;
  }

  if (ix.draggingNode) {
    const pos = screenToCanvas(e.clientX, e.clientY);
    const node = graph.nodes[ix.draggingNode];
    if (node) {
      const dx = (pos.x - ix.dragOffsetX) - node.x;
      const dy = (pos.y - ix.dragOffsetY) - node.y;
      // Move all selected together.
      const movedSet = ix.selection.has(ix.draggingNode) ? ix.selection : new Set([ix.draggingNode]);
      for (const id of movedSet) {
        const n = graph.nodes[id];
        if (!n) continue;
        n.x += dx; n.y += dy;
      }
      // If a moved node is a collapsed preview, drag the upstream nodes it
      // owns by the same delta so they stay in their stored relative
      // positions when the preview is expanded later.
      for (const id of movedSet) {
        const n = graph.nodes[id];
        if (!n || !PREVIEW_TYPES.has(n.type) || !n.collapsed) continue;
        const upstream = getUpstreamNodes(id);
        upstream.delete(id);
        for (const upId of upstream) {
          if (movedSet.has(upId)) continue; // avoid double-move
          const up = graph.nodes[upId];
          if (!up) continue;
          up.x += dx; up.y += dy;
        }
      }
      renderNodes();
      renderConnections();
    }
    return;
  }

  if (ix.wire) {
    const pos = screenToCanvas(e.clientX, e.clientY);
    updateWireDraft(ix.wire.startX, ix.wire.startY, pos.x, pos.y);
    // Lazy-connect: also highlight the node under the cursor.
    if (ix.lazyConnect) {
      document.querySelectorAll(".ne-node.is-lazy-target").forEach((el) => el.classList.remove("is-lazy-target"));
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = target?.closest(".ne-node");
      if (nodeEl && nodeEl.dataset.nodeId !== ix.lazyConnect.fromNode) {
        nodeEl.classList.add("is-lazy-target");
      }
    }
    return;
  }

  if (ix.cutting) {
    const c = screenToCanvas(e.clientX, e.clientY);
    ix.cutting.points.push(c);
    drawCutPath();
    return;
  }

  if (ix.boxStart) {
    const wrapRect = document.getElementById("canvasWrap").getBoundingClientRect();
    const x = Math.min(e.clientX, ix.boxStart.screenX) - wrapRect.left;
    const y = Math.min(e.clientY, ix.boxStart.screenY) - wrapRect.top;
    const w = Math.abs(e.clientX - ix.boxStart.screenX);
    const h = Math.abs(e.clientY - ix.boxStart.screenY);
    const box = document.getElementById("boxSelect");
    box.style.display = "";
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
  }
}

function onMouseup(e) {
  const wrap = document.getElementById("canvasWrap");

  if (ix.resizing) {
    ix.resizing = null;
    document.body.classList.remove("is-resizing");
    scheduleAutosave();
    return;
  }

  if (ix.panning) {
    ix.panning = false;
    wrap.classList.remove("is-panning");
    return;
  }

  if (ix.draggingNode) {
    ix.draggingNode = null;
    scheduleAutosave();
    return;
  }

  if (ix.wire) {
    // Lazy-connect releases use elementFromPoint over a node body, not a socket.
    if (ix.lazyConnect) {
      document.querySelectorAll(".ne-node.is-lazy-target").forEach((el) => el.classList.remove("is-lazy-target"));
      endLazyConnect(e);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el.classList.contains("ne-socket")) {
      endWire(el.dataset.nodeId, el.dataset.socketId, el.dataset.socketType, el.dataset.isOutput === "1");
    } else {
      // Released on empty canvas → spawn add menu, remember pending wire
      showAddMenu(e.clientX, e.clientY);
    }
    return;
  }

  if (ix.cutting) {
    finishCut();
    return;
  }

  if (ix.boxStart) {
    document.getElementById("boxSelect").style.display = "none";
    const startCanvas = { x: ix.boxStart.canvasX, y: ix.boxStart.canvasY };
    const endCanvas = screenToCanvas(e.clientX, e.clientY);
    const minX = Math.min(startCanvas.x, endCanvas.x);
    const maxX = Math.max(startCanvas.x, endCanvas.x);
    const minY = Math.min(startCanvas.y, endCanvas.y);
    const maxY = Math.max(startCanvas.y, endCanvas.y);
    const movedEnough = Math.abs(e.clientX - ix.boxStart.screenX) > 4 || Math.abs(e.clientY - ix.boxStart.screenY) > 4;
    if (movedEnough) {
      for (const [id, node] of Object.entries(graph.nodes)) {
        if (node.hidden) continue;
        const def = NODE_BY_TYPE[node.type];
        if (!def) continue;
        const w = node.width || 220;
        const h = 40 + (def.inputs.length + def.outputs.length) * 28;
        if (node.x < maxX && node.x + w > minX && node.y < maxY && node.y + h > minY) {
          ix.selection.add(id);
        }
      }
      updateSelectionVisuals();
      if (ix.selection.size === 1) renderProps([...ix.selection][0]);
    }
    ix.boxStart = null;
  }
}

function onCanvasWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const wrapRect = document.getElementById("canvasWrap").getBoundingClientRect();
  const cx = e.clientX - wrapRect.left;
  const cy = e.clientY - wrapRect.top;
  vp.x = cx - (cx - vp.x) * factor;
  vp.y = cy - (cy - vp.y) * factor;
  vp.zoom = Math.min(4, Math.max(0.1, vp.zoom * factor));
  applyViewport();
  renderConnections();
}

// ─── Cut tool (Ctrl+RMB drag across edges) ────────────────────────────────────

function drawCutPath() {
  if (!ix.cutting) return;
  const path = document.getElementById("cutPath");
  if (ix.cutting.points.length < 2) { path.style.display = "none"; return; }
  path.style.display = "";
  const d = ix.cutting.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  path.setAttribute("d", d);
}

function finishCut() {
  const pts = ix.cutting?.points || [];
  ix.cutting = null;
  document.getElementById("cutPath").style.display = "none";
  if (pts.length < 2) return;

  const toRemove = [];
  for (const edge of graph.edges) {
    if (graph.nodes[edge.fromNode]?.hidden || graph.nodes[edge.toNode]?.hidden) continue;
    const fromPos = getSocketCanvasPos(edge.fromNode, edge.fromSocket, true);
    const toPos = getSocketCanvasPos(edge.toNode, edge.toSocket, false);
    if (!fromPos || !toPos) continue;
    // Approximate: sample bezier in 16 segments and test against cut polyline
    if (intersectsBezier(fromPos, toPos, pts)) toRemove.push(edge.id);
  }
  if (toRemove.length > 0) {
    graph.edges = graph.edges.filter((e) => !toRemove.includes(e.id));
    renderGraph();
    scheduleAutosave();
    setHint(`cut ${toRemove.length} link${toRemove.length > 1 ? "s" : ""}`);
    setTimeout(clearHint, 1500);
  }
}

function intersectsBezier(from, to, polyline) {
  const dx = Math.max(Math.abs(to.x - from.x) * 0.5, 60);
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  const sample = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    const x = u*u*u*from.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*to.x;
    const y = u*u*u*from.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*to.y;
    sample.push({ x, y });
  }
  for (let i = 0; i < sample.length - 1; i++) {
    for (let j = 0; j < polyline.length - 1; j++) {
      if (segmentsIntersect(sample[i], sample[i+1], polyline[j], polyline[j+1])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  function ccw(p, q, r) { return (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x); }
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────

function onKeydown(e) {
  const tag = document.activeElement?.tagName;
  const inInput = (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && document.activeElement.id !== "addMenuSearch";
  if (inInput) {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }

  // Modal-active key handling
  if (ix.modal) {
    if (e.key === "Escape") { cancelModal(); e.preventDefault(); return; }
    if (e.key === "Enter") { commitModal(); e.preventDefault(); return; }
    if (e.key === "x" || e.key === "X") { ix.modal.axis = ix.modal.axis === "x" ? null : "x"; e.preventDefault(); return; }
    if (e.key === "y" || e.key === "Y") { ix.modal.axis = ix.modal.axis === "y" ? null : "y"; e.preventDefault(); return; }
    return;
  }

  // Add-menu open
  const addMenu = document.getElementById("addMenu");
  if (addMenu.style.display !== "none" && e.key === "Escape") {
    hideAddMenu(); e.preventDefault(); return;
  }

  if (e.key === "Escape") {
    cancelWire();
    return;
  }

  // Shift+A → add menu at cursor
  if ((e.key === "A" || e.key === "a") && e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    showAddMenu(ix.lastMouseScreen.x, ix.lastMouseScreen.y);
    return;
  }

  // G / S — modal transforms (R freed for runs panel toggle below; rotation
  // wasn't meaningful for a 2D node graph)
  if ((e.key === "g" || e.key === "G") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    startModal("G");
    return;
  }
  if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    startModal("S");
    return;
  }

  // T / P / R — panel toggles (palette, properties, runs)
  if ((e.key === "t" || e.key === "T") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    togglePanel("palette");
    return;
  }
  if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    togglePanel("props");
    return;
  }
  if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    togglePanel("runs");
    return;
  }

  // Ctrl+X — cut selected nodes (copy JSON payload, then remove)
  if ((e.key === "x" || e.key === "X") && (e.ctrlKey || e.metaKey) && !e.altKey) {
    e.preventDefault();
    cutSelectionToClipboard();
    return;
  }

  // Delete — remove selected nodes without touching the clipboard
  if (e.key === "Delete") {
    if (ix.selection.size > 0) {
      e.preventDefault();
      removeSelectedNodes();
    }
    return;
  }

  // A — select all (Blender uses A as toggle, not Ctrl+A)
  if ((e.key === "a") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (ix.selection.size === Object.keys(graph.nodes).length) {
      ix.selection.clear();
    } else {
      ix.selection = new Set(Object.keys(graph.nodes).filter((id) => !graph.nodes[id].hidden));
    }
    updateSelectionVisuals();
    return;
  }

  // Shift+D — duplicate
  if ((e.key === "D" || e.key === "d") && e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    duplicateSelection();
    return;
  }

  // Home / Numpad . — frame all
  if (e.key === "Home") {
    e.preventDefault();
    frameAll();
    return;
  }

  // F — auto-connect two selected nodes (Node Wrangler style)
  if ((e.key === "f" || e.key === "F") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    autoConnectSelected();
    return;
  }

  // Alt+P — preview from selected (Node Wrangler style)
  if ((e.key === "p" || e.key === "P") && e.altKey) {
    e.preventDefault();
    previewSelected();
    return;
  }

  // Ctrl+S — save to file
  if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveGraphToFile();
    return;
  }

  // Ctrl+O — load from file
  if ((e.key === "o" || e.key === "O") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById("loadGraphFile").click();
    return;
  }
}

function duplicateSelection() {
  // Snapshot the original selection IDs before mutating ix.selection.
  // Iterating a Set we keep adding to (via addNode → selectOnly) caused an
  // infinite loop and crashed the tab.
  const sourceIds = [...ix.selection];
  const offset = 24;
  const newIds = [];
  const idMap = {};
  for (const id of sourceIds) {
    const node = graph.nodes[id];
    if (!node) continue;
    const newId = addNode(node.type, node.x + offset, node.y + offset, { skipSelect: true });
    if (!newId) continue;
    const newNode = graph.nodes[newId];
    newNode.props = JSON.parse(JSON.stringify(node.props || {}));
    newNode.width = node.width;
    newNode.height = node.height;
    newIds.push(newId);
    idMap[id] = newId;
  }
  // Duplicate edges that lie entirely inside the selection.
  for (const e of graph.edges) {
    if (idMap[e.fromNode] && idMap[e.toNode]) {
      graph.edges.push({
        id: genEdgeId(),
        fromNode: idMap[e.fromNode], fromSocket: e.fromSocket,
        toNode: idMap[e.toNode], toSocket: e.toSocket,
      });
    }
  }
  ix.selection = new Set(newIds);
  renderGraph();
  updateSelectionVisuals();
  if (newIds.length > 0) renderProps(newIds[0]);
  scheduleAutosave();
  // Enter modal grab so the duplicates follow cursor (Blender-like).
  startModal("G");
}

function buildSelectionClipboardPayload(ids) {
  const selected = ids.filter((id) => graph.nodes[id]);
  if (selected.length === 0) return null;
  const selectedSet = new Set(selected);
  const nodes = {};
  for (const id of selected) {
    nodes[id] = JSON.parse(JSON.stringify(graph.nodes[id]));
  }
  const edges = graph.edges
    .filter((edge) => selectedSet.has(edge.fromNode) && selectedSet.has(edge.toNode))
    .map((edge) => ({ ...edge }));
  return { kind: "rundeer-node-selection", version: 1, nodes, edges };
}

function cutSelectionToClipboard() {
  const ids = [...ix.selection];
  const payload = buildSelectionClipboardPayload(ids);
  if (!payload) return;
  const text = JSON.stringify(payload, null, 2);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  const removed = removeSelectedNodes();
  setHint(`cut ${removed} node${removed === 1 ? "" : "s"}`);
  setTimeout(clearHint, 1400);
}

// ─── Panel toggles (T/P/R) ───────────────────────────────────────────────────

function togglePanel(which) {
  const shell = document.querySelector(".ne-shell");
  if (!shell) return;
  if (which === "palette") {
    shell.classList.toggle("hide-palette");
    setHint(shell.classList.contains("hide-palette") ? "palette hidden (T)" : "palette shown (T)");
  } else if (which === "props") {
    shell.classList.toggle("hide-props");
    setHint(shell.classList.contains("hide-props") ? "properties hidden (P)" : "properties shown (P)");
  } else if (which === "runs") {
    const panel = document.getElementById("runsPanel");
    if (panel) {
      panel.classList.toggle("is-open");
      setHint(panel.classList.contains("is-open") ? "runs panel open (R)" : "runs panel closed (R)");
      if (panel.classList.contains("is-open") && window.refreshRunsList) window.refreshRunsList();
    }
  }
  setTimeout(clearHint, 1200);
}

function autoConnectSelected() {
  const ids = [...ix.selection];
  if (ids.length !== 2) {
    setHint("F: select exactly 2 nodes to auto-connect");
    setTimeout(clearHint, 1500);
    return;
  }
  let [a, b] = ids;
  // Order: leftmost = source
  if (graph.nodes[a].x > graph.nodes[b].x) [a, b] = [b, a];
  const aDef = NODE_BY_TYPE[graph.nodes[a].type];
  const bDef = NODE_BY_TYPE[graph.nodes[b].type];
  let connected = 0;
  for (const out of aDef.outputs || []) {
    for (const inp of bDef.inputs || []) {
      if (canConnect(out.type, inp.type)) {
        const exists = graph.edges.some((e) => e.toNode === b && e.toSocket === inp.id);
        if (!exists) { addEdge(a, out.id, b, inp.id); connected++; break; }
      }
    }
  }
  setHint(connected ? `connected ${connected} link${connected > 1 ? "s" : ""}` : "no compatible sockets");
  setTimeout(clearHint, 1500);
}

function previewSelected() {
  if (ix.selection.size === 0) return;
  for (const id of ix.selection) {
    const node = graph.nodes[id];
    if (!node) continue;
    const def = NODE_BY_TYPE[node.type];
    const out = def?.outputs?.[0];
    if (!out) continue;
    const newId = addNode("preview", node.x + (node.width || 220) + 40, node.y);
    if (newId) addEdge(id, out.id, newId, "in");
  }
}

// ─── Frame all ───────────────────────────────────────────────────────────────

function frameAll() {
  const nodes = Object.values(graph.nodes).filter((n) => !n.hidden);
  const wrap = document.getElementById("canvasWrap");
  const wrapRect = wrap.getBoundingClientRect();

  if (nodes.length === 0) {
    vp.x = 0; vp.y = 0; vp.zoom = 1;
    applyViewport(); renderConnections();
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const def = NODE_BY_TYPE[n.type];
    const w = n.width || 220;
    const h = 40 + ((def?.inputs?.length || 0) + (def?.outputs?.length || 0)) * 28 + 16;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }

  const padding = 80;
  const contentW = maxX - minX + padding * 2;
  const contentH = maxY - minY + padding * 2;
  const scaleX = wrapRect.width / contentW;
  const scaleY = wrapRect.height / contentH;
  vp.zoom = Math.min(1.5, Math.max(0.1, Math.min(scaleX, scaleY)));
  vp.x = (wrapRect.width - (maxX - minX) * vp.zoom) / 2 - minX * vp.zoom;
  vp.y = (wrapRect.height - (maxY - minY) * vp.zoom) / 2 - minY * vp.zoom;
  applyViewport();
  renderConnections();
}

// ─── Add menu (Shift+A / drop on empty canvas) ────────────────────────────────

let pendingWireForMenu = null;
let addMenuCanvasPos = null;

function showAddMenu(screenX, screenY) {
  pendingWireForMenu = ix.wire ? { ...ix.wire } : null;
  ix.wire = null;
  document.getElementById("wireDraft").style.display = "none";
  clearCompatibleHighlights();

  addMenuCanvasPos = screenToCanvas(screenX, screenY);

  const menu = document.getElementById("addMenu");
  menu.style.display = "";
  // Position with bounds clamping
  const menuW = 240, menuH = 380;
  const left = Math.min(Math.max(8, screenX), window.innerWidth - menuW - 8);
  const top = Math.min(Math.max(8, screenY), window.innerHeight - menuH - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const search = document.getElementById("addMenuSearch");
  search.value = "";
  renderAddMenuList("");
  search.focus();

  search.oninput = () => renderAddMenuList(search.value.trim().toLowerCase());
  search.onkeydown = (e) => {
    if (e.key === "Escape") { hideAddMenu(); return; }
    const items = [...document.querySelectorAll(".ne-add-menu-item")];
    const active = document.querySelector(".ne-add-menu-item.is-active");
    const idx = active ? items.indexOf(active) : -1;
    if (e.key === "ArrowDown") {
      if (idx < items.length - 1) { active?.classList.remove("is-active"); items[idx + 1]?.classList.add("is-active"); items[idx + 1]?.scrollIntoView({ block: "nearest" }); }
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      if (idx > 0) { active?.classList.remove("is-active"); items[idx - 1]?.classList.add("is-active"); items[idx - 1]?.scrollIntoView({ block: "nearest" }); }
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (active) active.click();
      e.preventDefault();
    }
  };
}

function renderAddMenuList(query) {
  const list = document.getElementById("addMenuList");
  list.innerHTML = "";
  let firstItem = null;
  for (const cat of paletteCategoriesForDisplay()) {
    const matching = cat.nodes.filter((n) => !query || n.label.toLowerCase().includes(query) || n.type.includes(query) || n.desc.toLowerCase().includes(query));
    if (matching.length === 0) continue;

    const section = document.createElement("div");
    section.className = "ne-add-menu-section";
    const title = document.createElement("div");
    title.className = "ne-add-menu-section-title";
    title.textContent = cat.category;
    section.appendChild(title);

    for (const nodeDef of matching) {
      const sockType = nodeDef.outputs?.[0]?.type || nodeDef.inputs?.[0]?.type || "text";
      const color = SOCKET_TYPES[sockType]?.color || "#888";
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ne-add-menu-item";
      item.title = nodeDef.desc;
      item.innerHTML = `<span class="ne-add-menu-dot" style="background:${color}"></span>${escHtml(nodeDef.label)}`;
      item.addEventListener("click", () => {
        const pos = addMenuCanvasPos || screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
        const newId = addNode(nodeDef.type, pos.x - 110, pos.y - 30);
        if (newId && pendingWireForMenu) {
          const w = pendingWireForMenu;
          // For the synthetic "loop" entry resolve to the real node type
          // of the created anchor node.
          const realType = graph.nodes[newId]?.type || nodeDef.type;
          const def = NODE_BY_TYPE[realType];
          if (w.isOutput) {
            const compat = def?.inputs?.find((s) => canConnect(w.fromType, s.type));
            if (compat) addEdge(w.fromNode, w.fromSocket, newId, compat.id);
          } else {
            const compat = def?.outputs?.find((s) => canConnect(w.fromType, s.type));
            if (compat) addEdge(newId, compat.id, w.fromNode, w.fromSocket);
          }
        }
        pendingWireForMenu = null;
        hideAddMenu();
      });
      if (!firstItem) { firstItem = item; item.classList.add("is-active"); }
      section.appendChild(item);
    }
    list.appendChild(section);
  }
}

function hideAddMenu() {
  document.getElementById("addMenu").style.display = "none";
  pendingWireForMenu = null;
  cancelWire();
}

// ─── Properties panel ────────────────────────────────────────────────────────

function renderProps(nodeId) {
  const body = document.getElementById("propsBody");
  const nameEl = document.getElementById("propsNodeName");
  body.innerHTML = "";

  if (!nodeId || !graph.nodes[nodeId]) {
    nameEl.textContent = "— select a node —";
    body.innerHTML = `<div class="ne-props-empty">
      Click a node to inspect its properties.<br><br>
      <span class="ne-shortcuts">
        <b>Shift+A</b> add node · <b>Ctrl+X</b> cut · <b>Delete</b> remove<br>
        <b>G</b> grab · <b>R</b> rotate · <b>S</b> scale<br>
        <b>F</b> auto-connect · <b>Alt+P</b> preview<br>
        <b>Shift+D</b> duplicate · <b>A</b> select all<br>
        <b>Home</b> frame all · <b>Ctrl+S</b> save<br>
        <b>Ctrl+RMB drag</b> cut links<br>
        <b>MMB / Alt+LMB drag</b> pan · <b>Wheel</b> zoom
      </span>
    </div>`;
    return;
  }

  const node = graph.nodes[nodeId];
  const def = NODE_BY_TYPE[node.type];
  if (!def) return;
  nameEl.textContent = def.label;

  // Sockets summary
  const sockSection = document.createElement("div");
  sockSection.className = "ne-props-section";
  sockSection.innerHTML = `<p class="ne-props-section-title">sockets</p>`;
  for (const sock of [...(def.inputs || []), ...(def.outputs || [])]) {
    const isIn = (def.inputs || []).includes(sock);
    const row = document.createElement("div");
    row.className = "ne-props-socket-row";
    row.innerHTML = `
      <span class="ne-props-dot" style="background:${SOCKET_TYPES[sock.type]?.color || "#888"}"></span>
      <span>${isIn ? "↦" : "↤"} ${escHtml(sock.label)}</span>
      <span class="ne-props-type">${escHtml(SOCKET_TYPES[sock.type]?.label || sock.type)}</span>`;
    sockSection.appendChild(row);
  }
  body.appendChild(sockSection);

  // Props
  if ((def.props || []).length > 0) {
    const divider = document.createElement("div");
    divider.className = "ne-props-divider";
    body.appendChild(divider);
    for (const propDef of def.props) {
      body.appendChild(buildPropControl(nodeId, propDef, node.props[propDef.id]));
    }
  }

  // Last result
  if (node.lastResult) {
    const divider = document.createElement("div");
    divider.className = "ne-props-divider";
    body.appendChild(divider);
    const result = document.createElement("div");
    result.className = "ne-props-section";
    result.innerHTML = `<p class="ne-props-section-title">last result</p>
      <pre class="ne-props-result">${escHtml(String(node.lastResult.value || "").slice(0, 800))}</pre>`;
    body.appendChild(result);
  }
}

function buildPropControl(nodeId, propDef, currentValue) {
  const wrap = document.createElement("div");
  wrap.className = "ne-prop";

  // If a socket-edge feeds this prop, the control becomes read-only and is
  // visually muted to make clear the value is coming from upstream.
  const isWired = graph.edges.some(
    (e) => e.toNode === nodeId && e.toSocket === propDef.id
  );
  if (isWired) wrap.classList.add("is-disabled");

  if (propDef.kind === "checkbox") {
    const label = document.createElement("label");
    label.className = "ne-prop-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = Boolean(currentValue);
    cb.addEventListener("change", () => {
      graph.nodes[nodeId].props[propDef.id] = cb.checked;
      if (propDef.id === "collapse_upstream") renderGraph();
      scheduleAutosave();
      schedulePreviewRefresh();
    });
    const span = document.createElement("span");
    span.className = "ne-prop-label";
    span.textContent = propDef.label;
    label.appendChild(cb);
    label.appendChild(span);
    wrap.appendChild(label);
    return wrap;
  }

  const lbl = document.createElement("label");
  lbl.className = "ne-prop-label";
  lbl.textContent = propDef.label;
  wrap.appendChild(lbl);

  let control;
  let valueDisplay = null;
  if (propDef.kind === "textarea") {
    control = document.createElement("textarea");
    control.rows = 3;
  } else if (propDef.kind === "select") {
    control = document.createElement("select");
    for (const opt of propDef.options || []) {
      const o = document.createElement("option");
      o.value = opt; o.textContent = opt;
      control.appendChild(o);
    }
  } else if (propDef.kind === "number") {
    control = document.createElement("input");
    control.type = "number";
  } else if (propDef.kind === "range") {
    control = document.createElement("input");
    control.type = "range";
    if (propDef.min != null) control.min = propDef.min;
    if (propDef.max != null) control.max = propDef.max;
    if (propDef.step != null) control.step = propDef.step;
    valueDisplay = document.createElement("span");
    valueDisplay.className = "ne-prop-range-value";
  } else {
    control = document.createElement("input");
    control.type = "text";
  }
  control.value = currentValue ?? propDef.default ?? "";
  control.placeholder = propDef.placeholder || "";
  if (isWired) {
    control.disabled = true;
    control.title = "value is coming from a connected socket — disconnect to edit";
  }
  if (valueDisplay) valueDisplay.textContent = String(control.value);

  // Enable @-mention autocomplete for text-like controls so users can
  // surface upstream/graph image references inside prompts.
  if (propDef.kind === "textarea" || propDef.kind === "text" || propDef.kind === undefined) {
    enableMentions(control, nodeId);
  }

  control.addEventListener("input", () => {
    const isNumeric = propDef.kind === "number" || propDef.kind === "range";
    graph.nodes[nodeId].props[propDef.id] = isNumeric
      ? (control.value === "" ? null : Number(control.value))
      : control.value;
    if (valueDisplay) valueDisplay.textContent = String(control.value);
    if (propDef.id === "size") {
      // Size change rebuilds preview
      const el = document.querySelector(`[data-node-id="${nodeId}"]`);
      if (el) el.dataset.signature = "stale";
      renderNodes();
    }
    scheduleAutosave();
    schedulePreviewRefresh();
  });

  wrap.appendChild(control);
  if (valueDisplay) wrap.appendChild(valueDisplay);
  return wrap;
}

// ─── @-mention autocomplete ──────────────────────────────────────────────────

let _mentionPopupEl = null;
let _mentionState = null; // { control, nodeId, atIndex, options, highlight }

function basenameOf(p) {
  if (!p) return "";
  const s = String(p);
  const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return idx >= 0 ? s.slice(idx + 1) : s;
}

function gatherMentionOptions(forNodeId) {
  // Walk upstream from the node (if any) to collect direct context first.
  const seen = new Set();
  const opts = [];
  const pushOpt = (id, label, value, kind) => {
    if (!value) return;
    const key = `${id}::${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    opts.push({ nodeId: id, label, value, kind });
  };
  const walk = (id, depth) => {
    if (!id || depth > 8) return;
    const n = graph.nodes[id];
    if (!n) return;
    if (n.type === "image-input" && n.props?.path) {
      pushOpt(id, `Image · ${basenameOf(n.props.path)}`, n.props.path, "image");
    }
    if (n.type === "video-input" && n.props?.path) {
      pushOpt(id, `Video · ${basenameOf(n.props.path)}`, n.props.path, "video");
    }
    if (n.lastResult && n.lastResult.value && (n.lastResult.kind === "image" || n.lastResult.kind === "video")) {
      const def = NODE_BY_TYPE[n.type];
      pushOpt(id, `${def?.label || n.type} · ${basenameOf(n.lastResult.value)}`, n.lastResult.value, n.lastResult.kind);
    }
    for (const e of graph.edges) {
      if (e.toNode === id) walk(e.fromNode, depth + 1);
    }
  };
  if (forNodeId) walk(forNodeId, 0);
  // Also include any other image/video producing nodes anywhere in the graph
  // so users still see useful options on Text primitive nodes (which have no
  // upstream of their own).
  for (const id of Object.keys(graph.nodes)) {
    walk(id, 0);
  }
  return opts;
}

function ensureMentionPopup() {
  if (_mentionPopupEl) return _mentionPopupEl;
  const el = document.createElement("div");
  el.className = "ne-mention-popup";
  el.style.display = "none";
  document.body.appendChild(el);
  _mentionPopupEl = el;
  return el;
}

function closeMentionPopup() {
  if (_mentionPopupEl) _mentionPopupEl.style.display = "none";
  _mentionState = null;
}

function renderMentionPopup() {
  const st = _mentionState;
  const el = ensureMentionPopup();
  if (!st || !st.options.length) {
    el.style.display = "none";
    return;
  }
  el.innerHTML = "";
  st.options.forEach((opt, i) => {
    const row = document.createElement("div");
    row.className = "ne-mention-option" + (i === st.highlight ? " is-active" : "");
    const dot = document.createElement("span");
    dot.className = `ne-mention-dot is-${opt.kind}`;
    const label = document.createElement("span");
    label.className = "ne-mention-label";
    label.textContent = opt.label;
    const path = document.createElement("span");
    path.className = "ne-mention-path";
    path.textContent = opt.value;
    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(path);
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      acceptMention(i);
    });
    el.appendChild(row);
  });
  // Position below the focused control.
  const rect = st.control.getBoundingClientRect();
  el.style.left = `${Math.round(rect.left)}px`;
  el.style.top = `${Math.round(rect.bottom + 4)}px`;
  el.style.minWidth = `${Math.round(rect.width)}px`;
  el.style.display = "block";
}

function acceptMention(index) {
  const st = _mentionState;
  if (!st) return;
  const opt = st.options[index];
  if (!opt) return;
  const ctrl = st.control;
  const value = ctrl.value;
  const caret = ctrl.selectionStart ?? value.length;
  const before = value.slice(0, st.atIndex);
  const after = value.slice(caret);
  const insert = basenameOf(opt.value);
  ctrl.value = `${before}${insert}${after}`;
  const newCaret = before.length + insert.length;
  ctrl.setSelectionRange(newCaret, newCaret);
  ctrl.dispatchEvent(new Event("input", { bubbles: true }));
  closeMentionPopup();
  ctrl.focus();
}

function updateMentionFromControl(control, nodeId) {
  const value = control.value;
  const caret = control.selectionStart ?? value.length;
  // Find the most recent unescaped '@' before the caret with no whitespace between.
  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === "@") { at = i; break; }
    if (/\s/.test(ch)) break;
  }
  if (at < 0) {
    closeMentionPopup();
    return;
  }
  const query = value.slice(at + 1, caret).toLowerCase();
  const all = gatherMentionOptions(nodeId);
  const filtered = query
    ? all.filter((o) => o.label.toLowerCase().includes(query) || o.value.toLowerCase().includes(query))
    : all;
  if (!filtered.length) {
    closeMentionPopup();
    return;
  }
  _mentionState = {
    control,
    nodeId,
    atIndex: at,
    options: filtered.slice(0, 12),
    highlight: 0,
  };
  renderMentionPopup();
}

function enableMentions(control, nodeId) {
  const onUpdate = () => updateMentionFromControl(control, nodeId);
  control.addEventListener("input", onUpdate);
  control.addEventListener("click", onUpdate);
  control.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") onUpdate();
  });
  control.addEventListener("keydown", (e) => {
    if (!_mentionState || _mentionState.control !== control) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      _mentionState.highlight = (_mentionState.highlight + 1) % _mentionState.options.length;
      renderMentionPopup();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      _mentionState.highlight = (_mentionState.highlight - 1 + _mentionState.options.length) % _mentionState.options.length;
      renderMentionPopup();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      acceptMention(_mentionState.highlight);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMentionPopup();
    }
  });
  control.addEventListener("blur", () => {
    // Defer so click handlers on options run first.
    setTimeout(() => {
      if (_mentionState && _mentionState.control === control) closeMentionPopup();
    }, 150);
  });
}

// ─── Graph execution ─────────────────────────────────────────────────────────

// Returns the set of node ids that live inside *any* loop body, i.e. those
// that sit on a path from a `loop-decompose` to its matching `loop-output`
// via the loop-output's `item` input. These nodes must be driven by their
// owning loop-output (which iterates them) instead of being treated as
// independent top-level terminals — otherwise a cmd-* inside the body would
// resolve once with i=0 and the loop would never iterate.
function computeLoopBodyMembers() {
  const inBody = new Set();
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== "loop-output") continue;
    const loopId = String(node.props.loop_id || "loop1");
    const stack = [];
    for (const e of graph.edges) {
      if (e.toNode === node.id && e.toSocket === "item") stack.push(e.fromNode);
    }
    const visited = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = graph.nodes[id];
      if (!n) continue;
      inBody.add(id);
      // Stop walking past the matching decompose — its bundle input lives
      // OUTSIDE the loop body and must remain reachable as a normal
      // upstream dependency.
      if (n.type === "loop-decompose" && String(n.props.loop_id || "loop1") === loopId) continue;
      for (const e of graph.edges) {
        if (e.toNode === id) stack.push(e.fromNode);
      }
    }
  }
  return inBody;
}

async function runGraph() {
  const removedEdges = pruneInvalidEdges();
  if (removedEdges > 0) {
    renderGraph();
    scheduleAutosave();
    setHint(`removed ${removedEdges} incompatible link${removedEdges === 1 ? "" : "s"}`);
    setTimeout(clearHint, 1800);
  }
  // Find leaf nodes: command nodes OR preview nodes with input connected.
  // Nodes that live *inside a loop body* are driven by their owning
  // loop-output instead, so they must not run as standalone terminals
  // (otherwise a cmd-* inside the body would resolve once with i=0 and the
  // loop would never iterate).
  const inLoop = computeLoopBodyMembers();
  const terminals = Object.keys(graph.nodes).filter((id) => {
    if (inLoop.has(id)) return false;
    const n = graph.nodes[id];
    if (COMMAND_TYPES.has(n.type)) return true;
    if (PREVIEW_TYPES.has(n.type)) {
      return graph.edges.some((e) => e.toNode === id);
    }
    return false;
  });

  if (terminals.length === 0) {
    setGraphStatus("no command or preview nodes to run", "is-failed");
    return;
  }

  setGraphStatus("running…", "is-running");
  showRunLog();
  appendRunLog(`▶ Running graph (${terminals.length} terminal node${terminals.length > 1 ? "s" : ""})\n\n`);

  const cache = {};
  let anyFailed = false;

  for (const nodeId of terminals) {
    try {
      markNodeState(nodeId, "is-executing");
      appendRunLog(`▶ Resolving ${nodeId} (${graph.nodes[nodeId].type})…\n`);
      const res = await resolveNode(nodeId, cache);
      // Stash result for preview rendering
      const node = graph.nodes[nodeId];
      const outSock = (NODE_BY_TYPE[node.type].outputs || [])[0];
      const value = outSock ? res[outSock.id] : (res.in || "");
      let kind = outSock?.type || "any";
      if (Array.isArray(value)) {
        // Pick the bundle variant of the socket type.
        if (kind === "image" || kind === "any") kind = "image-bundle";
        else if (kind === "video") kind = "video-bundle";
      }
      node.lastResult = { kind, value };
      // Bump cache token so preview <img>/<video> reload after a re-run.
      if (Array.isArray(value)) {
        for (const v of value) if (v) artifactURL.bump(String(v));
      } else if (value) {
        artifactURL.bump(String(value));
      }
      // Force re-render of this node (signature changes)
      const el = document.querySelector(`[data-node-id="${nodeId}"]`);
      if (el) el.dataset.signature = "stale";
      renderNodes();
      markNodeState(nodeId, "is-done");
    } catch (err) {
      markNodeState(nodeId, "is-failed");
      appendRunLog(`✕ Error in ${nodeId}: ${err.message}\n\n`, true);
      anyFailed = true;
    }
  }

  setGraphStatus(anyFailed ? "some nodes failed" : "done", anyFailed ? "is-failed" : "is-done");
  if (window.refreshRunsList) window.refreshRunsList();
  scheduleAutosave();
}

async function resolveNode(nodeId, cache, loopCtx, opts) {
  loopCtx = loopCtx || {};
  opts = opts || {};
  // Cache key includes the loop context so the same node can yield different
  // values when re-resolved inside a loop body.
  const ctxKey = Object.keys(loopCtx).sort().map((k) => `${k}=${loopCtx[k].i}`).join("|");
  const cacheKey = `${nodeId}@${ctxKey}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const node = graph.nodes[nodeId];
  if (!node) throw new Error(`Node ${nodeId} not found`);
  const def = NODE_BY_TYPE[node.type];

  // Loop-decompose inside its own loop iteration: serve directly from the
  // precomputed item list carried by loopCtx. This is critical — walking
  // back through the `bundle` input on every iteration would re-execute
  // every upstream command (n2 cmd-image, etc.) once per loop step.
  if (node.type === "loop-decompose") {
    const loopId = String(node.props.loop_id || "loop1");
    const ctx = loopCtx[loopId];
    if (ctx && Array.isArray(ctx.items)) {
      const i = ctx.i | 0;
      const out = {
        item: ctx.items[i] !== undefined ? ctx.items[i] : "",
        index: i,
        count: ctx.items.length,
      };
      cache[cacheKey] = out;
      return out;
    }
  }

  // Lite mode (used by the preview-refresh pass): never invoke an actual
  // command — fall back to whatever the last real run produced. This lets
  // preview chains update the moment any cheap upstream value changes,
  // without re-spending API credits or hitting server endpoints.
  if (opts.lite || opts.liteCommands) {
    // Heavy nodes never re-execute in lite mode — they reuse their last
    // real result. loop-output is treated as heavy too: re-iterating its
    // body in lite mode would mis-feed a bundle into a per-iteration sink.
    const heavy = COMMAND_TYPES.has(node.type)
      || node.type === "compress-image"
      || node.type === "prompt-filter"
      || node.type === "loop-output";
    if (heavy) {
      const out = (def.outputs || [])[0];
      const v = node.lastResult ? node.lastResult.value : "";
      const result = {};
      if (out) result[out.id] = v;
      cache[cacheKey] = result;
      return result;
    }
  }

  const inputs = {};
  // Build a lookup: any input socket id whose name matches a prop becomes
  // overridden by an edge if one exists. This is what makes "props as
  // sockets" work — the synthetic input socket overrides the static prop.
  for (const sock of (def.inputs || [])) {
    const matchingEdges = graph.edges.filter((e) => e.toNode === nodeId && e.toSocket === sock.id);
    if (sock.multi) {
      const values = [];
      for (const edge of matchingEdges) {
        const sourceOutputs = await resolveNode(edge.fromNode, cache, loopCtx, opts);
        const v = sourceOutputs[edge.fromSocket];
        if (v != null && v !== "") {
          if (Array.isArray(v)) values.push(...v); else values.push(v);
        }
      }
      inputs[sock.id] = values;
    } else if (matchingEdges.length > 0) {
      const edge = matchingEdges[0];
      const sourceOutputs = await resolveNode(edge.fromNode, cache, loopCtx, opts);
      inputs[sock.id] = sourceOutputs[edge.fromSocket];
    } else {
      inputs[sock.id] = node.props[sock.id] ?? "";
    }
  }
  // Synthetic prop-sockets: any prop with an incoming edge replaces the
  // static prop value for this resolution.
  for (const propDef of def.props || []) {
    if ((def.inputs || []).some((s) => s.id === propDef.id)) continue;
    if (propDef.kind === "checkbox") continue;
    const matching = graph.edges.filter((e) => e.toNode === nodeId && e.toSocket === propDef.id);
    if (matching.length > 0) {
      const edge = matching[0];
      const sourceOutputs = await resolveNode(edge.fromNode, cache, loopCtx, opts);
      inputs[propDef.id] = sourceOutputs[edge.fromSocket];
    }
  }

  let outputs = {};

  switch (node.type) {
    case "text-input":     outputs.out = String(node.props.value || ""); break;
    case "number-input":   outputs.out = Number(node.props.value ?? 1); break;
    case "image-input":
    case "video-input":
    case "filepath-input": outputs.out = String(node.props.path || ""); break;
    case "text-join": {
      const sep = node.props.sep ?? " ";
      outputs.out = [inputs.a, inputs.b].filter((v) => v != null && v !== "").join(sep);
      break;
    }
    case "compress-image": {
      const inPath = inputs.in || "";
      if (!inPath) { outputs.out = ""; break; }
      appendRunLog(`  ↳ Compressing ${inPath} (q=${node.props.quality})…\n`);
      const result = await fetchJSON("/api/compress-image", {
        method: "POST",
        body: JSON.stringify({
          path: inPath,
          quality: Number(node.props.quality ?? 75),
          max_dimension: Number(node.props.max_dimension ?? 0),
        }),
      });
      if (result.error) throw new Error(`compress: ${result.error}`);
      const ratio = result.originalBytes ? Math.round((result.bytes / result.originalBytes) * 100) : 0;
      appendRunLog(`  ↳ → ${result.path} (${formatBytes(result.bytes)}, ${ratio}% of original)\n`);
      outputs.out = result.path;
      break;
    }
    case "prompt-filter": {
      appendRunLog(`  ↳ Filtering prompt via ${node.props.model_name || "model"}…\n`);
      const result = await fetchJSON("/api/filter-prompt", {
        method: "POST",
        body: JSON.stringify({
          prompt: inputs.prompt || "",
          instructions: inputs.instructions || "",
          model_name: node.props.model_name || "grok-3-mini-fast",
          model_api_key: node.props.model_api_key || "",
        }),
      });
      if (result.error) throw new Error(`filter-prompt: ${result.error}`);
      outputs.out = result.filtered_prompt || inputs.prompt || "";
      appendRunLog(`  ↳ "${(outputs.out || "").slice(0, 80).replace(/\n/g, " ")}${outputs.out.length > 80 ? "…" : ""}"\n`);
      break;
    }
    case "definition": {
      const name = node.props.name || "";
      if (!name) throw new Error("Definition node has no name");
      const args = inputs.args || "";
      const file = node.props.file || "";
      let token = `@${name}`;
      if (args) token += `:${args}`;
      if (file) token += `:"${file}"`;
      outputs.out = token;
      break;
    }
    case "preview":
      outputs.out = inputs.in;
      outputs.in = inputs.in;
      break;
    case "math-op": {
      const a = Number(inputs.a ?? 0);
      const b = Number(inputs.b ?? 0);
      const op = node.props.op || "add";
      let r = 0;
      switch (op) {
        case "add":      r = a + b; break;
        case "subtract": r = a - b; break;
        case "multiply": r = a * b; break;
        case "divide":   r = b === 0 ? 0 : a / b; break;
        case "modulo":   r = b === 0 ? 0 : a % b; break;
        case "power":    r = Math.pow(a, b); break;
        case "min":      r = Math.min(a, b); break;
        case "max":      r = Math.max(a, b); break;
      }
      outputs.out = r;
      break;
    }
    case "text-op": {
      const a = String(inputs.a ?? "");
      const b = String(inputs.b ?? "");
      const op = node.props.op || "to_string";
      const extra = String(node.props.extra ?? "");
      switch (op) {
        case "to_string": outputs.out = a; break;
        case "format":   outputs.out = (extra || "{a}").replace(/\{a\}/g, a).replace(/\{b\}/g, b); break;
        case "replace":  outputs.out = a.split(b).join(extra); break;
        case "upper":    outputs.out = a.toUpperCase(); break;
        case "lower":    outputs.out = a.toLowerCase(); break;
        case "trim":     outputs.out = a.trim(); break;
        case "slice": {
          const m = extra.split(":");
          const start = Number(m[0] || 0);
          const end = m[1] === undefined || m[1] === "" ? undefined : Number(m[1]);
          outputs.out = a.slice(start, end);
          break;
        }
        case "to_int":   outputs.out = parseInt(a, 10) || 0; break;
        case "to_float": outputs.out = parseFloat(a) || 0; break;
        case "length":   outputs.out = a.length; break;
        default:         outputs.out = a;
      }
      break;
    }
    case "loop-decompose": {
      const loopId = String(node.props.loop_id || "loop1");
      const ctx = loopCtx[loopId];
      const bundle = inputs.bundle;
      const items = Array.isArray(bundle) ? bundle : (bundle ? [bundle] : []);
      const i = ctx ? ctx.i : 0;
      outputs.item = items[i] !== undefined ? items[i] : "";
      outputs.index = i;
      outputs.count = items.length;
      break;
    }
    case "loop-output": {
      const loopId = String(node.props.loop_id || "loop1");
      // Find the matching decompose node.
      const decomposeNodeId = Object.keys(graph.nodes).find((id) => {
        const n = graph.nodes[id];
        return n.type === "loop-decompose" && String(n.props.loop_id || "loop1") === loopId;
      });
      if (!decomposeNodeId) throw new Error(`loop-output: no matching loop-decompose with loop_id="${loopId}"`);
      // Resolve the bundle feeding into the decompose ONCE, in the outer
      // cache, so n2 / upstream commands don't re-execute per iteration.
      const decomposeBundleEdges = graph.edges.filter(
        (e) => e.toNode === decomposeNodeId && e.toSocket === "bundle"
      );
      let bundleValue = [];
      if (decomposeBundleEdges.length > 0) {
        const edge = decomposeBundleEdges[0];
        const src = await resolveNode(edge.fromNode, cache, loopCtx, opts);
        const v = src[edge.fromSocket];
        bundleValue = Array.isArray(v) ? v : (v ? [v] : []);
      }
      // Resolve the item input N times with a fresh sub-cache per iteration.
      // The item list is carried in loopCtx so the decompose node can serve
      // it without re-walking its bundle input.
      const itemEdges = graph.edges.filter((e) => e.toNode === nodeId && e.toSocket === "item");
      const collected = [];
      for (let i = 0; i < bundleValue.length; i++) {
        const subCtx = { ...loopCtx, [loopId]: { i, total: bundleValue.length, items: bundleValue } };
        const subCache = {};
        if (itemEdges.length > 0) {
          const edge = itemEdges[0];
          const r = await resolveNode(edge.fromNode, subCache, subCtx, opts);
          collected.push(r[edge.fromSocket]);
        } else {
          collected.push(node.props.item ?? "");
        }
      }
      // Stash the assembled bundle on the immediate source node so the user
      // can see the per-iteration fan-out (e.g. n8 cmd-video) carry a bundle
      // instead of just its last single artifact.
      if (itemEdges.length > 0) {
        const srcNodeId = itemEdges[0].fromNode;
        const srcNode = graph.nodes[srcNodeId];
        if (srcNode) {
          let bk = "any";
          const first = collected.find((v) => v != null && v !== "");
          if (typeof first === "string") {
            if (/\.(mp4|mov|webm|mkv)$/i.test(first)) bk = "video-bundle";
            else if (/\.(png|jpe?g|webp|gif)$/i.test(first)) bk = "image-bundle";
          }
          srcNode.lastResult = { kind: bk, value: collected.slice() };
          for (const v of collected) if (v) artifactURL.bump(String(v));
          const el = document.querySelector(`[data-node-id="${srcNodeId}"]`);
          if (el) el.dataset.signature = "stale";
        }
      }
      outputs.out = collected;
      break;
    }
    default: {
      if (COMMAND_TYPES.has(node.type)) {
        const result = await executeCommandNode(node, inputs);
        // Iterations > 1 produces a bundle; otherwise a single artifact.
        if (Array.isArray(result.artifacts) && result.artifacts.length > 1) {
          outputs.out = result.artifacts;
        } else {
          outputs.out = result.firstArtifact || result.id || "";
        }
      }
    }
  }

  cache[cacheKey] = outputs;
  return outputs;
}

async function executeCommandNode(node, inputs) {
  const cmdMap = {
    "cmd-image": "image", "cmd-video": "video", "cmd-edit": "edit",
    "cmd-merge": "merge", "cmd-extend": "extend",
  };
  const command = cmdMap[node.type];
  const p = node.props;
  // Edges into prop-sockets override the static prop value. `inputs` was
  // populated by resolveNode for every wired prop socket.
  const pick = (key) => (inputs[key] !== undefined && inputs[key] !== "" && inputs[key] !== null) ? inputs[key] : p[key];
  const num = (key, fallback) => {
    const v = pick(key);
    if (v === "" || v == null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (key, fallback) => {
    const v = pick(key);
    return (v === "" || v == null) ? (fallback ?? "") : String(v);
  };
  // Multi-image inputs arrive as arrays from resolveNode; the CLI accepts
  // comma-separated paths via --input.
  const inputList = Array.isArray(inputs.input)
    ? inputs.input.filter((v) => v).map((v) => String(v)).join(",")
    : (inputs.input || "");
  const outputDir = str("output_dir", ".rundeer/outputs");
  const outputName = str("output_name", "output");
  const payload = {
    command,
    dryRun: Boolean(p.dry_run),
    subject: inputs.subject || "",
    motion: inputs.motion || "",
    style: str("style", ""),
    iterations: num("iterations", 1),
    image: { model: str("model", ""), aspectRatio: str("aspect_ratio", ""), resolution: str("resolution", "") },
    video: { model: str("model", ""), duration: num("duration", 6) },
    inputs: {
      input: inputList,
      startFrame: inputs.start_frame || "",
      source: inputs.source || "",
      editType: str("edit_type", "image"),
    },
    output: { dir: outputDir, name: outputName },
    references: { ids: str("reference_ids", "") },
    grid: { enabled: Boolean(p.grid) },
    chain: { enabled: false },
    definitions: [],
    extra: {},
  };

  appendRunLog(`  ↳ ${command} · "${(payload.subject || "").slice(0, 50)}"\n`);

  const endpoint = payload.dryRun ? "/api/plan" : "/api/run";
  const result = await fetchJSON(endpoint, { method: "POST", body: JSON.stringify(payload) });

  if (payload.dryRun) {
    appendRunLog(result.output || "(no output)\n");
    return { id: result.id };
  }

  appendRunLog(`  ↳ run ${result.id}\n`);
  const final = await pollUntilDone(result.id);
  // Resolve the produced artifact(s). When iterations > 1 we collect ALL
  // matching artifacts so the output socket carries a bundle.
  const artifacts = await findArtifactsForRun(final, { output_dir: outputDir, output_name: outputName });
  return {
    id: result.id,
    firstArtifact: artifacts[0] || "",
    artifacts,
  };
}

async function findArtifactsForRun(runRecord, props) {
  const outputDir = (props?.output_dir || ".rundeer/outputs").replace(/^\.\//, "");
  const outputName = String(props?.output_name || "");
  const startedAt = (runRecord.startedAt || 0) - 5;
  // Match files whose basename is `<output_name>` or `<output_name>_<digits>`
  // followed by a media extension. Anchoring on the basename (not a substring
  // of the full path) prevents false positives like "output" matching every
  // file inside the `outputs/` directory.
  const escName = outputName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const baseRe = outputName
    ? new RegExp(`^${escName}(?:_\\d+)?\\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mkv)$`, "i")
    : /\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;
  try {
    const data = await fetchJSON("/api/artifacts");
    const items = data.artifacts || [];
    const matches = items.filter((a) => {
      const p = String(a.path || "");
      if (!p.toLowerCase().startsWith(outputDir.toLowerCase())) return false;
      const base = p.replace(/.*[\\/]/, "");
      if (!baseRe.test(base)) return false;
      return (a.mtime || 0) >= startedAt;
    });
    matches.sort((x, y) => (x.mtime || 0) - (y.mtime || 0));
    return matches.map((m) => m.path);
  } catch (_) {
    const single = findArtifactPath(runRecord.output || "", props);
    return single ? [single] : [];
  }
}

function findArtifactPath(output, props) {
  // Look for lines like "saved <path>" or paths under output_dir
  const dir = props?.output_dir || ".rundeer/outputs";
  const lines = output.split(/\r?\n/);
  // Match common patterns produced by rundeer
  const patterns = [
    /(?:saved|wrote|->)\s+(\S+\.(?:png|jpg|jpeg|webp|mp4|mov|webm))/i,
    new RegExp(`(${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\S+\\.(?:png|jpg|jpeg|webp|mp4|mov|webm))`, "i"),
  ];
  for (const line of lines) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m) return m[1];
    }
  }
  return "";
}

async function pollUntilDone(runId) {
  return new Promise((resolve, reject) => {
    let lastLen = 0;
    const handle = setInterval(async () => {
      try {
        const rec = await fetchJSON(`/api/runs/${encodeURIComponent(runId)}`);
        const out = rec.output || "";
        if (out.length > lastLen) {
          appendRunLog(out.slice(lastLen));
          lastLen = out.length;
        }
        // Server emits "failed (rc=N)" — treat any status starting with these
        // tokens as terminal so polling can never spin forever.
        const status = String(rec.status || "");
        const finished = rec.endedAt != null
          || status === "done"
          || status.startsWith("failed")
          || status.startsWith("error");
        updateRunLogStatus(status, runId);
        if (finished) {
          clearInterval(handle);
          if (status === "done" && (rec.returncode === 0 || rec.returncode == null)) {
            resolve(rec);
          } else {
            reject(new Error(`Run ${runId} ${status} (rc=${rec.returncode})`));
          }
        }
      } catch (err) {
        clearInterval(handle);
        reject(err);
      }
    }, 1100);
  });
}

function markNodeState(nodeId, cls) {
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!el) return;
  el.classList.remove("is-executing", "is-done", "is-failed");
  if (cls) el.classList.add(cls);
}

// ─── Run log ─────────────────────────────────────────────────────────────────

function showRunLog() {
  const log = document.getElementById("runLog");
  log.classList.remove("is-hidden");
  document.getElementById("runLogBody").textContent = "";
  document.getElementById("runLogStatus").dataset.state = "running";
  document.getElementById("runLogStatus").textContent = "Running";
  document.getElementById("runLogTitle").textContent = "graph run";
}

function appendRunLog(text) {
  const body = document.getElementById("runLogBody");
  body.textContent += text;
  body.scrollTop = body.scrollHeight;
}

function updateRunLogStatus(status, id) {
  const pill = document.getElementById("runLogStatus");
  pill.dataset.state = status;
  pill.textContent = { done: "Done", failed: "Failed", running: "Running", queued: "Queued" }[status] || status;
  if (id) document.getElementById("runLogTitle").textContent = `id ${id}`;
}

// ─── Past runs panel ─────────────────────────────────────────────────────────

async function refreshRunsList() {
  try {
    const data = await fetchJSON("/api/runs");
    const list = document.getElementById("runsList");
    list.innerHTML = "";
    if (!data.runs || data.runs.length === 0) {
      list.innerHTML = `<li class="ne-runs-empty">no runs yet</li>`;
      return;
    }
    for (const run of data.runs) {
      const li = document.createElement("li");
      li.className = "ne-run-item";
      li.dataset.runId = run.id;
      const when = run.startedAt ? new Date(run.startedAt * 1000).toLocaleTimeString() : "";
      li.innerHTML = `
        <span class="ne-run-status" data-state="${escAttr(run.status)}">${escHtml(run.status || "?")}</span>
        <span class="ne-run-id" title="${escAttr(run.id)}">${escHtml(run.id.slice(-12))}</span>
        <span class="ne-run-time">${escHtml(when)}</span>
        <span class="ne-run-cmd" title="${escAttr(run.command || "")}">${escHtml((run.command || "").slice(0, 40))}</span>`;
      li.addEventListener("click", () => openRunInLog(run.id));
      list.appendChild(li);
    }
  } catch (e) { /* ignore */ }
}
window.refreshRunsList = refreshRunsList;

async function openRunInLog(runId) {
  try {
    const rec = await fetchJSON(`/api/runs/${encodeURIComponent(runId)}`);
    showRunLog();
    document.getElementById("runLogBody").textContent = rec.output || "(no output)";
    updateRunLogStatus(rec.status || "done", runId);
  } catch (e) {
    setHint(`could not load run: ${e.message}`);
    setTimeout(clearHint, 2500);
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const GRAPH_STORAGE_KEY = "rundeer_node_graph_v2";
let autosaveTimer = null;

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveLocalStorage, 400);
}

// ─── Preview auto-refresh ────────────────────────────────────────────────────
// Re-resolves every preview node in `lite` mode after any cheap upstream
// change (text-input edits, edge add/remove, etc.). Lite mode never invokes
// command nodes or other server endpoints — those reuse their lastResult.

let _previewRefreshTimer = null;
let _previewRefreshRunning = false;
let _previewRefreshAgain = false;

function schedulePreviewRefresh() {
  if (_previewRefreshTimer) clearTimeout(_previewRefreshTimer);
  _previewRefreshTimer = setTimeout(() => { refreshAllPreviews().catch(() => {}); }, 200);
}

async function refreshAllPreviews(opts = {}) {
  if (_previewRefreshRunning) { _previewRefreshAgain = true; return; }
  _previewRefreshRunning = true;
  try {
    const previews = Object.values(graph.nodes).filter((n) => PREVIEW_TYPES.has(n.type));
    if (previews.length === 0) return;
    const cache = {};
    const resolveOpts = { lite: !opts.force };
    for (const node of previews) {
      if (!graph.edges.some((e) => e.toNode === node.id && e.toSocket === "in")) continue;
      try {
        const res = await resolveNode(node.id, cache, {}, resolveOpts);
        const value = res.in !== undefined ? res.in : res.out;
        let kind = "any";
        if (Array.isArray(value)) {
          const first = value.find((v) => v != null && v !== "");
          const k = inferPreviewMediaKind(node, "", String(first || ""));
          kind = k === "video" ? "video-bundle" : (k === "image" ? "image-bundle" : "any");
        } else {
          kind = inferPreviewMediaKind(node, "", String(value || ""));
        }
        const before = JSON.stringify(node.lastResult || null);
        node.lastResult = { kind, value: value === undefined ? "" : value };
        if (opts.force) {
          if (Array.isArray(value)) {
            for (const v of value) if (v) artifactURL.bump(String(v));
          } else if (value) {
            artifactURL.bump(String(value));
          }
        }
        if (JSON.stringify(node.lastResult) !== before) {
          const el = document.querySelector(`[data-node-id="${node.id}"]`);
          if (el) el.dataset.signature = "stale";
        }
      } catch (_) { /* ignore: leaves prior lastResult untouched */ }
    }
    renderNodes();
  } finally {
    _previewRefreshRunning = false;
    if (_previewRefreshAgain) {
      _previewRefreshAgain = false;
      schedulePreviewRefresh();
    }
  }
}

function refreshPreview(nodeId, opts = {}) {
  const node = graph.nodes[nodeId];
  if (!node || !PREVIEW_TYPES.has(node.type)) return;
  // Single-node refresh shares the same path; force=true also re-fetches
  // images/videos by bumping the cache token on the resolved artifact.
  refreshAllPreviews(opts).catch(() => {});
}

function serializeGraph() {
  // Strip transient fields
  const cleanNodes = {};
  for (const [id, n] of Object.entries(graph.nodes)) {
    cleanNodes[id] = {
      id: n.id, type: n.type, x: n.x, y: n.y, props: n.props, width: n.width,
      height: n.height || null,
      previewMode: n.previewMode || null,
      collapsed: Boolean(n.collapsed),
      lastResult: n.lastResult || null,
    };
  }
  return { version: 2, nodes: cleanNodes, edges: graph.edges, _nextId: graph._nextId };
}

function loadGraphData(data) {
  if (!data || !data.nodes) return false;
  graph.nodes = {};
  for (const [id, n] of Object.entries(data.nodes)) {
    // Legacy migration: collapse preview-image / preview-video / preview-text
    // into the unified `preview` node.
    const migrated = LEGACY_PREVIEW_TYPES.has(n.type) ? { ...n, type: "preview" } : n;
    graph.nodes[id] = { ...migrated, hidden: false, collapsedBy: null };
  }
  graph.edges = (data.edges || []).map((e) => ({ ...e, id: e.id || genEdgeId() }));
  graph._nextId = data._nextId || (Math.max(0, ...Object.keys(graph.nodes).map((k) => Number(k.slice(1)) || 0)) + 1);
  const removedEdges = pruneInvalidEdges();
  ix.selection.clear();
  renderGraph();
  renderProps(null);
  if (removedEdges > 0) {
    setHint(`removed ${removedEdges} incompatible link${removedEdges === 1 ? "" : "s"}`);
    setTimeout(clearHint, 1800);
    scheduleAutosave();
  }
  return true;
}

function autosaveLocalStorage() {
  try {
    localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(serializeGraph()));
    flashAutosave();
  } catch (e) { /* quota or disabled */ }
}

function flashAutosave() {
  const dot = document.getElementById("autosaveDot");
  if (!dot) return;
  dot.classList.add("is-saving");
  setTimeout(() => dot.classList.remove("is-saving"), 600);
}

function loadGraphFromLocalStorage() {
  try {
    const raw = localStorage.getItem(GRAPH_STORAGE_KEY);
    if (!raw) return false;
    return loadGraphData(JSON.parse(raw));
  } catch (e) { return false; }
}

function saveGraphToFile() {
  const data = JSON.stringify(serializeGraph(), null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rundeer-graph-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  setHint("saved to file");
  setTimeout(clearHint, 1500);
}

function loadGraphFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(String(e.target.result));
      if (loadGraphData(data)) {
        frameAll();
        scheduleAutosave();
        setHint(`loaded ${file.name}`);
        setTimeout(clearHint, 1800);
      }
    } catch (err) {
      setHint(`load failed: ${err.message}`);
      setTimeout(clearHint, 2500);
    }
  };
  reader.readAsText(file);
}

function clearGraph() {
  if (!confirm("Clear the graph? All nodes and connections will be lost.")) return;
  graph.nodes = {}; graph.edges = []; graph._nextId = 1;
  ix.selection.clear();
  renderGraph();
  renderProps(null);
  scheduleAutosave();
}

// ─── Status ──────────────────────────────────────────────────────────────────

let graphStatusTimer = null;
function setGraphStatus(text, cls) {
  const el = document.getElementById("graphStatus");
  el.textContent = text;
  el.className = `ne-status ${cls || ""}`.trim();
  if (graphStatusTimer) clearTimeout(graphStatusTimer);
  if (!cls) graphStatusTimer = setTimeout(() => { el.textContent = "ready"; el.className = "ne-status"; }, 3000);
}

// ─── Palette ─────────────────────────────────────────────────────────────────

// Display-only catalog: hides the two real Loop node types behind a single
// virtual "Loop" entry so users always insert a complete Decompose/Output
// pair instead of an orphan half.
function paletteCategoriesForDisplay() {
  return NODE_CATALOG.map((cat) => {
    if (cat.category !== "Loop") return cat;
    return {
      ...cat,
      nodes: [
        {
          type: "loop", label: "Loop",
          desc: "Iterate a subgraph once per item of an incoming bundle (creates a paired Decompose + Output)",
          inputs: [{ id: "bundle", label: "Bundle", type: "any" }],
          outputs: [{ id: "out", label: "Bundle", type: "any" }],
          props: [],
        },
      ],
    };
  });
}

function renderPalette(query = "") {
  const host = document.getElementById("paletteCategories");
  host.innerHTML = "";
  const q = query.toLowerCase();
  for (const cat of paletteCategoriesForDisplay()) {
    const matching = cat.nodes.filter((n) => !q || n.label.toLowerCase().includes(q) || n.type.includes(q) || n.desc.toLowerCase().includes(q));
    if (matching.length === 0) continue;
    const catEl = document.createElement("div");
    catEl.className = "ne-category is-open";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "ne-category-head";
    head.innerHTML = `<span class="ne-category-caret">▸</span>${escHtml(cat.category)}`;
    head.addEventListener("click", () => catEl.classList.toggle("is-open"));
    catEl.appendChild(head);
    const body = document.createElement("div");
    body.className = "ne-category-body";
    for (const nodeDef of matching) {
      const sockType = nodeDef.outputs?.[0]?.type || nodeDef.inputs?.[0]?.type || "text";
      const color = SOCKET_TYPES[sockType]?.color || "#888";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ne-node-btn";
      btn.draggable = true;
      btn.dataset.nodeType = nodeDef.type;
      btn.title = nodeDef.desc;
      btn.innerHTML = `<span class="ne-node-dot" style="background:${color}"></span>${escHtml(nodeDef.label)}`;
      btn.addEventListener("click", () => {
        const wrap = document.getElementById("canvasWrap");
        const rect = wrap.getBoundingClientRect();
        const c = screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
        addNode(nodeDef.type, c.x - 110, c.y - 30);
      });
      btn.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("rundeer/node-type", nodeDef.type);
        e.dataTransfer.effectAllowed = "copy";
      });
      body.appendChild(btn);
    }
    catEl.appendChild(body);
    host.appendChild(catEl);
  }
}

// ─── Masthead ────────────────────────────────────────────────────────────────

let deerFrames = [];
let deerIdx = 0;
async function startDeerAnimation() {
  try {
    const data = await fetchJSON("/api/logo");
    deerFrames = data.frames || [];
  } catch (_) { deerFrames = ["rundeer"]; }
  const el = document.getElementById("asciiDeer");
  if (!el || deerFrames.length === 0) return;
  el.textContent = deerFrames[0];
  if (deerFrames.length > 1) {
    setInterval(() => { deerIdx = (deerIdx + 1) % deerFrames.length; el.textContent = deerFrames[deerIdx]; }, 800);
  }
}

async function loadState() {
  try {
    const data = await fetchJSON("/api/state");
    document.getElementById("versionTag").textContent = data.version || "?";
    document.getElementById("projectRoot").textContent = data.projectRoot || "?";
    const env = data.env || {};
    const keysOk = Boolean(env.VISION_API_KEY && env.MODEL_API_KEY);
    const keyEl = document.getElementById("keyStatus");
    keyEl.textContent = keysOk ? "ok" : "missing";
    keyEl.classList.toggle("is-positive", keysOk);
    keyEl.classList.toggle("is-quiet", !keysOk);
    document.getElementById("stylesStat").textContent = String((data.styles || []).length);
  } catch (_) { document.getElementById("projectRoot").textContent = "unavailable"; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) }, ...opts,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(str) { return escHtml(str); }

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  startDeerAnimation();
  loadState();
  renderPalette();
  applyViewport();
  renderProps(null);

  const wrap = document.getElementById("canvasWrap");

  wrap.addEventListener("mousedown", onCanvasMousedown);
  window.addEventListener("mousemove", onMousemove);
  window.addEventListener("mouseup", onMouseup);
  wrap.addEventListener("wheel", onCanvasWheel, { passive: false });
  wrap.addEventListener("contextmenu", (e) => e.preventDefault());

  // Alt + RightClick drag → lazy-connect (Node Wrangler style).
  // Capture-phase listener so it intercepts before per-node handlers swallow it.
  window.addEventListener("mousedown", (e) => {
    if (e.button !== 2 || !e.altKey) return;
    if (e.ctrlKey || e.metaKey) return;
    const target = e.target?.closest?.(".ne-node");
    if (!target) return;
    const fromNodeId = target.dataset.nodeId;
    if (!fromNodeId) return;
    e.preventDefault();
    e.stopPropagation();
    startLazyConnect(e, fromNodeId);
  }, true);

  wrap.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  wrap.addEventListener("drop", (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("rundeer/node-type");
    if (!type) return;
    const pos = screenToCanvas(e.clientX, e.clientY);
    addNode(type, pos.x - 110, pos.y - 30);
  });

  document.addEventListener("keydown", onKeydown);

  // High-priority modal commit/cancel: when a transform is active, ANY
  // mouse click anywhere (including on top of nodes) commits or cancels.
  // Capture phase + early return so node-level handlers don't fire.
  window.addEventListener("mousedown", (e) => {
    if (!ix.modal) return;
    if (e.button === 0) commitModal();
    else if (e.button === 2) cancelModal();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener("mousedown", (e) => {
    const menu = document.getElementById("addMenu");
    if (menu.style.display !== "none" && !menu.contains(e.target) && !e.target.closest(".ne-canvas-wrap")) {
      hideAddMenu();
    }
  });

  document.getElementById("paletteSearch").addEventListener("input", (e) => renderPalette(e.target.value.trim()));

  // Toolbar
  document.getElementById("runGraphBtn").addEventListener("click", runGraph);
  document.getElementById("clearGraphBtn").addEventListener("click", clearGraph);
  document.getElementById("saveGraphBtn").addEventListener("click", saveGraphToFile);
  document.getElementById("loadGraphBtn").addEventListener("click", () => document.getElementById("loadGraphFile").click());
  document.getElementById("loadGraphFile").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) loadGraphFromFile(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("frameAllBtn").addEventListener("click", frameAll);
  document.getElementById("refreshButton").addEventListener("click", () => { loadState(); refreshRunsList(); });
  document.getElementById("runLogClose").addEventListener("click", () => document.getElementById("runLog").classList.add("is-hidden"));

  // Help / quick-start modal — toggle is-hidden on the help overlay.
  const helpBtn = document.getElementById("helpBtn");
  const helpModal = document.getElementById("helpModal");
  const helpClose = document.getElementById("helpClose");
  if (helpBtn && helpModal) {
    helpBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      helpModal.classList.remove("is-hidden");
    });
    if (helpClose) {
      helpClose.addEventListener("click", () => helpModal.classList.add("is-hidden"));
    }
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) helpModal.classList.add("is-hidden");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !helpModal.classList.contains("is-hidden")) {
        helpModal.classList.add("is-hidden");
      }
    });
  }

  // Runs panel toggle
  const runsToggle = document.getElementById("runsToggle");
  if (runsToggle) {
    runsToggle.addEventListener("click", () => {
      const panel = document.getElementById("runsPanel");
      panel.classList.toggle("is-open");
      if (panel.classList.contains("is-open")) refreshRunsList();
    });
  }

  // Restore from localStorage
  loadGraphFromLocalStorage();
  refreshRunsList();
  setInterval(refreshRunsList, 4000);
  // Initial preview pass so non-command upstream values populate immediately.
  schedulePreviewRefresh();

  // Save before unload as a final safety net
  window.addEventListener("beforeunload", () => autosaveLocalStorage());
});
