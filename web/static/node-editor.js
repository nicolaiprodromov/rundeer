// rundeer node editor — Blender-style node graph controller.
// Features: modal G/R/S transforms, preview nodes, collapse-under-preview,
// autosave to .rundeer, Node-Wrangler shortcuts, past-runs panel.

"use strict";

// ─── Socket type registry ────────────────────────────────────────────────────

const SOCKET_TYPES = {
  text:         { color: "oklch(74% 0.180 235)", label: "String" },
  image:        { color: "oklch(84% 0.190 82)", label: "Image" },
  video:        { color: "oklch(72% 0.210 315)", label: "Video" },
  number:       { color: "oklch(76% 0.180 165)", label: "Number" },
  boolean:      { color: "oklch(78% 0.190 45)", label: "Boolean" },
  definition:   { color: "oklch(76% 0.170 185)", label: "Definition" },
  filepath:     { color: "oklch(80% 0.180 58)", label: "File Path" },
  vector:       { color: "oklch(74% 0.16 340)", label: "Vector" },
  "vector-map": { color: "oklch(70% 0.135 304)", label: "Vector Map" },
  color:        { color: "oklch(74% 0.180 35)", label: "Color" },
  "image-bundle": { color: "oklch(88% 0.220 88)", label: "Image Bundle" },
  "video-bundle": { color: "oklch(76% 0.230 310)", label: "Video Bundle" },
  run:          { color: "oklch(80% 0.180 100)", label: "Run" },
  any:          { color: "oklch(75% 0.035 80)", label: "Any" },
};

function baseType(t) {
  if (t === "image-bundle") return "image";
  if (t === "video-bundle") return "video";
  return t;
}

function canConnect(typeA, typeB) {
  if (!typeA || !typeB) return false;
  if (typeA === typeB) return true;
  // Run trigger wires are isolated from the data graph — they only match
  // other "run" sockets, never the generic "any" passthrough.
  if (typeA === "run" || typeB === "run") return false;
  if (typeA === "any" || typeB === "any") return true;
  // bundle  <->  scalar of same media kind
  if (baseType(typeA) === baseType(typeB)) return true;
  if ((typeA === "filepath" || typeA === "text") && (typeB === "filepath" || typeB === "text")) return true;
  // A constant vector primitive can feed any vector-map socket: numpy
  // broadcasts a (1,1,3) array against (H,W,C) maps server-side.
  if ((typeA === "vector" && typeB === "vector-map") || (typeA === "vector-map" && typeB === "vector")) return true;
  // UV / vector maps carry a .png sidecar so they wire-compatible with
  // image consumers (cmd-edit, preview, uv-render's pixel input). The
  // artifact resolver in resolveNode prefers the .npy when the consumer
  // is itself a vector op.
  if ((typeA === "vector-map" && typeB === "image") || (typeA === "image" && typeB === "vector-map")) return true;
  if ((typeA === "vector-map" && typeB === "image-bundle") || (typeA === "image-bundle" && typeB === "vector-map")) return true;
  if ((typeA === "vector" && typeB === "image") || (typeA === "image" && typeB === "vector")) return true;
  return false;
}

const COMMAND_COMMON_PROPS = [
  { id: "style", label: "Style", kind: "text", default: "Moebius", placeholder: "Moebius" },
  { id: "iterations", label: "Iterations", kind: "number", default: 1 },
  { id: "concurrency", label: "Concurrency", kind: "number", default: null, placeholder: "auto" },
  { id: "output_dir", label: "Output Dir", kind: "text", default: ".rundeer/outputs" },
  { id: "output_name", label: "Output Name", kind: "text", default: "output" },
];

const COMMAND_IMAGE_MODEL_PROP = { id: "model", label: "Image Model", kind: "text", default: "grok-imagine-image" };
const COMMAND_VIDEO_MODEL_PROP = { id: "model", label: "Video Model", kind: "text", default: "grok-imagine-video" };
const COMMAND_AUTO_MODEL_PROP = { id: "model", label: "Model", kind: "text", default: "", placeholder: "auto by type" };

const COMMAND_IMAGE_PROPS = [
  { id: "aspect_ratio", label: "Aspect Ratio", kind: "text", default: "1:1" },
  { id: "resolution", label: "Resolution", kind: "text", default: "", placeholder: "1k or 2k" },
];

const COMMAND_VIDEO_PROPS = [
  { id: "aspect_ratio", label: "Aspect Ratio", kind: "text", default: "16:9" },
  { id: "duration", label: "Duration (s)", kind: "number", default: 6 },
  { id: "resolution", label: "Resolution", kind: "text", default: "720p", placeholder: "480p, 720p, 1080p" },
];

const COMMAND_REFERENCE_PROPS = [
  { id: "reference_ids", label: "Style Reference IDs", kind: "text", default: "", placeholder: "e.g. 0,1,2" },
  { id: "pad_reference", label: "Pad References", kind: "checkbox", default: true },
  { id: "ref_quality", label: "JPEG Quality", kind: "number", default: 85 },
];

const COMMAND_MEDIA_INPUT_PROPS = [
  { id: "pad_reference", label: "Pad Inputs", kind: "checkbox", default: true },
  { id: "ref_quality", label: "JPEG Quality", kind: "number", default: 85 },
];

const PROMPT_MODEL_PROPS = [
  { id: "model", label: "Model override", kind: "text", default: "", placeholder: "uses env MODEL_NAME" },
  { id: "reasoning_effort", label: "Reasoning Effort", kind: "select", options: ["default", "none", "low", "medium", "high"], default: "default" },
];

const PROMPT_SAMPLING_PROPS = [
  { id: "temperature", label: "Temperature", kind: "number", default: 0.7, placeholder: "0.0 - 2.0" },
  { id: "top_p", label: "Top P", kind: "number", default: "", placeholder: "0.0 - 1.0 (unset)" },
  { id: "max_tokens", label: "Max Tokens", kind: "number", default: 1024 },
  { id: "seed", label: "Seed", kind: "number", default: "", placeholder: "optional" },
  { id: "frequency_penalty", label: "Frequency Penalty", kind: "number", default: "", placeholder: "-2.0 - 2.0 (non-reasoning only)" },
  { id: "presence_penalty", label: "Presence Penalty", kind: "number", default: "", placeholder: "-2.0 - 2.0 (non-reasoning only)" },
  { id: "stop", label: "Stop", kind: "text", default: "", placeholder: "comma-separated (non-reasoning only)" },
];

const COMMAND_CHAIN_PROPS = [
  { id: "chain", label: "Chain Edits", kind: "checkbox", default: false },
  { id: "chain_compose", label: "Mask Compose", kind: "checkbox", default: false },
  { id: "chain_threshold", label: "Threshold", kind: "number", default: 12 },
  { id: "chain_override", label: "Override", kind: "number", default: 50 },
  { id: "chain_dilate", label: "Dilate", kind: "number", default: 6 },
  { id: "chain_feather", label: "Feather", kind: "number", default: 8 },
  { id: "chain_min_region", label: "Min Region", kind: "number", default: 64 },
];

const PROP_GROUPS = {
  settings: { label: "settings" },
  highlights: { label: "highlights" },
  run: { label: "run" },
  media: { label: "media" },
  references: { label: "references" },
  chain: { label: "chain" },
  model: { label: "model" },
  sampling: { label: "sampling" },
};

function groupProps(group, props) {
  return props.map((prop) => ({ ...prop, group }));
}

// Compress node helper: returns true when its `in` socket has an incoming
// edge whose effective output base-type is text. Used to conditionally render
// the `instructions` input socket and to drive auto-helper-node creation.
function compressInHasTextUpstream(nodeId) {
  const edge = activeIncomingEdges(nodeId, "in")[0];
  if (!edge) return false;
  const sock = outputSocketDef(edge.fromNode, edge.fromSocket);
  return baseType(sock?.type || "any") === "text";
}

// Whether a given input socket should be visible on the node body. The
// Compress node hides `instructions` unless its `in` is fed by a text source.
function isInputSocketVisible(node, def, sock) {
  if (node?.type === "compress-image" && sock.id === "instructions") {
    return compressInHasTextUpstream(node.id);
  }
  return true;
}

function propGroupId(propDef) {
  return propDef.group || "settings";
}

function propGroupLabel(groupId) {
  return PROP_GROUPS[groupId]?.label || groupId;
}

function propGroupDefaultCollapsed(node, groupId) {
  const def = NODE_BY_TYPE[node?.type];
  const groupSocketIds = new Set(
    (def?.props || [])
      .filter((prop) => propGroupId(prop) === groupId)
      .map((prop) => prop.id)
  );
  const hasWiredSocket = activeIncomingEdges(node?.id).some((edge) => groupSocketIds.has(edge.toSocket));
  if (hasWiredSocket) return false;
  if (groupId === "highlights") return !String(node?.props?.highlight_pairs || "").trim();
  if (groupId === "chain") return !Boolean(node.props?.chain);
  return false;
}

function propGroupSummary(node, groupId, count) {
  const def = NODE_BY_TYPE[node?.type];
  const groupSocketIds = new Set(
    (def?.props || [])
      .filter((prop) => propGroupId(prop) === groupId)
      .map((prop) => prop.id)
  );
  if (activeIncomingEdges(node?.id).some((edge) => groupSocketIds.has(edge.toSocket))) return "wired";
  if (groupId === "highlights") return String(node?.props?.highlight_pairs || "").trim() ? "on" : "off";
  if (groupId === "chain") return node.props?.chain ? "on" : "off";
  return String(count);
}

// Returns true when a node's output socket carries a *bundle* (array of
// values) rather than a single value. Used to show bundle markers on the
// socket dot and to render bundle wires as dashed.
function outputProducesBundle(nodeId, sockId, seen = new Set()) {
  const key = `${nodeId}:${sockId}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const n = graph.nodes[nodeId];
  if (!n) return false;
  if (isNodeMuted(n)) return false;
  if (n.type === "reroute") {
    const incoming = activeIncomingEdges(nodeId, "in")[0];
    return incoming ? outputProducesBundle(incoming.fromNode, incoming.fromSocket, seen) : false;
  }
  if (n.type === "loop-output") return true;
  if (n.type === "folder-bundle") return true;
  if (n.type === "create-bundle") return true;
  if (n.type === "sample-bundle") {
    // count is always a scalar; only the `out` socket can ever be a bundle.
    if (sockId !== "out") return false;
    return sampleBundleProducesBundle(n);
  }
  if (n.lastResult && n.lastResult.value !== undefined && Array.isArray(n.lastResult.value)) return true;
  if (COMMAND_TYPES.has(n.type)) {
    const directIters = Number(n.props.iterations || 1);
    if (directIters > 1) return true;
    // iterations may also be wired in from an upstream node — peek at the
    // source's static value so the bundle marker is still drawn pre-run.
    const wired = activeIncomingEdges(nodeId, "iterations")[0];
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

// ─── UV / Mix helpers ────────────────────────────────────────────────────
// Small coercers shared between the `vector-op`, `mix`, and `uv-render`
// executor cases. They turn the loosely-typed values the resolver collects
// (paths, hex colors, numbers, arrays) into payload shapes the
// /api/uv/* endpoints can consume.

function _isUvPath(v) {
  if (typeof v !== "string" || !v) return false;
  // Anything with a known image-ish suffix or our cached .npy maps.
  return /\.(npy|png|jpe?g|webp|tiff?|bmp|gif)$/i.test(v);
}

function _hexToRgba(hex) {
  const s = String(hex || "").trim();
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{8}|[0-9a-f]{3})$/i.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

function _rgbaToHex(rgba) {
  const clip = (v) => Math.max(0, Math.min(255, Math.round((Number(v) || 0) * 255)));
  const r = clip(rgba[0]).toString(16).padStart(2, "0");
  const g = clip(rgba[1]).toString(16).padStart(2, "0");
  const b = clip(rgba[2]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function _coerceVectorInput(v) {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) return { color: v.map(Number) };
  if (typeof v === "number") return { scalar: v };
  if (typeof v === "string") {
    if (_isUvPath(v)) return { path: v };
    const rgba = _hexToRgba(v);
    if (rgba) return { color: rgba };
    const num = Number(v);
    if (Number.isFinite(num)) return { scalar: num };
  }
  return null;
}

function _coerceMixInput(v, { isFactor } = {}) {
  // Returns { payload, isPath, scalar?, color? } — payload is the dict that
  // goes into the /api/uv/mix request; the other fields drive the JS fast
  // path.
  if (typeof v === "string" && _isUvPath(v)) {
    return { payload: { path: v }, isPath: true };
  }
  if (typeof v === "string") {
    const rgba = _hexToRgba(v);
    if (rgba) {
      return { payload: { color: rgba }, isPath: false, color: rgba };
    }
    const num = Number(v);
    if (Number.isFinite(num)) {
      return { payload: { scalar: num }, isPath: false, scalar: num };
    }
  }
  if (Array.isArray(v)) {
    const arr = v.map(Number);
    return { payload: { color: arr }, isPath: false, color: arr };
  }
  if (typeof v === "number") {
    return { payload: { scalar: v }, isPath: false, scalar: v };
  }
  // Default by role: factor → 0.5, color slot → black.
  if (isFactor) return { payload: { scalar: 0.5 }, isPath: false, scalar: 0.5 };
  return { payload: { color: [0, 0, 0, 1] }, isPath: false, color: [0, 0, 0, 1] };
}

function _coerceVector2Value(v, fallback = [0, 0]) {
  if (v == null || v === "") return fallback.slice(0, 2);
  if (Array.isArray(v)) {
    const nums = v.map(Number).filter((n) => Number.isFinite(n));
    if (nums.length >= 2) return [nums[0], nums[1]];
    if (nums.length === 1) return [nums[0], nums[0]];
    return fallback.slice(0, 2);
  }
  if (typeof v === "number") return Number.isFinite(v) ? [v, v] : fallback.slice(0, 2);
  // Dict shapes that mirror the Python `_coerce_vector2` helper. These can
  // come from prop sockets when an upstream node ships a wrapped vector
  // (e.g. {x, y}) or a typed primitive ({scalar} / {color} / {value}).
  if (typeof v === "object") {
    if ("x" in v || "y" in v) return _coerceVector2Value([v.x ?? fallback[0], v.y ?? fallback[1]], fallback);
    if ("value" in v) return _coerceVector2Value(v.value, fallback);
    if ("color" in v) return _coerceVector2Value(v.color, fallback);
    if ("scalar" in v) return _coerceVector2Value(v.scalar, fallback);
    return fallback.slice(0, 2);
  }
  const raw = String(v).trim().replace(/[\[\]()]/g, "").replace(/[×xX]/g, ",");
  const nums = raw.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length >= 2) return [nums[0], nums[1]];
  if (nums.length === 1) return [nums[0], nums[0]];
  return fallback.slice(0, 2);
}

// Detect strings that look like file paths (e.g. ".npy" UV maps) wired into
// a size/position socket. Returns the offending path or "" — used to warn
// users that a wired socket silently fell back to its default value.
function _vectorSocketUnparseableSource(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  if (!/[\\/]/.test(s) && !/\.[a-z0-9]{2,4}$/i.test(s)) return "";
  const stripped = s.replace(/[\[\]()]/g, "").replace(/[×xX]/g, ",");
  const nums = stripped.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length >= 1) return "";
  return s;
}

function _mediaPathList(v) {
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== "").map((x) => String(x));
  if (v == null || v === "") return [];
  return [String(v)];
}

function _jsBlend(a, b, mode) {
  const pair = (fn) => a.map((va, i) => fn(va, b[i] ?? 0));
  switch (mode) {
    case "add":      return pair((x, y) => x + y);
    case "multiply": return pair((x, y) => x * y);
    case "screen":   return pair((x, y) => 1 - (1 - x) * (1 - y));
    case "overlay":  return pair((x, y) => x < 0.5 ? 2 * x * y : 1 - 2 * (1 - x) * (1 - y));
    default:         return b.slice(); // "mix"
  }
}

// Parse a Sample Bundle expression into a list of integer indices given a
// known bundle length. Used both at run time and for the bundle-marker hint.
// Returns null when the expression is empty/wildcard (meaning "all items").
// Supports: "*", "", single index, negative indices, comma lists, and
// Python-style slices ("start:stop[:step]"). Out-of-range indices are
// silently dropped.
function parseSampleBundleExpression(expr, length) {
  const raw = String(expr ?? "").trim();
  if (!raw || raw === "*") return null;
  const norm = (i) => {
    if (!Number.isFinite(i)) return null;
    let v = Math.trunc(i);
    if (v < 0) v += length;
    if (v < 0 || v >= length) return null;
    return v;
  };
  const out = [];
  for (const partRaw of raw.split(",")) {
    const part = partRaw.trim();
    if (!part) continue;
    if (part.includes(":")) {
      const segs = part.split(":");
      const start = segs[0] === "" ? 0 : parseInt(segs[0], 10);
      const stop  = segs[1] === undefined || segs[1] === "" ? length : parseInt(segs[1], 10);
      const stepRaw = segs[2] === undefined || segs[2] === "" ? 1 : parseInt(segs[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(stepRaw) || stepRaw === 0) continue;
      let s = Math.trunc(start);
      let e = Math.trunc(stop);
      const step = Math.trunc(stepRaw);
      if (s < 0) s += length;
      if (e < 0) e += length;
      if (step > 0) {
        s = Math.max(0, s);
        e = Math.min(length, e);
        for (let i = s; i < e; i += step) if (i >= 0 && i < length) out.push(i);
      } else {
        s = Math.min(length - 1, s);
        e = Math.max(-1, e);
        for (let i = s; i > e; i += step) if (i >= 0 && i < length) out.push(i);
      }
    } else {
      const n = parseInt(part, 10);
      const v = norm(n);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

// Heuristic: does a `sample-bundle` node's expression yield multiple items?
// Used for the dashed-wire / bundle-marker hint before the graph has run.
function sampleBundleProducesBundle(n) {
  const expr = String(n?.props?.expression ?? "").trim();
  if (!expr || expr === "*") return true;
  if (expr.includes(",") || expr.includes(":")) return true;
  return false;
}

// Resolve the effective base media type of an output socket, peeking past
// reroutes and using the output socket type directly. Used by Create Bundle
// to lock its item slots to a single coherent type.
function effectiveBundleItemType(nodeId, socketId) {
  const seen = new Set();
  let curNode = nodeId;
  let curSock = socketId;
  while (curNode && !seen.has(`${curNode}:${curSock}`)) {
    seen.add(`${curNode}:${curSock}`);
    const n = graph.nodes[curNode];
    if (!n) return "any";
    if (isNodeMuted(n)) return "any";
    if (n.type === "reroute") {
      const incoming = activeIncomingEdges(curNode, "in")[0];
      if (!incoming) return "any";
      curNode = incoming.fromNode;
      curSock = incoming.fromSocket;
      continue;
    }
    const def = NODE_BY_TYPE[n.type];
    const sock = def?.outputs?.find((s) => s.id === curSock);
    return baseType(sock?.type || "any") || "any";
  }
  return "any";
}

function outputTypeForRenderedEdge(edge, seen = new Set()) {
  const key = edge.id || `${edge.fromNode}:${edge.fromSocket}->${edge.toNode}:${edge.toSocket}`;
  if (seen.has(key)) return "any";
  seen.add(key);
  const fromNode = graph.nodes[edge.fromNode];
  if (fromNode?.type === "reroute") {
    const incoming = activeIncomingEdges(edge.fromNode, "in")[0];
    if (incoming) return outputTypeForRenderedEdge(incoming, seen);
  }
  return outputSocketDef(edge.fromNode, edge.fromSocket)?.type || "any";
}

// ─── Node catalog ────────────────────────────────────────────────────────────

const NODE_CATALOG = [
  {
    category: "Primitives",
    nodes: [
      {
        type: "text-input", label: "String", desc: "Multi-line string value (markdown · @mentions)",
        defaultWidth: 280,
        defaultHeight: 240,
        inputs: [],
        outputs: [{ id: "out", label: "String", type: "text" }],
        props: [
          {
            id: "value", label: "Value", kind: "textarea",
            default: "",
            placeholder: "Markdown — **bold**, _italic_, `code`, > quote, lists, @reference…",
            mdEditor: true,
          },
          ...groupProps("highlights", [{
            id: "highlight_pairs", label: "Word Colors", kind: "textarea",
            default: "",
            placeholder: "sun = rgb(255, 210, 80)\nshadow = 120, 170, 255",
          }]),
        ],
      },
      {
        type: "number-input", label: "Number", desc: "Numeric value",
        inputs: [],
        outputs: [{ id: "out", label: "Number", type: "number" }],
        props: [{ id: "value", label: "Value", kind: "number", default: 1 }],
      },
      {
        type: "boolean-input", label: "Boolean", desc: "True or false value",
        inputs: [],
        outputs: [{ id: "out", label: "Boolean", type: "boolean" }],
        props: [{ id: "value", label: "Value", kind: "checkbox", default: false }],
      },
      {
        // Constant vector primitive (3-component). Feeds Vector / Mapping /
        // Mix wherever a vector input is expected. The value broadcasts
        // against per-pixel maps server-side.
        type: "vector-input", label: "Vector", desc: "Constant 3-component vector (X, Y, Z).",
        allInline: true,
        inputs: [],
        outputs: [{ id: "out", label: "Vector", type: "vector" }],
        props: [
          { id: "x", label: "X", kind: "number", default: 0.0 },
          { id: "y", label: "Y", kind: "number", default: 0.0 },
          { id: "z", label: "Z", kind: "number", default: 0.0 },
        ],
      },
      {
        // Unified file node — replaces the previous image-input/video-input/
        // filepath-input trio. Inherits the Preview node's UI (toolbar,
        // collapse-upstream button, refresh, media rendering) so the path
        // value is shown inline without an extra Preview wired downstream.
        type: "file", label: "File", desc: "Path to an image, video, or any file. Previews the artifact inline.",
        inputs: [],
        outputs: [{ id: "out", label: "Out", type: "any" }],
        props: [{ id: "path", label: "Path", kind: "text", default: "", placeholder: "path/to/image.png · clip.mp4 · .rundeer/batch.json" }],
        defaultWidth: 320,
        defaultHeight: 260,
        resizable: true,
      },
    ],
  },
  {
    category: "Operations",
    nodes: [
      {
        type: "text-join", label: "Join", desc: "Concatenate two values as strings",
        inputs: [
          { id: "a", label: "A", type: "any" },
          { id: "b", label: "B", type: "any" },
        ],
        outputs: [{ id: "out", label: "Joined", type: "text" }],
        props: [{ id: "sep", label: "Separator", kind: "text", default: " ", placeholder: " " }],
      },
      {
        type: "compress-image", label: "Compress",
        desc: "Compress images (re-encode), videos (re-encode), bundles (zip), or text (LLM summary)",
        inputs: [
          { id: "in", label: "Input", type: "any" },
          { id: "instructions", label: "Compression Instructions", type: "text" },
        ],
        outputs: [{ id: "out", label: "Compressed", type: "any" }],
        props: [
          { id: "quality", label: "Quality (0–100)", kind: "range", min: 1, max: 100, step: 1, default: 75 },
          { id: "max_dimension", label: "Max Dimension (px, 0=keep)", kind: "number", default: 0 },
        ],
      },
      {
        // Gaussian blur for images. Single image path in, single blurred
        // image path out. Bundles fan out automatically (one cached output
        // per input) so the node slots into a loop or feeds straight into
        // a Preview / cmd-edit downstream.
        type: "blur-image", label: "Blur",
        desc: "Gaussian blur an image (or bundle of images)",
        inputs: [
          { id: "in", label: "Image", type: "image" },
        ],
        outputs: [{ id: "out", label: "Blurred", type: "image" }],
        props: [
          { id: "radius", label: "Radius (px)", kind: "range", min: 0, max: 100, step: 0.5, default: 4 },
        ],
      },
      {
        type: "crop-media", label: "Crop",
        desc: "Crop an image or video. Size and position use pixel vectors; position starts at the source bottom-left.",
        inputs: [{ id: "in", label: "Media", type: "any" }],
        outputs: [{ id: "out", label: "Cropped", type: "any" }],
        props: [
          { id: "size", label: "Size", kind: "text", default: "512,512", placeholder: "width,height", socketType: "vector", passthroughWired: true },
          { id: "position", label: "Position", kind: "text", default: "0,0", placeholder: "x,y from bottom-left", socketType: "vector", passthroughWired: true },
        ],
      },
      {
        type: "resize-media", label: "Resize",
        desc: "Resize an image or video to a target size with aspect handling.",
        inputs: [{ id: "in", label: "Media", type: "any" }],
        outputs: [{ id: "out", label: "Resized", type: "any" }],
        props: [
          { id: "size", label: "Size", kind: "text", default: "1024,1024", placeholder: "width,height", socketType: "vector", passthroughWired: true },
          { id: "mode", label: "Integration", kind: "select", options: ["none", "fill", "stretch", "contain"], default: "contain", socketType: "text" },
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
      {
        type: "random", label: "Random", desc: "Generate a random integer, float, or string",
        inputs: [],
        outputs: [{ id: "out", label: "Value", type: "any" }],
        props: [
          { id: "mode", label: "Mode", kind: "select", options: ["integer", "float", "string"], default: "integer", socketType: "text" },
          { id: "min", label: "Min", kind: "number", default: 0 },
          { id: "max", label: "Max", kind: "number", default: 100 },
          { id: "charset", label: "Charset", kind: "select", options: ["alphanumeric", "alpha", "lower_alpha", "upper_alpha", "numeric", "hex", "special", "ascii"], default: "alphanumeric", socketType: "text" },
        ],
      },
    ],
  },
  {
    category: "Layout",
    nodes: [
      {
        type: "reroute", label: "Reroute", desc: "Pass a value through a compact routing point",
        defaultWidth: 88,
        defaultHeight: 30,
        inputs: [{ id: "in", label: "In", type: "any" }],
        outputs: [{ id: "out", label: "Out", type: "any" }],
        props: [],
      },
    ],
  },
  {
    category: "Prompt",
    nodes: [
      {
        type: "prompt", label: "Prompt", desc: "Prompt a model with optional image context",
        inputs: [
          { id: "prompt", label: "Prompt In", type: "text" },
          { id: "input", label: "Context Images", type: "image", multi: true },
        ],
        outputs: [{ id: "out", label: "Response", type: "text" }],
        props: [
          ...groupProps("model", PROMPT_MODEL_PROPS),
          ...groupProps("sampling", PROMPT_SAMPLING_PROPS),
        ],
      },
      {
        type: "prompt-filter", label: "Prompt Filter", desc: "Use a model to transform a prompt",
        inputs: [
          { id: "prompt", label: "Prompt In", type: "text" },
          { id: "instructions", label: "Instructions", type: "text" },
          { id: "input", label: "Context Images", type: "image", multi: true },
        ],
        outputs: [{ id: "out", label: "Prompt Out", type: "text" }],
        props: [
          ...groupProps("model", PROMPT_MODEL_PROPS),
          ...groupProps("sampling", PROMPT_SAMPLING_PROPS),
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
          { id: "trigger", label: "Run", type: "run" },
          { id: "subject", label: "Subject", type: "text" },
          { id: "input", label: "Reference Images", type: "image", multi: true },
        ],
        outputs: [{ id: "out", label: "Run →", type: "image" }],
        props: [
          ...groupProps("run", [...COMMAND_COMMON_PROPS, COMMAND_IMAGE_MODEL_PROP]),
          ...groupProps("media", COMMAND_IMAGE_PROPS),
          ...groupProps("references", COMMAND_REFERENCE_PROPS),
        ],
      },
      {
        type: "cmd-video", label: "Video", desc: "Generate video clips",
        inputs: [
          { id: "trigger", label: "Run", type: "run" },
          { id: "subject", label: "Subject", type: "text" },
          { id: "motion", label: "Motion", type: "text" },
          { id: "start_frame", label: "Start Frame", type: "image" },
          { id: "input", label: "Reference Images", type: "image", multi: true },
        ],
        outputs: [{ id: "out", label: "Run →", type: "video" }],
        props: [
          ...groupProps("run", [...COMMAND_COMMON_PROPS, COMMAND_VIDEO_MODEL_PROP]),
          ...groupProps("media", COMMAND_VIDEO_PROPS),
          ...groupProps("references", COMMAND_REFERENCE_PROPS),
        ],
      },
      {
        type: "cmd-edit", label: "Edit", desc: "Apply targeted edits",
        inputs: [
          { id: "trigger", label: "Run", type: "run" },
          { id: "input", label: "Input Images", type: "image", multi: true },
          { id: "subject", label: "Edit Instructions", type: "text" },
          { id: "motion", label: "Motion", type: "text" },
        ],
        outputs: [{ id: "out", label: "Run →", type: "any" }],
        props: [
          ...groupProps("run", [...COMMAND_COMMON_PROPS, COMMAND_AUTO_MODEL_PROP]),
          ...groupProps("media", [
            { id: "edit_type", label: "Type", kind: "select", options: ["image", "video"], default: "image" },
            { id: "aspect_ratio", label: "Aspect Ratio", kind: "text", default: "1:1" },
            { id: "resolution", label: "Resolution", kind: "text", default: "", placeholder: "1k/2k or 480p/720p/1080p" },
            { id: "duration", label: "Duration (s)", kind: "number", default: 6 },
          ]),
          ...groupProps("references", COMMAND_REFERENCE_PROPS),
          ...groupProps("chain", COMMAND_CHAIN_PROPS),
        ],
      },
      {
        type: "cmd-merge", label: "Merge", desc: "Composite multiple images",
        inputs: [
          { id: "trigger", label: "Run", type: "run" },
          { id: "input", label: "Input Images", type: "image", multi: true },
          { id: "subject", label: "Subject", type: "text" },
        ],
        outputs: [{ id: "out", label: "Run →", type: "image" }],
        props: [
          ...groupProps("run", [...COMMAND_COMMON_PROPS, COMMAND_IMAGE_MODEL_PROP]),
          ...groupProps("media", COMMAND_IMAGE_PROPS),
          ...groupProps("references", COMMAND_MEDIA_INPUT_PROPS),
        ],
      },
      {
        type: "cmd-extend", label: "Extend", desc: "Extend an existing video clip",
        inputs: [
          { id: "trigger", label: "Run", type: "run" },
          { id: "source", label: "Source Clip", type: "video" },
          { id: "subject", label: "Subject", type: "text" },
          { id: "motion", label: "Motion", type: "text" },
        ],
        outputs: [{ id: "out", label: "Run →", type: "video" }],
        props: [
          ...groupProps("run", [...COMMAND_COMMON_PROPS, COMMAND_VIDEO_MODEL_PROP]),
          ...groupProps("media", [
            { id: "duration", label: "Duration (s)", kind: "number", default: 6 },
          ]),
        ],
      },
    ],
  },
  {
    category: "Bundle",
    nodes: [
      {
        type: "folder-bundle", label: "Bundle", desc: "Emit a bundle from a folder, or extract frames from a video / animated image",
        defaultWidth: 280,
        inputs: [],
        outputs: [{ id: "out", label: "Bundle", type: "any" }],
        props: [
          { id: "path", label: "Path", kind: "text", default: "", placeholder: "folder/ or clip.mp4 / .mov / .webm / .gif / .webp" },
          ...groupProps("settings", [
            { id: "kind", label: "Folder Filter", kind: "select", options: ["all", "image", "video", "media"], default: "all" },
            { id: "recursive", label: "Recursive (folder)", kind: "checkbox", default: false },
          ]),
          ...groupProps("media", [
            { id: "fps", label: "Frames / sec (0 = native)", kind: "number", default: 0 },
            { id: "modulo", label: "Modulo (every Nth, 1 = all)", kind: "number", default: 1 },
            { id: "start", label: "Start (item/frame #, 0 = first)", kind: "number", default: 0 },
            { id: "end", label: "End (item/frame #, 0 = all)", kind: "number", default: 0 },
            { id: "format", label: "Frame Format", kind: "select", options: ["png", "jpg", "webp"], default: "png" },
          ]),
        ],
      },
      {
        // Create Bundle — collects N inputs into a single bundle wire.
        // The `items` socket is multi (a new empty placeholder row appears
        // as soon as one is wired), and addEdge enforces same-type plugs.
        type: "create-bundle", label: "Create Bundle", desc: "Combine multiple inputs of the same type into a bundle. Plug into the dotted socket — a new slot appears automatically.",
        defaultWidth: 240,
        inputs: [{ id: "items", label: "Item", type: "any", multi: true }],
        outputs: [{ id: "out", label: "Bundle", type: "any" }],
        props: [],
      },
      {
        // Sample Bundle — pick indices / slices / wildcards out of a bundle.
        // Expression syntax:
        //   *                 — entire bundle (passthrough)
        //   3                 — single item (output is scalar)
        //   -1                — last item
        //   0,2,4             — specific indices (output is a bundle)
        //   1:5  · 1:5:2      — Python-style slice (start:stop[:step])
        //   :3  · 2:          — open-ended slices
        //   any combination of the above separated by commas
        type: "sample-bundle", label: "Sample Bundle", desc: "Pick indices, slices, or a sub-bundle from a bundle. Single index → scalar, multiple → bundle.",
        defaultWidth: 260,
        inputs: [{ id: "bundle", label: "Bundle", type: "any" }],
        outputs: [
          { id: "out", label: "Out", type: "any" },
          { id: "count", label: "Count", type: "number" },
        ],
        props: [
          { id: "expression", label: "Indices", kind: "text", default: "0", placeholder: "0 · -1 · 0,2,4 · 1:5 · 1:5:2 · *" },
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
    category: "Triggers",
    nodes: [
      {
        // Fires a manual run for the connected subgraph (upstream + downstream
        // from each connected command node). Has only one output socket
        // (the `run` type, isolated from data wires) and a big play button.
        type: "run-trigger", label: "Run", desc: "Press play to run the connected command(s) and their upstream + downstream nodes.",
        defaultWidth: 200,
        defaultHeight: 170,
        inputs: [],
        outputs: [{ id: "run", label: "Run", type: "run" }],
        props: [],
      },
      {
        type: "pause", label: "Pause", desc: "Pause graph execution at this passthrough point, then resume from the node or footer.",
        defaultWidth: 220,
        defaultHeight: 170,
        inputs: [{ id: "in", label: "In", type: "any" }],
        outputs: [{ id: "out", label: "Out", type: "any" }],
        props: [],
      },
    ],
  },
  {
    category: "Coordinates",
    nodes: [
      {
        // Coordinate node: emits a fresh UV map at the requested size.
        // Treated as both a vector-map source and an image source: its
        // `.png` sidecar lets it feed any image consumer (cmd-edit,
        // preview, uv-render), while the `.npy` flows naturally into
        // downstream vector ops.
        type: "coordinate", label: "Coordinate",
        desc: "Generate a bottom-left UV coordinate map (R=u, G=v in [0,1]). Acts as both a vector field and an image - wire into Mapping, Vector, Render, Preview, or any command's image input.",
        defaultWidth: 260,
        defaultHeight: 240,
        resizable: true,
        inputs: [],
        outputs: [{ id: "uv", label: "UV", type: "vector-map" }],
        props: [
          { id: "width", label: "Width (px)", kind: "number", default: 1024 },
          { id: "height", label: "Height (px)", kind: "number", default: 1024 },
          { id: "dpi", label: "DPI", kind: "number", default: 72 },
          { id: "space", label: "Space", kind: "select", options: ["uv", "screen"], default: "uv" },
        ],
      },
      {
        // Blender-style Mapping (Point mode): scale → rotate → translate.
        type: "mapping", label: "Mapping",
        desc: "Transform a UV map: scale, rotate (deg), then translate, around a configurable pivot.",
        inputs: [{ id: "uv", label: "UV", type: "vector-map" }],
        outputs: [{ id: "out", label: "UV", type: "vector-map" }],
        props: [
          ...groupProps("location", [
            { id: "location_x", label: "X", kind: "number", default: 0.0 },
            { id: "location_y", label: "Y", kind: "number", default: 0.0 },
          ]),
          ...groupProps("rotation", [
            { id: "rotation", label: "Rotation (deg)", kind: "number", default: 0.0 },
          ]),
          ...groupProps("scale", [
            { id: "scale_x", label: "X", kind: "number", default: 1.0 },
            { id: "scale_y", label: "Y", kind: "number", default: 1.0 },
          ]),
          ...groupProps("pivot", [
            { id: "pivot_x", label: "X", kind: "number", default: 0.5 },
            { id: "pivot_y", label: "Y", kind: "number", default: 0.5 },
          ]),
        ],
      },
    ],
  },
  {
    category: "Vector",
    nodes: [
      {
        // Vector operations as a true per-pixel field operator (Blender's
        // Vector Math). A/B accept anything that can be coerced to a
        // per-pixel field: images, UV/vector maps, vector primitives, or
        // scalars. The backend (core.uv_ops.vector_op) broadcasts scalars
        // and vectors against spatial maps; mismatched spatial extents
        // are nearest-neighbor resized to the larger side.
        type: "vector-op", label: "Vector",
        desc: "Per-pixel vector op between two fields (image, UV map, vector, or scalar). Mirrors Blender's Vector Math node.",
        inputs: [
          { id: "a", label: "A", type: "any" },
          { id: "b", label: "B", type: "any" },
        ],
        outputs: [{ id: "out", label: "Out", type: "any" }],
        props: [
          {
            id: "op", label: "Operation", kind: "select",
            options: ["add", "subtract", "multiply", "divide", "scale", "dot", "cross", "normalize", "length", "floor", "fract", "min", "max", "mix"],
            default: "add",
          },
        ],
      },
      {
        // Blender-style Mix node. Factor/A/B are prop sockets so each row is
        // both the connectable socket and its local fallback control.
        type: "mix", label: "Mix",
        desc: "Blend two inputs by a factor. A/B default to color controls; factor can be a number or an image/map. Mirrors Blender's Mix node.",
        inputs: [],
        outputs: [{ id: "out", label: "Out", type: "any" }],
        props: [
          { id: "factor", label: "Factor", kind: "range", min: 0, max: 1, step: 0.01, default: 0.5, socketType: "any", passthroughWired: true },
          { id: "a", label: "A", kind: "color", default: "#000000", socketType: "any" },
          { id: "b", label: "B", kind: "color", default: "#ffffff", socketType: "any" },
          { id: "mode", label: "Mode", kind: "select", options: ["mix", "add", "multiply", "screen", "overlay"], default: "mix" },
          { id: "clamp", label: "Clamp Factor", kind: "checkbox", default: true },
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
      {
        type: "canvas", label: "Canvas", desc: "Composite multiple images on a sized canvas. Each image can be paired with a bottom-left position vector.",
        inputs: [
          { id: "images", label: "Image", type: "image", multi: true },
          { id: "positions", label: "Position", type: "vector", multi: true },
        ],
        outputs: [{ id: "out", label: "Image", type: "image" }],
        props: [
          { id: "size", label: "Size", kind: "text", default: "1024,1024", placeholder: "width,height", socketType: "vector", passthroughWired: true },
        ],
        defaultWidth: 360,
        defaultHeight: 300,
        resizable: true,
      },
      {
        // Render: samples a pixel image at the UV coordinates in `uv`.
        // Output is a regular image path, so downstream nodes treat it
        // exactly like any other image. Shares the Preview node's inline
        // rendering machinery (collapse, zoom, refresh).
        type: "uv-render", label: "Render",
        desc: "Sample a pixel image using a bottom-left UV coordinate map. Like Blender's Image Texture sampled by a custom UV.",
        inputs: [
          { id: "pixel", label: "Pixel", type: "image" },
          { id: "uv", label: "UV", type: "vector-map" },
        ],
        outputs: [{ id: "out", label: "Image", type: "image" }],
        props: [
          { id: "interp", label: "Interpolation", kind: "select", options: ["bilinear", "nearest"], default: "bilinear" },
          { id: "extension", label: "Extension", kind: "select", options: ["clamp", "repeat", "mirror"], default: "clamp" },
        ],
        defaultWidth: 320,
        defaultHeight: 260,
        resizable: true,
      },
    ],
  },

  // ─── Agent Brain ────────────────────────────────────────────────────────
  // Three special nodes describe the chat agent: `brain` composes the
  // system prompt + tool list, `agent` carries runtime settings and is
  // the destination of the brain, and `tool-flag` enables/overrides a
  // single tool. Everything else on the canvas (text-input, create-bundle,
  // preview, …) comes from the regular palette — the brain just wires
  // them together.
  {
    category: "Agent Brain",
    nodes: [
      {
        type: "brain", label: "Brain",
        desc: "Composes the agent's system prompt + tool list. Plug strings (or bundles of strings) into Sections, and Tool Flag nodes (or bundles of them) into Tools. The compiled brain text comes out as the Brain output.",
        defaultWidth: 280,
        inputs: [
          { id: "sections", label: "Sections", type: "text", multi: true },
          { id: "tools", label: "Tools", type: "any", multi: true },
        ],
        outputs: [{ id: "out", label: "Brain", type: "text" }],
        props: [],
      },
      {
        type: "agent", label: "Agent",
        desc: "The chat agent itself. Connect a Brain into its input. Props are runtime overrides (model, temperature, iteration & rate caps, vision).",
        defaultWidth: 320,
        inputs: [{ id: "brain", label: "Brain", type: "text" }],
        outputs: [],
        props: [
          { id: "model", label: "Model", kind: "text", default: "", placeholder: "inherits global agent.model" },
          { id: "temperature", label: "Temperature", kind: "number", default: null, placeholder: "leave blank for default" },
          { id: "max_tool_iterations", label: "Max Tool Iterations", kind: "number", default: null, placeholder: "default 12" },
          { id: "max_web_search_per_turn", label: "Max Web Searches / Turn", kind: "number", default: null },
          { id: "max_file_bytes", label: "Max File Bytes", kind: "number", default: null },
          { id: "max_list_entries", label: "Max List Entries", kind: "number", default: null },
          { id: "vision_enabled", label: "Vision Enabled", kind: "checkbox", default: true },
        ],
      },
      {
        type: "tool-flag", label: "Tool Flag",
        desc: "Enable/disable a tool and optionally override its description, category, or destructive flag. Connect into the Brain's Tools input (directly or via a Bundle).",
        defaultWidth: 320,
        inputs: [],
        outputs: [{ id: "out", label: "Tool", type: "any" }],
        props: [
          { id: "tool_name", label: "Tool Name", kind: "text", default: "" },
          { id: "enabled", label: "Enabled", kind: "checkbox", default: true },
          { id: "description", label: "Description override", kind: "textarea", default: "", placeholder: "leave blank for built-in" },
          { id: "category", label: "Category override", kind: "select", options: ["", "read", "mutate", "execute", "vision", "self_modify"], default: "" },
          { id: "destructive", label: "Destructive override", kind: "select", options: ["", "true", "false"], default: "" },
        ],
      },
    ],
  },
];

const NODE_BY_TYPE = Object.fromEntries(
  NODE_CATALOG.flatMap((cat) => cat.nodes.map((n) => [n.type, { ...n, category: cat.category }]))
);

const PREVIEW_TYPES = new Set(["preview", "file", "uv-render", "coordinate", "canvas"]);
const LIVE_UPDATE_TYPES = new Set(["mix"]);
const LEGACY_PREVIEW_TYPES = new Set(["preview-image", "preview-video", "preview-text"]);
// Legacy primitive file-source types that were folded into the unified `file`
// node. Migrated on load.
const LEGACY_FILE_TYPES = new Set(["image-input", "video-input", "filepath-input"]);
const COMMAND_TYPES = new Set(["cmd-image", "cmd-video", "cmd-edit", "cmd-merge", "cmd-extend"]);
const PREVIEW_ZOOM_MIN = 1;
const PREVIEW_ZOOM_MAX = 4;
const PREVIEW_ZOOM_WHEEL_SENSITIVITY = 0.0015;
const PREVIEW_ZOOM_STEP = 1.16;
const TEXT_ZOOM_MIN = 0.75;
const TEXT_ZOOM_MAX = 1.8;
const TEXT_ZOOM_WHEEL_SENSITIVITY = 0.0014;
const FOLD_EXPOSED_GUTTER = 14;

function primaryNodeResult(node, outputs) {
  const def = NODE_BY_TYPE[node?.type];
  const outSock = (def?.outputs || [])[0];
  if (!outSock) return null;
  const value = outputs ? outputs[outSock.id] : undefined;
  let kind = outSock.type || "any";
  if (Array.isArray(value)) {
    if (kind === "image" || kind === "any") kind = "image-bundle";
    else if (kind === "video") kind = "video-bundle";
  }
  return { kind, value: value === undefined ? "" : value };
}

function stashNodeResult(nodeId, outputs) {
  const node = graph.nodes[nodeId];
  const result = primaryNodeResult(node, outputs);
  if (!node || !result) return false;
  const before = JSON.stringify(node.lastResult || null);
  node.lastResult = result;
  const changed = JSON.stringify(node.lastResult) !== before;
  if (changed) {
    const el = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (el) el.dataset.signature = "stale";
  }
  return changed;
}

// ─── Graph state ─────────────────────────────────────────────────────────────

const graph = {
  nodes: {},   // id → { id, type, x, y, props, width, lastResult, hidden, collapsedBy, foldLocked, muted }
  edges: [],
  _nextId: 1,
};

function isNodeMuted(nodeOrId) {
  const node = typeof nodeOrId === "string" ? graph.nodes[nodeOrId] : nodeOrId;
  return Boolean(node?.muted);
}

function isEdgeMuted(edge) {
  if (!edge) return false;
  return isNodeMuted(edge.fromNode) || isNodeMuted(edge.toNode);
}

function activeIncomingEdges(nodeId, socketId = null) {
  if (!nodeId || isNodeMuted(nodeId)) return [];
  return graph.edges.filter((edge) => {
    if (edge.toNode !== nodeId) return false;
    if (socketId !== null && edge.toSocket !== socketId) return false;
    return !isEdgeMuted(edge);
  });
}

function activeOutgoingEdges(nodeId, socketId = null) {
  if (!nodeId || isNodeMuted(nodeId)) return [];
  return graph.edges.filter((edge) => {
    if (edge.fromNode !== nodeId) return false;
    if (socketId !== null && edge.fromSocket !== socketId) return false;
    return !isEdgeMuted(edge);
  });
}

function mutedNodeOutputs(def) {
  const outputs = {};
  for (const sock of def?.outputs || []) outputs[sock.id] = "";
  return outputs;
}

function genNodeId(preferredId = null) {
  const wanted = preferredId == null ? "" : String(preferredId).trim();
  if (wanted && !graph.nodes[wanted]) {
    const match = wanted.match(/^n(\d+)$/);
    if (match) graph._nextId = Math.max(graph._nextId, Number(match[1]) + 1);
    return wanted;
  }
  let id = "";
  do { id = `n${graph._nextId++}`; } while (graph.nodes[id]);
  return id;
}
function genEdgeId() { return `e${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

// ─── Viewport ────────────────────────────────────────────────────────────────

const vp = { x: 0, y: 0, zoom: 1 };
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 2.75;
const ZOOM_WHEEL_SENSITIVITY = 0.0018;
const GRID_CELL_SIZE = 32;
const GRID_MAJOR_EVERY = 5;

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positiveModulo(value, size) {
  if (!size) return 0;
  return ((value % size) + size) % size;
}

function px(value) {
  return `${Math.round(value * 1000) / 1000}px`;
}

function applyViewport() {
  const canvas = document.getElementById("nodeCanvas");
  canvas.style.transform = `translate(${px(vp.x)}, ${px(vp.y)}) scale(${vp.zoom})`;
  updateViewportGrid();
  const zd = document.getElementById("zoomDisplay");
  if (zd) zd.textContent = `${Math.round(vp.zoom * 100)}%`;
}

function updateViewportGrid() {
  const wrap = document.getElementById("canvasWrap");
  if (!wrap) return;
  const minor = GRID_CELL_SIZE * vp.zoom;
  const major = minor * GRID_MAJOR_EVERY;
  wrap.style.setProperty("--ne-grid-size", px(minor));
  wrap.style.setProperty("--ne-grid-major-size", px(major));
  wrap.style.setProperty("--ne-grid-x", px(positiveModulo(vp.x, minor)));
  wrap.style.setProperty("--ne-grid-y", px(positiveModulo(vp.y, minor)));
  wrap.style.setProperty("--ne-grid-major-x", px(positiveModulo(vp.x, major)));
  wrap.style.setProperty("--ne-grid-major-y", px(positiveModulo(vp.y, major)));
  wrap.style.setProperty("--ne-grid-opacity", String(clampValue(0.18 + vp.zoom * 0.11, 0.22, 0.42)));
}

function screenToCanvas(sx, sy) {
  const rect = document.getElementById("canvasWrap").getBoundingClientRect();
  return {
    x: (sx - rect.left - vp.x) / vp.zoom,
    y: (sy - rect.top - vp.y) / vp.zoom,
  };
}

function preserveCanvasRightEdge(mutator) {
  const wrap = document.getElementById("canvasWrap");
  const beforeRight = wrap?.getBoundingClientRect().right;
  mutator();
  if (!wrap || !Number.isFinite(beforeRight)) return;
  const afterRight = wrap.getBoundingClientRect().right;
  const dx = afterRight - beforeRight;
  if (Math.abs(dx) < 0.5) return;
  vp.x += dx;
  applyViewport();
  renderConnections();
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
  reroutePlacement: null,
  boxStart: null,
  selection: new Set(),
  resizeHoverEl: null,
  // Modal transform (Blender G/R/S)
  modal: null,           // { kind: "G"|"R"|"S", startMouse:{x,y}, snapshots, companionSnapshots }
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
  const id = genNodeId(opts.id);
  const props = {};
  for (const p of def.props || []) props[p.id] = p.default ?? "";
  Object.assign(props, opts.props || {});
  // Adding a bare Decompose (e.g. via legacy graph load or undo): assign a
  // unique loop_id and auto-add the matching Output node.
  const isStandaloneDecompose = (type === "loop-decompose" && !opts.skipPair);
  if (isStandaloneDecompose) {
    props.loop_id = nextLoopId();
  }
  graph.nodes[id] = {
    id, type, x: canvasX, y: canvasY, props,
    title: "",
    width: def.defaultWidth || 220,
    height: def.defaultHeight || null,
    collapsed: false,
    foldLocked: false,
    previewMode: null,
    previewIndex: 0,
    previewZoom: 1,
    previewPanX: 0,
    previewPanY: 0,
    textZoom: 1,
    minimized: false,
    muted: Boolean(opts.muted),
    collapsedPanels: {},
    lastRunMs: null,
    lastRunStatus: null,
    lastRunCount: 0,
  };
  migrateMixNode(graph.nodes[id]);
  if (isStandaloneDecompose) {
    const outDef = NODE_BY_TYPE["loop-output"];
    const outProps = {};
    for (const p of outDef.props || []) outProps[p.id] = p.default ?? "";
    outProps.loop_id = props.loop_id;
    const outId = genNodeId();
    graph.nodes[outId] = {
      id: outId, type: "loop-output",
      x: canvasX + 360, y: canvasY, props: outProps,
      title: "",
      width: outDef.defaultWidth || 220,
      height: outDef.defaultHeight || null,
      collapsed: false,
      foldLocked: false,
      previewMode: null,
      previewIndex: 0,
      previewZoom: 1,
      previewPanX: 0,
      previewPanY: 0,
      textZoom: 1,
      minimized: false,
      muted: Boolean(opts.muted),
      collapsedPanels: {},
      lastRunMs: null,
      lastRunStatus: null,
      lastRunCount: 0,
    };
  }
  renderGraph();
  if (!opts.skipSelect) selectOnly(id);
  if (!opts.skipAutosave) scheduleAutosave();
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
  Object.assign(decProps, opts.props || {});
  decProps.loop_id = loopId;
  const decId = genNodeId(opts.id);
  graph.nodes[decId] = {
    id: decId, type: "loop-decompose",
    x: canvasX, y: canvasY, props: decProps,
    title: "",
    width: decDef.defaultWidth || 220, collapsed: false,
    foldLocked: false,
    previewMode: null,
    previewIndex: 0,
    previewZoom: 1,
    previewPanX: 0,
    previewPanY: 0,
    textZoom: 1,
    minimized: false,
    muted: Boolean(opts.muted),
    collapsedPanels: {},
    lastRunMs: null,
    lastRunStatus: null,
    lastRunCount: 0,
  };
  const outDef = NODE_BY_TYPE["loop-output"];
  const outProps = {};
  for (const p of outDef.props || []) outProps[p.id] = p.default ?? "";
  outProps.loop_id = loopId;
  const outId = genNodeId();
  graph.nodes[outId] = {
    id: outId, type: "loop-output",
    x: canvasX + 360, y: canvasY, props: outProps,
    title: "",
    width: outDef.defaultWidth || 220, collapsed: false,
    foldLocked: false,
    previewMode: null,
    previewIndex: 0,
    previewZoom: 1,
    previewPanX: 0,
    previewPanY: 0,
    textZoom: 1,
    minimized: false,
    muted: Boolean(opts.muted),
    collapsedPanels: {},
    lastRunMs: null,
    lastRunStatus: null,
    lastRunCount: 0,
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
  if (propDef.socketType) return propDef.socketType;
  if (propDef.kind === "checkbox") return "boolean";
  if (propDef.kind === "number" || propDef.kind === "range") return "number";
  if (propDef.kind === "color") return "color";
  return "text";
}

function inputSocketDefsForDef(def) {
  return [
    ...(def?.inputs || []),
    ...(def?.props || []).map((prop) => ({
      id: prop.id,
      label: prop.label,
      type: socketTypeForProp(prop),
      multi: false,
      _isProp: true,
    })),
  ];
}

function canonicalInputSocketId(nodeId, socketId) {
  const node = graph.nodes[nodeId];
  if (node?.type === "mix") {
    if (socketId === "color_a") return "a";
    if (socketId === "color_b") return "b";
  }
  return socketId;
}

function inputSocketDef(nodeId, socketId) {
  const def = NODE_BY_TYPE[graph.nodes[nodeId]?.type];
  if (!def) return null;
  socketId = canonicalInputSocketId(nodeId, socketId);
  const direct = (def.inputs || []).find((sock) => sock.id === socketId);
  if (direct) return direct;
  const propDef = (def.props || []).find((prop) => prop.id === socketId);
  if (!propDef) return null;
  return { id: propDef.id, label: propDef.label, type: socketTypeForProp(propDef), multi: false };
}

function outputSocketDef(nodeId, socketId) {
  const def = NODE_BY_TYPE[graph.nodes[nodeId]?.type];
  if (!def) return null;
  return (def.outputs || []).find((sock) => sock.id === socketId) || null;
}

function nodeInputSocketIds(nodeId) {
  const def = NODE_BY_TYPE[graph.nodes[nodeId]?.type];
  if (!def) return [];
  return [
    ...(def.inputs || []).map((sock) => sock.id),
    ...(def.props || []).map((prop) => prop.id),
  ];
}

function nodeOutputSocketIds(nodeId) {
  const def = NODE_BY_TYPE[graph.nodes[nodeId]?.type];
  if (!def) return [];
  return (def.outputs || []).map((sock) => sock.id);
}

function shouldWrapSocketSection(rows) {
  return rows.length > 1;
}

function aggregateSocketType(nodeId, socketIds, isOutput) {
  const defs = (socketIds || [])
    .map((socketId) => (isOutput ? outputSocketDef(nodeId, socketId) : inputSocketDef(nodeId, socketId)))
    .filter(Boolean);
  const types = [...new Set(defs.map((sock) => baseType(sock.type)))];
  if (types.length === 1) return types[0];
  return "any";
}

function resolveAggregateSocketId(nodeId, socketIds, isOutput, otherType) {
  const defs = (socketIds || [])
    .map((socketId) => (isOutput ? outputSocketDef(nodeId, socketId) : inputSocketDef(nodeId, socketId)))
    .filter(Boolean);
  if (defs.length === 0) return null;
  const compatible = defs.filter((sock) => canConnect(sock.type, otherType));
  if (compatible.length === 0) return defs[0].id;
  const exact = compatible.find((sock) => sock.type === otherType);
  if (exact) return exact.id;
  const sameBase = compatible.find((sock) => otherType && baseType(sock.type) === baseType(otherType));
  if (sameBase) return sameBase.id;
  const wildcard = compatible.find((sock) => sock.type === "any" || otherType === "any");
  return (wildcard || compatible[0]).id;
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
  const removed = graph.edges.find((e) => e.id === edgeId);
  graph.edges = graph.edges.filter((e) => e.id !== edgeId);
  if (removed) maintainCompressInstructions(removed.toNode, removed.toSocket);
  renderGraph();
  scheduleAutosave();
  schedulePreviewRefresh();
}

function addEdge(fromNode, fromSocket, toNode, toSocket) {
  // Prevent self-loops
  if (fromNode === toNode) return;
  toSocket = canonicalInputSocketId(toNode, toSocket);
  const fromSockDef = outputSocketDef(fromNode, fromSocket);
  const toSockDef = inputSocketDef(toNode, toSocket);
  if (!fromSockDef || !toSockDef || !canConnect(fromSockDef.type, toSockDef.type)) {
    setHint("incompatible socket types");
    setTimeout(clearHint, 1200);
    return;
  }
  // Create Bundle: enforce that every wired item shares the same base media
  // type (image/video/text/etc.) so the resulting bundle is coherent. The
  // first connection sets the bundle's effective type; later ones must match.
  if (graph.nodes[toNode]?.type === "create-bundle" && toSocket === "items") {
    const existing = graph.edges.filter((e) => e.toNode === toNode && e.toSocket === "items");
    if (existing.length > 0) {
      const newType = effectiveBundleItemType(fromNode, fromSocket);
      const lockedType = existing
        .map((e) => effectiveBundleItemType(e.fromNode, e.fromSocket))
        .find((t) => t && t !== "any");
      if (lockedType && newType && newType !== "any" && lockedType !== newType) {
        setHint(`Create Bundle is locked to ${lockedType}`);
        setTimeout(clearHint, 1600);
        return;
      }
    }
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
  maintainCompressInstructions(toNode, toSocket);
  renderGraph();
  scheduleAutosave();
  schedulePreviewRefresh();
}

// Compress node bookkeeping. When the `in` socket gains a text upstream we
// spawn (or reuse) a String node to the left, pre-filled with a useful
// summarization prompt, and wire it into the `instructions` socket. When the
// upstream is no longer text we tear down the helper edge but never delete
// the spawned String node — the user keeps any edits to it.
const COMPRESS_HELPER_PROMPT =
  "Summarize and compress the input text. Keep all the same meaning, intent, " +
  "facts, and tone — strip filler, redundancy, and rephrase verbose passages " +
  "into tighter prose. Do not invent or omit information. Return only the " +
  "compressed text, no preamble.";

function maintainCompressInstructions(nodeId, changedSocket) {
  const node = graph.nodes[nodeId];
  if (!node || node.type !== "compress-image") return;
  if (changedSocket !== "in" && changedSocket !== "instructions") return;
  const hasText = compressInHasTextUpstream(nodeId);
  if (!hasText) {
    // Drop any edge feeding `instructions`; helper node (if any) stays put.
    graph.edges = graph.edges.filter(
      (e) => !(e.toNode === nodeId && e.toSocket === "instructions")
    );
    return;
  }
  // Text upstream → ensure an instructions edge exists.
  const existing = graph.edges.find(
    (e) => e.toNode === nodeId && e.toSocket === "instructions"
  );
  if (existing) return;
  node.props ||= {};
  let helperId = node.props._instructionsHelperId;
  if (!helperId || !graph.nodes[helperId]) {
    helperId = createCompressInstructionsHelper(node);
    node.props._instructionsHelperId = helperId;
  }
  graph.edges.push({
    id: genEdgeId(),
    fromNode: helperId,
    fromSocket: "out",
    toNode: nodeId,
    toSocket: "instructions",
  });
}

function createCompressInstructionsHelper(compressNode) {
  const def = NODE_BY_TYPE["text-input"];
  const id = genNodeId();
  const props = {};
  for (const p of def.props || []) props[p.id] = p.default ?? "";
  props.value = COMPRESS_HELPER_PROMPT;
  const width = def.defaultWidth || 280;
  graph.nodes[id] = {
    id, type: "text-input",
    x: (compressNode.x || 0) - width - 40,
    y: (compressNode.y || 0) + 30,
    props,
    title: "Compress · Instructions",
    width,
    height: def.defaultHeight || null,
    collapsed: false,
    foldLocked: false,
    previewMode: null,
    previewIndex: 0,
    previewZoom: 1,
    previewPanX: 0,
    previewPanY: 0,
    textZoom: 1,
    minimized: false,
    collapsedPanels: {},
    lastRunMs: null,
    lastRunStatus: null,
    lastRunCount: 0,
  };
  return id;
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
    n.collapseIndex = null;
    n.collapseCount = null;
    n.foldAnchorId = null;
    n.foldIndex = null;
    n.foldCount = null;
    n.hidden = false;
  }
  // Apply: each collapsed preview hides every node upstream of it
  for (const n of Object.values(graph.nodes)) {
    if (PREVIEW_TYPES.has(n.type) && n.collapsed) {
      const upstream = getUpstreamNodes(n.id);
      upstream.delete(n.id);
      const upstreamIds = [...upstream].sort((a, b) => {
        const an = graph.nodes[a];
        const bn = graph.nodes[b];
        return (an?.y ?? 0) - (bn?.y ?? 0) || (an?.x ?? 0) - (bn?.x ?? 0) || a.localeCompare(b);
      });
      const hiddenIds = [];
      const exposedNodeIds = [];
      for (const upId of upstreamIds) {
        const target = graph.nodes[upId];
        if (!target) continue;
        if (target.foldLocked) {
          target.hidden = false;
          exposedNodeIds.push(upId);
        } else {
          hiddenIds.push(upId);
        }
      }
      hiddenIds.forEach((upId, i) => {
        const target = graph.nodes[upId];
        if (!target) return;
        target.collapsedBy = n.id;
        target.collapseIndex = i;
        target.collapseCount = hiddenIds.length;
        target.hidden = true;
      });
      exposedNodeIds.forEach((upId, i) => {
        const target = graph.nodes[upId];
        if (!target) return;
        target.foldAnchorId = n.id;
        target.foldIndex = i;
        target.foldCount = exposedNodeIds.length;
      });
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

function toggleFoldLock(nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  node.foldLocked = !node.foldLocked;
  renderGraph();
  animateConnectionsFor(320);
  scheduleAutosave();
}

function collapsedPreviewCompanionNodeIds(previewId) {
  const node = graph.nodes[previewId];
  if (!node || !PREVIEW_TYPES.has(node.type) || !node.collapsed) return [];
  const ids = new Set();
  for (const other of Object.values(graph.nodes)) {
    if (!other || other.id === previewId) continue;
    if (other.collapsedBy === previewId || other.foldAnchorId === previewId) ids.add(other.id);
  }
  if (ids.size === 0) {
    const upstream = getUpstreamNodes(previewId);
    upstream.delete(previewId);
    for (const id of upstream) ids.add(id);
  }
  return [...ids].filter((id) => graph.nodes[id]);
}

function moveCollapsedPreviewCompanions(previewId, dx, dy, movedIds = new Set()) {
  for (const id of collapsedPreviewCompanionNodeIds(previewId)) {
    if (movedIds.has(id)) continue;
    const node = graph.nodes[id];
    if (!node) continue;
    node.x += dx;
    node.y += dy;
    movedIds.add(id);
  }
}

function collapsedPreviewCompanionSnapshots(previewIds, selectedIds = new Set()) {
  const snapshots = new Map();
  const movedIds = new Set(selectedIds);
  for (const previewId of previewIds) {
    const node = graph.nodes[previewId];
    if (!node || !PREVIEW_TYPES.has(node.type) || !node.collapsed) continue;
    for (const id of collapsedPreviewCompanionNodeIds(previewId)) {
      if (movedIds.has(id) || snapshots.has(id)) continue;
      const companion = graph.nodes[id];
      if (!companion) continue;
      snapshots.set(id, { x: companion.x, y: companion.y });
      movedIds.add(id);
    }
  }
  return snapshots;
}

function foldExposedNodeIds(anchorId) {
  return Object.values(graph.nodes)
    .filter((n) => n.foldAnchorId === anchorId && n.foldLocked && !n.hidden)
    .sort((a, b) =>
      (a.foldIndex ?? 0) - (b.foldIndex ?? 0) ||
      (a.y ?? 0) - (b.y ?? 0) ||
      (a.x ?? 0) - (b.x ?? 0) ||
      String(a.id).localeCompare(String(b.id))
    )
    .map((n) => n.id);
}

function nodeRenderedSize(node) {
  if (!node) return { w: 220, h: 80 };
  const def = NODE_BY_TYPE[node.type] || {};
  return {
    w: node.width || def.defaultWidth || 220,
    h: estimatedNodeHeight(node),
  };
}

function foldExposedNodeLayout(anchorId) {
  const anchor = graph.nodes[anchorId];
  if (!anchor) return new Map();
  const anchorSize = nodeRenderedSize(anchor);
  const anchorH = Math.max(1, anchorSize.h);
  const ids = foldExposedNodeIds(anchorId);
  const columns = [];
  let column = null;
  const finishColumn = () => {
    if (!column || column.items.length === 0) return;
    columns.push(column);
    column = null;
  };

  for (const id of ids) {
    const node = graph.nodes[id];
    if (!node) continue;
    const size = nodeRenderedSize(node);
    const item = { id, w: size.w, h: size.h };
    const nextHeight = column
      ? column.height + FOLD_EXPOSED_GUTTER + item.h
      : item.h;
    if (column && nextHeight > anchorH) finishColumn();
    if (!column) column = { items: [], width: 0, height: 0 };
    if (column.items.length > 0) column.height += FOLD_EXPOSED_GUTTER;
    column.items.push(item);
    column.width = Math.max(column.width, item.w);
    column.height += item.h;
  }
  finishColumn();

  const positions = new Map();
  let rightEdge = anchor.x;
  for (const col of columns) {
    const x = Math.round(rightEdge - FOLD_EXPOSED_GUTTER - col.width);
    const top = Math.round(anchor.y + Math.max(0, (anchorH - col.height) / 2));
    let y = top;
    for (const item of col.items) {
      positions.set(item.id, {
        x: Math.round(x + (col.width - item.w) / 2),
        y: Math.round(y),
      });
      y += item.h + FOLD_EXPOSED_GUTTER;
    }
    rightEdge = x;
  }
  return positions;
}

function foldExposedNodePosition(node) {
  if (!node?.foldAnchorId || !node.foldLocked) return null;
  return foldExposedNodeLayout(node.foldAnchorId).get(node.id) || null;
}

function nodeRenderedPosition(nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return null;
  return foldExposedNodePosition(node) || { x: node.x, y: node.y };
}

function nodeUsesFoldLayout(node) {
  if (!node) return false;
  return Boolean(node.foldAnchorId) || foldExposedNodeIds(node.id).length > 0;
}

function toggleNodeMinimized(nodeIds) {
  const ids = (Array.isArray(nodeIds) ? nodeIds : [nodeIds]).filter((id) => graph.nodes[id] && !graph.nodes[id].hidden);
  if (ids.length === 0) {
    setHint("H: select a node first");
    setTimeout(clearHint, 1400);
    return;
  }
  const nextState = ids.some((id) => !graph.nodes[id].minimized);
  for (const id of ids) {
    const node = graph.nodes[id];
    if (!node) continue;
    node.minimized = nextState;
    node.height = null;
  }
  renderGraph();
  if (ids.length === 1 && ix.selection.has(ids[0])) renderProps(ids[0]);
  scheduleAutosave();
  setHint(nextState ? `hid ${ids.length} node${ids.length === 1 ? "" : "s"} (H)` : `restored ${ids.length} node${ids.length === 1 ? "" : "s"} (H)`);
  setTimeout(clearHint, 1200);
}

function toggleNodeMuted(nodeIds) {
  const ids = (Array.isArray(nodeIds) ? nodeIds : [nodeIds]).filter((id) => graph.nodes[id]);
  if (ids.length === 0) {
    setHint("M: select a node first");
    setTimeout(clearHint, 1400);
    return;
  }
  const nextState = ids.some((id) => !graph.nodes[id].muted);
  for (const id of ids) {
    const node = graph.nodes[id];
    if (!node) continue;
    node.muted = nextState;
    if (nextState) {
      node.lastRunStatus = null;
      node.lastRunMs = null;
      node.lastRunCount = 0;
    }
  }
  renderGraph();
  if (ix.selection.size === 1) renderProps([...ix.selection][0]);
  scheduleAutosave();
  setHint(nextState ? `muted ${ids.length} node${ids.length === 1 ? "" : "s"} (M)` : `unmuted ${ids.length} node${ids.length === 1 ? "" : "s"} (M)`);
  setTimeout(clearHint, 1200);
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
    enforceNodeMinimumSize(id, node, el);

    // Position: hidden nodes animate into a small stack tucked beneath their
    // collapsed preview, so they disappear under the preview instead of on top.
    // Fold-exposed nodes render in a temporary horizontal dock; their stored
    // x/y remains the expanded graph layout, updated by group drags below.
    const target = node.hidden && node.collapsedBy && graph.nodes[node.collapsedBy]
      ? graph.nodes[node.collapsedBy]
      : null;
    const foldPos = !target ? foldExposedNodePosition(node) : null;
    if (target) {
      const targetW = target.width || NODE_BY_TYPE[target.type]?.defaultWidth || 220;
      const targetH = target.height || NODE_BY_TYPE[target.type]?.defaultHeight || estimatedNodeHeight(target);
      const nodeW = node.width || NODE_BY_TYPE[node.type]?.defaultWidth || 220;
      const fan = Math.min(node.collapseCount || 1, 5);
      const idx = node.collapseIndex || 0;
      const centered = idx - (fan - 1) / 2;
      el.style.left = `${target.x + (targetW - nodeW) / 2 + centered * 8}px`;
      el.style.top = `${target.y + Math.max(42, targetH - 34) + Math.min(idx, 6) * 5}px`;
      el.style.setProperty("--collapse-index", String(idx));
      el.classList.add("is-collapsed-hidden");
      el.classList.remove("is-fold-exposed");
    } else {
      el.style.left = `${foldPos ? foldPos.x : node.x}px`;
      el.style.top = `${foldPos ? foldPos.y : node.y}px`;
      el.style.removeProperty("--collapse-index");
      el.classList.remove("is-collapsed-hidden");
      el.classList.toggle("is-fold-exposed", Boolean(foldPos));
    }
    el.classList.toggle("is-selected", ix.selection.has(id));
    el.classList.toggle("is-preview", PREVIEW_TYPES.has(node.type));
    el.classList.toggle("is-muted", Boolean(node.muted));
    paintNodeRunChrome(id);
  }
  refreshActiveNodeHighlight();
  updateInlineRunControls();
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
    node.title || "",
    node.lastResult?.kind || "",
    typeof v === "string" ? v : "",
    resultShape,
    tok,
    node.collapsed ? "c" : "e",
    node.minimized ? "m" : "x",
    node.muted ? "muted" : "active",
    node.foldLocked ? "fold:keep" : "fold:auto",
    node.previewMode || "",
    node.previewIndex ?? "",
    node.previewZoom ?? "",
    node.previewPanX ?? "",
    node.previewPanY ?? "",
    node.textZoom ?? "",
    node.width || "",
    node.height || "",
    node.lastRunMs ?? "",
    node.lastRunCount ?? "",
    node.lastRunStatus || "",
    JSON.stringify(node.collapsedPanels || {}),
    node.props?.chain ? "chain:on" : "chain:off",
    inSig,
  ].join("|");
}

const REMOVED_COMMAND_PROP_IDS = new Set([
  "dry_run",
  "grid",
  "grid_only",
  "grid_rows",
  "grid_columns",
  "grid_padding",
  "grid_bg_color",
]);

function sanitizeCommandProps(node) {
  if (!node || !COMMAND_TYPES.has(node.type) || !node.props) return node;
  for (const propId of REMOVED_COMMAND_PROP_IDS) delete node.props[propId];
  return node;
}

function migrateMixNode(node) {
  if (!node || node.type !== "mix") return node;
  node.props ||= {};
  if (node.props.a == null && node.props.color_a != null) node.props.a = node.props.color_a;
  if (node.props.b == null && node.props.color_b != null) node.props.b = node.props.color_b;
  delete node.props.color_a;
  delete node.props.color_b;
  return node;
}

function migrateMixEdge(edge) {
  const target = graph.nodes[edge?.toNode];
  if (!target || target.type !== "mix") return edge;
  if (edge.toSocket === "color_a") edge.toSocket = "a";
  if (edge.toSocket === "color_b") edge.toSocket = "b";
  return edge;
}

function nodeDefaultLabel(node) {
  const def = NODE_BY_TYPE[node?.type];
  return def?.label || node?.type || "Node";
}

function nodeDisplayTitle(node) {
  const title = String(node?.title || "").trim();
  return title || nodeDefaultLabel(node);
}

function nodeCategoryLabel(node) {
  return NODE_BY_TYPE[node?.type]?.category || "Node";
}

function setNodeTitle(nodeId, rawTitle, sourceControl = null) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  node.title = String(rawTitle ?? "").trim();
  const title = nodeDisplayTitle(node);
  const nodeEl = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (nodeEl) {
    const label = nodeEl.querySelector(".ne-node-label");
    if (label) {
      label.textContent = title;
      label.title = `${nodeDefaultLabel(node)} · double-click or F2 to rename`;
    }
    nodeEl.dataset.signature = nodeSignature(node);
  }
  if (ix.selection.has(nodeId)) {
    const nameEl = document.getElementById("propsNodeName");
    if (nameEl) {
      nameEl.textContent = title;
      nameEl.title = nodeDefaultLabel(node);
    }
  }
  document.querySelectorAll(`[data-title-node="${nodeId}"]`).forEach((control) => {
    if (control !== sourceControl) control.value = node.title || "";
  });
  scheduleAutosave();
}

function startNodeTitleEdit(nodeId) {
  const node = graph.nodes[nodeId];
  const nodeEl = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!node || !nodeEl) return;
  const existing = nodeEl.querySelector(".ne-node-title-input");
  if (existing) {
    existing.focus();
    existing.select();
    return;
  }
  const label = nodeEl.querySelector(".ne-node-label");
  if (!label) return;
  const input = document.createElement("input");
  input.className = "ne-node-title-input";
  input.type = "text";
  input.value = node.title || nodeDefaultLabel(node);
  input.placeholder = nodeDefaultLabel(node);
  input.setAttribute("aria-label", "Node title");
  label.replaceWith(input);

  let finished = false;
  let cancelled = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) setNodeTitle(nodeId, input.value, input);
    const currentEl = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (currentEl) currentEl.dataset.signature = "stale-title-edit";
    renderNodes();
    if (ix.selection.has(nodeId)) renderProps(nodeId);
  };

  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled = true;
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(!cancelled));
  input.focus();
  input.select();
}

function nodeMuteButtonMarkup(id, node, extraClass = "") {
  const active = Boolean(node?.muted);
  const label = active ? "Unmute node" : "Mute node";
  const classes = ["ne-node-action", "ne-node-mute", extraClass, active ? "is-active" : ""]
    .filter(Boolean)
    .join(" ");
  return `<button class="${classes}" data-mute="${escAttr(id)}" aria-label="${label}" title="${label} (M)" type="button"><span aria-hidden="true">M</span></button>`;
}

function bindNodeMuteButton(root, nodeId) {
  const muteEl = Array.from(root.querySelectorAll("[data-mute]")).find((el) => el.dataset.mute === nodeId);
  if (!muteEl) return;
  muteEl.addEventListener("mousedown", (e) => e.stopPropagation());
  muteEl.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNodeMuted(nodeId);
  });
}

function estimatedNodeHeight(node) {
  const def = NODE_BY_TYPE[node.type];
  if (!def) return 80;
  if (node.minimized) return nodeResizeMin(node).h;
  if (node.height) return node.height;
  return Math.max(def.defaultHeight || 0, nodeResizeMin(node).h);
}

function buildRerouteNodeElement(id, node, def) {
  const el = document.createElement("div");
  el.className = "ne-node ne-reroute-node";
  el.dataset.nodeId = id;
  el.dataset.nodeType = node.type;
  el.dataset.category = def.category;
  el.dataset.signature = nodeSignature(node);
  el.classList.toggle("is-muted", Boolean(node.muted));
  el.style.width = `${node.width || def.defaultWidth || 88}px`;
  el.style.height = `${node.height || def.defaultHeight || 30}px`;

  const body = document.createElement("div");
  body.className = "ne-reroute-body";
  body.title = "Reroute";
  body.appendChild(buildRerouteSocket(id, false));
  body.appendChild(buildRerouteSocket(id, true));
  body.insertAdjacentHTML("beforeend", nodeMuteButtonMarkup(id, node, "ne-reroute-mute"));
  bindNodeMuteButton(body, id);
  body.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains("ne-socket")) return;
    e.stopPropagation();
    startNodeDrag(e, id);
  });
  el.appendChild(body);

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains("ne-socket")) return;
    if (!ix.selection.has(id)) selectOnly(id);
  });
  return el;
}

function buildRerouteSocket(nodeId, isOutput) {
  const dot = document.createElement("div");
  dot.className = `ne-socket ne-reroute-socket ${isOutput ? "is-output" : "is-input"}`;
  dot.dataset.nodeId = nodeId;
  dot.dataset.socketId = isOutput ? "out" : "in";
  dot.dataset.socketType = "any";
  dot.dataset.isOutput = isOutput ? "1" : "0";
  dot.style.background = SOCKET_TYPES.any.color;
  dot.style.color = SOCKET_TYPES.any.color;
  dot.title = isOutput ? "Reroute output" : "Reroute input";
  const isConnected = isOutput
    ? graph.edges.some((edge) => edge.fromNode === nodeId && edge.fromSocket === "out")
    : graph.edges.some((edge) => edge.toNode === nodeId && edge.toSocket === "in");
  if (isConnected) dot.classList.add("is-connected");
  dot.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    startWire(e, nodeId, isOutput ? "out" : "in", "any", isOutput);
  });
  return dot;
}

function buildNodeElement(id, node) {
  const def = NODE_BY_TYPE[node.type];
  if (!def) return document.createElement("div");
  if (node.type === "reroute") return buildRerouteNodeElement(id, node, def);

  const el = document.createElement("div");
  el.className = "ne-node";
  el.dataset.nodeId = id;
  el.dataset.nodeType = node.type;
  el.dataset.category = def.category;
  el.dataset.signature = nodeSignature(node);
  el.classList.toggle("is-minimized", Boolean(node.minimized));
  el.classList.toggle("is-muted", Boolean(node.muted));
  el.style.width = `${node.width || 220}px`;
  const fixedHeight = !node.minimized ? (node.height || (node.type === "text-input" ? def.defaultHeight : null)) : null;
  if (fixedHeight) {
    el.style.height = `${fixedHeight}px`;
    el.classList.add("is-resized");
  }

  // Header
  const header = document.createElement("div");
  header.className = "ne-node-header";
  const isPreview = PREVIEW_TYPES.has(node.type);
  const collapseBtn = isPreview
    ? `<button class="ne-node-action ne-node-collapse" data-collapse="${id}" aria-label="${node.collapsed ? "Expand upstream" : "Collapse upstream"}" title="${node.collapsed ? "Expand upstream" : "Collapse upstream into this preview"}" type="button"><span aria-hidden="true">${node.collapsed ? "▸" : "▾"}</span></button>`
    : "";
  const refreshBtn = isPreview
    ? `<button class="ne-node-action ne-node-refresh" data-refresh="${id}" aria-label="Refresh preview" title="Refresh preview from upstream" type="button"><span aria-hidden="true">↻</span></button>`
    : "";
  const foldBtn = `<button class="ne-node-action ne-node-fold-lock ${node.foldLocked ? "is-active" : ""}" data-fold-lock="${id}" aria-label="${node.foldLocked ? "Fold with collapsed previews" : "Keep exposed when previews collapse"}" title="${node.foldLocked ? "Fold with collapsed previews" : "Keep exposed when previews collapse"}" type="button"><span aria-hidden="true">${node.foldLocked ? "◈" : "◇"}</span></button>`;
  const hideBtn = `<button class="ne-node-action ne-node-hide ${node.minimized ? "is-active" : ""}" data-hide="${id}" aria-label="${node.minimized ? "Show node body" : "Hide node body"}" title="${node.minimized ? "Show full node (H)" : "Hide node body (H)"}" type="button"><span aria-hidden="true">${node.minimized ? "+" : "−"}</span></button>`;
  const muteBtn = nodeMuteButtonMarkup(id, node);
  header.innerHTML = `
    <span class="ne-node-type-dot"></span>
    <span class="ne-node-label" title="${escAttr(nodeDefaultLabel(node))} · double-click or F2 to rename">${escHtml(nodeDisplayTitle(node))}</span>
    <span class="ne-node-actions">${refreshBtn}${collapseBtn}${muteBtn}${foldBtn}${hideBtn}</span>`;
  const labelEl = header.querySelector(".ne-node-label");
  if (labelEl) {
    labelEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startNodeTitleEdit(id);
    });
  }
  const hideEl = header.querySelector("[data-hide]");
  if (hideEl) {
    hideEl.addEventListener("mousedown", (e) => e.stopPropagation());
    hideEl.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNodeMinimized(id);
    });
  }
  bindNodeMuteButton(header, id);
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
  const foldEl = header.querySelector("[data-fold-lock]");
  if (foldEl) {
    foldEl.addEventListener("mousedown", (e) => e.stopPropagation());
    foldEl.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFoldLock(id);
    });
  }
  header.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const resizeEdge = nodeResizeEdgeFromEvent(e, el);
    if (resizeEdge) {
      e.stopPropagation();
      e.preventDefault();
      startNodeResize(e, id, resizeEdge);
      return;
    }
    e.stopPropagation();
    startNodeDrag(e, id);
  });
  el.appendChild(header);

  if (node.minimized) {
    el.appendChild(buildNodeCompactStrip(id));
  } else {
    const body = document.createElement("div");
    body.className = "ne-node-body";

    // Outputs are intentionally first so data leaves from the top of each node.
    const outputRows = (def.outputs || []).map((sock) => buildSocketRow(id, sock, false));
    if (outputRows.length > 0) {
      if (shouldWrapSocketSection(outputRows)) {
        body.appendChild(buildNodePanel(id, "outputs", "outputs", outputRows, {
          summary: String(outputRows.length),
          aggregateOutputSocketIds: (def.outputs || []).map((sock) => sock.id),
        }));
      } else {
        body.appendChild(outputRows[0]);
      }
    }

    if ((def.props || []).length > 0) {
      body.appendChild(buildNodeFields(id, node, def));
    }

    // Static input sockets are kept below the inline fields, so outputs remain
    // visually above inputs while prop values stay close to the node title.
    const inputRows = [];
    for (const sock of def.inputs || []) {
      if (!isInputSocketVisible(node, def, sock)) continue;
      if (sock.multi) {
        // Render one row per existing edge plus one empty placeholder row at
        // the bottom so the order of multi-image inputs is visible and the
        // user can keep adding more.
        const matches = graph.edges
          .filter((e) => e.toNode === id && e.toSocket === sock.id);
        matches.forEach((edge, i) => {
          inputRows.push(buildSocketRow(id, sock, true, { multiIndex: i + 1, edgeId: edge.id }));
        });
        inputRows.push(buildSocketRow(id, sock, true, {
          multiIndex: matches.length + 1, isMultiPlaceholder: true,
        }));
      } else {
        inputRows.push(buildSocketRow(id, sock, true));
      }
    }
    if (inputRows.length > 0) {
      if (shouldWrapSocketSection(inputRows)) {
        body.appendChild(buildNodePanel(id, "inputs", "inputs", inputRows, {
          summary: String(inputRows.length),
          aggregateInputSocketIds: (def.inputs || []).map((sock) => sock.id),
        }));
      } else {
        body.appendChild(inputRows[0]);
      }
    }

    // Preview content sits under the sockets so the media area stays stable.
    if (PREVIEW_TYPES.has(node.type)) {
      body.appendChild(buildPreviewContent(node));
    }

    // Run trigger: render a big play button below the output socket.
    if (node.type === "run-trigger") {
      body.appendChild(buildRunTriggerButton(id));
    }

    if (node.type === "pause") {
      body.appendChild(buildPauseNodeButton(id));
    }

    el.appendChild(body);
  }
  el.appendChild(buildNodeFooter(node));

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains("ne-socket")) return;
    if (e.target.closest("button")) return;
    const resizeEdge = nodeResizeEdgeFromEvent(e, el);
    if (resizeEdge) {
      e.stopPropagation();
      e.preventDefault();
      startNodeResize(e, id, resizeEdge);
      return;
    }
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

function buildNodeCompactStrip(nodeId) {
  const wrap = document.createElement("div");
  wrap.className = "ne-node-compact";

  const inputSocket = buildNodeCompactSocket(nodeId, false, nodeInputSocketIds(nodeId));
  const outputSocket = buildNodeCompactSocket(nodeId, true, nodeOutputSocketIds(nodeId));
  if (inputSocket) wrap.appendChild(inputSocket);
  if (outputSocket) wrap.appendChild(outputSocket);
  return wrap;
}

function buildNodeCompactSocket(nodeId, isOutput, socketIds) {
  const ids = (socketIds || []).filter(Boolean);
  if (ids.length === 0) return null;

  const socketType = aggregateSocketType(nodeId, ids, isOutput);
  const color = SOCKET_TYPES[socketType]?.color || SOCKET_TYPES.any.color;
  const dot = document.createElement("div");
  dot.className = `ne-socket ne-node-compact-socket ${isOutput ? "is-output" : "is-input"}`;
  dot.dataset.nodeId = nodeId;
  dot.dataset.socketId = ids[0];
  dot.dataset.socketType = socketType;
  dot.dataset.isOutput = isOutput ? "1" : "0";
  dot.dataset.aggregateSocketIds = ids.join(" ");
  dot.dataset.compactAggregate = "1";
  dot.style.background = color;
  dot.style.color = color;
  dot.title = isOutput ? "Connect from hidden outputs" : "Connect into hidden inputs";

  if (isOutput && ids.some((socketId) => outputProducesBundle(nodeId, socketId))) {
    dot.dataset.bundle = "1";
  }

  const isConnected = isOutput
    ? graph.edges.some((edge) => edge.fromNode === nodeId && ids.includes(edge.fromSocket))
    : graph.edges.some((edge) => edge.toNode === nodeId && ids.includes(edge.toSocket));
  if (isConnected) dot.classList.add("is-connected");

  dot.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (!isOutput) {
      const existing = graph.edges.filter((edge) => edge.toNode === nodeId && ids.includes(edge.toSocket)).at(-1);
      if (existing) {
        graph.edges = graph.edges.filter((edge) => edge.id !== existing.id);
        const fromDef = NODE_BY_TYPE[graph.nodes[existing.fromNode]?.type];
        const fromSockDef = fromDef?.outputs?.find((sock) => sock.id === existing.fromSocket);
        renderGraph();
        startWire(e, existing.fromNode, existing.fromSocket, fromSockDef?.type || "any", true);
        return;
      }
    }
    startWire(e, nodeId, ids[0], socketType, isOutput, { aggregateSocketIds: ids });
  });

  return dot;
}

function buildNodeFooter(node) {
  const footer = document.createElement("div");
  footer.className = "ne-node-footer";
  const status = document.createElement("span");
  status.className = "ne-node-footer-status";
  status.textContent = `${nodeDefaultLabel(node)} · ${nodeCategoryLabel(node)}`;
  const runtime = document.createElement("span");
  runtime.className = "ne-node-footer-runtime";
  runtime.dataset.state = node.lastRunStatus || "idle";
  runtime.textContent = formatNodeRuntime(node.lastRunMs, node.lastRunCount, node.lastRunStatus);
  footer.append(status, runtime);
  return footer;
}

function formatNodeRuntime(ms, count = 0, status = null) {
  if (status === "running") return count > 0 ? `${count + 1}x · running` : "running";
  if (status === "cancelled") return "stopped";
  if (typeof ms !== "number" || !Number.isFinite(ms)) return status === "failed" ? "failed" : "not run";
  let label;
  if (ms < 1000) label = `${Math.max(1, Math.round(ms))} ms`;
  else {
    const seconds = ms / 1000;
    label = `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
  }
  return count > 1 ? `${count}x · ${label}` : label;
}

class GraphRunCancelled extends Error {
  constructor(message = "graph stopped") {
    super(message);
    this.name = "GraphRunCancelled";
  }
}

let _graphRunState = null;

function graphRunFromOpts(opts = {}) {
  return opts && opts.run ? opts.run : null;
}

function updateGraphRunControls() {
  const runBtn = document.getElementById("runGraphBtn");
  const stopBtn = document.getElementById("stopGraphBtn");
  const pauseBtn = document.getElementById("pauseGraphBtn");
  const control = document.getElementById("graphRunControl");
  const running = Boolean(_graphRunState);
  const paused = Boolean(_graphRunState?.paused);
  if (control) control.dataset.state = running ? (paused ? "paused" : "running") : "idle";
  if (runBtn) runBtn.hidden = running;
  if (stopBtn) stopBtn.hidden = !running;
  if (pauseBtn) {
    pauseBtn.hidden = !running;
    pauseBtn.innerHTML = paused
      ? `<span class="btn-glyph" aria-hidden="true">▶</span>`
      : `<span class="btn-glyph" aria-hidden="true">Ⅱ</span>`;
    pauseBtn.setAttribute("aria-label", paused ? "Resume graph" : "Pause graph");
    pauseBtn.title = paused ? "Resume graph" : "Pause graph before the next execution step";
  }
  updateInlineRunControls();
}

function updateInlineRunControls() {
  const graphBusy = Boolean(_graphRunState);
  document.querySelectorAll(".ne-run-play").forEach((btn) => {
    const nodeId = btn.closest(".ne-node")?.dataset.nodeId;
    const muted = nodeId ? isNodeMuted(nodeId) : false;
    btn.disabled = graphBusy || muted;
    btn.title = graphBusy ? "A graph is already running" : (muted ? "Unmute this node before running" : "Run connected command(s)");
  });
  document.querySelectorAll(".ne-pause-resume").forEach((btn) => {
    const nodeId = btn.dataset.pauseResumeNode || btn.closest(".ne-node")?.dataset.nodeId;
    const active = isPauseNodeResumeReady(nodeId);
    btn.disabled = !active;
    btn.classList.toggle("is-active", active);
    btn.title = active ? "Resume graph flow" : "Available when graph execution is paused here";
    btn.setAttribute("aria-label", active ? "Resume graph flow" : "Resume graph flow when paused here");
  });
}

function resolvePauseWaiters(run) {
  if (!run || !Array.isArray(run.pauseWaiters)) return;
  const waiters = run.pauseWaiters.splice(0);
  for (const resolve of waiters) resolve();
}

function pauseGraphRun(reason = "manual", nodeId = null) {
  const run = _graphRunState;
  if (!run || run.cancelled) return;
  run.paused = true;
  run.pauseReason = reason;
  run.pausedNodeId = nodeId || null;
  setGraphStatus(reason === "node" ? "paused at node" : "paused", "is-paused");
  updateGraphRunControls();
  if (reason === "node") renderNodes();
}

function resumeGraphRun(source = "manual") {
  const run = _graphRunState;
  if (!run || !run.paused) return;
  run.paused = false;
  run.pauseReason = "";
  run.pausedNodeId = null;
  resolvePauseWaiters(run);
  appendRunLog(source === "node" ? "▶ Resumed from pause node\n" : "▶ Resumed graph\n");
  setGraphStatus("running…", "is-running");
  updateGraphRunControls();
  renderNodes();
}

function stopGraphRun() {
  const run = _graphRunState;
  if (!run || run.cancelled) return;
  run.cancelled = true;
  try { run.abortController?.abort(); } catch (_) { /* ignore */ }
  resolvePauseWaiters(run);
  appendRunLog("■ Stopping graph…\n");
  setGraphStatus("stopping…", "is-cancelled");
  updateGraphRunControls();
  const runIds = Array.from(run.activeRunIds || []);
  for (const runId of runIds) {
    fetchJSON(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: JSON.stringify({}) }).catch(() => {});
  }
}

async function waitForGraphRunReady(opts = {}) {
  const run = graphRunFromOpts(opts);
  if (!run) return;
  if (run.cancelled) throw new GraphRunCancelled();
  while (run.paused && !run.cancelled) {
    await new Promise((resolve) => run.pauseWaiters.push(resolve));
  }
  if (run.cancelled) throw new GraphRunCancelled();
}

async function graphDelay(ms, opts = {}) {
  const run = graphRunFromOpts(opts);
  if (!run) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (run.cancelled) throw new GraphRunCancelled();
  await new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      run.abortController?.signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      run.abortController?.signal?.removeEventListener("abort", onAbort);
      reject(new GraphRunCancelled());
    };
    const timer = setTimeout(done, ms);
    run.abortController?.signal?.addEventListener("abort", onAbort, { once: true });
  });
  await waitForGraphRunReady(opts);
}

async function graphFetchJSON(url, fetchOpts = {}, runOpts = {}) {
  await waitForGraphRunReady(runOpts);
  const run = graphRunFromOpts(runOpts);
  const nextOpts = { ...fetchOpts };
  if (run?.abortController && !nextOpts.signal) nextOpts.signal = run.abortController.signal;
  try {
    const data = await fetchJSON(url, nextOpts);
    await waitForGraphRunReady(runOpts);
    return data;
  } catch (err) {
    if (run?.cancelled || err?.name === "AbortError") throw new GraphRunCancelled();
    throw err;
  }
}

function shouldTraceNodeResolution(opts = {}) {
  return Boolean(_graphRunState) && !opts.lite && !opts.liteCommands;
}

function resetGraphRunMetrics() {
  for (const node of Object.values(graph.nodes)) {
    node.lastRunMs = null;
    node.lastRunStatus = null;
    node.lastRunCount = 0;
    paintNodeRunChrome(node.id);
  }
  clearActiveNodeHighlight();
}

function beginGraphRunState() {
  _graphRunState = {
    frames: [],
    cancelled: false,
    paused: false,
    pauseReason: "",
    pausedNodeId: null,
    pauseWaiters: [],
    abortController: new AbortController(),
    activeRunIds: new Set(),
  };
  resetGraphRunMetrics();
  updateGraphRunControls();
  return _graphRunState;
}

function finishGraphRunState() {
  if (!_graphRunState) return;
  resolvePauseWaiters(_graphRunState);
  _graphRunState.frames.length = 0;
  clearActiveNodeHighlight();
  _graphRunState = null;
  updateGraphRunControls();
}

function nodeExecutionFrame() {
  if (!_graphRunState) return null;
  for (let i = _graphRunState.frames.length - 1; i >= 0; i--) {
    const frame = _graphRunState.frames[i];
    if (!frame.finished && !frame.paused && graph.nodes[frame.nodeId]) return frame;
  }
  return null;
}

function clearActiveNodeHighlight() {
  document.querySelectorAll(".ne-node.is-executing").forEach((el) => {
    el.classList.remove("is-executing");
  });
}

function refreshActiveNodeHighlight() {
  clearActiveNodeHighlight();
  const frame = nodeExecutionFrame();
  if (!frame) return;
  const el = document.querySelector(`[data-node-id="${frame.nodeId}"]`);
  if (el) el.classList.add("is-executing");
}

function paintNodeRunChrome(nodeId) {
  const node = graph.nodes[nodeId];
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!node || !el) return;
  el.classList.toggle("is-done", node.lastRunStatus === "done");
  el.classList.toggle("is-failed", node.lastRunStatus === "failed");
  el.classList.toggle("is-cancelled", node.lastRunStatus === "cancelled");
  const runtime = el.querySelector(".ne-node-footer-runtime");
  if (runtime) {
    runtime.dataset.state = node.lastRunStatus || "idle";
    runtime.textContent = formatNodeRuntime(node.lastRunMs, node.lastRunCount, node.lastRunStatus);
  }
}

function setNodeRunStatus(nodeId, status) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  node.lastRunStatus = status;
  paintNodeRunChrome(nodeId);
  refreshActiveNodeHighlight();
}

function recordNodeRuntimeElapsed(nodeId, elapsedMs, status = "done") {
  const node = graph.nodes[nodeId];
  if (!node || typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) return;
  const prior = typeof node.lastRunMs === "number" && Number.isFinite(node.lastRunMs) ? node.lastRunMs : 0;
  node.lastRunMs = Math.max(1, Math.round(prior + elapsedMs));
  node.lastRunCount = Math.max(0, Number(node.lastRunCount) || 0) + 1;
  node.lastRunStatus = status === "failed" || node.lastRunStatus === "failed" ? "failed" : status;
  paintNodeRunChrome(nodeId);
}

function beginNodeWork(nodeId) {
  if (!_graphRunState || !graph.nodes[nodeId]) return null;
  const frame = {
    nodeId,
    startedAt: performance.now(),
    elapsedMs: 0,
    paused: false,
    finished: false,
  };
  _graphRunState.frames.push(frame);
  setNodeRunStatus(nodeId, "running");
  return frame;
}

function pauseNodeWork(frame) {
  if (!frame || frame.finished || frame.paused) return;
  frame.elapsedMs += Math.max(0, performance.now() - frame.startedAt);
  frame.startedAt = null;
  frame.paused = true;
  refreshActiveNodeHighlight();
}

function resumeNodeWork(frame) {
  if (!frame || frame.finished || !frame.paused || !_graphRunState) return;
  frame.startedAt = performance.now();
  frame.paused = false;
  refreshActiveNodeHighlight();
}

function finishNodeWork(frame, status = "done") {
  if (!frame || frame.finished) return;
  if (!frame.paused && frame.startedAt != null) {
    frame.elapsedMs += Math.max(0, performance.now() - frame.startedAt);
  }
  frame.finished = true;
  if (_graphRunState) {
    const idx = _graphRunState.frames.indexOf(frame);
    if (idx >= 0) _graphRunState.frames.splice(idx, 1);
  }
  recordNodeRuntimeElapsed(frame.nodeId, frame.elapsedMs, status);
  refreshActiveNodeHighlight();
}

async function resolveNodeWithPausedWork(frame, nodeId, cache, loopCtx, opts) {
  pauseNodeWork(frame);
  try {
    return await resolveNode(nodeId, cache, loopCtx, opts);
  } finally {
    resumeNodeWork(frame);
  }
}

function connectedPanelEdges(nodeId, socketIds, direction = "input") {
  const ids = new Set(socketIds || []);
  if (ids.size === 0) return [];
  if (direction === "output") {
    return graph.edges.filter((edge) => edge.fromNode === nodeId && ids.has(edge.fromSocket));
  }
  return graph.edges.filter((edge) => edge.toNode === nodeId && ids.has(edge.toSocket));
}

function panelAggregateSocketColor(nodeId, edges, direction = "input") {
  const first = edges[0];
  const sock = first
    ? (direction === "output" ? outputSocketDef(nodeId, first.fromSocket) : inputSocketDef(nodeId, first.toSocket))
    : null;
  return SOCKET_TYPES[sock?.type]?.color || SOCKET_TYPES.any.color;
}

function buildNodePanel(nodeId, panelKey, label, rows, opts = {}) {
  const node = graph.nodes[nodeId];
  const panel = document.createElement("section");
  panel.className = `ne-node-panel ${opts.className || ""}`.trim();
  panel.dataset.panelKey = panelKey;

  const collapsed = isNodePanelCollapsed(node, panelKey, Boolean(opts.defaultCollapsed));
  panel.classList.toggle("is-collapsed", collapsed);
  const aggregateInputEdges = connectedPanelEdges(nodeId, opts.aggregateInputSocketIds || [], "input");
  const aggregateOutputEdges = connectedPanelEdges(nodeId, opts.aggregateOutputSocketIds || [], "output");
  panel.classList.toggle("has-collapsed-inputs", collapsed && aggregateInputEdges.length > 0);
  panel.classList.toggle("has-collapsed-outputs", collapsed && aggregateOutputEdges.length > 0);

  const head = document.createElement("button");
  head.type = "button";
  head.className = "ne-node-panel-head";
  head.title = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  head.addEventListener("mousedown", (e) => e.stopPropagation());
  head.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNodePanel(nodeId, panelKey, opts.defaultCollapsed);
  });

  const icon = document.createElement("span");
  icon.className = "ne-node-panel-icon";
  icon.textContent = collapsed ? "▸" : "▾";
  const title = document.createElement("span");
  title.className = "ne-node-panel-title";
  title.textContent = label;
  const summary = document.createElement("span");
  summary.className = "ne-node-panel-summary";
  summary.textContent = opts.summary || String(rows.length);
  head.append(icon, title, summary);
  panel.appendChild(head);

  if (collapsed && aggregateInputEdges.length > 0) {
    const aggregate = document.createElement("span");
    aggregate.className = "ne-panel-aggregate-socket";
    aggregate.dataset.panelAggregateInput = "1";
    aggregate.dataset.socketIds = [...new Set(aggregateInputEdges.map((edge) => edge.toSocket))].join(" ");
    aggregate.dataset.edgeCount = String(aggregateInputEdges.length);
    aggregate.style.background = panelAggregateSocketColor(nodeId, aggregateInputEdges, "input");
    aggregate.style.color = aggregate.style.background;
    aggregate.title = `${aggregateInputEdges.length} incoming link${aggregateInputEdges.length === 1 ? "" : "s"} inside collapsed ${label}`;
    panel.appendChild(aggregate);
  }

  if (collapsed && aggregateOutputEdges.length > 0) {
    const aggregate = document.createElement("span");
    aggregate.className = "ne-panel-aggregate-socket is-output";
    aggregate.dataset.panelAggregateOutput = "1";
    aggregate.dataset.socketIds = [...new Set(aggregateOutputEdges.map((edge) => edge.fromSocket))].join(" ");
    aggregate.dataset.edgeCount = String(aggregateOutputEdges.length);
    aggregate.style.background = panelAggregateSocketColor(nodeId, aggregateOutputEdges, "output");
    aggregate.style.color = aggregate.style.background;
    aggregate.title = `${aggregateOutputEdges.length} outgoing link${aggregateOutputEdges.length === 1 ? "" : "s"} inside collapsed ${label}`;
    panel.appendChild(aggregate);
  }

  const content = document.createElement("div");
  content.className = "ne-node-panel-body";
  for (const row of rows) content.appendChild(row);
  panel.appendChild(content);
  return panel;
}

function isNodePanelCollapsed(node, panelKey, defaultCollapsed = false) {
  if (!node) return defaultCollapsed;
  const panels = node.collapsedPanels || {};
  if (Object.prototype.hasOwnProperty.call(panels, panelKey)) return Boolean(panels[panelKey]);
  return defaultCollapsed;
}

function toggleNodePanel(nodeId, panelKey, defaultCollapsed = false) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  node.collapsedPanels ||= {};
  node.collapsedPanels[panelKey] = !isNodePanelCollapsed(node, panelKey, Boolean(defaultCollapsed));
  // Toggling a panel changes the natural content size of the node, so any
  // explicit height the user picked is no longer meaningful — revert to the
  // CSS-driven natural fit so the node visibly adapts (shrinks or grows).
  node.height = null;
  renderGraph();
  scheduleAutosave();
}

function previewBundleItems(node) {
  const value = node?.lastResult?.value;
  if (!Array.isArray(value)) return [];
  // Defensive one-level flatten: in case an upstream emitted a nested
  // bundle (older graphs, custom nodes), render it as a flat grid instead
  // of stringified arrays.
  const flat = [];
  for (const v of value) {
    if (Array.isArray(v)) flat.push(...v);
    else flat.push(v);
  }
  return flat.filter((v) => v != null && v !== "");
}

function previewModeForNode(node) {
  return node?.previewMode === "slider" ? "slider" : "grid";
}

const PREVIEW_TILE_MIN = 56;
const PREVIEW_TILE_MAX = 256;
const PREVIEW_TILE_DEFAULT = 96;
const PREVIEW_GRID_GAP = 4;
const PREVIEW_GRID_OVERSCAN = 6; // rows above/below viewport to pre-render

function previewTileSize(node) {
  const raw = Number(node?.previewTileSize);
  if (!Number.isFinite(raw)) return PREVIEW_TILE_DEFAULT;
  return clampValue(Math.round(raw), PREVIEW_TILE_MIN, PREVIEW_TILE_MAX);
}

function setPreviewTileSize(nodeId, next) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  const size = clampValue(Math.round(Number(next) || PREVIEW_TILE_DEFAULT), PREVIEW_TILE_MIN, PREVIEW_TILE_MAX);
  if (node.previewTileSize === size) return;
  node.previewTileSize = size;
  // Re-layout the grid in place rather than re-rendering everything.
  const grid = document.querySelector(`[data-node-id="${nodeId}"] .ne-bundle-vgrid`);
  if (grid && grid._bundleVGrid) {
    grid._bundleVGrid.setTileSize(size);
  } else {
    renderNodes();
    renderConnections();
  }
  scheduleAutosave();
}

// Cheap thumbnail URL (server-side cached JPEG). Falls back to the
// full file when we can't sensibly produce a thumb (text values etc).
function thumbURL(path, size = 128) {
  const s = String(path || "");
  if (!s) return "";
  if (s.startsWith("/api/") || s.startsWith("http")) return s;
  const token = (artifactURL._tokens && artifactURL._tokens[s]) || "";
  const bucket = quantizeThumbSize(size);
  return `/api/thumb?path=${encodeURIComponent(s)}&size=${bucket}${token ? `&v=${token}` : ""}`;
}

// Snap requested thumbnail dimensions to a small set of buckets so the
// server doesn't have to encode a unique thumb per pixel size and the
// browser HTTP cache stays effective across small node-resize wiggles.
const THUMB_BUCKETS = [64, 96, 128, 192, 256, 384];
function quantizeThumbSize(size) {
  const n = Math.max(32, Math.min(1024, Math.round(Number(size) || 128)));
  for (const b of THUMB_BUCKETS) if (n <= b) return b;
  return THUMB_BUCKETS[THUMB_BUCKETS.length - 1];
}

// Global concurrency-limited image loader. Browsers cap simultaneous
// connections per origin (~6), so a giant preview will starve every other
// request unless we throttle ourselves. We also need to *cancel* loads for
// tiles that scrolled out of view before they ever start fetching.
const ThumbLoader = (() => {
  const MAX_INFLIGHT = 6;
  let inflight = 0;
  const queue = []; // {url, img, key, cancelled, started}
  const handles = new WeakMap(); // img → handle

  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length > 0) {
      const h = queue.shift();
      if (h.cancelled || !h.img.isConnected) continue;
      inflight += 1;
      h.started = true;
      const done = () => {
        if (h.done) return;
        h.done = true;
        h.img.removeEventListener("load", done);
        h.img.removeEventListener("error", done);
        inflight = Math.max(0, inflight - 1);
        pump();
      };
      h._done = done;
      h.img.addEventListener("load", done);
      h.img.addEventListener("error", done);
      // Setting src kicks off the request. Browser still does its own
      // caching layer, so re-requests of identical urls are instant.
      h.img.src = h.url;
    }
  }
  return {
    /** Enqueue a thumbnail load on `img`. Returns a handle with cancel(). */
    load(img, url) {
      this.cancel(img);
      const h = { url, img, cancelled: false, started: false, done: false };
      handles.set(img, h);
      queue.push(h);
      pump();
      return h;
    },
    /** Cancel any pending load for this <img> (no-op if not queued). */
    cancel(img) {
      const h = handles.get(img);
      if (h) {
        h.cancelled = true;
        handles.delete(img);
        // If we already started the request, free the inflight slot now —
        // detached imgs don't reliably fire error after removeAttribute("src"),
        // which would otherwise leak slots and starve future loads.
        if (h.started && !h.done) {
          h.done = true;
          if (h._done) {
            h.img.removeEventListener("load", h._done);
            h.img.removeEventListener("error", h._done);
          }
          inflight = Math.max(0, inflight - 1);
          pump();
        }
      }
      // If the request already started, aborting via empty src tells the
      // browser to drop the in-flight transfer.
      if (img && img.src && !img.complete) {
        img.removeAttribute("src");
      }
    },
  };
})();

function clampPreviewIndex(node, itemCount) {
  if (!node || itemCount <= 0) return 0;
  const raw = Number(node.previewIndex);
  const next = Number.isFinite(raw) ? Math.max(0, Math.min(itemCount - 1, Math.round(raw))) : 0;
  node.previewIndex = next;
  return next;
}

function clampPreviewZoom(node) {
  if (!node) return 1;
  const raw = Number(node.previewZoom);
  const next = clampValue(Number.isFinite(raw) ? raw : 1, PREVIEW_ZOOM_MIN, PREVIEW_ZOOM_MAX);
  node.previewZoom = Math.round(next * 100) / 100;
  return node.previewZoom;
}

function clampPreviewPan(node) {
  if (!node) return { x: 0, y: 0 };
  const x = Number(node.previewPanX);
  const y = Number(node.previewPanY);
  node.previewPanX = Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
  node.previewPanY = Number.isFinite(y) ? Math.round(y * 10) / 10 : 0;
  return { x: node.previewPanX, y: node.previewPanY };
}

function clampPreviewPanToStage(node, stage, media) {
  if (!node || !stage || !media) return clampPreviewPan(node);
  const zoom = clampPreviewZoom(node);
  if (zoom <= 1.005) {
    node.previewPanX = 0;
    node.previewPanY = 0;
    return { x: 0, y: 0 };
  }
  const stageRect = stage.getBoundingClientRect();
  const stageW = stage.clientWidth || stageRect.width || 0;
  const stageH = stage.clientHeight || stageRect.height || 0;
  const mediaW = media.offsetWidth || 0;
  const mediaH = media.offsetHeight || 0;
  if (stageW <= 0 || stageH <= 0 || mediaW <= 1 || mediaH <= 1) return clampPreviewPan(node);

  const clampAxis = (rawPan, stageSize, mediaSize) => {
    const base = (stageSize - mediaSize) / 2;
    const scaled = mediaSize * zoom;
    if (scaled <= stageSize) return 0;
    const min = stageSize - base - scaled;
    const max = -base;
    return clampValue(rawPan, min, max);
  };

  const current = clampPreviewPan(node);
  node.previewPanX = Math.round(clampAxis(current.x, stageW, mediaW) * 10) / 10;
  node.previewPanY = Math.round(clampAxis(current.y, stageH, mediaH) * 10) / 10;
  return { x: node.previewPanX, y: node.previewPanY };
}

function clampTextZoom(node) {
  if (!node) return 1;
  const raw = Number(node.textZoom);
  const next = clampValue(Number.isFinite(raw) ? raw : 1, TEXT_ZOOM_MIN, TEXT_ZOOM_MAX);
  node.textZoom = Math.round(next * 100) / 100;
  return node.textZoom;
}

function textWheelDelta(e) {
  const deltaUnit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : (e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1);
  const delta = e.deltaY * deltaUnit;
  return Number.isFinite(delta) ? delta : 0;
}

function updateTextZoomDom(nodeId) {
  const node = graph.nodes[nodeId];
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!node || !el) return;
  const zoom = clampTextZoom(node);
  el.querySelectorAll(".ne-string-editor, .ne-markdown-viewer").forEach((surface) => {
    surface.style.setProperty("--ne-text-zoom", String(zoom));
  });
}

function setNodeTextZoom(nodeId, nextZoom) {
  const node = graph.nodes[nodeId];
  if (!node) return false;
  const zoom = Math.round(clampValue(Number(nextZoom) || 1, TEXT_ZOOM_MIN, TEXT_ZOOM_MAX) * 100) / 100;
  if (Math.abs(clampTextZoom(node) - zoom) < 0.005) return false;
  node.textZoom = zoom;
  updateTextZoomDom(nodeId);
  scheduleAutosave();
  return true;
}

function handleNodeTextWheel(e, nodeId) {
  if (!(e.ctrlKey || e.metaKey)) return false;
  const delta = textWheelDelta(e);
  if (!delta) return false;
  e.preventDefault();
  e.stopPropagation();
  const node = graph.nodes[nodeId];
  const current = clampTextZoom(node);
  setNodeTextZoom(nodeId, current * Math.exp(-delta * TEXT_ZOOM_WHEEL_SENSITIVITY));
  return true;
}

function bindTextWheelZoom(el, nodeId) {
  el.addEventListener("wheel", (e) => {
    if (handleNodeTextWheel(e, nodeId)) return;
    e.stopPropagation();
  }, { passive: false });
}

function previewMediaAreaEstimate(node, hasToolbar = true) {
  const def = NODE_BY_TYPE[node?.type];
  const width = Math.max(120, (node?.width || def?.defaultWidth || 320) - 22);
  const nodeH = node?.height || def?.defaultHeight || 260;
  const chrome = 34 + 28 + 62 + (hasToolbar ? 34 : 0);
  const height = Math.max(100, nodeH - chrome);
  return { width, height };
}

function bundleGridPlan(node, items) {
  const count = Math.max(1, items.length);
  const area = previewMediaAreaEstimate(node, true);
  const kinds = items.map((v) => inferPreviewMediaKind(node, node.lastResult?.kind, v));
  const mediaAspect = kinds.every((kind) => kind === "video") ? 16 / 9 : 1;
  let best = { cols: 1, rows: count, aspect: mediaAspect, score: -Infinity };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const gap = 6;
    const tileW = Math.max(1, (area.width - (cols - 1) * gap) / cols);
    const tileH = Math.max(1, (area.height - (rows - 1) * gap) / rows);
    const fitH = Math.min(tileH, tileW / mediaAspect);
    const fitW = fitH * mediaAspect;
    const emptyPenalty = cols * rows - count;
    const gridRatio = cols / rows;
    const containerRatio = Math.max(0.1, area.width / area.height);
    const balancePenalty = Math.abs(Math.log(gridRatio / containerRatio));
    const score = fitW * fitH - emptyPenalty * 24 - balancePenalty * 8;
    if (score > best.score) best = { cols, rows, aspect: mediaAspect, score };
  }
  return best;
}

function setPreviewMode(nodeId, mode) {
  const node = graph.nodes[nodeId];
  if (!node || !PREVIEW_TYPES.has(node.type)) return;
  const nextMode = mode === "slider" ? "slider" : "grid";
  if (node.previewMode === nextMode) return;
  node.previewMode = nextMode;
  if (nextMode === "slider") {
    clampPreviewIndex(node, previewBundleItems(node).length);
    clampPreviewZoom(node);
  }
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (el) el.dataset.signature = "stale-preview-mode";
  renderNodes();
  renderConnections();
  scheduleAutosave();
}

function setPreviewIndex(nodeId, nextIndex, itemCount = null) {
  const node = graph.nodes[nodeId];
  if (!node) return false;
  const count = itemCount ?? previewBundleItems(node).length;
  if (count <= 0) return false;
  const wrapped = ((Math.round(nextIndex) % count) + count) % count;
  if (node.previewIndex === wrapped) return false;
  node.previewIndex = wrapped;
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (el) el.dataset.signature = "stale-preview-index";
  renderNodes();
  renderConnections();
  scheduleAutosave();
  return true;
}

function stepPreviewIndex(nodeId, delta) {
  const node = graph.nodes[nodeId];
  const items = previewBundleItems(node);
  if (!node || items.length <= 0) return false;
  const current = clampPreviewIndex(node, items.length);
  return setPreviewIndex(nodeId, current + delta, items.length);
}

function updatePreviewZoomDom(nodeId) {
  const node = graph.nodes[nodeId];
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!node || !el) return;
  const zoom = clampPreviewZoom(node);
  if (zoom <= PREVIEW_ZOOM_MIN + 0.005) {
    node.previewPanX = 0;
    node.previewPanY = 0;
  }
  el.querySelectorAll(".ne-preview-zoom-stage").forEach((stage) => {
    const media = stage.querySelector("img, video");
    const pan = clampPreviewPanToStage(node, stage, media);
    stage.style.setProperty("--preview-zoom", String(zoom));
    stage.style.setProperty("--preview-pan-x", `${pan.x}px`);
    stage.style.setProperty("--preview-pan-y", `${pan.y}px`);
    stage.classList.toggle("is-zoomed", zoom > 1.005);
  });
  el.querySelectorAll("[data-preview-zoom-label]").forEach((label) => {
    label.textContent = `${Math.round(zoom * 100)}%`;
  });
}

function previewZoomAnchorPoint(nodeId, anchor) {
  const stage = document.querySelector(`[data-node-id="${nodeId}"] .ne-preview-zoom-stage`);
  if (!stage) return null;
  if (anchor && Number.isFinite(anchor.clientX) && Number.isFinite(anchor.clientY)) {
    return { stage, clientX: anchor.clientX, clientY: anchor.clientY };
  }
  const rect = stage.getBoundingClientRect();
  return { stage, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

function adjustPreviewPanForZoom(nodeId, oldZoom, nextZoom, anchor = null) {
  const node = graph.nodes[nodeId];
  if (!node || Math.abs(oldZoom - nextZoom) < 0.005) return;
  if (nextZoom <= PREVIEW_ZOOM_MIN + 0.005) {
    node.previewPanX = 0;
    node.previewPanY = 0;
    return;
  }
  const point = previewZoomAnchorPoint(nodeId, anchor);
  const media = point?.stage?.querySelector?.("img, video");
  if (!point || !media) return;
  const stageRect = point.stage.getBoundingClientRect();
  const mediaWidth = media.offsetWidth || media.getBoundingClientRect().width || 1;
  const mediaHeight = media.offsetHeight || media.getBoundingClientRect().height || 1;
  const baseLeft = stageRect.left + (stageRect.width - mediaWidth) / 2;
  const baseTop = stageRect.top + (stageRect.height - mediaHeight) / 2;
  const pan = clampPreviewPan(node);
  const localX = (point.clientX - baseLeft - pan.x) / oldZoom;
  const localY = (point.clientY - baseTop - pan.y) / oldZoom;
  node.previewPanX = point.clientX - baseLeft - localX * nextZoom;
  node.previewPanY = point.clientY - baseTop - localY * nextZoom;
}

function setPreviewZoom(nodeId, nextZoom, opts = {}) {
  const node = graph.nodes[nodeId];
  if (!node) return false;
  const current = clampPreviewZoom(node);
  const zoom = Math.round(clampValue(Number(nextZoom) || 1, PREVIEW_ZOOM_MIN, PREVIEW_ZOOM_MAX) * 100) / 100;
  if (Math.abs(current - zoom) < 0.005) return false;
  adjustPreviewPanForZoom(nodeId, current, zoom, opts.anchor || null);
  node.previewZoom = zoom;
  if (opts.render) {
    const el = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (el) el.dataset.signature = "stale-preview-zoom";
    renderNodes();
    renderConnections();
  } else {
    updatePreviewZoomDom(nodeId);
  }
  scheduleAutosave();
  return true;
}

function stepPreviewZoom(nodeId, direction) {
  const node = graph.nodes[nodeId];
  if (!node) return false;
  const current = clampPreviewZoom(node);
  const factor = direction > 0 ? PREVIEW_ZOOM_STEP : 1 / PREVIEW_ZOOM_STEP;
  return setPreviewZoom(nodeId, current * factor, { anchor: "center" });
}

function makePreviewButton(className, label, title) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = label;
  button.addEventListener("mousedown", (e) => e.stopPropagation());
  return button;
}

function copyIconSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="12" rx="2"></rect><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
}

function searchIconSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4 4"></path></svg>';
}

function makeTextCopyButton(title, getText) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ne-string-copy-icon";
  button.dataset.iconButton = "1";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = copyIconSvg();
  button.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  button.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await copyTextToClipboard(getText());
      flashTextButton(button);
    } catch (_) {
      flashTextButton(button, "failed");
    }
  });
  return button;
}

function makeTextSearchControl() {
  const wrap = document.createElement("label");
  wrap.className = "ne-string-search-wrap";
  const icon = document.createElement("span");
  icon.className = "ne-string-search-icon";
  icon.innerHTML = searchIconSvg();
  const input = document.createElement("input");
  input.type = "search";
  input.className = "ne-string-search";
  input.placeholder = "search";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search text");
  wrap.append(icon, input);
  wrap.addEventListener("mousedown", (e) => e.stopPropagation());
  wrap.addEventListener("click", (e) => e.stopPropagation());
  wrap.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  return { wrap, input };
}

function previewMarkdownContextNodeId(nodeId, seen = new Set()) {
  if (!nodeId || seen.has(nodeId)) return nodeId;
  seen.add(nodeId);
  const node = graph.nodes[nodeId];
  if (!node) return nodeId;
  if (node.type === "text-input") return nodeId;
  const incoming = graph.edges.find((edge) => edge.toNode === nodeId && (edge.toSocket === "in" || edge.toSocket === "value" || edge.toSocket === "sections"));
  if (!incoming) return nodeId;
  return previewMarkdownContextNodeId(incoming.fromNode, seen) || nodeId;
}

function buildReadonlyMarkdownViewer(node, value, contextNodeId = null) {
  const nodeId = node.id;
  const text = String(value ?? "");
  const markdownNodeId = contextNodeId || previewMarkdownContextNodeId(nodeId);
  const wrap = document.createElement("div");
  wrap.className = "ne-string-editor ne-markdown-viewer";
  wrap.dataset.propNode = nodeId;
  wrap.style.setProperty("--ne-text-zoom", String(clampTextZoom(node)));

  const toolbar = document.createElement("div");
  toolbar.className = "ne-string-toolbar";
  const copyBtn = makeTextCopyButton("Copy text", () => text);
  const searchControl = makeTextSearchControl();
  const search = searchControl.input;
  const spacer = document.createElement("span");
  spacer.className = "ne-string-spacer";
  const meta = document.createElement("span");
  meta.className = "ne-string-meta";
  toolbar.append(searchControl.wrap, spacer, meta, copyBtn);

  const preview = document.createElement("div");
  preview.className = "ne-string-preview ne-preview-markdown";
  preview.tabIndex = 0;
  preview.title = "read-only markdown preview";

  const render = () => {
    const query = search.value || "";
    preview.innerHTML = renderInlineMarkdown(text, markdownNodeId, { search: query });
    const words = (text.match(/\S+/g) || []).length;
    const matches = countTextSearchMatches(text, query);
    meta.textContent = query.trim() ? `${matches} hit${matches === 1 ? "" : "s"}` : `${text.length}c · ${words}w`;
    if (query.trim()) requestAnimationFrame(() => scrollFirstSearchHit(preview));
  };

  [wrap, toolbar, preview].forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (!ix.selection.has(nodeId)) selectOnly(nodeId);
    });
  });
  search.addEventListener("mousedown", (e) => e.stopPropagation());
  search.addEventListener("click", (e) => e.stopPropagation());
  search.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      search.value = "";
      render();
      preview.focus();
    }
  });
  search.addEventListener("input", render);
  bindTextWheelZoom(preview, nodeId);

  wrap.append(toolbar, preview);
  render();
  return wrap;
}

// Build a scrollable, virtualized image grid for bundles of any size.
// Only tiles inside the viewport (plus a small overscan) are kept in the
// DOM, and only those have their thumbnail <img> src set. Designed to
// handle folders of tens of thousands of frames without choking.
function makeBundleVirtualGrid(node, items) {
  const root = document.createElement("div");
  root.className = "ne-bundle-vgrid";
  const sizer = document.createElement("div");
  sizer.className = "ne-bundle-vgrid-sizer";
  root.appendChild(sizer);
  const layer = document.createElement("div");
  layer.className = "ne-bundle-vgrid-layer";
  sizer.appendChild(layer);

  const tileCache = new Map();
  let tileSize = previewTileSize(node);
  let cols = 1;
  let rows = items.length;

  function recompute() {
    const w = root.clientWidth || 1;
    cols = Math.max(1, Math.floor((w + PREVIEW_GRID_GAP) / (tileSize + PREVIEW_GRID_GAP)));
    rows = Math.ceil(items.length / cols);
    sizer.style.height = `${rows * (tileSize + PREVIEW_GRID_GAP)}px`;
  }

  function makeTile(i) {
    const v = items[i];
    const kind = inferPreviewMediaKind(node, node.lastResult?.kind, v);
    const tile = document.createElement("div");
    tile.className = "ne-bundle-vtile";
    tile.dataset.index = String(i);
    tile.title = `${i + 1}/${items.length}  ${String(v || "")}`;
    tile.style.width = `${tileSize}px`;
    tile.style.height = `${tileSize}px`;
    if (kind === "image" || kind === "video") {
      const img = document.createElement("img");
      img.className = "ne-bundle-vthumb";
      img.alt = "";
      img.decoding = "async";
      // Note: we *don't* set src directly. ThumbLoader assigns it when a
      // slot is free so a giant grid can't starve other requests.
      const px = Math.max(96, Math.min(384, Math.round(tileSize * (window.devicePixelRatio || 1))));
      const url = thumbURL(v, px);
      tile._thumbImg = img;
      tile._thumbURL = url;
      img.addEventListener("error", () => { img.style.opacity = "0.25"; });
      tile.appendChild(img);
      if (kind === "video") {
        const badge = document.createElement("span");
        badge.className = "ne-bundle-vbadge";
        badge.textContent = "▶";
        tile.appendChild(badge);
      }
    } else {
      const label = document.createElement("span");
      label.className = "ne-bundle-vtext";
      label.textContent = (String(v).split("/").pop()) || String(v);
      tile.appendChild(label);
    }
    tile.addEventListener("mousedown", (e) => e.stopPropagation());
    tile.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      node.previewIndex = i;
      setPreviewMode(node.id, "slider");
    });
    return tile;
  }

  function renderViewport() {
    const scrollTop = root.scrollTop;
    const viewportH = root.clientHeight || 0;
    if (!viewportH) return;
    const rowH = tileSize + PREVIEW_GRID_GAP;
    const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - PREVIEW_GRID_OVERSCAN);
    const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewportH) / rowH) + PREVIEW_GRID_OVERSCAN);
    const needed = new Set();
    const newlyCreated = [];
    for (let r = firstRow; r <= lastRow; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        if (i >= items.length) break;
        needed.add(i);
        const x = c * (tileSize + PREVIEW_GRID_GAP);
        const y = r * (tileSize + PREVIEW_GRID_GAP);
        let tile = tileCache.get(i);
        if (!tile) {
          tile = makeTile(i);
          tile.style.position = "absolute";
          layer.appendChild(tile);
          tileCache.set(i, tile);
          newlyCreated.push(tile);
        }
        tile.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
    for (const [idx, el] of tileCache) {
      if (!needed.has(idx)) {
        // Cancel any pending/in-flight image fetch before dropping the tile.
        if (el._thumbImg) ThumbLoader.cancel(el._thumbImg);
        el.remove();
        tileCache.delete(idx);
      }
    }
    // Debounced load: schedule a single microtask after the burst settles
    // so a fast scroll past 300 tiles doesn't enqueue 300 image requests.
    if (newlyCreated.length > 0) {
      if (loadScheduled) clearTimeout(loadScheduled);
      loadScheduled = setTimeout(() => {
        loadScheduled = null;
        for (const tile of newlyCreated) {
          // Tile may have been evicted while waiting.
          if (!tile.isConnected || !tile._thumbImg) continue;
          ThumbLoader.load(tile._thumbImg, tile._thumbURL);
        }
      }, 80);
    }
  }

  let loadScheduled = null;

  function rerender() {
    for (const [, el] of tileCache) {
      if (el._thumbImg) ThumbLoader.cancel(el._thumbImg);
      el.remove();
    }
    tileCache.clear();
    recompute();
    renderViewport();
  }

  root._bundleVGrid = {
    setTileSize(next) {
      const size = clampValue(Math.round(next), PREVIEW_TILE_MIN, PREVIEW_TILE_MAX);
      if (size === tileSize) return;
      tileSize = size;
      rerender();
    },
  };

  root.addEventListener("scroll", () => {
    node.previewScrollTop = root.scrollTop;
    requestAnimationFrame(renderViewport);
  });
  root.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  root.addEventListener("mousedown", (e) => e.stopPropagation());
  const ro = new ResizeObserver(() => requestAnimationFrame(rerender));
  ro.observe(root);
  queueMicrotask(() => {
    rerender();
    // Restore previous scroll position when re-rendered (mode toggle,
    // tile-size change-induced rebuild, etc.).
    const prev = Number(node.previewScrollTop || 0);
    if (prev > 0) {
      root.scrollTop = prev;
      renderViewport();
    }
  });
  return root;
}

function bindPreviewStagePan(stage, nodeId) {
  stage.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const node = graph.nodes[nodeId];
    if (!node || clampPreviewZoom(node) <= 1.005) return;
    e.preventDefault();
    e.stopPropagation();
    if (!ix.selection.has(nodeId)) selectOnly(nodeId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startPan = clampPreviewPan(node);
    stage.classList.add("is-dragging");
    const move = (ev) => {
      node.previewPanX = startPan.x + ev.clientX - startX;
      node.previewPanY = startPan.y + ev.clientY - startY;
      updatePreviewZoomDom(nodeId);
    };
    const up = () => {
      stage.classList.remove("is-dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      scheduleAutosave();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, { once: true });
  });
  stage.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    setPreviewZoom(nodeId, 1, { anchor: e });
  });
}

function makePreviewZoomStage(node, media) {
  const stage = document.createElement("div");
  stage.className = "ne-bundle-stage ne-preview-zoom-stage";
  stage.dataset.nodeId = node.id;
  stage.style.setProperty("--preview-zoom", String(clampPreviewZoom(node)));
  const pan = clampPreviewPan(node);
  stage.style.setProperty("--preview-pan-x", `${pan.x}px`);
  stage.style.setProperty("--preview-pan-y", `${pan.y}px`);
  stage.classList.toggle("is-zoomed", clampPreviewZoom(node) > 1.005);
  stage.appendChild(media);
  const refreshPan = () => updatePreviewZoomDom(node.id);
  if (media.tagName === "IMG" && !media.complete) media.addEventListener("load", refreshPan, { once: true });
  else if (media.tagName === "VIDEO") media.addEventListener("loadedmetadata", refreshPan, { once: true });
  queueMicrotask(refreshPan);
  bindPreviewStagePan(stage, node.id);
  return stage;
}

function makePreviewZoomControls(nodeId) {
  const controls = document.createElement("div");
  controls.className = "ne-bundle-controls ne-preview-zoom-controls";
  const zoomOutBtn = makePreviewButton("ne-bundle-zoom", "−", "Zoom out");
  const zoomInBtn = makePreviewButton("ne-bundle-zoom", "+", "Zoom in");
  const zoomResetBtn = makePreviewButton("ne-bundle-zoom ne-bundle-zoom-reset", "1x", "Reset zoom");
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "ne-bundle-zoom-label";
  zoomLabel.dataset.previewZoomLabel = "true";
  zoomLabel.textContent = `${Math.round(clampPreviewZoom(graph.nodes[nodeId]) * 100)}%`;
  zoomOutBtn.addEventListener("click", (e) => { e.stopPropagation(); stepPreviewZoom(nodeId, -1); });
  zoomInBtn.addEventListener("click", (e) => { e.stopPropagation(); stepPreviewZoom(nodeId, 1); });
  zoomResetBtn.addEventListener("click", (e) => { e.stopPropagation(); setPreviewZoom(nodeId, 1, { anchor: "center" }); });
  controls.append(zoomOutBtn, zoomLabel, zoomInBtn, zoomResetBtn);
  return controls;
}

function makeSingleMediaPreview(node, value, kind) {
  const wrap = document.createElement("div");
  wrap.className = "ne-single-preview";
  wrap.appendChild(makePreviewZoomStage(node, makeBundleMedia(value, kind)));
  wrap.appendChild(makePreviewZoomControls(node.id));
  return wrap;
}

function buildPreviewContent(node) {
  const wrap = document.createElement("div");
  wrap.className = `ne-preview-content`;

  const result = node.lastResult;
  if (!result || result.value === undefined || result.value === null || result.value === "") {
    wrap.innerHTML = `<div class="ne-preview-empty">no data yet — run the graph</div>`;
    return wrap;
  }

  // Bundle (array) — render grid OR slider based on node.previewMode.
  if (Array.isArray(result.value)) {
    const items = previewBundleItems(node);
    if (items.length === 0) {
      wrap.innerHTML = `<div class="ne-preview-empty">empty bundle</div>`;
      return wrap;
    }
    const mode = previewModeForNode(node);
    wrap.dataset.previewMode = mode;
    const toolbar = document.createElement("div");
    toolbar.className = "ne-bundle-toolbar";
    toolbar.innerHTML =
      `<button class="ne-bundle-tab ${mode === "grid" ? "is-active" : ""}" data-mode="grid" type="button">grid</button>` +
      `<button class="ne-bundle-tab ${mode === "slider" ? "is-active" : ""}" data-mode="slider" type="button">slider</button>` +
      `<span class="ne-bundle-count">${items.length.toLocaleString()} items</span>`;
    toolbar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setPreviewMode(node.id, btn.dataset.mode);
      });
    });
    if (mode === "grid") {
      const sizeWrap = document.createElement("label");
      sizeWrap.className = "ne-bundle-tilesize";
      sizeWrap.title = "Tile size";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(PREVIEW_TILE_MIN);
      slider.max = String(PREVIEW_TILE_MAX);
      slider.step = "8";
      slider.value = String(previewTileSize(node));
      slider.addEventListener("mousedown", (e) => e.stopPropagation());
      slider.addEventListener("input", (e) => {
        e.stopPropagation();
        setPreviewTileSize(node.id, Number(slider.value));
      });
      sizeWrap.appendChild(slider);
      toolbar.appendChild(sizeWrap);
    }
    wrap.appendChild(toolbar);

    if (mode === "grid") {
      wrap.appendChild(makeBundleVirtualGrid(node, items));
    } else {
      const slider = document.createElement("div");
      slider.className = "ne-bundle-slider";
      slider.dataset.nodeId = node.id;
      const counter = document.createElement("span");
      counter.className = "ne-bundle-counter";
      const index = clampPreviewIndex(node, items.length);
      const stage = makePreviewZoomStage(node, makeBundleMedia(items[index], inferPreviewMediaKind(node, node.lastResult?.kind, items[index])));
      counter.textContent = `${index + 1} / ${items.length}`;
      slider.appendChild(stage);
      const ctrls = document.createElement("div");
      ctrls.className = "ne-bundle-controls";
      const prevBtn = makePreviewButton("ne-bundle-step", "←", "Previous");
      const nextBtn = makePreviewButton("ne-bundle-step", "→", "Next");
      prevBtn.addEventListener("click", (e) => { e.stopPropagation(); stepPreviewIndex(node.id, -1); });
      nextBtn.addEventListener("click", (e) => { e.stopPropagation(); stepPreviewIndex(node.id, 1); });
      ctrls.appendChild(prevBtn);
      ctrls.appendChild(counter);
      ctrls.appendChild(nextBtn);
      const zoomControls = makePreviewZoomControls(node.id);
      while (zoomControls.firstChild) ctrls.appendChild(zoomControls.firstChild);
      slider.appendChild(ctrls);
      const pips = document.createElement("div");
      pips.className = "ne-bundle-pips";
      if (items.length <= 16) {
        items.forEach((_, i) => {
          const pip = makePreviewButton(`ne-bundle-pip ${i === index ? "is-active" : ""}`, String(i + 1), `Show ${i + 1}`);
          pip.addEventListener("click", (e) => { e.stopPropagation(); setPreviewIndex(node.id, i, items.length); });
          pips.appendChild(pip);
        });
      } else {
        pips.style.setProperty("--bundle-progress", `${((index + 1) / items.length) * 100}%`);
        pips.classList.add("is-progress");
      }
      slider.appendChild(pips);
      wrap.appendChild(slider);
    }
    return wrap;
  }

  const rawValue = String(result.value);
  const kind = inferPreviewMediaKind(node, result.kind, rawValue);
  // Prefer the .png sidecar alias for image rendering when the raw value
  // is a UV / vector-map .npy. The alias is set by runGraph from the
  // backend's `image` field (coordinate / vector-op / mapping responses).
  const value = (kind === "image" && result.image) ? String(result.image) : rawValue;
  if (kind === "image") {
    wrap.appendChild(makeSingleMediaPreview(node, value, "image"));
  } else if (kind === "video") {
    wrap.appendChild(makeSingleMediaPreview(node, value, "video"));
  } else {
    wrap.appendChild(buildReadonlyMarkdownViewer(node, value, previewMarkdownContextNodeId(node.id)));
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
  // UV / vector maps render as their .png sidecar alias — treat as image.
  if (k === "vector-map" || k === "vector") return "image";
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
    if (t === "vector-map" || t === "vector") return "image";
  }
  if (/\.(mp4|mov|webm|mkv)$/i.test(value)) return "video";
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(value)) return "image";
  if (/\.npy$/i.test(value)) return "image";
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
  img.decoding = "async";
  img.loading = "eager";
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

function isPropWired(nodeId, propId) {
  return activeIncomingEdges(nodeId, propId).length > 0;
}

function normalizePropValue(propDef, control) {
  if (propDef.kind === "checkbox") return Boolean(control.checked);
  if (propDef.kind === "number" || propDef.kind === "range") {
    return control.value === "" ? null : Number(control.value);
  }
  if (propDef.kind === "color") return String(control.value || "#000000");
  return control.value;
}

function coerceWiredPropValue(propDef, value) {
  if (propDef.passthroughWired) return value;
  if (propDef.kind === "checkbox") return coerceBooleanInput(value);
  if (propDef.kind === "number" || propDef.kind === "range") {
    if (value === "" || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function coerceBooleanInput(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return Boolean(value);
}

function setNodePropValue(nodeId, propDef, value, sourceControl = null) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  node.props[propDef.id] = value;
  syncPropControls(nodeId, propDef.id, value, sourceControl);
  if (node.type === "text-input" && (propDef.id === "value" || propDef.id === "highlight_pairs")) {
    applyNodeMinimumSizeNow(nodeId);
    if (propDef.id === "value") preserveActiveStringEditorSignature(nodeId, sourceControl);
    if (propDef.id === "highlight_pairs") refreshStringEditorsForNode(nodeId);
  }
  if (propDef.id === "size") {
    const el = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (el) el.dataset.signature = "stale";
    renderNodes();
  }
  if (propDef.id === "grid" || propDef.id === "chain") {
    const el = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (el) el.dataset.signature = "stale";
    renderNodes();
  }
  scheduleAutosave();
  schedulePreviewRefresh();
}

function preserveActiveStringEditorSignature(nodeId, sourceControl = null) {
  const node = graph.nodes[nodeId];
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!node || node.type !== "text-input" || !el) return;
  const active = document.activeElement;
  const activeTextarea = active && el.contains(active) && active.classList?.contains("ne-string-textarea");
  const activeSource = sourceControl?.classList?.contains("ne-string-editor") && sourceControl.dataset.mode === "edit";
  if (!activeTextarea && !activeSource) return;
  el.dataset.signature = nodeSignature(node);
}

function refreshStringEditorsForNode(nodeId) {
  document.querySelectorAll(".ne-string-editor[data-prop-node]").forEach((editor) => {
    if (editor.dataset.propNode !== nodeId) return;
    if (typeof editor._renderPreview === "function") editor._renderPreview();
    if (typeof editor._updateEditorChrome === "function") editor._updateEditorChrome();
  });
}

function syncPropControls(nodeId, propId, value, sourceControl) {
  document.querySelectorAll(`[data-prop-node="${nodeId}"][data-prop-id="${propId}"]`).forEach((control) => {
    if (control === sourceControl) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value ?? "";
    const display = control.closest(".ne-prop, .ne-inline-prop-row")?.querySelector("[data-prop-range-value]");
    if (display) display.textContent = String(control.type === "checkbox" ? Boolean(value) : (value ?? ""));
  });
}

function buildPropValueControl(nodeId, propDef, currentValue, opts = {}) {
  let control;
  let valueDisplay = null;
  if (propDef.kind === "checkbox") {
    control = document.createElement("input");
    control.type = "checkbox";
    control.checked = Boolean(currentValue);
  } else if (propDef.kind === "textarea") {
    if (propDef.mdEditor) {
      return buildMarkdownEditorControl(nodeId, propDef, currentValue, opts);
    }
    control = document.createElement("textarea");
    control.rows = opts.compact ? 2 : 3;
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
  } else if (propDef.kind === "color") {
    control = document.createElement("input");
    control.type = "color";
  } else if (propDef.kind === "range") {
    control = document.createElement("input");
    control.type = "range";
    if (propDef.min != null) control.min = propDef.min;
    if (propDef.max != null) control.max = propDef.max;
    if (propDef.step != null) control.step = propDef.step;
    valueDisplay = document.createElement("span");
    valueDisplay.className = opts.compact ? "ne-node-field-range-value" : "ne-prop-range-value";
    valueDisplay.dataset.propRangeValue = "1";
  } else {
    control = document.createElement("input");
    control.type = "text";
  }

  control.className = opts.compact ? "ne-node-field-control" : "";
  control.dataset.propNode = nodeId;
  control.dataset.propId = propDef.id;
  if (propDef.kind !== "checkbox") {
    control.value = currentValue ?? propDef.default ?? "";
    control.placeholder = propDef.placeholder || "";
  }
  if (opts.disabled) {
    control.disabled = true;
    control.title = "value is coming from a connected socket - disconnect to edit";
  }
  if (valueDisplay) valueDisplay.textContent = String(control.value);

  if (propDef.kind === "textarea" || propDef.kind === "text" || propDef.kind === undefined) {
    enableMentions(control, nodeId);
  }

  const commit = () => {
    const value = normalizePropValue(propDef, control);
    if (valueDisplay) valueDisplay.textContent = String(propDef.kind === "checkbox" ? Boolean(value) : (control.value ?? ""));
    setNodePropValue(nodeId, propDef, value, control);
  };
  control.addEventListener(propDef.kind === "checkbox" ? "change" : "input", commit);
  control.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    if (!ix.selection.has(nodeId)) selectOnly(nodeId);
  });
  control.addEventListener("click", (e) => e.stopPropagation());
  control.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  return { control, valueDisplay };
}

function buildNodeFields(nodeId, node, def) {
  const fields = document.createDocumentFragment();
  // Primitives surface their first prop bare (no collapsible group) so the
  // node's primary value stays front-and-center. Any additional props still
  // group as usual.
  const isPrimitive = def.category === "Primitives";
  const allProps = def.props || [];
  let inlinePropIds = new Set();
  if (isPrimitive && allProps.length > 0) {
    // When allInline is set, surface ALL props bare (no collapsible group).
    // Use this for primitives with multiple tightly-related values like Vector.
    const propsToInline = def.allInline ? allProps : [allProps[0]];
    for (const p of propsToInline) {
      inlinePropIds.add(p.id);
      fields.appendChild(buildInlinePropRow(nodeId, p, node.props[p.id]));
    }
  }
  const groups = new Map();
  for (const propDef of allProps) {
    if (inlinePropIds.has(propDef.id)) continue;
    const groupId = propGroupId(propDef);
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(propDef);
  }
  for (const [groupId, props] of groups) {
    const rows = props.map((propDef) => buildInlinePropRow(nodeId, propDef, node.props[propDef.id]));
    fields.appendChild(buildNodePanel(nodeId, `props:${groupId}`, propGroupLabel(groupId), rows, {
      defaultCollapsed: propGroupDefaultCollapsed(node, groupId),
      summary: propGroupSummary(node, groupId, props.length),
      className: `is-prop-panel is-${groupId}`,
      aggregateInputSocketIds: props.map((propDef) => propDef.id),
    }));
  }
  return fields;
}

function buildInlinePropRow(nodeId, propDef, currentValue) {
  const sock = {
    id: propDef.id,
    label: propDef.label,
    type: socketTypeForProp(propDef),
    _isProp: true,
  };
  const row = buildSocketRow(nodeId, sock, true, { isPropSocket: true });
  row.classList.add("ne-inline-prop-row");
  if (propDef.kind === "textarea") row.classList.add("has-textarea");
  if (propDef.kind === "checkbox") row.classList.add("has-toggle");
  if (propDef.mdEditor) row.classList.add("has-md-editor");
  const field = document.createElement("div");
  field.className = "ne-node-field";
  const { control, valueDisplay } = buildPropValueControl(nodeId, propDef, currentValue, {
    compact: true,
    disabled: isPropWired(nodeId, propDef.id),
  });
  field.appendChild(control);
  if (valueDisplay) field.appendChild(valueDisplay);
  row.appendChild(field);
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

    const color = SOCKET_TYPES[outputTypeForRenderedEdge(edge)]?.color || "#888";
    const isBundle = outputProducesBundle(edge.fromNode, edge.fromSocket);
    const muted = isEdgeMuted(edge);

    const path = makeBezierPath(fromPos, toPos);
    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", path);
    pathEl.setAttribute("stroke", color);
    pathEl.setAttribute("stroke-width", isBundle ? "2.6" : "2.2");
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke-linecap", "round");
    if (muted) pathEl.setAttribute("stroke-dasharray", "2 5");
    else if (isBundle) pathEl.setAttribute("stroke-dasharray", "6 4");
    pathEl.dataset.edgeId = edge.id;
    if (muted) pathEl.classList.add("is-muted");
    pathEl.style.opacity = muted ? "0.2" : "0.92";
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
  const aggregate = getAggregateSocketEl(nodeId, socketId, isOutput);
  if (aggregate) return socketElementCanvasPos(aggregate);
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
  const rect = dot.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    const fallback = getAggregateSocketEl(nodeId, socketId, isOutput);
    return fallback ? socketElementCanvasPos(fallback) : null;
  }
  return socketElementCanvasPos(dot);
}

function getAggregateSocketEl(nodeId, socketId, isOutput = false) {
  const compact = getCompactAggregateSocketEl(nodeId, socketId, isOutput);
  if (compact) return compact;
  return getCollapsedPanelAggregateEl(nodeId, socketId, isOutput);
}

function getCompactAggregateSocketEl(nodeId, socketId, isOutput = false) {
  const nodeEl = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!nodeEl) return null;
  for (const el of nodeEl.querySelectorAll(`.ne-node-compact-socket[data-is-output='${isOutput ? "1" : "0"}']`)) {
    const ids = (el.dataset.aggregateSocketIds || "").split(/\s+/).filter(Boolean);
    if (ids.includes(socketId)) return el;
  }
  return null;
}

function getCollapsedPanelAggregateEl(nodeId, socketId, isOutput = false) {
  const nodeEl = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!nodeEl) return null;
  const selector = isOutput
    ? ".ne-panel-aggregate-socket[data-panel-aggregate-output='1']"
    : ".ne-panel-aggregate-socket[data-panel-aggregate-input='1']";
  for (const el of nodeEl.querySelectorAll(selector)) {
    const ids = (el.dataset.socketIds || "").split(/\s+/).filter(Boolean);
    if (ids.includes(socketId)) return el;
  }
  return null;
}

function socketElementCanvasPos(dot) {
  const dotRect = dot.getBoundingClientRect();
  const wrapRect = document.getElementById("canvasWrap").getBoundingClientRect();
  const sx = dotRect.left + dotRect.width / 2;
  const sy = dotRect.top + dotRect.height / 2;
  return {
    x: (sx - wrapRect.left - vp.x) / vp.zoom,
    y: (sy - wrapRect.top - vp.y) / vp.zoom,
  };
}

const SOCKET_HIT_RADIUS = 24;

function findSocketTargetAt(clientX, clientY, radius = SOCKET_HIT_RADIUS) {
  let best = null;
  let bestDist = Infinity;
  document.querySelectorAll(".ne-socket").forEach((dot) => {
    if (dot.closest(".ne-node")?.classList.contains("is-collapsed-hidden")) return;
    const rect = dot.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(clientX - cx, clientY - cy);
    const hitRadius = Math.max(radius, Math.max(rect.width, rect.height) / 2 + 10);
    if (dist <= hitRadius && dist < bestDist) {
      best = dot;
      bestDist = dist;
    }
  });
  return best;
}

function makeBezierPath(from, to) {
  const dx = Math.max(Math.abs(to.x - from.x) * 0.5, 60);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y} ${to.x - dx} ${to.y} ${to.x} ${to.y}`;
}

// ─── Wire (drag from socket) ──────────────────────────────────────────────────

function startWire(e, nodeId, socketId, socketType, isFromOutput, opts = {}) {
  const pos = getSocketCanvasPos(nodeId, socketId, isFromOutput);
  if (!pos) return;
  ix.wire = {
    fromNode: nodeId,
    fromSocket: socketId,
    fromType: socketType,
    isOutput: isFromOutput,
    startX: pos.x,
    startY: pos.y,
    aggregateSocketIds: opts.aggregateSocketIds || null,
  };
  updateWireDraft(pos.x, pos.y, pos.x, pos.y);
  document.getElementById("wireDraft").style.display = "";
  document.body.classList.add("is-wiring");
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

function endWire(targetNodeId, targetSocketId, targetType, targetIsOutput, targetAggregateSocketIds = null) {
  const w = ix.wire;
  ix.wire = null;
  clearCompatibleHighlights();
  document.body.classList.remove("is-wiring");
  document.getElementById("wireDraft").style.display = "none";
  document.getElementById("wireDraft").setAttribute("d", "");
  if (!w) return;
  if (w.isOutput === targetIsOutput) return;
  if (!canConnect(w.fromType, targetType)) return;

  if (w.isOutput) {
    const fromSocket = w.aggregateSocketIds
      ? (resolveAggregateSocketId(w.fromNode, w.aggregateSocketIds, true, targetType) || w.fromSocket)
      : w.fromSocket;
    const toSocket = targetAggregateSocketIds
      ? (resolveAggregateSocketId(targetNodeId, targetAggregateSocketIds, false, w.fromType) || targetSocketId)
      : targetSocketId;
    addEdge(w.fromNode, fromSocket, targetNodeId, toSocket);
  } else {
    const fromSocket = targetAggregateSocketIds
      ? (resolveAggregateSocketId(targetNodeId, targetAggregateSocketIds, true, w.fromType) || targetSocketId)
      : targetSocketId;
    const toSocket = w.aggregateSocketIds
      ? (resolveAggregateSocketId(w.fromNode, w.aggregateSocketIds, false, targetType) || w.fromSocket)
      : w.fromSocket;
    addEdge(targetNodeId, fromSocket, w.fromNode, toSocket);
  }
}

// ─── Lazy-connect (Alt+RightClick drag, Node Wrangler style) ─────────────────

function pickAutoConnectPair(fromNode, toNode) {
  const fromDef = NODE_BY_TYPE[graph.nodes[fromNode]?.type];
  const toDef = NODE_BY_TYPE[graph.nodes[toNode]?.type];
  if (!fromDef || !toDef) return null;
  for (const out of fromDef.outputs || []) {
    for (const inp of inputSocketDefsForDef(toDef)) {
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
  document.body.classList.add("is-wiring");
}

function endLazyConnect(e) {
  const lazy = ix.lazyConnect;
  ix.lazyConnect = null;
  ix.wire = null;
  document.body.classList.remove("is-wiring");
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
  document.body.classList.remove("is-wiring");
  const draft = document.getElementById("wireDraft");
  draft.style.display = "none";
  draft.setAttribute("d", "");
}

function firstRerouteSourceFromSelection() {
  for (const nodeId of ix.selection) {
    const node = graph.nodes[nodeId];
    if (!node || node.hidden) continue;
    const out = (NODE_BY_TYPE[node.type]?.outputs || [])[0];
    if (out) return { nodeId, socketId: out.id, socketType: out.type };
  }
  return null;
}

function updateReroutePlacement(clientX = ix.lastMouseScreen.x, clientY = ix.lastMouseScreen.y) {
  const placement = ix.reroutePlacement;
  if (!placement) return;
  const node = graph.nodes[placement.nodeId];
  if (!node) return;
  const def = NODE_BY_TYPE.reroute;
  const pos = screenToCanvas(clientX, clientY);
  const w = node.width || def.defaultWidth || 88;
  const h = node.height || def.defaultHeight || 30;
  node.x = pos.x - w / 2;
  node.y = pos.y - h / 2;
  renderNodes();
  renderConnections();
}

function startReroutePlacement() {
  if (ix.reroutePlacement) return;
  const source = firstRerouteSourceFromSelection();
  if (!source) {
    setHint("E: select a node with an output first");
    setTimeout(clearHint, 1400);
    return;
  }
  const pos = ix.lastMouseCanvas || { x: 0, y: 0 };
  const def = NODE_BY_TYPE.reroute;
  const nodeId = addNode("reroute", pos.x - (def.defaultWidth || 88) / 2, pos.y - (def.defaultHeight || 30) / 2, {
    skipSelect: true,
    skipAutosave: true,
  });
  if (!nodeId) return;
  const edgeId = genEdgeId();
  graph.edges.push({ id: edgeId, fromNode: source.nodeId, fromSocket: source.socketId, toNode: nodeId, toSocket: "in" });
  ix.reroutePlacement = {
    nodeId,
    edgeId,
    previousSelection: [...ix.selection],
  };
  ix.selection = new Set([nodeId]);
  document.body.classList.add("is-reroute-placing");
  updateReroutePlacement();
  updateSelectionVisuals();
  renderProps(nodeId);
  setHint("Reroute — LMB place · Esc cancel");
}

function commitReroutePlacement() {
  const placement = ix.reroutePlacement;
  if (!placement) return;
  ix.reroutePlacement = null;
  document.body.classList.remove("is-reroute-placing");
  clearHint();
  ix.selection = new Set([placement.nodeId]);
  renderGraph();
  renderProps(placement.nodeId);
  scheduleAutosave();
  schedulePreviewRefresh();
}

function cancelReroutePlacement() {
  const placement = ix.reroutePlacement;
  if (!placement) return;
  ix.reroutePlacement = null;
  document.body.classList.remove("is-reroute-placing");
  graph.edges = graph.edges.filter((edge) => edge.id !== placement.edgeId);
  delete graph.nodes[placement.nodeId];
  ix.selection = new Set((placement.previousSelection || []).filter((id) => graph.nodes[id]));
  clearHint();
  renderGraph();
  renderProps(ix.selection.size === 1 ? [...ix.selection][0] : null);
}

// ─── Node dragging ───────────────────────────────────────────────────────────

function startNodeDrag(e, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node) return;
  const dragNodeId = node.foldAnchorId ? node.foldAnchorId : nodeId;
  const dragNode = graph.nodes[dragNodeId];
  if (!dragNode) return;
  ix.draggingNode = dragNodeId;
  document.body.classList.add("is-dragging-node");
  const c = screenToCanvas(e.clientX, e.clientY);
  ix.dragOffsetX = c.x - dragNode.x;
  ix.dragOffsetY = c.y - dragNode.y;
  if (!ix.selection.has(nodeId)) selectOnly(nodeId);
}

// ─── Node resize ─────────────────────────────────────────────────────────────

const NODE_RESIZE_HIT_PX = 12;

function isNodeResizeIgnoredTarget(target) {
  return Boolean(target?.closest?.("button, input, textarea, select, .ne-socket, .ne-node-panel-head, .ne-string-toolbar, .ne-bundle-toolbar, .ne-bundle-controls, .ne-bundle-pips"));
}

function nodeResizeEdgeFromEvent(e, nodeEl) {
  if (!nodeEl || isNodeResizeIgnoredTarget(e.target)) return null;
  const rect = nodeEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hit = NODE_RESIZE_HIT_PX;
  const nearLeft = x <= hit;
  const nearRight = rect.width - x <= hit;
  const nearTop = y <= hit;
  const nearBottom = rect.height - y <= hit;
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) return null;
  return `${nearTop ? "n" : ""}${nearBottom ? "s" : ""}${nearLeft ? "w" : ""}${nearRight ? "e" : ""}` || "se";
}

function resizeCursorForEdge(edge) {
  if (edge === "n" || edge === "s") return "ns-resize";
  if (edge === "e" || edge === "w") return "ew-resize";
  if (edge === "ne" || edge === "sw") return "nesw-resize";
  return "nwse-resize";
}

function clearNodeResizeHover() {
  if (!ix.resizeHoverEl) return;
  ix.resizeHoverEl.classList.remove("is-resize-hover");
  ix.resizeHoverEl.style.removeProperty("--ne-resize-cursor");
  delete ix.resizeHoverEl.dataset.resizeEdge;
  ix.resizeHoverEl = null;
}

function updateNodeResizeHover(e) {
  if (ix.modal || ix.resizing || ix.draggingNode || ix.panning || ix.wire || ix.cutting || ix.boxStart || ix.reroutePlacement) {
    clearNodeResizeHover();
    return;
  }
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const nodeEl = target?.closest?.(".ne-node");
  const edge = nodeEl ? nodeResizeEdgeFromEvent(e, nodeEl) : null;
  if (!nodeEl || !edge) {
    clearNodeResizeHover();
    return;
  }
  if (ix.resizeHoverEl && ix.resizeHoverEl !== nodeEl) clearNodeResizeHover();
  ix.resizeHoverEl = nodeEl;
  nodeEl.classList.add("is-resize-hover");
  nodeEl.dataset.resizeEdge = edge;
  nodeEl.style.setProperty("--ne-resize-cursor", resizeCursorForEdge(edge));
}

function startNodeResize(e, nodeId, edge = "se") {
  const node = graph.nodes[nodeId];
  if (!node) return;
  const def = NODE_BY_TYPE[node.type];
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  const currentRect = el?.getBoundingClientRect();
  if (!ix.selection.has(nodeId)) selectOnly(nodeId);
  const rendered = nodeRenderedPosition(nodeId) || { x: node.x, y: node.y };
  clearNodeResizeHover();
  ix.resizing = {
    nodeId,
    edge,
    anchorLocked: Boolean(foldExposedNodePosition(node)),
    startMouse: { x: e.clientX, y: e.clientY },
    startX: rendered.x,
    startY: rendered.y,
    startW: currentRect ? Math.round(currentRect.width / vp.zoom) : (node.width || def?.defaultWidth || 220),
    startH: currentRect ? Math.round(currentRect.height / vp.zoom) : (node.height || estimatedNodeHeight(node)),
  };
  document.body.classList.add("is-resizing");
  document.body.style.cursor = resizeCursorForEdge(edge);
}

// Fixed floor for the string primitive's editor surface. Text content should
// scroll inside the surface instead of forcing the node to grow as it changes.
function stringEditorMinRowHeight() {
  return 62;
}

function nodeResizeMin(node) {
  if (!node) return { w: 160, h: 120 };
  const def = NODE_BY_TYPE[node.type];
  if (node.type === "reroute") {
    return { w: def?.defaultWidth || 88, h: def?.defaultHeight || 30 };
  }
  const minW = node.type === "text-input" ? 220 : (def?.defaultWidth ? Math.min(def.defaultWidth, 220) : 160);

  const HEADER = 34;
  const PANEL_HEAD = 32;
  const SOCKET_ROW = 31;
  const PROP_ROW = 33;
  const TEXTAREA_ROW = 68;
  const PREVIEW_BODY = 120;
  const FOOTER = 26;
  const MINIMIZED_BODY = 18;
  // Buffer requested by user: ~50px under the last socket/group so the node
  // never feels cramped, even when panels are expanded with little content.
  // The string primitive already pads itself via the editor's toolbar and
  // textarea chrome, so it gets a much smaller buffer to avoid the visibly
  // huge empty area that shows up once the value grows past a few lines.
  const BOTTOM_BUFFER = node.type === "text-input" ? 6 : 50;

  if (node.minimized) {
    return {
      w: minW,
      h: HEADER + MINIMIZED_BODY + FOOTER,
    };
  }

  let contentH = 0;

  // Outputs panel.
  const outputs = def?.outputs || [];
  if (outputs.length > 0) {
    if (shouldWrapSocketSection(outputs)) {
      contentH += PANEL_HEAD;
      if (!isNodePanelCollapsed(node, "outputs", false)) {
        contentH += outputs.length * SOCKET_ROW;
      }
    } else {
      contentH += outputs.length * SOCKET_ROW;
    }
  }

  // Props are split into one collapsible panel per group.
  const props = def?.props || [];
  if (props.length > 0) {
    const groups = new Map();
    for (const prop of props) {
      const gid = propGroupId(prop);
      if (!groups.has(gid)) groups.set(gid, []);
      groups.get(gid).push(prop);
    }
    for (const [gid, list] of groups) {
      contentH += PANEL_HEAD;
      const panelKey = `props:${gid}`;
      const collapsed = isNodePanelCollapsed(node, panelKey, propGroupDefaultCollapsed(node, gid));
      if (!collapsed) {
        for (const prop of list) {
          if (prop.mdEditor) contentH += stringEditorMinRowHeight(node, prop);
          else contentH += prop.kind === "textarea" ? TEXTAREA_ROW : PROP_ROW;
        }
      }
    }
  }

  // Inputs panel.
  const inputs = def?.inputs || [];
  if (inputs.length > 0) {
    let rows = 0;
    for (const sock of inputs) {
      if (sock.multi) {
        const matches = graph.edges.filter((e) => e.toNode === node.id && e.toSocket === sock.id).length;
        rows += Math.max(1, matches + 1);
      } else {
        rows += 1;
      }
    }
    if (shouldWrapSocketSection(Array.from({ length: rows }))) {
      contentH += PANEL_HEAD;
      if (!isNodePanelCollapsed(node, "inputs", false)) {
        contentH += rows * SOCKET_ROW;
      }
    } else {
      contentH += rows * SOCKET_ROW;
    }
  }

  // Preview body.
  if (PREVIEW_TYPES.has(node.type)) {
    contentH += PREVIEW_BODY;
  }

  return {
    w: minW,
    h: HEADER + contentH + FOOTER + BOTTOM_BUFFER,
  };
}

function applyNodeMinimumSizeNow(nodeId) {
  const node = graph.nodes[nodeId];
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!node || !el) return;
  const min = nodeResizeMin(node);
  enforceNodeMinimumSize(nodeId, node, el);
  const def = NODE_BY_TYPE[node.type];
  const currentW = node.width || def?.defaultWidth || 220;
  if (currentW < min.w) {
    node.width = min.w;
    el.style.width = `${min.w}px`;
  }
  if (node.height && node.height < min.h) {
    node.height = min.h;
    el.style.height = `${min.h}px`;
    el.classList.add("is-resized");
  }
  requestAnimationFrame(renderConnections);
}

function enforceNodeMinimumSize(id, node, el) {
  // IMPORTANT: do NOT mutate node.width/node.height here. This runs on every
  // render (including during drag), so any writeback would ratchet the node
  // size upward each frame. Just expose the floor via CSS — the browser will
  // grow the element naturally to fit content, and the resize/scale handlers
  // clamp to this same floor when the user explicitly resizes.
  const min = nodeResizeMin(node);
  el.style.minWidth = `${min.w}px`;
  el.style.minHeight = `${min.h}px`;
  // Horizontal: explicitly remove any max so wider scaling stays unrestricted.
  el.style.maxWidth = "none";
}

// ─── Modal transforms (Blender G/R/S) ─────────────────────────────────────────

function startModal(kind) {
  if (ix.selection.size === 0) {
    setHint("Select nodes first");
    return;
  }
  const snapshots = new Map();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (const id of ix.selection) {
    const node = graph.nodes[id];
    if (!node) continue;
    const w = node.width || NODE_BY_TYPE[node.type]?.defaultWidth || 220;
    const h = node.height || estimatedNodeHeight(node);
    snapshots.set(id, {
      x: node.x,
      y: node.y,
      w,
      h,
      hadHeight: node.height != null,
    });
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + w);
    maxY = Math.max(maxY, node.y + h);
    n++;
  }
  if (n === 0) return;
  const modalIds = [...snapshots.keys()];
  const pivot = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  ix.modal = {
    kind,
    startMouse: screenToCanvas(ix.lastMouseScreen.x, ix.lastMouseScreen.y),
    snapshots,
    companionSnapshots: kind === "G" ? collapsedPreviewCompanionSnapshots(modalIds, modalIds) : new Map(),
    pivot,
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
    for (const [id, snap] of m.companionSnapshots || []) {
      const node = graph.nodes[id];
      if (!node) continue;
      node.x = snap.x + useX;
      node.y = snap.y + useY;
    }
  } else if (m.kind === "S") {
    const distStart = Math.hypot(m.startMouse.x - m.pivot.x, m.startMouse.y - m.pivot.y) || 1;
    const distNow = Math.hypot(cur.x - m.pivot.x, cur.y - m.pivot.y);
    const factor = distNow / distStart;
    // Blender-style: with a single node selected, S resizes the node (with
    // optional X/Y axis lock for width/height only). With multiple nodes
    // selected, S keeps node sizes intact and just fans positions out/in
    // around the median pivot — same as Blender's node editor behaviour.
    const multi = m.snapshots.size > 1;
    const fx = m.axis === "y" ? 1 : factor;
    const fy = m.axis === "x" ? 1 : factor;
    for (const [id, snap] of m.snapshots) {
      const node = graph.nodes[id];
      if (!node) continue;
      // Position scales around pivot on whichever axes are active.
      node.x = m.pivot.x + (snap.x - m.pivot.x) * fx;
      node.y = m.pivot.y + (snap.y - m.pivot.y) * fy;
      if (multi) {
        // Restore snapshot size so multi-select scaling never resizes nodes.
        node.width = snap.w;
        node.height = snap.hadHeight ? snap.h : null;
        continue;
      }
      // Pin the floor to the snapshot's pre-scale width so the content-aware
      // min height stays stable through the gesture instead of stepping.
      if (!snap.min) snap.min = nodeResizeMin(node);
      const min = snap.min;
      node.width = Math.max(min.w, Math.round(snap.w * fx));
      node.height = Math.max(min.h, Math.round(snap.h * fy));
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
    node.width = snap.w;
    node.height = snap.hadHeight ? snap.h : null;
  }
  for (const [id, snap] of ix.modal.companionSnapshots || []) {
    const node = graph.nodes[id];
    if (!node) continue;
    node.x = snap.x;
    node.y = snap.y;
  }
  ix.modal = null;
  document.body.classList.remove("is-modal");
  clearHint();
  renderNodes();
  renderConnections();
}

function setModalHint(kind) {
  const labels = { G: "Grab/move — LMB confirm · RMB/Esc cancel · X/Y constrain · Ctrl snap",
                   S: "Scale — LMB confirm · RMB/Esc cancel · X/Y constrain · multi-select fans positions",
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
  updateNodeResizeHover(e);

  if (ix.reroutePlacement) { updateReroutePlacement(e.clientX, e.clientY); return; }

  if (ix.modal) { updateModal(e); return; }

  if (ix.resizing) {
    const r = ix.resizing;
    const node = graph.nodes[r.nodeId];
    if (node) {
      const dx = (e.clientX - r.startMouse.x) / vp.zoom;
      const dy = (e.clientY - r.startMouse.y) / vp.zoom;
      // Use a stable floor captured from the node's pre-drag width so the
      // content-aware min height doesn't jump as width changes mid-drag.
      if (!r.min) r.min = nodeResizeMin(node);
      const min = r.min;
      const edge = r.edge || "se";
      let nextX = r.startX;
      let nextY = r.startY;
      let nextW = r.startW;
      let nextH = r.startH;
      if (edge.includes("e")) nextW = r.startW + dx;
      if (edge.includes("s")) nextH = r.startH + dy;
      if (edge.includes("w")) {
        nextW = r.startW - dx;
        nextX = r.startX + dx;
      }
      if (edge.includes("n")) {
        nextH = r.startH - dy;
        nextY = r.startY + dy;
      }
      if (nextW < min.w) {
        if (edge.includes("w")) nextX = r.startX + (r.startW - min.w);
        nextW = min.w;
      }
      if (nextH < min.h) {
        if (edge.includes("n")) nextY = r.startY + (r.startH - min.h);
        nextH = min.h;
      }
      if (!r.anchorLocked) {
        node.x = Math.round(nextX);
        node.y = Math.round(nextY);
      }
      node.width = Math.round(nextW);
      node.height = Math.round(nextH);
      if (r.anchorLocked || nodeUsesFoldLayout(node)) {
        renderNodes();
      } else {
        const el = document.querySelector(`[data-node-id="${r.nodeId}"]`);
        if (el) {
          el.style.left = `${node.x}px`;
          el.style.top = `${node.y}px`;
          el.style.width = `${node.width}px`;
          el.style.height = `${node.height}px`;
          el.classList.add("is-resized");
        }
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
      const movedIds = new Set(movedSet);
      for (const id of movedSet) {
        const n = graph.nodes[id];
        if (!n) continue;
        n.x += dx; n.y += dy;
      }
      // If a moved node is a collapsed preview, drag the nodes it currently
      // owns by the same delta so they expand back into the same layout.
      for (const id of movedSet) {
        const n = graph.nodes[id];
        if (!n || !PREVIEW_TYPES.has(n.type) || !n.collapsed) continue;
        moveCollapsedPreviewCompanions(id, dx, dy, movedIds);
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
    const resizedId = ix.resizing.nodeId;
    ix.resizing = null;
    document.body.classList.remove("is-resizing");
    document.body.style.cursor = "";
    // If a fold-exposed preview or its anchor was resized, redraw the
    // temporary dock so adjacent previews keep their horizontal alignment.
    const rn = graph.nodes[resizedId];
    if (rn) {
      if (rn.foldAnchorId || foldExposedNodeIds(resizedId).length > 0) {
        renderNodes();
        renderConnections();
      }
    }
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
    document.body.classList.remove("is-dragging-node");
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
    const socketEl = el?.closest?.(".ne-socket") || findSocketTargetAt(e.clientX, e.clientY);
    if (socketEl) {
      endWire(
        socketEl.dataset.nodeId,
        socketEl.dataset.socketId,
        socketEl.dataset.socketType,
        socketEl.dataset.isOutput === "1",
        (socketEl.dataset.aggregateSocketIds || "").split(/\s+/).filter(Boolean)
      );
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
        const pos = nodeRenderedPosition(id) || { x: node.x, y: node.y };
        const w = node.width || 220;
        const h = estimatedNodeHeight(node);
        if (pos.x < maxX && pos.x + w > minX && pos.y < maxY && pos.y + h > minY) {
          ix.selection.add(id);
        }
      }
      updateSelectionVisuals();
      if (ix.selection.size === 1) renderProps([...ix.selection][0]);
    }
    ix.boxStart = null;
  }
}

function zoomablePreviewFromEvent(e) {
  const targetEl = e.target instanceof Element ? e.target : null;
  const stage = targetEl?.closest?.(".ne-preview-zoom-stage");
  if (!stage) return null;
  const nodeEl = stage.closest(".ne-node.is-preview");
  if (!nodeEl) return null;
  const nodeId = nodeEl.dataset.nodeId;
  if (!nodeId) return null;
  const node = graph.nodes[nodeId];
  return node || null;
}

function handlePreviewWheel(e) {
  const node = zoomablePreviewFromEvent(e);
  if (!node) return false;
  const deltaUnit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : (e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1);
  const delta = e.deltaY * deltaUnit;
  if (!Number.isFinite(delta) || delta === 0) return false;
  e.preventDefault();
  e.stopPropagation();
  const current = clampPreviewZoom(node);
  setPreviewZoom(node.id, current * Math.exp(-delta * PREVIEW_ZOOM_WHEEL_SENSITIVITY), { anchor: e });
  return true;
}

function onCanvasWheel(e) {
  if (handlePreviewWheel(e)) return;
  e.preventDefault();
  const deltaUnit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : (e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1);
  const delta = e.deltaY * deltaUnit;
  if (!Number.isFinite(delta) || delta === 0) return;
  const wrapRect = document.getElementById("canvasWrap").getBoundingClientRect();
  const cx = e.clientX - wrapRect.left;
  const cy = e.clientY - wrapRect.top;
  const canvasX = (cx - vp.x) / vp.zoom;
  const canvasY = (cy - vp.y) / vp.zoom;
  const nextZoom = clampValue(vp.zoom * Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY), ZOOM_MIN, ZOOM_MAX);
  vp.zoom = nextZoom;
  vp.x = cx - canvasX * nextZoom;
  vp.y = cy - canvasY * nextZoom;
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

const SHORTCUT_DEFINITIONS = [
  { id: "runGraph", group: "Run", label: "Run graph", description: "Run active graph", default: "Mod+Enter" },
  { id: "addNodeMenu", group: "Graph", label: "Add node menu", description: "Open node picker", default: "Shift+A" },
  { id: "renameNode", group: "Graph", label: "Rename node", description: "Edit selected node title", default: "F2" },
  { id: "grabNodes", group: "Graph", label: "Grab", description: "Move selected nodes", default: "G" },
  { id: "scaleNodes", group: "Graph", label: "Scale", description: "Resize selected nodes", default: "S" },
  { id: "placeReroute", group: "Graph", label: "Place reroute", description: "Sprout reroute from selection", default: "E" },
  { id: "muteNodes", group: "Graph", label: "Mute nodes", description: "Toggle selected or hovered nodes", default: "M" },
  { id: "togglePalette", group: "Panels", label: "Node palette", description: "Toggle node palette", default: "T" },
  { id: "toggleProperties", group: "Panels", label: "Properties", description: "Toggle properties panel", default: "P" },
  { id: "openRuns", group: "Panels", label: "Runs", description: "Open runs page", default: "R" },
  { id: "toggleAgentPanel", group: "Panels", label: "Palette", description: "Toggle floating palette", default: "N" },
  { id: "cutSelection", group: "Edit", label: "Cut selection", description: "Copy and remove selected nodes", default: "Mod+X" },
  { id: "deleteSelection", group: "Edit", label: "Delete selection", description: "Remove selected nodes", default: "Delete" },
  { id: "selectAll", group: "Edit", label: "Select all", description: "Toggle all nodes", default: "A" },
  { id: "duplicateSelection", group: "Edit", label: "Duplicate", description: "Duplicate selected nodes", default: "Shift+D" },
  { id: "frameAll", group: "View", label: "Frame all", description: "Fit graph to view", default: "Home" },
  { id: "fitView", group: "View", label: "Fit to view", description: "Fit graph to view", default: "Shift+C" },
  { id: "autoConnect", group: "Wire", label: "Auto connect", description: "Connect two selected nodes", default: "F" },
  { id: "hideNodes", group: "View", label: "Hide nodes", description: "Collapse selected or hovered nodes", default: "H" },
  { id: "previewSelected", group: "Preview", label: "Preview selected", description: "Create preview node", default: "Alt+P" },
  { id: "previewPrevious", group: "Preview", label: "Previous preview item", description: "Step selected preview backward", default: "ArrowLeft" },
  { id: "previewNext", group: "Preview", label: "Next preview item", description: "Step selected preview forward", default: "ArrowRight" },
  { id: "previewZoomIn", group: "Preview", label: "Preview zoom in", description: "Zoom selected preview", default: "ArrowUp" },
  { id: "previewZoomOut", group: "Preview", label: "Preview zoom out", description: "Zoom selected preview", default: "ArrowDown" },
  { id: "saveGraph", group: "Graphs", label: "Save graph", description: "Save current graph", default: "Mod+S" },
  { id: "loadGraphJson", group: "Graphs", label: "Load graph JSON", description: "Open graph JSON", default: "Mod+O" },
];

const SHORTCUT_BY_ID = Object.fromEntries(SHORTCUT_DEFINITIONS.map((def) => [def.id, def]));
let shortcutCaptureAction = null;

function shortcutState() {
  if (!webStore.state.shortcuts || typeof webStore.state.shortcuts !== "object") webStore.state.shortcuts = {};
  return webStore.state.shortcuts;
}

function normalizeShortcutKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const aliases = {
    esc: "Escape",
    escape: "Escape",
    del: "Delete",
    delete: "Delete",
    space: "Space",
    return: "Enter",
    enter: "Enter",
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
  };
  if (aliases[lower]) return aliases[lower];
  if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
  if (raw.length === 1) return raw.toUpperCase();
  return raw[0].toUpperCase() + raw.slice(1);
}

function normalizeShortcutCombo(combo) {
  const parts = String(combo || "").split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  let hasMod = false;
  let hasShift = false;
  let hasAlt = false;
  let key = "";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (["mod", "ctrl", "control", "cmd", "command", "meta"].includes(lower)) hasMod = true;
    else if (lower === "shift") hasShift = true;
    else if (["alt", "option"].includes(lower)) hasAlt = true;
    else key = normalizeShortcutKey(part);
  }
  if (!key) return "";
  const out = [];
  if (hasMod) out.push("Mod");
  if (hasShift) out.push("Shift");
  if (hasAlt) out.push("Alt");
  out.push(key);
  return out.join("+");
}

function shortcutFor(actionId) {
  const def = SHORTCUT_BY_ID[actionId];
  if (!def) return "";
  const custom = shortcutState()[actionId];
  return normalizeShortcutCombo(custom || def.default || "");
}

function eventShortcutKey(e) {
  if (!e || !e.key) return "";
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return "";
  if (e.key === " ") return "Space";
  return normalizeShortcutKey(e.key);
}

function shortcutEventToCombo(e) {
  const key = eventShortcutKey(e);
  if (!key) return "";
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}

function shortcutMatches(e, actionId) {
  const expected = shortcutFor(actionId);
  return Boolean(expected) && shortcutEventToCombo(e) === expected;
}

function formatShortcut(combo) {
  const normalized = normalizeShortcutCombo(combo);
  if (!normalized) return "Unassigned";
  return normalized.split("+").map((part) => part === "Mod" ? "Ctrl/Cmd" : part).join("+");
}

function shortcutConflict(actionId, combo) {
  const normalized = normalizeShortcutCombo(combo);
  if (!normalized) return null;
  return SHORTCUT_DEFINITIONS.find((def) => def.id !== actionId && shortcutFor(def.id) === normalized) || null;
}

function setShortcut(actionId, combo) {
  const def = SHORTCUT_BY_ID[actionId];
  if (!def) return;
  const normalized = normalizeShortcutCombo(combo);
  const store = shortcutState();
  if (!normalized || normalized === normalizeShortcutCombo(def.default)) delete store[actionId];
  else store[actionId] = normalized;
  scheduleWebStoreSave();
  renderShortcutSettings();
}

function resetShortcut(actionId) {
  delete shortcutState()[actionId];
  scheduleWebStoreSave();
  renderShortcutSettings();
}

function resetAllShortcuts() {
  webStore.state.shortcuts = {};
  shortcutCaptureAction = null;
  scheduleWebStoreSave();
  renderShortcutSettings();
}

function beginShortcutCapture(actionId) {
  shortcutCaptureAction = actionId;
  renderShortcutSettings();
}

function handleShortcutCaptureKeydown(e) {
  if (!shortcutCaptureAction) return false;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") {
    shortcutCaptureAction = null;
    renderShortcutSettings();
    return true;
  }
  const combo = shortcutEventToCombo(e);
  if (!combo) return true;
  const conflict = shortcutConflict(shortcutCaptureAction, combo);
  if (conflict) {
    setHint(`${formatShortcut(combo)} is used by ${conflict.label}`);
    setTimeout(clearHint, 1800);
    return true;
  }
  setShortcut(shortcutCaptureAction, combo);
  shortcutCaptureAction = null;
  return true;
}

function renderShortcutSettings() {
  const root = document.getElementById("shortcutsList");
  if (!root) return;
  const groups = [];
  for (const def of SHORTCUT_DEFINITIONS) {
    let group = groups.find((item) => item.name === def.group);
    if (!group) {
      group = { name: def.group, items: [] };
      groups.push(group);
    }
    group.items.push(def);
  }
  const frag = document.createDocumentFragment();
  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "shortcut-group";
    const title = document.createElement("div");
    title.className = "shortcut-group-title";
    title.textContent = group.name;
    section.appendChild(title);
    for (const def of group.items) {
      const row = document.createElement("div");
      row.className = "shortcut-row";

      const name = document.createElement("div");
      name.className = "shortcut-name";
      const strong = document.createElement("strong");
      strong.textContent = def.label;
      const desc = document.createElement("span");
      desc.textContent = def.description || "";
      name.append(strong, desc);

      const key = document.createElement("button");
      key.type = "button";
      key.className = "shortcut-key" + (shortcutCaptureAction === def.id ? " is-capturing" : "");
      key.textContent = shortcutCaptureAction === def.id ? "Press keys" : formatShortcut(shortcutFor(def.id));
      key.addEventListener("click", () => beginShortcutCapture(def.id));

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "btn btn-ghost btn-tiny shortcut-reset";
      reset.textContent = "Reset";
      reset.disabled = !Object.prototype.hasOwnProperty.call(shortcutState(), def.id);
      reset.addEventListener("click", () => resetShortcut(def.id));

      row.append(name, key, reset);
      section.appendChild(row);
    }
    frag.appendChild(section);
  }
  root.replaceChildren(frag);
  const meta = document.getElementById("settingsPageMeta");
  if (meta) meta.textContent = `${SHORTCUT_DEFINITIONS.length} shortcuts · .rundeer/web-state.json`;
}

function selectedSliderPreviewNodeId() {
  const ids = [...ix.selection].filter((id) => {
    const node = graph.nodes[id];
    return node && PREVIEW_TYPES.has(node.type) && !node.hidden && previewModeForNode(node) === "slider" && previewBundleItems(node).length > 0;
  });
  return ids.length === 1 ? ids[0] : null;
}

function selectedZoomablePreviewNodeId() {
  const ids = [...ix.selection].filter((id) => {
    const node = graph.nodes[id];
    if (!node || !PREVIEW_TYPES.has(node.type) || node.hidden || !node.lastResult) return false;
    if (Array.isArray(node.lastResult.value)) return previewModeForNode(node) === "slider" && previewBundleItems(node).length > 0;
    const value = String(node.lastResult.value ?? "");
    const kind = inferPreviewMediaKind(node, node.lastResult.kind, value);
    return kind === "image" || kind === "video";
  });
  return ids.length === 1 ? ids[0] : null;
}

function handlePreviewKeydown(e) {
  const isPrevious = shortcutMatches(e, "previewPrevious");
  const isNext = shortcutMatches(e, "previewNext");
  const isZoomIn = shortcutMatches(e, "previewZoomIn");
  const isZoomOut = shortcutMatches(e, "previewZoomOut");
  if (!isPrevious && !isNext && !isZoomIn && !isZoomOut) return false;
  const sliderNodeId = selectedSliderPreviewNodeId();
  const zoomNodeId = selectedZoomablePreviewNodeId();
  if ((isPrevious || isNext) && !sliderNodeId) return false;
  if ((isZoomIn || isZoomOut) && !zoomNodeId) return false;
  if (isPrevious) stepPreviewIndex(sliderNodeId, -1);
  if (isNext) stepPreviewIndex(sliderNodeId, 1);
  if (isZoomIn) stepPreviewZoom(zoomNodeId, 1);
  if (isZoomOut) stepPreviewZoom(zoomNodeId, -1);
  e.preventDefault();
  return true;
}

function onKeydown(e) {
  if (handleShortcutCaptureKeydown(e)) return;
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
  if (addMenu.style.display !== "none") {
    if (e.key === "Escape") hideAddMenu();
    e.preventDefault(); return;
  }

  if (ix.reroutePlacement) {
    if (e.key === "Escape") { cancelReroutePlacement(); e.preventDefault(); return; }
    if (e.key === "Enter") { commitReroutePlacement(); e.preventDefault(); return; }
    return;
  }

  if (e.key === "Escape") {
    cancelWire();
    return;
  }

  if (handlePreviewKeydown(e)) return;

  if (shortcutMatches(e, "runGraph")) {
    e.preventDefault();
    runGraph();
    return;
  }

  if (shortcutMatches(e, "addNodeMenu")) {
    e.preventDefault();
    showAddMenu(ix.lastMouseScreen.x, ix.lastMouseScreen.y);
    return;
  }

  if (shortcutMatches(e, "renameNode")) {
    e.preventDefault();
    const ids = [...ix.selection].filter((id) => graph.nodes[id] && !graph.nodes[id].hidden);
    if (ids.length === 1) {
      startNodeTitleEdit(ids[0]);
    } else {
      setHint("F2: select one node to rename");
      setTimeout(clearHint, 1400);
    }
    return;
  }
  if (shortcutMatches(e, "grabNodes")) {
    e.preventDefault();
    startModal("G");
    return;
  }
  if (shortcutMatches(e, "scaleNodes")) {
    e.preventDefault();
    startModal("S");
    return;
  }

  if (shortcutMatches(e, "placeReroute")) {
    e.preventDefault();
    startReroutePlacement();
    return;
  }

  if (shortcutMatches(e, "muteNodes")) {
    e.preventDefault();
    if (ix.selection.size > 0) {
      toggleNodeMuted([...ix.selection]);
      return;
    }
    const hovered = document.elementFromPoint(ix.lastMouseScreen.x, ix.lastMouseScreen.y)?.closest?.(".ne-node");
    if (hovered?.dataset?.nodeId) {
      toggleNodeMuted(hovered.dataset.nodeId);
      return;
    }
    setHint("M: select a node first");
    setTimeout(clearHint, 1400);
    return;
  }

  if (shortcutMatches(e, "togglePalette")) {
    e.preventDefault();
    togglePanel("palette");
    return;
  }
  if (shortcutMatches(e, "toggleProperties")) {
    e.preventDefault();
    togglePanel("props");
    return;
  }
  if (shortcutMatches(e, "openRuns")) {
    e.preventDefault();
    togglePanel("runs");
    return;
  }
  if (shortcutMatches(e, "toggleAgentPanel")) {
    e.preventDefault();
    togglePanel("n");
    return;
  }

  if (shortcutMatches(e, "cutSelection")) {
    e.preventDefault();
    cutSelectionToClipboard();
    return;
  }

  if (shortcutMatches(e, "deleteSelection")) {
    if (ix.selection.size > 0) {
      e.preventDefault();
      removeSelectedNodes();
    }
    return;
  }

  if (shortcutMatches(e, "selectAll")) {
    e.preventDefault();
    if (ix.selection.size === Object.keys(graph.nodes).length) {
      ix.selection.clear();
    } else {
      ix.selection = new Set(Object.keys(graph.nodes).filter((id) => !graph.nodes[id].hidden));
    }
    updateSelectionVisuals();
    return;
  }

  if (shortcutMatches(e, "duplicateSelection")) {
    e.preventDefault();
    duplicateSelection();
    return;
  }

  if (shortcutMatches(e, "frameAll")) {
    e.preventDefault();
    frameAll();
    return;
  }

  if (shortcutMatches(e, "fitView")) {
    e.preventDefault();
    frameAll();
    return;
  }

  if (shortcutMatches(e, "autoConnect")) {
    e.preventDefault();
    autoConnectSelected();
    return;
  }

  if (shortcutMatches(e, "hideNodes")) {
    e.preventDefault();
    if (ix.selection.size > 0) {
      toggleNodeMinimized([...ix.selection]);
      return;
    }
    const hovered = document.elementFromPoint(ix.lastMouseScreen.x, ix.lastMouseScreen.y)?.closest?.(".ne-node");
    if (hovered?.dataset?.nodeId) {
      toggleNodeMinimized(hovered.dataset.nodeId);
      return;
    }
    setHint("H: select a node first");
    setTimeout(clearHint, 1400);
    return;
  }

  if (shortcutMatches(e, "previewSelected")) {
    e.preventDefault();
    previewSelected();
    return;
  }

  if (shortcutMatches(e, "saveGraph")) {
    e.preventDefault();
    saveGraphToFile();
    return;
  }

  if (shortcutMatches(e, "loadGraphJson")) {
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
    newNode.title = node.title || "";
    newNode.width = node.width;
    newNode.height = node.height;
    newNode.collapsedPanels = JSON.parse(JSON.stringify(node.collapsedPanels || {}));
    newNode.minimized = Boolean(node.minimized);
    newNode.muted = Boolean(node.muted);
    newNode.foldLocked = Boolean(node.foldLocked);
    newNode.previewMode = node.previewMode || null;
    newNode.previewIndex = Number.isFinite(Number(node.previewIndex)) ? Number(node.previewIndex) : 0;
    newNode.previewZoom = Number.isFinite(Number(node.previewZoom)) ? Number(node.previewZoom) : 1;
    newNode.previewPanX = Number.isFinite(Number(node.previewPanX)) ? Number(node.previewPanX) : 0;
    newNode.previewPanY = Number.isFinite(Number(node.previewPanY)) ? Number(node.previewPanY) : 0;
    newNode.textZoom = Number.isFinite(Number(node.textZoom)) ? Number(node.textZoom) : 1;
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
    applyPaletteLayout({ commitHandleSide: true });
    setHint(shell.classList.contains("hide-palette") ? "palette hidden (T)" : "palette shown (T)");
  } else if (which === "props") {
    const willShow = shell.classList.contains("hide-props");
    preserveCanvasRightEdge(() => {
      if (willShow) {
        shell.classList.remove("hide-props");
      } else {
        shell.classList.add("hide-props");
      }
    });
    applyPaletteLayout({ commitHandleSide: true });
    setHint(shell.classList.contains("hide-props") ? "properties hidden (P)" : "properties shown (P)");
  } else if (which === "n") {
    shell.classList.toggle("hide-n");
    paletteLayoutState().hidden = shell.classList.contains("hide-n");
    applyPaletteLayout({ commitHandleSide: true });
    scheduleWebStoreSave();
    setHint(shell.classList.contains("hide-n") ? "palette hidden (N)" : "palette shown (N)");
  } else if (which === "runs") {
    setActiveView("runs");
    setHint("runs view (R)");
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
    for (const inp of inputSocketDefsForDef(bDef)) {
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
    const h = estimatedNodeHeight(n);
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
  vp.zoom = clampValue(Math.min(scaleX, scaleY), ZOOM_MIN, Math.min(ZOOM_MAX, 1.5));
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
  document.body.classList.remove("is-wiring");
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
    section.dataset.category = cat.category;
    const title = document.createElement("div");
    title.className = "ne-add-menu-section-title";
    title.innerHTML = `<span class="ne-add-menu-section-dot"></span>${escHtml(cat.category)}`;
    section.appendChild(title);

    for (const nodeDef of matching) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ne-add-menu-item";
      item.dataset.category = cat.category;
      item.title = nodeDef.desc;
      item.innerHTML = `<span class="ne-add-menu-dot"></span>${escHtml(nodeDef.label)}`;
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
            const compat = inputSocketDefsForDef(def).find((s) => canConnect(w.fromType, s.type));
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
    nameEl.title = "";
    body.innerHTML = `<div class="ne-props-empty">
      Click a node to inspect its properties.<br><br>
      <span class="ne-shortcuts">
        <b>Shift+A</b> add node · <b>Ctrl+X</b> cut · <b>Delete</b> remove<br>
        <b>F2</b> rename · <b>G</b> grab · <b>S</b> scale<br>
        <b>F</b> auto-connect · <b>E</b> reroute · <b>Alt+P</b> preview<br>
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
  nameEl.textContent = nodeDisplayTitle(node);
  nameEl.title = nodeDefaultLabel(node);

  body.appendChild(buildNodeIdentitySection(nodeId, node, def));

  // Sockets summary
  const sockSection = document.createElement("div");
  sockSection.className = "ne-props-section";
  sockSection.innerHTML = `<p class="ne-props-section-title">sockets</p>`;
  const propSockets = (def.props || []).map((prop) => ({
    id: prop.id,
    label: prop.label,
    type: socketTypeForProp(prop),
    isProp: true,
  }));
  for (const sock of [...(def.outputs || []), ...(def.inputs || []), ...propSockets]) {
    const isIn = (def.inputs || []).includes(sock) || sock.isProp;
    const row = document.createElement("div");
    row.className = "ne-props-socket-row";
    if (sock.isProp) row.classList.add("is-prop");
    row.innerHTML = `
      <span class="ne-props-dot" style="background:${SOCKET_TYPES[sock.type]?.color || "#888"}"></span>
      <span>${isIn ? "↦" : "↤"} ${escHtml(sock.label)}${sock.isProp ? " <small>prop</small>" : ""}</span>
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

function buildNodeIdentitySection(nodeId, node, def) {
  const section = document.createElement("div");
  section.className = "ne-props-section ne-props-identity";
  section.innerHTML = `<p class="ne-props-section-title">node</p>`;

  const titleWrap = document.createElement("div");
  titleWrap.className = "ne-prop";
  const titleLabel = document.createElement("label");
  titleLabel.className = "ne-prop-label";
  titleLabel.textContent = "Title";
  const titleField = document.createElement("div");
  titleField.className = "ne-prop-field";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "ne-node-title-control";
  titleInput.dataset.titleNode = nodeId;
  titleInput.value = node.title || "";
  titleInput.placeholder = def.label;
  titleInput.addEventListener("input", () => setNodeTitle(nodeId, titleInput.value, titleInput));
  titleInput.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    if (!ix.selection.has(nodeId)) selectOnly(nodeId);
  });
  titleInput.addEventListener("click", (e) => e.stopPropagation());
  titleField.appendChild(titleInput);
  titleWrap.append(titleLabel, titleField);
  section.appendChild(titleWrap);

  const meta = document.createElement("div");
  meta.className = "ne-props-node-meta";
  meta.innerHTML = `
    <span><b>type</b>${escHtml(def.label)}</span>
    <span><b>category</b>${escHtml(def.category || "Node")}</span>`;
  section.appendChild(meta);
  return section;
}

function buildPropControl(nodeId, propDef, currentValue) {
  const wrap = document.createElement("div");
  wrap.className = "ne-prop";

  // If a socket-edge feeds this prop, the control becomes read-only and is
  // visually muted to make clear the value is coming from upstream.
  const isWired = isPropWired(nodeId, propDef.id);
  if (isWired) wrap.classList.add("is-disabled");

  if (propDef.kind === "checkbox") {
    const label = document.createElement("label");
    label.className = "ne-prop-toggle";
    const { control } = buildPropValueControl(nodeId, propDef, currentValue, { disabled: isWired });
    const span = document.createElement("span");
    span.className = "ne-prop-label";
    span.textContent = propDef.label;
    label.appendChild(control);
    label.appendChild(span);
    wrap.appendChild(label);
    return wrap;
  }

  const lbl = document.createElement("label");
  lbl.className = "ne-prop-label";
  lbl.textContent = propDef.label;
  wrap.appendChild(lbl);

  const field = document.createElement("div");
  field.className = "ne-prop-field";
  const { control, valueDisplay } = buildPropValueControl(nodeId, propDef, currentValue, { disabled: isWired });
  field.appendChild(control);
  if (valueDisplay) field.appendChild(valueDisplay);
  wrap.appendChild(field);
  return wrap;
}

// ─── Advanced String editor (markdown preview + @-mentions) ──────────────────

function escHtmlSafe(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Classify an @reference token by looking it up against the upstream mention
// catalog. Returns one of: image | video | file | definition | text | unknown.
function classifyReferenceToken(token, nodeId) {
  if (!token) return "unknown";
  const t = token.toLowerCase();
  // Definitions appear as @name on Definition nodes.
  for (const n of Object.values(graph.nodes)) {
    if (n.type === "definition" && (n.props?.name || "").toLowerCase() === t) return "definition";
  }
  const opts = gatherMentionOptions(nodeId);
  for (const o of opts) {
    if (basenameOf(o.value).toLowerCase() === t) return o.kind || "file";
  }
  return "unknown";
}

// Wrap @tokens with reference chips. Operates on already-escaped HTML, so it
// only matches plain @ characters that survived escaping.
function highlightReferences(htmlEscaped, nodeId) {
  return htmlEscaped.replace(/(^|[\s(>])@([A-Za-z0-9_.\-/]+)/g, (m, lead, tok) => {
    const kind = classifyReferenceToken(tok, nodeId);
    return `${lead}<span class="ne-ref ne-ref-${kind}" data-ref-kind="${kind}" data-ref-token="${escHtmlSafe(tok)}">@${escHtmlSafe(tok)}</span>`;
  });
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHighlightColor(raw) {
  const value = String(raw || "").trim();
  const rgbFn = value.match(/^rgb\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})\s*\)$/i);
  const plainRgb = value.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  const parts = rgbFn ? rgbFn.slice(1) : (plainRgb ? plainRgb.slice(1) : null);
  if (parts) {
    const nums = parts.map((n) => Number(n));
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return `rgb(${nums[0]}, ${nums[1]}, ${nums[2]})`;
    }
  }
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return value;
  return null;
}

function stripOuterQuotes(value) {
  const s = String(value || "").trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseWordHighlightPairs(src) {
  const specs = [];
  const seen = new Set();
  for (const rawLine of String(src || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    let match = line.match(/^(.+?)\s*(?:=>|=|\||:)\s*(.+)$/);
    if (!match) {
      match = line.match(/^(.+?)\s+(rgb\([^)]*\)|#[0-9a-fA-F]{3,6}|\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})$/);
    }
    if (!match) continue;
    const word = stripOuterQuotes(match[1]);
    const color = normalizeHighlightColor(match[2]);
    if (!word || !color) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push({ word, escapedWord: escHtmlSafe(word), color });
  }
  return specs.sort((a, b) => b.escapedWord.length - a.escapedWord.length);
}

function applyConfiguredWordHighlights(html, specs) {
  if (!specs || specs.length === 0) return html;
  const pattern = specs.map((spec) => escapeRegExp(spec.escapedWord)).join("|");
  if (!pattern) return html;
  const byWord = new Map(specs.map((spec) => [spec.escapedWord.toLowerCase(), spec]));
  const wordRe = new RegExp(`(^|[^A-Za-z0-9_])(${pattern})(?=$|[^A-Za-z0-9_])`, "gi");
  return String(html).split(/(<[^>]*>)/g).map((part) => {
    if (!part || part.startsWith("<")) return part;
    return part.replace(wordRe, (match, lead, word) => {
      const spec = byWord.get(String(word).toLowerCase());
      if (!spec) return match;
      return `${lead}<span class="ne-word-highlight" style="--ne-highlight-color: ${spec.color};">${word}</span>`;
    });
  }).join("");
}

function applyTextSearchHighlights(html, query) {
  const q = String(query || "").trim();
  if (!q) return String(html || "");
  const escapedQuery = escHtmlSafe(q);
  const pattern = escapeRegExp(escapedQuery);
  if (!pattern) return String(html || "");
  const re = new RegExp(pattern, "gi");
  return String(html || "").split(/(<[^>]*>)/g).map((part) => {
    if (!part || part.startsWith("<")) return part;
    return part.replace(re, '<mark class="ne-search-hit">$&</mark>');
  }).join("");
}

function countTextSearchMatches(text, query) {
  const q = String(query || "").trim();
  if (!q) return 0;
  const re = new RegExp(escapeRegExp(q), "gi");
  return (String(text || "").match(re) || []).length;
}

function scrollFirstSearchHit(root) {
  const hit = root?.querySelector?.(".ne-search-hit");
  if (hit) hit.scrollIntoView({ block: "center", inline: "nearest" });
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.setAttribute("readonly", "");
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); }
  finally { ta.remove(); }
  return ok;
}

function flashTextButton(button, label = "copied") {
  if (!button) return;
  if (button.dataset.iconButton === "1") {
    const oldLabel = button.getAttribute("aria-label") || button.title || "Copy text";
    button.dataset.state = label;
    button.classList.toggle("is-copied", label === "copied");
    button.classList.toggle("is-failed", label !== "copied");
    button.setAttribute("aria-label", label === "copied" ? "Copied" : "Copy failed");
    button.title = label === "copied" ? "Copied" : "Copy failed";
    button.disabled = true;
    setTimeout(() => {
      button.dataset.state = "";
      button.classList.remove("is-copied", "is-failed");
      button.setAttribute("aria-label", oldLabel);
      button.title = oldLabel;
      button.disabled = false;
    }, 900);
    return;
  }
  const old = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = old;
    button.disabled = false;
  }, 900);
}

// Tiny, dependency-free markdown renderer. Supports: headings, bold, italic,
// inline code, fenced code blocks, blockquotes, hr, links, ordered + unordered
// lists, and paragraphs. Reference chips are layered on top.
function renderInlineMarkdown(src, nodeId, opts = {}) {
  const highlightSpecs = parseWordHighlightPairs(graph.nodes[nodeId]?.props?.highlight_pairs || "");
  const decorate = (html) => applyConfiguredWordHighlights(highlightReferences(html, nodeId), highlightSpecs);
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    let text = escHtmlSafe(buf.join("\n"));
    // inline code
    text = text.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
    // bold + italic (bold first, then italic to avoid swallowing)
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    text = text.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
    // links [label](url)
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    // line breaks
    text = text.replace(/\n/g, "<br>");
    text = decorate(text);
    out.push(`<p>${text}</p>`);
  };

  let para = [];
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      flushParagraph(para); para = [];
      const langMatch = line.match(/^```(\S*)/);
      const lang = langMatch ? langMatch[1] : "";
      i++;
      const code = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]); i++;
      }
      i++; // consume closing fence
      out.push(`<pre data-lang="${escHtmlSafe(lang)}">${applyConfiguredWordHighlights(escHtmlSafe(code.join("\n")), highlightSpecs)}</pre>`);
      continue;
    }

    // hr
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(para); para = [];
      out.push("<hr>");
      i++; continue;
    }

    // heading
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushParagraph(para); para = [];
      const level = h[1].length;
      const inner = decorate(escHtmlSafe(h[2]));
      out.push(`<h${level}>${inner}</h${level}>`);
      i++; continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushParagraph(para); para = [];
      const quoted = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      let inner = escHtmlSafe(quoted.join("\n")).replace(/\n/g, "<br>");
      inner = decorate(inner);
      out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(para); para = [];
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      const inner = items.map((it) => {
        let h = escHtmlSafe(it);
        h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        h = h.replace(/`([^`\n]+)`/g, "<code>$1</code>");
        h = decorate(h);
        return `<li>${h}</li>`;
      }).join("");
      out.push(`<ul>${inner}</ul>`);
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(para); para = [];
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      const inner = items.map((it) => {
        let h = escHtmlSafe(it);
        h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        h = h.replace(/`([^`\n]+)`/g, "<code>$1</code>");
        h = decorate(h);
        return `<li>${h}</li>`;
      }).join("");
      out.push(`<ol>${inner}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph(para); para = [];
      i++; continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);
  return applyTextSearchHighlights(out.join(""), opts.search || "");
}

// Wrap a textarea selection with prefix/suffix, or apply a line transform.
function wrapSelection(textarea, prefix, suffix = prefix) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const v = textarea.value;
  const sel = v.slice(start, end);
  const replacement = `${prefix}${sel}${suffix}`;
  textarea.value = `${v.slice(0, start)}${replacement}${v.slice(end)}`;
  const caretEnd = start + replacement.length;
  textarea.setSelectionRange(start + prefix.length, caretEnd - suffix.length);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}
function prefixLines(textarea, prefix) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const v = textarea.value;
  const lineStart = v.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const before = v.slice(0, lineStart);
  const block = v.slice(lineStart, end);
  const after = v.slice(end);
  const next = block
    .split("\n")
    .map((ln) => (ln.length ? `${prefix}${ln}` : ln))
    .join("\n");
  textarea.value = `${before}${next}${after}`;
  textarea.setSelectionRange(lineStart, lineStart + next.length);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function replaceTextareaRange(textarea, start, end, replacement, selectStart, selectEnd) {
  const value = textarea.value;
  textarea.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  textarea.setSelectionRange(selectStart, selectEnd);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function indentTextareaSelection(textarea, outdent = false) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const value = textarea.value;
  if (!outdent && start === end) {
    replaceTextareaRange(textarea, start, end, "  ", start + 2, start + 2);
    return;
  }
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const block = value.slice(lineStart, end);
  const lines = block.split("\n");
  const next = lines.map((line) => outdent ? line.replace(/^(?: {1,2}|\t)/, "") : `  ${line}`).join("\n");
  replaceTextareaRange(textarea, lineStart, end, next, lineStart, lineStart + next.length);
}

function continueMarkdownLine(textarea) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  if (start !== end) return false;
  const value = textarea.value;
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const line = value.slice(lineStart, start);
  const match = line.match(/^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/);
  if (!match) return false;
  if (!match[3].trim()) {
    replaceTextareaRange(textarea, lineStart, start, "", lineStart, lineStart);
    return true;
  }
  let marker = match[2];
  const ordered = marker.match(/^(\d+)\.\s+$/);
  if (ordered) marker = `${Number(ordered[1]) + 1}. `;
  const insert = `\n${match[1]}${marker}`;
  replaceTextareaRange(textarea, start, end, insert, start + insert.length, start + insert.length);
  return true;
}

function pairTypedSelection(textarea, opener, closer) {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const value = textarea.value;
  const selected = value.slice(start, end);
  const replacement = `${opener}${selected}${closer}`;
  const caret = selected ? start + replacement.length : start + opener.length;
  replaceTextareaRange(textarea, start, end, replacement, caret, selected ? caret : caret);
}

function buildMarkdownEditorControl(nodeId, propDef, currentValue, opts) {
  const wrap = document.createElement("div");
  wrap.className = "ne-string-editor";
  wrap.dataset.propNode = nodeId;
  wrap.dataset.propId = propDef.id;
  wrap.dataset.mode = "preview";
  wrap.style.setProperty("--ne-text-zoom", String(clampTextZoom(graph.nodes[nodeId])));

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "ne-string-toolbar";

  const mkTool = (label, title, handler) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ne-string-tool";
    b.textContent = label;
    b.title = title;
    b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener("click", (e) => { e.stopPropagation(); handler(); });
    return b;
  };

  const editBtn = mkTool("edit", "Edit (click)", () => setMode("edit"));
  const previewBtn = mkTool("preview", "Preview (rendered markdown)", () => setMode("preview"));
  const copyBtn = makeTextCopyButton("Copy text", () => textarea.value || "");
  const sep1 = document.createElement("span");
  sep1.className = "ne-string-spacer";
  sep1.style.flex = "0 0 8px";

  const boldBtn = mkTool("B", "Bold (Ctrl+B)", () => wrapSelection(textarea, "**"));
  boldBtn.style.fontWeight = "700";
  const italBtn = mkTool("I", "Italic (Ctrl+I)", () => wrapSelection(textarea, "_"));
  italBtn.style.fontStyle = "italic";
  const codeBtn = mkTool("`", "Inline code", () => wrapSelection(textarea, "`"));
  const h2Btn   = mkTool("H", "Heading", () => prefixLines(textarea, "## "));
  const liBtn   = mkTool("•", "Bullet list", () => prefixLines(textarea, "- "));
  const quoteBtn = mkTool("❝", "Quote", () => prefixLines(textarea, "> "));
  const refBtn  = mkTool("@", "Insert reference", () => {
    const start = textarea.selectionStart ?? textarea.value.length;
    const v = textarea.value;
    textarea.value = `${v.slice(0, start)}@${v.slice(start)}`;
    textarea.setSelectionRange(start + 1, start + 1);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  });

  const spacer = document.createElement("span");
  spacer.className = "ne-string-spacer";
  const searchControl = makeTextSearchControl();
  const search = searchControl.input;
  const meta = document.createElement("span");
  meta.className = "ne-string-meta";

  toolbar.append(editBtn, previewBtn, sep1, boldBtn, italBtn, codeBtn, h2Btn, liBtn, quoteBtn, refBtn, spacer, searchControl.wrap, meta, copyBtn);

  // Textarea (editor)
  const textarea = document.createElement("textarea");
  textarea.className = "ne-string-textarea";
  textarea.value = currentValue ?? propDef.default ?? "";
  textarea.placeholder = propDef.placeholder || "";
  textarea.spellcheck = true;
  if (opts.disabled) {
    textarea.disabled = true;
    textarea.title = "value is coming from a connected socket - disconnect to edit";
  }

  // Preview
  const preview = document.createElement("div");
  preview.className = "ne-string-preview";
  preview.tabIndex = 0;
  preview.title = "click to edit";

  const surface = document.createElement("div");
  surface.className = "ne-string-surface";
  const lineNumbers = document.createElement("div");
  lineNumbers.className = "ne-string-lines";
  lineNumbers.setAttribute("aria-hidden", "true");
  const stage = document.createElement("div");
  stage.className = "ne-string-stage";
  stage.append(textarea, preview);
  surface.append(lineNumbers, stage);

  let mode = "preview";

  const updateLineNumbers = () => {
    const lineCount = Math.max(1, String(textarea.value || "").replace(/\r\n?/g, "\n").split("\n").length);
    wrap.style.setProperty("--line-number-digits", String(Math.max(2, String(lineCount).length)));
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= lineCount; i++) {
      const line = document.createElement("span");
      line.textContent = String(i);
      frag.appendChild(line);
    }
    lineNumbers.replaceChildren(frag);
  };
  const syncLineScroll = (source) => {
    lineNumbers.scrollTop = source?.scrollTop || 0;
  };

  const updateMeta = () => {
    const v = textarea.value || "";
    const w = (v.match(/\S+/g) || []).length;
    const q = search.value || "";
    if (q.trim()) {
      const hits = countTextSearchMatches(v, q);
      meta.textContent = `${hits} hit${hits === 1 ? "" : "s"}`;
    } else {
      meta.textContent = `${v.length}c · ${w}w`;
    }
  };
  const renderPreview = () => {
    const v = textarea.value || "";
    if (!v.trim()) {
      preview.classList.add("is-empty");
      preview.textContent = propDef.placeholder || "(empty)";
    } else {
      preview.classList.remove("is-empty");
      preview.innerHTML = renderInlineMarkdown(v, nodeId, { search: search.value || "" });
      if ((search.value || "").trim()) requestAnimationFrame(() => scrollFirstSearchHit(preview));
    }
  };
  const setMode = (m) => {
    mode = m;
    wrap.dataset.mode = m;
    if (m === "edit") {
      textarea.style.display = "";
      preview.style.display = "none";
      editBtn.classList.add("is-on");
      previewBtn.classList.remove("is-on");
      syncLineScroll(textarea);
      requestAnimationFrame(() => textarea.focus());
    } else {
      renderPreview();
      textarea.style.display = "none";
      preview.style.display = "";
      editBtn.classList.remove("is-on");
      previewBtn.classList.add("is-on");
      syncLineScroll(preview);
    }
  };

  // Click preview → edit mode
  preview.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    if (!ix.selection.has(nodeId)) selectOnly(nodeId);
  });
  preview.addEventListener("click", (e) => {
    if (textarea.disabled) return;
    e.stopPropagation();
    setMode("edit");
  });

  // Editing → re-render preview on blur (deferred so mention popup clicks land first)
  textarea.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === textarea) return;
      // If the mention popup is open and has focus, stay in edit mode.
      if (_mentionState && _mentionState.control === textarea) return;
      if (mode === "edit") setMode("preview");
    }, 200);
  });

  textarea.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    if (!ix.selection.has(nodeId)) selectOnly(nodeId);
  });
  textarea.addEventListener("click", (e) => e.stopPropagation());
  bindTextWheelZoom(textarea, nodeId);
  textarea.addEventListener("scroll", () => syncLineScroll(textarea));
  preview.addEventListener("scroll", () => syncLineScroll(preview));
  bindTextWheelZoom(preview, nodeId);

  search.addEventListener("mousedown", (e) => e.stopPropagation());
  search.addEventListener("click", (e) => e.stopPropagation());
  search.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  search.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      search.value = "";
      updateMeta();
      renderPreview();
      preview.focus();
    }
  });
  search.addEventListener("input", () => {
    updateMeta();
    renderPreview();
  });

  // Keyboard shortcuts
  textarea.addEventListener("keydown", (e) => {
    const mentionActive = _mentionState && _mentionState.control === textarea;
    if (mentionActive && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); wrapSelection(textarea, "**"); }
      else if (k === "i") { e.preventDefault(); wrapSelection(textarea, "_"); }
      else if (k === "e") { e.preventDefault(); wrapSelection(textarea, "`"); }
      else if (k === "enter") { e.preventDefault(); setMode(mode === "edit" ? "preview" : "edit"); }
      else if (k === "k") {
        e.preventDefault();
        const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) || "label";
        wrapSelection(textarea, `[${sel}](`, ")");
      }
    }
    if (e.defaultPrevented) return;
    if (e.key === "Tab") {
      e.preventDefault();
      indentTextareaSelection(textarea, e.shiftKey);
      return;
    }
    if (e.key === "Enter" && continueMarkdownLine(textarea)) {
      e.preventDefault();
      return;
    }
    const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "`": "`" };
    if (!e.ctrlKey && !e.metaKey && !e.altKey && pairs[e.key]) {
      e.preventDefault();
      pairTypedSelection(textarea, e.key, pairs[e.key]);
      return;
    }
    if (e.key === "Escape" && !_mentionState) {
      e.preventDefault();
      setMode("preview");
    }
  });

  // Commit input → graph state
  const commit = () => {
    updateLineNumbers();
    updateMeta();
    setNodePropValue(nodeId, propDef, textarea.value, wrap);
  };
  textarea.addEventListener("input", commit);

  // Mention support runs on the inner textarea (real selection/value).
  enableMentions(textarea, nodeId);

  // Proxy `.value` / `.disabled` so syncPropControls + outer code keep working.
  Object.defineProperty(wrap, "value", {
    get() { return textarea.value; },
    set(v) {
      textarea.value = v ?? "";
      updateLineNumbers();
      updateMeta();
      if (mode === "preview") renderPreview();
    },
    configurable: true,
  });
  Object.defineProperty(wrap, "disabled", {
    get() { return textarea.disabled; },
    set(v) { textarea.disabled = !!v; },
    configurable: true,
  });
  Object.defineProperty(wrap, "type", {
    get() { return "textarea"; },
    configurable: true,
  });
  wrap._renderPreview = renderPreview;
  wrap._updateEditorChrome = () => {
    updateLineNumbers();
    updateMeta();
    if (mode === "preview") renderPreview();
  };

  wrap.append(toolbar, surface);

  updateLineNumbers();
  updateMeta();
  setMode("preview");

  return { control: wrap, valueDisplay: null };
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

// Build the play action shown inside a `run-trigger` node body.
function buildRunTriggerButton(nodeId) {
  const wrap = document.createElement("div");
  wrap.className = "ne-run-trigger-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ne-run-play";
  const graphBusy = Boolean(_graphRunState);
  btn.title = graphBusy ? "A graph is already running" : (isNodeMuted(nodeId) ? "Unmute this node before running" : "Run connected command(s)");
  btn.disabled = graphBusy || isNodeMuted(nodeId);
  btn.setAttribute("aria-label", "Run connected command nodes");
  btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.74-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"/></svg><span>Run</span>`;
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    runFromTrigger(nodeId);
  });
  wrap.appendChild(btn);
  return wrap;
}

function isPauseNodeResumeReady(nodeId) {
  return Boolean(_graphRunState && _graphRunState.paused && _graphRunState.pausedNodeId === nodeId && !_graphRunState.cancelled);
}

function buildPauseNodeButton(nodeId) {
  const wrap = document.createElement("div");
  wrap.className = "ne-pause-node-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ne-pause-resume";
  btn.dataset.pauseResumeNode = nodeId;
  const active = isPauseNodeResumeReady(nodeId);
  btn.classList.toggle("is-active", active);
  btn.disabled = !active;
  btn.title = active ? "Resume graph flow" : "Available when graph execution is paused here";
  btn.setAttribute("aria-label", active ? "Resume graph flow" : "Resume graph flow when paused here");
  btn.innerHTML = `<span aria-hidden="true">▶</span><span>Resume</span>`;
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isPauseNodeResumeReady(nodeId)) resumeGraphRun("node");
  });
  wrap.appendChild(btn);
  return wrap;
}

async function pauseGraphAtNode(nodeId, outputs, opts = {}) {
  const run = graphRunFromOpts(opts);
  if (!run || opts.lite || opts.liteCommands || opts.dryRun) return;
  const node = graph.nodes[nodeId];
  if (node) {
    stashNodeResult(nodeId, outputs);
    const el = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (el) el.dataset.signature = "stale-pause";
    renderNodes();
  }
  appendRunLog(`Ⅱ Paused at ${nodeId}\n`);
  pauseGraphRun("node", nodeId);
  await refreshAllPreviews().catch(() => {});
  scheduleAutosave();
  await waitForGraphRunReady(opts);
}

// Compute the set of node ids that should be run when a trigger fires:
// for each command node fed by the trigger's run-output, include the
// command itself plus every node reachable via data edges in either
// direction (upstream ancestors and downstream descendants).
function nodesInTriggerSubgraph(triggerId) {
  if (isNodeMuted(triggerId)) return new Set();
  const targets = activeOutgoingEdges(triggerId, "run")
    .map((e) => e.toNode)
    .filter((id) => graph.nodes[id] && !isNodeMuted(id));
  const include = new Set();
  for (const seed of targets) {
    if (include.has(seed)) continue;
    // BFS upstream + downstream from the seed, ignoring `run`-typed edges
    // so trigger wires don't pull in unrelated triggers.
    const stack = [seed];
    while (stack.length) {
      const cur = stack.pop();
      if (include.has(cur)) continue;
      if (isNodeMuted(cur)) continue;
      include.add(cur);
      for (const e of graph.edges) {
        if (isEdgeMuted(e)) continue;
        const sock = NODE_BY_TYPE[graph.nodes[e.fromNode]?.type]?.outputs?.find((s) => s.id === e.fromSocket);
        if (sock?.type === "run") continue;
        if (e.toNode === cur && !include.has(e.fromNode)) stack.push(e.fromNode);
        if (e.fromNode === cur && !include.has(e.toNode)) stack.push(e.toNode);
      }
    }
  }
  return include;
}

async function runFromTrigger(triggerId, opts = {}) {
  if (_graphRunState) {
    setHint(_graphRunState.paused ? "graph is paused" : "graph is already running");
    setTimeout(clearHint, 1600);
    return;
  }
  if (isNodeMuted(triggerId)) {
    setHint("unmute this Run node first");
    setTimeout(clearHint, 1800);
    return;
  }
  const subset = nodesInTriggerSubgraph(triggerId);
  if (subset.size === 0) {
    setHint("connect this Run node to an active command first");
    setTimeout(clearHint, 1800);
    return;
  }
  await runGraph({ ...opts, subset });
}

// Returns the set of node ids that live inside *any* loop body, i.e. those
// that sit on a path from a `loop-decompose` to its matching `loop-output`
// via the loop-output's `item` input. These nodes must be driven by their
// owning loop-output (which iterates them) instead of being treated as
// independent top-level terminals — otherwise a cmd-* inside the body would
// resolve once with i=0 and the loop would never iterate.
function computeLoopBodyMembers() {
  const inBody = new Set();
  for (const node of Object.values(graph.nodes)) {
    if (isNodeMuted(node)) continue;
    if (node.type !== "loop-output") continue;
    const loopId = String(node.props.loop_id || "loop1");
    const stack = [];
    for (const e of activeIncomingEdges(node.id, "item")) stack.push(e.fromNode);
    const visited = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = graph.nodes[id];
      if (!n) continue;
      if (isNodeMuted(n)) continue;
      inBody.add(id);
      // Stop walking past the matching decompose — its bundle input lives
      // OUTSIDE the loop body and must remain reachable as a normal
      // upstream dependency.
      if (n.type === "loop-decompose" && String(n.props.loop_id || "loop1") === loopId) continue;
      for (const e of activeIncomingEdges(id)) stack.push(e.fromNode);
    }
  }
  return inBody;
}

async function runGraph(opts = {}) {
  if (_graphRunState) {
    setHint(_graphRunState.paused ? "graph is paused" : "graph is already running");
    setTimeout(clearHint, 1600);
    return;
  }
  const subset = opts.subset instanceof Set ? opts.subset : null;
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
    if (subset && !subset.has(id)) return false;
    if (inLoop.has(id)) return false;
    const n = graph.nodes[id];
    if (isNodeMuted(n)) return false;
    if (COMMAND_TYPES.has(n.type)) return true;
    if (PREVIEW_TYPES.has(n.type)) {
      // Coordinate is a self-contained source (no inputs); it should run
      // eagerly so its inline UV preview appears.
      if (n.type === "coordinate") return true;
      return activeIncomingEdges(id).length > 0;
    }
    return false;
  });

  if (terminals.length === 0) {
    setGraphStatus("no active command or preview nodes to run", "is-failed");
    return;
  }

  const dryRun = Boolean(opts.dryRun);
  const runTab = getActiveTab();
  setGraphStatus(dryRun ? "planning…" : "running…", "is-running");
  setRunningGraphState(true, runTab);
  startRunLog(`graph ${dryRun ? "dry-run" : "run"} · ${terminals.length} node${terminals.length > 1 ? "s" : ""}`);
  appendRunLog(`▶ ${dryRun ? "Planning" : "Running"} graph (${terminals.length} terminal node${terminals.length > 1 ? "s" : ""})\n\n`);

  const cache = {};
  let anyFailed = false;
  let wasCancelled = false;

  const runState = beginGraphRunState();
  try {
    for (const nodeId of terminals) {
      try {
        await waitForGraphRunReady({ run: runState });
        appendRunLog(`▶ Resolving ${nodeId} (${graph.nodes[nodeId].type})…\n`);
        const res = await resolveNode(nodeId, cache, {}, { dryRun, run: runState });
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
        if (node._uvImage) {
          node.lastResult.image = node._uvImage;
          delete node._uvImage;
        }
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
        setNodeRunStatus(nodeId, "done");
      } catch (err) {
        if (err instanceof GraphRunCancelled) {
          wasCancelled = true;
          appendRunLog("■ Graph stopped\n\n");
          break;
        }
        const el = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (el) el.dataset.signature = "stale";
        renderNodes();
        setNodeRunStatus(nodeId, "failed");
        appendRunLog(`✕ Error in ${nodeId}: ${err.message}\n\n`, true);
        anyFailed = true;
      }
    }
  } finally {
    finishGraphRunState();
    setRunningGraphState(false);
  }

  setGraphStatus(wasCancelled ? "stopped" : (anyFailed ? "some nodes failed" : "done"), wasCancelled ? "is-cancelled" : (anyFailed ? "is-failed" : "is-done"));
  await persistRunLogNow().catch(() => {});
  if (window.refreshRunsList) window.refreshRunsList();
  scheduleAutosave();
  schedulePreviewRefresh();
}

async function resolveNode(nodeId, cache, loopCtx, opts) {
  loopCtx = loopCtx || {};
  opts = opts || {};
  await waitForGraphRunReady(opts);
  // Cache key includes the loop context so the same node can yield different
  // values when re-resolved inside a loop body.
  const ctxKey = Object.keys(loopCtx).sort().map((k) => `${k}=${loopCtx[k].i}`).join("|");
  const cacheKey = `${nodeId}@${ctxKey}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const node = graph.nodes[nodeId];
  if (!node) throw new Error(`Node ${nodeId} not found`);
  const def = NODE_BY_TYPE[node.type];
  if (isNodeMuted(node)) {
    const outputs = mutedNodeOutputs(def);
    cache[cacheKey] = outputs;
    return outputs;
  }
  const traceNode = shouldTraceNodeResolution(opts);

  // Loop-decompose inside its own loop iteration: serve directly from the
  // precomputed item list carried by loopCtx. This is critical — walking
  // back through the `bundle` input on every iteration would re-execute
  // every upstream command (n2 cmd-image, etc.) once per loop step.
  if (node.type === "loop-decompose") {
    const loopId = String(node.props.loop_id || "loop1");
    const ctx = loopCtx[loopId];
    if (ctx && Array.isArray(ctx.items)) {
      const work = traceNode ? beginNodeWork(nodeId) : null;
      try {
        const i = ctx.i | 0;
        const out = {
          item: ctx.items[i] !== undefined ? ctx.items[i] : "",
          index: i,
          count: ctx.items.length,
        };
        cache[cacheKey] = out;
        finishNodeWork(work, "done");
        return out;
      } catch (err) {
        finishNodeWork(work, "failed");
        throw err;
      }
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
      || node.type === "prompt"
      || node.type === "prompt-filter"
      || node.type === "loop-output";
    if (heavy) {
      const out = (def.outputs || [])[0];
      if (!node.lastResult) throw new Error("no cached result");
      const v = node.lastResult ? node.lastResult.value : "";
      const result = {};
      if (out) result[out.id] = v;
      cache[cacheKey] = result;
      return result;
    }
  }

  const inputs = {};
  const skipInputResolution = node.type === "loop-output" ? new Set(["item"]) : new Set();
  // When an image-typed socket pulls from a vector-map producer, swap the
  // raw .npy for its .png sidecar alias so commands / previews see a real
  // image. Vector consumers (vector-op) keep the .npy via their `any` type.
  const adaptForDest = (rawValue, edge, destType) => {
    if (rawValue == null || rawValue === "") return rawValue;
    if (Array.isArray(rawValue)) return rawValue;
    const dt = String(destType || "");
    if (dt !== "image" && dt !== "image-bundle") return rawValue;
    if (typeof rawValue !== "string" || !/\.npy$/i.test(rawValue)) return rawValue;
    const src = graph.nodes[edge.fromNode];
    const alias = src?._uvImage || src?.lastResult?.image || "";
    return alias || rawValue;
  };
  // Build a lookup: any input socket id whose name matches a prop becomes
  // overridden by an edge if one exists. This is what makes "props as
  // sockets" work — the synthetic input socket overrides the static prop.
  for (const sock of (def.inputs || [])) {
    if (skipInputResolution.has(sock.id)) {
      inputs[sock.id] = node.props[sock.id] ?? "";
      continue;
    }
    const matchingEdges = activeIncomingEdges(nodeId, sock.id);
    if (sock.multi) {
      const values = [];
      for (const edge of matchingEdges) {
        const sourceOutputs = await resolveNode(edge.fromNode, cache, loopCtx, opts);
        let v = sourceOutputs[edge.fromSocket];
        v = adaptForDest(v, edge, sock.type);
        if (v != null && v !== "") {
          if (Array.isArray(v) && sock.type !== "vector") values.push(...v); else values.push(v);
        }
      }
      inputs[sock.id] = values;
    } else if (matchingEdges.length > 0) {
      const edge = matchingEdges[0];
      const sourceOutputs = await resolveNode(edge.fromNode, cache, loopCtx, opts);
      inputs[sock.id] = adaptForDest(sourceOutputs[edge.fromSocket], edge, sock.type);
    } else {
      inputs[sock.id] = node.props[sock.id] ?? "";
    }
  }
  // Synthetic prop-sockets: any prop with an incoming edge replaces the
  // static prop value for this resolution.
  for (const propDef of def.props || []) {
    if ((def.inputs || []).some((s) => s.id === propDef.id)) continue;
    const matching = activeIncomingEdges(nodeId, propDef.id);
    if (matching.length > 0) {
      const edge = matching[0];
      const sourceOutputs = await resolveNode(edge.fromNode, cache, loopCtx, opts);
      inputs[propDef.id] = coerceWiredPropValue(propDef, sourceOutputs[edge.fromSocket]);
    }
  }

  // Effective props view: each prop is a first-class socket — when wired,
  // the upstream value overrides the static `node.props` entry; otherwise
  // the static value is used. Cases below must read from `props` (never
  // `node.props`) so prop sockets are honoured uniformly. This is what
  // makes every prop on every node actually "evaluate".
  const props = { ...node.props };
  for (const propDef of def.props || []) {
    if ((def.inputs || []).some((s) => s.id === propDef.id)) continue;
    const wired = inputs[propDef.id];
    if (wired !== undefined && wired !== "" && wired !== null) {
      props[propDef.id] = wired;
    }
  }

  let outputs = {};
  const work = traceNode ? beginNodeWork(nodeId) : null;

  try {
  switch (node.type) {
    case "text-input":     outputs.out = String(props.value || ""); break;
    case "tool-flag": {
      outputs.out = {
        tool_name: String(props.tool_name || ""),
        enabled: props.enabled !== false,
        description: String(props.description || ""),
        category: String(props.category || ""),
        destructive: props.destructive ?? "",
      };
      break;
    }
    case "brain": {
      const sections = Array.isArray(inputs.sections)
        ? inputs.sections
        : (inputs.sections != null && inputs.sections !== "" ? [inputs.sections] : []);
      outputs.out = sections
        .map((value) => String(value == null ? "" : value).trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
      break;
    }
    case "number-input":   outputs.out = Number(props.value ?? 1); break;
    case "boolean-input":  outputs.out = Boolean(props.value); break;
    case "vector-input": {
      outputs.out = [Number(props.x ?? 0), Number(props.y ?? 0), Number(props.z ?? 0)];
      break;
    }
    case "image-input":
    case "video-input":
    case "filepath-input":
    case "file": {
      outputs.out = String(props.path ?? "");
      break;
    }
    case "folder-bundle": {
      // `props` already merges wired prop sockets over the static values,
      // so each field below is automatically socket-aware.
      const folderPath = String(props.path || "").trim();
      if (!folderPath) { outputs.out = []; break; }
      const kind = String(props.kind || "all");
      const recursive = props.recursive ? "1" : "0";
      const params = { path: folderPath, kind, recursive };
      const fps = Number(props.fps);
      if (Number.isFinite(fps) && fps > 0) params.fps = String(fps);
      const modulo = Number(props.modulo);
      if (Number.isFinite(modulo) && modulo > 1) params.modulo = String(Math.round(modulo));
      const start = Number(props.start);
      if (Number.isFinite(start) && start > 0) params.start = String(Math.round(start));
      const end = Number(props.end);
      if (Number.isFinite(end) && end > 0) params.end = String(Math.round(end));
      const fmt = String(props.format || "").trim();
      if (fmt) params.format = fmt;
      const qs = new URLSearchParams(params).toString();
      appendRunLog(`  ↳ Bundle ${folderPath}…\n`);
      const result = await graphFetchJSON(`/api/folder-list?${qs}`, {}, opts);
      if (result.error) throw new Error(`bundle: ${result.error}`);
      const paths = Array.isArray(result.paths) ? result.paths : [];
      const tag = result.source === "frames" ? `frames${result.cached ? ", cached" : ""}` : "files";
      appendRunLog(`  ↳ → ${paths.length} ${tag}\n`);
      outputs.out = paths;
      break;
    }
    case "create-bundle": {
      // `items` is a multi socket — the standard resolver above already
      // collected every wired source into a flat array. Pass it straight
      // through as a bundle. Same-type validation happens at addEdge time,
      // so anything that lands here is already coherent.
      const collected = Array.isArray(inputs.items) ? inputs.items.slice() : [];
      outputs.out = collected;
      break;
    }
    case "sample-bundle": {
      const v = inputs.bundle;
      const items = Array.isArray(v) ? v : (v !== undefined && v !== null && v !== "" ? [v] : []);
      const expr = String(props.expression ?? "").trim();
      const picked = parseSampleBundleExpression(expr, items.length);
      let chosen;
      if (picked === null) {
        // wildcard / empty → whole bundle
        chosen = items.slice();
      } else {
        chosen = picked.map((i) => items[i]);
      }
      // Single-index expressions collapse to a scalar so downstream nodes
      // receive a plain value instead of a 1-element array. Slices and
      // multi-index lists always stay as a bundle, even when they happen
      // to yield a single element.
      const exprIsSingle = !!expr && expr !== "*" && !expr.includes(",") && !expr.includes(":");
      if (exprIsSingle && chosen.length === 1) {
        outputs.out = chosen[0];
      } else {
        outputs.out = chosen;
      }
      outputs.count = chosen.length;
      break;
    }
    case "text-join": {
      const sep = props.sep ?? " ";
      outputs.out = [inputs.a, inputs.b].filter((v) => v != null && v !== "").join(sep);
      break;
    }
    case "compress-image": {
      const v = inputs.in;
      // Bundle (array) → zip via backend.
      if (Array.isArray(v)) {
        const items = v.filter((x) => x != null && x !== "").map((x) => String(x));
        if (items.length === 0) { outputs.out = ""; break; }
        appendRunLog(`  ↳ Zipping bundle (${items.length} item${items.length === 1 ? "" : "s"})…\n`);
        const result = await graphFetchJSON("/api/compress", {
          method: "POST",
          body: JSON.stringify({ kind: "bundle", paths: items }),
        }, opts);
        if (result.error) throw new Error(`compress: ${result.error}`);
        appendRunLog(`  ↳ → ${result.path} (${formatBytes(result.bytes)})\n`);
        outputs.out = result.path;
        break;
      }
      const str = (v == null) ? "" : String(v);
      if (!str) { outputs.out = ""; break; }
      // Decide between path and raw text. Heuristic: looks-like-path when it
      // has a short extension, no newlines, and no spaces in a long string.
      const looksLikePath =
        /\.[A-Za-z0-9]{1,6}$/.test(str) &&
        !str.includes("\n") &&
        str.length < 512;
      const inEdge = activeIncomingEdges(nodeId, "in")[0];
      const inSockType = inEdge ? baseType(outputSocketDef(inEdge.fromNode, inEdge.fromSocket)?.type || "any") : "any";
      const isText = inSockType === "text" || (!looksLikePath && inSockType === "any");
      if (isText) {
        const instructions = inputs.instructions || COMPRESS_HELPER_PROMPT;
        appendRunLog(`  ↳ Compressing text via LLM…\n`);
        const result = await graphFetchJSON("/api/filter-prompt", {
          method: "POST",
          body: JSON.stringify({
            prompt: str,
            instructions,
            images: [],
          }),
        }, opts);
        if (result.error) throw new Error(`compress(text): ${result.error}`);
        outputs.out = result.filtered_prompt || str;
        appendRunLog(`  ↳ → ${(outputs.out || "").length} chars (was ${str.length})\n`);
        break;
      }
      // File path → dispatch by extension server-side.
      appendRunLog(`  ↳ Compressing ${str} (q=${props.quality})…\n`);
      const result = await graphFetchJSON("/api/compress", {
        method: "POST",
        body: JSON.stringify({
          kind: "auto",
          path: str,
          quality: Number(props.quality ?? 75),
          max_dimension: Number(props.max_dimension ?? 0),
        }),
      }, opts);
      if (result.error) throw new Error(`compress: ${result.error}`);
      const ratio = result.originalBytes ? Math.round((result.bytes / result.originalBytes) * 100) : 0;
      appendRunLog(`  ↳ → ${result.path} (${formatBytes(result.bytes)}, ${ratio}% of original)\n`);
      outputs.out = result.path;
      break;
    }
    case "blur-image": {
      // Gaussian blur via PIL on the server. Accepts a single image path or
      // a bundle (array of paths). Empty input → empty output (no-op).
      const radius = Math.max(0, Number(props.radius ?? 4));
      const blurOne = async (path) => {
        const p = String(path || "").trim();
        if (!p) return "";
        appendRunLog(`  ↳ Blurring ${p} (r=${radius})…\n`);
        const result = await graphFetchJSON("/api/blur-image", {
          method: "POST",
          body: JSON.stringify({ path: p, radius }),
        }, opts);
        if (result.error) throw new Error(`blur: ${result.error}`);
        appendRunLog(`  ↳ → ${result.path}\n`);
        return result.path;
      };
      const v = inputs.in;
      if (Array.isArray(v)) {
        const out = [];
        for (const item of v) {
          const blurred = await blurOne(item);
          if (blurred) out.push(blurred);
        }
        outputs.out = out;
        break;
      }
      outputs.out = await blurOne(v);
      break;
    }
    case "crop-media": {
      // Both size and position are prop sockets with `passthroughWired:
      // true`, so `props.X` already reflects whatever was wired in (or
      // falls back to the static text default). Warn loudly when the
      // wired value looks like a file path — that's almost always a UV
      // .npy from a vector-op with spatial inputs, which can't be parsed
      // as a 2-vector and would silently use the default.
      const sizeWired = inputs.size;
      const positionWired = inputs.position;
      const sizeBad = _vectorSocketUnparseableSource(sizeWired);
      const positionBad = _vectorSocketUnparseableSource(positionWired);
      if (sizeBad) appendRunLog(`  ↳ ⚠ Crop size socket received "${sizeBad}" (not a vector) — using default\n`);
      if (positionBad) appendRunLog(`  ↳ ⚠ Crop position socket received "${positionBad}" (not a vector) — using default\n`);
      const size = _coerceVector2Value(sizeBad ? "" : props.size, [512, 512]);
      const position = _coerceVector2Value(positionBad ? "" : props.position, [0, 0]);
      const sizeTag = (sizeWired !== undefined && sizeWired !== "" && sizeWired !== null && !sizeBad) ? " [wired]" : "";
      const posTag = (positionWired !== undefined && positionWired !== "" && positionWired !== null && !positionBad) ? " [wired]" : "";
      const cropOne = async (path) => {
        const p = String(path || "").trim();
        if (!p) return "";
        appendRunLog(`  ↳ Cropping ${p} ${Math.round(size[0])}×${Math.round(size[1])}${sizeTag} @ ${Math.round(position[0])},${Math.round(position[1])}${posTag}\n`);
        const result = await graphFetchJSON("/api/media/crop", {
          method: "POST",
          body: JSON.stringify({ path: p, size, position }),
        }, opts);
        if (result.error) throw new Error(`crop: ${result.error}`);
        appendRunLog(`  ↳ → ${result.path}\n`);
        return result.path;
      };
      // Preserve bundle semantics: array in → array out (even for a single
      // item). Matches blur-image and keeps downstream bundle-aware nodes
      // honest.
      const v = inputs.in;
      if (Array.isArray(v)) {
        const out = [];
        for (const item of v) {
          const cropped = await cropOne(item);
          if (cropped) out.push(cropped);
        }
        outputs.out = out;
        break;
      }
      outputs.out = await cropOne(v);
      break;
    }
    case "resize-media": {
      const sizeWired = inputs.size;
      const modeWired = inputs.mode;
      const sizeBad = _vectorSocketUnparseableSource(sizeWired);
      if (sizeBad) appendRunLog(`  ↳ ⚠ Resize size socket received "${sizeBad}" (not a vector) — using default\n`);
      const size = _coerceVector2Value(sizeBad ? "" : props.size, [1024, 1024]);
      const mode = String(props.mode || "contain").trim().toLowerCase();
      const sizeTag = (sizeWired !== undefined && sizeWired !== "" && sizeWired !== null && !sizeBad) ? " [wired]" : "";
      const modeTag = (modeWired !== undefined && modeWired !== "" && modeWired !== null) ? " [wired]" : "";
      const resizeOne = async (path) => {
        const p = String(path || "").trim();
        if (!p) return "";
        appendRunLog(`  ↳ Resizing ${p} ${Math.round(size[0])}×${Math.round(size[1])}${sizeTag} (${mode}${modeTag})\n`);
        const result = await graphFetchJSON("/api/media/resize", {
          method: "POST",
          body: JSON.stringify({ path: p, size, mode }),
        }, opts);
        if (result.error) throw new Error(`resize: ${result.error}`);
        appendRunLog(`  ↳ → ${result.path}\n`);
        return result.path;
      };
      const v = inputs.in;
      if (Array.isArray(v)) {
        const out = [];
        for (const item of v) {
          const resized = await resizeOne(item);
          if (resized) out.push(resized);
        }
        outputs.out = out;
        break;
      }
      outputs.out = await resizeOne(v);
      break;
    }
    case "prompt":
    case "prompt-filter": {
      const imageInputs = Array.isArray(inputs.input)
        ? inputs.input.filter((v) => v).map((v) => String(v))
        : (inputs.input ? [String(inputs.input)] : []);
      const imageNote = imageInputs.length
        ? ` + ${imageInputs.length} image${imageInputs.length === 1 ? "" : "s"}`
        : "";
      // Edges into prop-sockets override the static prop value.
      const pf_pick = (key) => (inputs[key] !== undefined && inputs[key] !== "" && inputs[key] !== null) ? inputs[key] : props[key];
      const pf_str = (key) => {
        const v = pf_pick(key);
        return (v == null) ? "" : String(v).trim();
      };
      const pf_num = (key) => {
        const v = pf_pick(key);
        if (v === "" || v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const modelOverride = pf_str("model");
      const reasoningEffort = pf_str("reasoning_effort");
      const payload = {
        prompt: inputs.prompt || "",
        instructions: node.type === "prompt"
          ? "Answer the user's prompt directly. Return only the response text."
          : (inputs.instructions || ""),
        images: imageInputs,
        model: modelOverride,
        reasoning_effort: (reasoningEffort && reasoningEffort !== "default") ? reasoningEffort : "",
        temperature: pf_num("temperature"),
        top_p: pf_num("top_p"),
        max_tokens: pf_num("max_tokens"),
        seed: pf_num("seed"),
        frequency_penalty: pf_num("frequency_penalty"),
        presence_penalty: pf_num("presence_penalty"),
        stop: pf_str("stop"),
      };
      const modelLabel = modelOverride || "MODEL_NAME";
      const effortNote = payload.reasoning_effort ? ` (reasoning=${payload.reasoning_effort})` : "";
      appendRunLog(`  ↳ ${node.type === "prompt" ? "Prompting" : "Filtering prompt"} via ${modelLabel}${effortNote}${imageNote}…\n`);
      const result = await graphFetchJSON("/api/filter-prompt", {
        method: "POST",
        body: JSON.stringify(payload),
      }, opts);
      if (result.error) throw new Error(`${node.type === "prompt" ? "prompt" : "filter-prompt"}: ${result.error}`);
      outputs.out = result.filtered_prompt || inputs.prompt || "";
      appendRunLog(`  ↳ "${(outputs.out || "").slice(0, 80).replace(/\n/g, " ")}${outputs.out.length > 80 ? "…" : ""}"\n`);
      break;
    }
    case "definition": {
      const name = String(props.name || "").trim().replace(/^@+/, "");
      if (!name) throw new Error("Definition node has no name");
      const args = String(inputs.args || "").trim();
      let token = `@${name}`;
      if (args) token += `:${args}`;
      outputs.out = token;
      break;
    }
    case "reroute":
      outputs.out = inputs.in;
      // Carry the .png alias forward so downstream previews can render
      // UV / vector-map sources without staring at a .npy.
      {
        const inc = activeIncomingEdges(nodeId, "in")[0];
        const src = inc ? graph.nodes[inc.fromNode] : null;
        const alias = src?._uvImage || src?.lastResult?.image || "";
        if (alias) node._uvImage = alias;
      }
      break;
    case "preview":
      outputs.out = inputs.in;
      outputs.in = inputs.in;
      {
        const inc = activeIncomingEdges(nodeId, "in")[0];
        const src = inc ? graph.nodes[inc.fromNode] : null;
        const alias = src?._uvImage || src?.lastResult?.image || "";
        if (alias) node._uvImage = alias;
      }
      break;
    case "canvas": {
      const images = _mediaPathList(inputs.images);
      if (images.length === 0) { outputs.out = ""; break; }
      const rawPositions = Array.isArray(inputs.positions) ? inputs.positions : (inputs.positions ? [inputs.positions] : []);
      // Per-image position evaluation. Each multi-edge feeding `positions`
      // contributes one entry; images with no matching position get [0,0].
      // Path-like strings (e.g. a UV .npy wired from a spatial vector-op)
      // are flagged loudly instead of silently defaulting.
      const positions = images.map((_, i) => {
        const raw = rawPositions[i];
        const bad = _vectorSocketUnparseableSource(raw);
        if (bad) appendRunLog(`  ↳ ⚠ Canvas position[${i}] received "${bad}" (not a vector) — using [0,0]\n`);
        return _coerceVector2Value(bad ? "" : raw, [0, 0]);
      });
      const sizeWired = inputs.size;
      const sizeBad = _vectorSocketUnparseableSource(sizeWired);
      if (sizeBad) appendRunLog(`  ↳ ⚠ Canvas size socket received "${sizeBad}" (not a vector) — using default\n`);
      const size = _coerceVector2Value(sizeBad ? "" : props.size, [1024, 1024]);
      const sizeTag = (sizeWired !== undefined && sizeWired !== "" && sizeWired !== null && !sizeBad) ? " [wired]" : "";
      const wiredPosCount = rawPositions.filter((p) => p !== undefined && p !== "" && p !== null).length;
      const posSummary = wiredPosCount > 0 ? ` (${wiredPosCount}/${images.length} positions wired)` : "";
      appendRunLog(`  ↳ Canvas ${images.length} image${images.length === 1 ? "" : "s"} ${Math.round(size[0])}×${Math.round(size[1])}${sizeTag}${posSummary}\n`);
      const result = await graphFetchJSON("/api/media/canvas", {
        method: "POST",
        body: JSON.stringify({ images, positions, size }),
      }, opts);
      if (result.error) throw new Error(`canvas: ${result.error}`);
      outputs.out = result.path;
      break;
    }
    case "pause": {
      outputs.out = inputs.in;
      outputs.in = inputs.in;
      await pauseGraphAtNode(nodeId, outputs, opts);
      break;
    }
    case "coordinate": {
      const w = Math.max(1, Math.round(Number(props.width ?? 1024)));
      const h = Math.max(1, Math.round(Number(props.height ?? 1024)));
      const dpi = Math.max(1, Math.round(Number(props.dpi ?? 72)));
      const space = String(props.space || "uv");
      appendRunLog(`  ↳ Coord ${w}×${h}${space === "screen" ? " (screen)" : ""}\n`);
      const result = await graphFetchJSON("/api/uv/coordinate", {
        method: "POST",
        body: JSON.stringify({ width: w, height: h, dpi, space }),
      }, opts);
      if (result.error) throw new Error(`coordinate: ${result.error}`);
      outputs.uv = result.path;
      // Stash the .png alias so inline image previews (and any downstream
      // consumer that prefers an image) can render without loading a .npy.
      node._uvImage = result.image || result.preview || "";
      break;
    }
    case "vector-op": {
      const op = String(props.op || "add");
      const payload = {
        op,
        a: _coerceVectorInput(inputs.a),
        b: _coerceVectorInput(inputs.b),
      };
      appendRunLog(`  ↳ Vector ${op}\n`);
      const result = await graphFetchJSON("/api/uv/vector", {
        method: "POST",
        body: JSON.stringify(payload),
      }, opts);
      if (result.error) throw new Error(`vector: ${result.error}`);
      // When both inputs are scalar/vector primitives the result is a 1×1
      // map. Return the raw value array so size/position sockets downstream
      // can parse it directly instead of receiving an unreadable .npy path.
      outputs.out = (result.value != null) ? result.value : result.path;
      node._uvImage = result.image || result.preview || "";
      break;
    }
    case "mapping": {
      const uv = inputs.uv;
      if (!uv) throw new Error("mapping: UV input required");
      const payload = {
        uv: { path: String(uv) },
        location_x: Number(props.location_x ?? 0),
        location_y: Number(props.location_y ?? 0),
        rotation: Number(props.rotation ?? 0),
        scale_x: Number(props.scale_x ?? 1),
        scale_y: Number(props.scale_y ?? 1),
        pivot_x: Number(props.pivot_x ?? 0.5),
        pivot_y: Number(props.pivot_y ?? 0.5),
      };
      appendRunLog(`  ↳ Mapping rot=${payload.rotation}° scale=(${payload.scale_x},${payload.scale_y})\n`);
      const result = await graphFetchJSON("/api/uv/mapping", {
        method: "POST",
        body: JSON.stringify(payload),
      }, opts);
      if (result.error) throw new Error(`mapping: ${result.error}`);
      outputs.out = result.path;
      node._uvImage = result.image || result.preview || "";
      break;
    }
    case "mix": {
      const mode = String(props.mode || "mix");
      const clamp = props.clamp !== false;
      const factorRaw = inputs.factor !== undefined && inputs.factor !== "" && inputs.factor !== null
        ? inputs.factor
        : Number(props.factor ?? 0.5);
      const aRaw = inputs.a !== undefined && inputs.a !== "" && inputs.a !== null
        ? inputs.a
        : (props.a ?? props.color_a ?? "#000000");
      const bRaw = inputs.b !== undefined && inputs.b !== "" && inputs.b !== null
        ? inputs.b
        : (props.b ?? props.color_b ?? "#ffffff");

      const factor = _coerceMixInput(factorRaw, { isFactor: true });
      const a = _coerceMixInput(aRaw, {});
      const b = _coerceMixInput(bRaw, {});

      // Fast path: pure scalar/color → blend in JS, no server hit.
      if (!factor.isPath && !a.isPath && !b.isPath) {
        const f = clamp ? Math.max(0, Math.min(1, Number(factor.scalar ?? factor.color?.[0] ?? 0))) : Number(factor.scalar ?? factor.color?.[0] ?? 0);
        const colA = a.color || [Number(a.scalar) || 0, Number(a.scalar) || 0, Number(a.scalar) || 0, 1];
        const colB = b.color || [Number(b.scalar) || 0, Number(b.scalar) || 0, Number(b.scalar) || 0, 1];
        const blended = _jsBlend(colA, colB, mode);
        const out = colA.map((v, i) => (1 - f) * v + f * (blended[i] ?? v));
        outputs.out = _rgbaToHex(out);
        appendRunLog(`  ↳ Mix(${mode}) → ${outputs.out} (scalar)\n`);
        break;
      }

      const payload = {
        mode,
        clamp,
        factor: factor.payload,
        a: a.payload,
        b: b.payload,
      };
      appendRunLog(`  ↳ Mix ${mode}\n`);
      const result = await graphFetchJSON("/api/uv/mix", {
        method: "POST",
        body: JSON.stringify(payload),
      }, opts);
      if (result.error) throw new Error(`mix: ${result.error}`);
      if (result.path) outputs.out = result.path;
      else if (result.color) outputs.out = _rgbaToHex(result.color);
      else outputs.out = "";
      break;
    }
    case "uv-render": {
      const pixel = inputs.pixel;
      const uv = inputs.uv;
      if (!pixel) throw new Error("render: pixel input required");
      if (!uv) throw new Error("render: UV input required");
      const payload = {
        pixel: String(pixel),
        uv: { path: String(uv) },
        interp: String(props.interp || "bilinear"),
        extension: String(props.extension || "clamp"),
      };
      appendRunLog(`  ↳ Render (${payload.interp}, ${payload.extension})\n`);
      const result = await graphFetchJSON("/api/uv/render", {
        method: "POST",
        body: JSON.stringify(payload),
      }, opts);
      if (result.error) throw new Error(`render: ${result.error}`);
      outputs.out = result.path;
      break;
    }
    case "math-op": {
      const a = Number(inputs.a ?? 0);
      const b = Number(inputs.b ?? 0);
      const op = props.op || "add";
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
    case "random": {
      const pick = (key) => (inputs[key] !== undefined && inputs[key] !== "" && inputs[key] !== null) ? inputs[key] : props[key];
      const modeRaw = String(pick("mode") || "integer").trim().toLowerCase();
      const mode = ({ int: "integer", integer: "integer", float: "float", number: "float", str: "string", string: "string", text: "string" })[modeRaw] || "integer";
      let min = Number(pick("min") ?? 0);
      let max = Number(pick("max") ?? 100);
      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max)) max = mode === "string" ? 32 : 100;
      if (max < min) [min, max] = [max, min];
      if (mode === "float") {
        outputs.out = min + Math.random() * (max - min);
        break;
      }
      if (mode === "string") {
        const charsets = {
          alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
          alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
          lower_alpha: "abcdefghijklmnopqrstuvwxyz",
          upper_alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
          numeric: "0123456789",
          hex: "0123456789abcdef",
          special: "!@#$%^&*()-_=+[]{};:,.<>/?",
          ascii: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.<>/?",
        };
        const charsetKey = String(pick("charset") || "alphanumeric").trim().toLowerCase().replace(/[\s-]+/g, "_");
        const alphabet = charsets[charsetKey] || charsets.alphanumeric;
        const minLen = Math.max(0, Math.floor(min));
        const maxLen = Math.max(minLen, Math.floor(max));
        const length = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
        let value = "";
        for (let i = 0; i < length; i += 1) {
          value += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        outputs.out = value;
        break;
      }
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      outputs.out = hi < lo ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));
      break;
    }
    case "text-op": {
      const a = String(inputs.a ?? "");
      const b = String(inputs.b ?? "");
      const op = props.op || "to_string";
      const extra = String(props.extra ?? "");
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
      const decomposeBundleEdges = activeIncomingEdges(decomposeNodeId, "bundle");
      let bundleValue = [];
      if (decomposeBundleEdges.length > 0) {
        const edge = decomposeBundleEdges[0];
        const src = await resolveNodeWithPausedWork(work, edge.fromNode, cache, loopCtx, opts);
        const v = src[edge.fromSocket];
        bundleValue = Array.isArray(v) ? v : (v ? [v] : []);
      }
      // Resolve the item input N times with a fresh sub-cache per iteration.
      // The item list is carried in loopCtx so the decompose node can serve
      // it without re-walking its bundle input.
      const itemEdges = activeIncomingEdges(nodeId, "item");
      const collected = [];
      for (let i = 0; i < bundleValue.length; i++) {
        await waitForGraphRunReady(opts);
        const subCtx = { ...loopCtx, [loopId]: { i, total: bundleValue.length, items: bundleValue } };
        const subCache = {};
        if (itemEdges.length > 0) {
          const edge = itemEdges[0];
          const r = await resolveNodeWithPausedWork(work, edge.fromNode, subCache, subCtx, opts);
          // Flatten-on-output: if an iteration produced a bundle (e.g. an
          // inner command with iterations > 1, or a nested Loop · Output),
          // spread its items into the outer bundle so the result is always
          // a flat array. One level only — loops compose by re-flattening
          // at each enclosing Loop · Output.
          const v = r[edge.fromSocket];
          if (Array.isArray(v)) collected.push(...v);
          else collected.push(v);
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
        const result = await executeCommandNode(node, inputs, opts);
        // Iterations > 1 produces a bundle; otherwise a single artifact.
        if (Array.isArray(result.artifacts) && result.artifacts.length > 1) {
          outputs.out = result.artifacts;
        } else {
          // When no artifact is found we leave the output empty rather than
          // falling back to the run ID — the latter looks like a path to
          // downstream nodes and surfaces as "artifact not found <code>" in
          // the preview.
          outputs.out = result.firstArtifact || "";
        }
      }
    }
  }
  } catch (err) {
    finishNodeWork(work, err instanceof GraphRunCancelled ? "cancelled" : "failed");
    throw err;
  }

  cache[cacheKey] = outputs;
  if ((!opts.lite && !opts.liteCommands) || LIVE_UPDATE_TYPES.has(node.type)) {
    stashNodeResult(nodeId, outputs);
  }
  finishNodeWork(work, "done");
  return outputs;
}

function collectDefinitionMapForCommand(nodeId) {
  const definitions = {};
  const stack = [nodeId];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const edge of activeIncomingEdges(current)) {
      const source = graph.nodes[edge.fromNode];
      if (!source || isNodeMuted(source)) continue;
      if (source.type === "definition") {
        const name = String(source.props?.name || "").trim().replace(/^@+/, "");
        const file = String(source.props?.file || "").trim();
        if (name && file) definitions[name] = file;
      }
      if (!visited.has(edge.fromNode)) stack.push(edge.fromNode);
    }
  }
  return definitions;
}

async function executeCommandNode(node, inputs, opts = {}) {
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
  const optionalNum = (key) => {
    const v = pick(key);
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (key, fallback) => {
    const v = pick(key);
    return (v === "" || v == null) ? (fallback ?? "") : String(v);
  };
  const bool = (key, fallback = false) => {
    const v = pick(key);
    if (v === "" || v == null) return fallback;
    if (typeof v === "string") return !["false", "0", "no", "off"].includes(v.trim().toLowerCase());
    return Boolean(v);
  };
  // Multi-image inputs arrive as arrays from resolveNode; the CLI accepts
  // comma-separated paths via --input.
  const inputList = Array.isArray(inputs.input)
    ? inputs.input.filter((v) => v).map((v) => String(v)).join(",")
    : (inputs.input || "");
  const outputDir = str("output_dir", ".rundeer/outputs");
  const outputName = str("output_name", "output");
  const model = str("model", "");
  const aspectRatio = str("aspect_ratio", "");
  const resolution = str("resolution", "");
  const usesImageModel = command === "image" || command === "merge" || command === "edit";
  const usesVideoModel = command === "video" || command === "extend" || command === "edit";
  const payload = {
    command,
    dryRun: Boolean(opts.dryRun),
    subject: inputs.subject || "",
    motion: inputs.motion || "",
    style: str("style", ""),
    batch: {
      iterations: num("iterations", 1),
      concurrency: optionalNum("concurrency"),
      grid: false,
      grid_only: false,
      grid_options: {
        rows: "auto",
        columns: "auto",
        padding: 0,
        bg_color: "#000000",
      },
      chain: bool("chain", false),
      chain_compose: bool("chain_compose", false),
      chain_threshold: num("chain_threshold", 12),
      chain_override: num("chain_override", 50),
      chain_dilate: num("chain_dilate", 6),
      chain_feather: num("chain_feather", 8),
      chain_min_region: num("chain_min_region", 64),
    },
    image: {
      model: usesImageModel ? model : "",
      aspect_ratio: command === "image" || command === "merge" || (command === "edit" && str("edit_type", "image") === "image") ? aspectRatio : "",
      resolution: command === "image" || command === "merge" || (command === "edit" && str("edit_type", "image") === "image") ? resolution : "",
    },
    video: {
      model: usesVideoModel ? model : "",
      aspect_ratio: command === "video" || (command === "edit" && str("edit_type", "image") === "video") ? aspectRatio : "",
      duration: num("duration", 6),
      resolution: command === "video" || (command === "edit" && str("edit_type", "image") === "video") ? (resolution || "720p") : "",
    },
    inputs: {
      input: inputList,
      startFrame: inputs.start_frame || "",
      source: inputs.source || "",
      editType: str("edit_type", "image"),
    },
    output: { dir: outputDir, name: outputName },
    references: {
      ids: str("reference_ids", ""),
      pad: bool("pad_reference", true),
      quality: num("ref_quality", 85),
    },
    definitions: collectDefinitionMapForCommand(node.id),
    extra: {},
  };

  appendRunLog(`  ↳ ${command} · "${(payload.subject || "").slice(0, 50)}"\n`);

  const endpoint = payload.dryRun ? "/api/plan" : "/api/run";
  const result = await graphFetchJSON(endpoint, { method: "POST", body: JSON.stringify(payload) }, opts);

  if (payload.dryRun) {
    appendRunLog(result.output || "(no output)\n");
    bindRunLogToRun(result.id);
    await persistRunLogNow(result.id);
    return { id: result.id };
  }

  appendRunLog(`  ↳ run ${result.id}\n`);
  const runState = graphRunFromOpts(opts);
  if (runState && result.id) runState.activeRunIds.add(result.id);
  bindRunLogToRun(result.id);
  await persistRunLogNow(result.id);
  let final;
  try {
    final = await pollUntilDone(result.id, opts);
  } finally {
    if (runState && result.id) runState.activeRunIds.delete(result.id);
    await persistRunLogNow(result.id).catch(() => {});
  }
  // Resolve the produced artifact(s). When iterations > 1 we collect ALL
  // matching artifacts so the output socket carries a bundle.
  const artifacts = await findArtifactsForRun(final, { output_dir: outputDir, output_name: outputName }, opts);
  return {
    id: result.id,
    firstArtifact: artifacts[0] || "",
    artifacts,
  };
}

async function findArtifactsForRun(runRecord, props, opts = {}) {
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
    // Pass output_dir so the server scans it too — runs writing outside
    // .rundeer/outputs (e.g. a user-specified `hurl_test/`) would otherwise
    // be invisible to /api/artifacts and we'd fall back to the run ID.
    const qs = outputDir ? `?dir=${encodeURIComponent(outputDir)}` : "";
    const data = await graphFetchJSON(`/api/artifacts${qs}`, {}, opts);
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

async function pollUntilDone(runId, opts = {}) {
  bindRunLogToRun(runId);
  let lastLen = 0;
  while (true) {
    await graphDelay(1100, opts);
    const rec = await graphFetchJSON(`/api/runs/${encodeURIComponent(runId)}`, {}, opts);
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
      || status === "cancelled"
      || status.startsWith("failed")
      || status.startsWith("error");
    updateRunLogStatus(status, runId);
    if (!finished) continue;
    await persistRunLogNow(runId).catch(() => {});
    if (status === "done" && (rec.returncode === 0 || rec.returncode == null)) return rec;
    if (status === "cancelled") throw new GraphRunCancelled();
    throw new Error(`Run ${runId} ${status} (rc=${rec.returncode})`);
  }
}

function markNodeState(nodeId, cls) {
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (!el) return;
  el.classList.remove("is-executing", "is-done", "is-failed", "is-cancelled");
  if (cls) el.classList.add(cls);
}

// ─── Run log (draggable run dock) ────────────────────────────────────────────
//
// The run dock is a single persistent element (#runLog). It retains its log
// content across show/hide cycles so re-opening from the runs panel doesn't
// lose info. Use startRunLog() to begin a new run (clears + shows); use
// showRunLog() to merely unhide the existing content.

let _runLogState = {
  currentRunId: null,    // active run we're streaming into
  lastShownRunId: null,  // most recently displayed run (for dedup)
  linkedRunIds: new Set(),
  persistTimer: null,
  persistInFlight: false,
  persistAgain: false,
  persistPromise: null,
};

const RUN_DOCK_PAD = 12;
function clampRunDockValue(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeRunDockEdge(edge) {
  if (["top", "right", "bottom", "left"].includes(edge)) return edge;
  if (typeof edge === "string") {
    if (edge.startsWith("top")) return "top";
    if (edge.startsWith("bottom")) return "bottom";
    if (edge.endsWith("left") || edge === "left") return "left";
    if (edge.endsWith("right") || edge === "right") return "right";
  }
  return "bottom";
}

function defaultRunDockAlong(edge) {
  return edge === "bottom" ? 0.72 : 0.5;
}

function legacyRunDockState(value) {
  const edge = normalizeRunDockEdge(value);
  if (value === "top-left" || value === "bottom-left") return { edge, along: 0.2 };
  if (value === "top-right" || value === "bottom-right") return { edge, along: 0.8 };
  return { edge, along: defaultRunDockAlong(edge) };
}

function readRunDockState() {
  const saved = webStore.state.runDock;
  if (saved && typeof saved === "object") {
    const edge = normalizeRunDockEdge(saved.edge);
    const along = Number.isFinite(saved.along) ? saved.along : defaultRunDockAlong(edge);
    return { edge, along };
  }
  return { edge: "bottom", along: defaultRunDockAlong("bottom") };
}

function saveRunDockState(state) {
  webStore.state.runDock = {
    edge: normalizeRunDockEdge(state.edge),
    along: clampRunDockValue(state.along, 0, 1),
  };
  scheduleWebStoreSave();
}

function closestRunDockEdge(localX, localY, viewportRect) {
  const candidates = [
    { edge: "top", distance: localY },
    { edge: "right", distance: viewportRect.width - localX },
    { edge: "bottom", distance: viewportRect.height - localY },
    { edge: "left", distance: localX },
  ];
  candidates.sort((first, second) => first.distance - second.distance);
  return candidates[0].edge;
}

function runDockSizeForEdge(dock, edge, viewportRect) {
  dock.dataset.edge = edge;
  const fallbackWidth = edge === "left" || edge === "right" ? 360 : 420;
  const fallbackHeight = edge === "left" || edge === "right" ? 420 : 280;
  return {
    width: dock.offsetWidth || Math.min(fallbackWidth, Math.max(0, viewportRect.width - RUN_DOCK_PAD * 2)),
    height: dock.offsetHeight || Math.min(fallbackHeight, Math.max(0, viewportRect.height - RUN_DOCK_PAD * 2)),
  };
}

function placeRunDockAtPoint(dock, edge, localX, localY, viewportRect) {
  const normalizedEdge = normalizeRunDockEdge(edge);
  const size = runDockSizeForEdge(dock, normalizedEdge, viewportRect);
  const maxLeft = Math.max(RUN_DOCK_PAD, viewportRect.width - size.width - RUN_DOCK_PAD);
  const maxTop = Math.max(RUN_DOCK_PAD, viewportRect.height - size.height - RUN_DOCK_PAD);

  dock.style.left = "";
  dock.style.right = "";
  dock.style.top = "";
  dock.style.bottom = "";

  if (normalizedEdge === "top" || normalizedEdge === "bottom") {
    const left = clampRunDockValue(localX - size.width / 2, RUN_DOCK_PAD, maxLeft);
    dock.style.left = `${left}px`;
    if (normalizedEdge === "top") dock.style.top = `${RUN_DOCK_PAD}px`;
    else dock.style.bottom = `${RUN_DOCK_PAD}px`;
    return {
      edge: normalizedEdge,
      along: clampRunDockValue((left + size.width / 2) / Math.max(viewportRect.width, 1), 0, 1),
    };
  }

  const top = clampRunDockValue(localY - size.height / 2, RUN_DOCK_PAD, maxTop);
  dock.style.top = `${top}px`;
  if (normalizedEdge === "left") dock.style.left = `${RUN_DOCK_PAD}px`;
  else dock.style.right = `${RUN_DOCK_PAD}px`;
  return {
    edge: normalizedEdge,
    along: clampRunDockValue((top + size.height / 2) / Math.max(viewportRect.height, 1), 0, 1),
  };
}

function applyRunDockState(state) {
  const dock = document.getElementById("runLog");
  if (!dock) return state;
  const viewportRect = { width: window.innerWidth, height: window.innerHeight };
  if (viewportRect.width <= 0 || viewportRect.height <= 0) return state;
  const edge = normalizeRunDockEdge(state.edge);
  const along = clampRunDockValue(Number.isFinite(state.along) ? state.along : defaultRunDockAlong(edge), 0, 1);
  const localX = edge === "top" || edge === "bottom" ? viewportRect.width * along : RUN_DOCK_PAD;
  const localY = edge === "left" || edge === "right" ? viewportRect.height * along : RUN_DOCK_PAD;
  return placeRunDockAtPoint(dock, edge, localX, localY, viewportRect);
}

function currentRunDockState(dock) {
  if (!dock) return readRunDockState();
  const viewportRect = { width: window.innerWidth, height: window.innerHeight };
  const edge = normalizeRunDockEdge(dock.dataset.edge);
  if (viewportRect.width <= 0 || viewportRect.height <= 0) return { edge, along: defaultRunDockAlong(edge) };
  const rect = dock.getBoundingClientRect();
  if (edge === "top" || edge === "bottom") {
    return {
      edge,
      along: clampRunDockValue((rect.left + rect.width / 2) / Math.max(viewportRect.width, 1), 0, 1),
    };
  }
  return {
    edge,
    along: clampRunDockValue((rect.top + rect.height / 2) / Math.max(viewportRect.height, 1), 0, 1),
  };
}

function repositionRunDockFromCurrentState() {
  const dock = document.getElementById("runLog");
  if (!dock) return;
  applyRunDockState(currentRunDockState(dock));
}

function showRunLog() {
  const log = document.getElementById("runLog");
  if (log) log.classList.remove("is-empty");
}

function startRunLog(title) {
  if (_runLogState.persistTimer) {
    clearTimeout(_runLogState.persistTimer);
    _runLogState.persistTimer = null;
  }
  const log = document.getElementById("runLog");
  if (log) log.classList.remove("is-empty");
  const body = document.getElementById("runLogBody");
  if (body) body.textContent = "";
  const pill = document.getElementById("runLogStatus");
  if (pill) {
    pill.dataset.state = "running";
    pill.textContent = "Running";
  }
  const titleEl = document.getElementById("runLogTitle");
  if (titleEl) titleEl.textContent = title || "graph run";
  const meta = document.getElementById("runLogMeta");
  if (meta) meta.textContent = "live graph output";
  _runLogState.currentRunId = null;
  _runLogState.lastShownRunId = null;
  _runLogState.linkedRunIds = new Set();
}

function runLogDisplayPayload() {
  const body = document.getElementById("runLogBody");
  const title = document.getElementById("runLogTitle");
  const meta = document.getElementById("runLogMeta");
  const status = document.getElementById("runLogStatus");
  return {
    displayOutput: body ? body.textContent : "",
    displayTitle: title ? title.textContent : "",
    displayMeta: meta ? meta.textContent : "",
    displayStatus: status ? status.dataset.state || status.textContent || "" : "",
  };
}

function bindRunLogToRun(runId) {
  if (!runId) return;
  _runLogState.currentRunId = runId;
  _runLogState.lastShownRunId = runId;
  _runLogState.linkedRunIds.add(runId);
  const title = document.getElementById("runLogTitle");
  if (title) title.textContent = `id ${runId}`;
  scheduleRunLogPersist(0);
}

function scheduleRunLogPersist(delay = 250) {
  if (_runLogState.linkedRunIds.size === 0) return;
  if (_runLogState.persistTimer) clearTimeout(_runLogState.persistTimer);
  _runLogState.persistTimer = setTimeout(() => {
    _runLogState.persistTimer = null;
    persistRunLogNow().catch(() => {});
  }, delay);
}

async function persistRunLogNow(runId = null) {
  if (runId) _runLogState.linkedRunIds.add(runId);
  if (_runLogState.linkedRunIds.size === 0) return;
  if (_runLogState.persistInFlight) {
    _runLogState.persistAgain = true;
    return _runLogState.persistPromise || Promise.resolve();
  }
  _runLogState.persistInFlight = true;
  _runLogState.persistPromise = (async () => {
    try {
      let ids = runId ? new Set([runId]) : new Set(_runLogState.linkedRunIds);
      while (ids.size > 0) {
        _runLogState.persistAgain = false;
        const payload = runLogDisplayPayload();
        await Promise.allSettled(Array.from(ids).map((id) => fetchJSON(`/api/runs/${encodeURIComponent(id)}/display-log`, {
          method: "POST",
          body: JSON.stringify(payload),
        })));
        ids = _runLogState.persistAgain ? new Set(_runLogState.linkedRunIds) : new Set();
      }
    } finally {
      _runLogState.persistInFlight = false;
      _runLogState.persistPromise = null;
    }
  })();
  return _runLogState.persistPromise;
}

function appendRunLog(text) {
  const body = document.getElementById("runLogBody");
  const log = document.getElementById("runLog");
  if (log) log.classList.remove("is-empty");
  if (!body) return;
  body.textContent += text;
  body.scrollTop = body.scrollHeight;
  scheduleRunLogPersist();
}

function updateRunLogStatus(status, id) {
  const pill = document.getElementById("runLogStatus");
  const normalizedStatus = String(status || "idle");
  if (pill) {
    pill.dataset.state = normalizedStatus;
    pill.textContent = { done: "Done", failed: "Failed", running: "Running", queued: "Queued", cancelling: "Cancelling", cancelled: "Cancelled" }[normalizedStatus] || normalizedStatus;
  }
  if (id) {
    const title = document.getElementById("runLogTitle");
    if (title) title.textContent = `id ${id}`;
    if (_runLogState.linkedRunIds.has(id)) scheduleRunLogPersist();
    _runLogState.lastShownRunId = id;
  }
}

function toggleRunLogMinimized() {
  const log = document.getElementById("runLog");
  const state = currentRunDockState(log);
  const isMin = log.dataset.minimized === "true";
  log.dataset.minimized = isMin ? "false" : "true";
  const btn = document.getElementById("runLogMinimize");
  if (btn) btn.textContent = isMin ? "–" : "▢";
  requestAnimationFrame(() => applyRunDockState(state));
}

// --- Edge-locked drag inside the node viewport ------------------------------

function setupRunDockDrag() {
  const dock = document.getElementById("runLog");
  const head = document.getElementById("runLogHead");
  if (!dock || !head) return;

  dock.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });

  let savedState = readRunDockState();
  dock.dataset.edge = savedState.edge;
  requestAnimationFrame(() => {
    savedState = applyRunDockState(savedState);
  });

  let drag = null;

  head.addEventListener("mousedown", (e) => {
    if (e.target.closest(".run-dock-btn")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { startX: e.clientX, startY: e.clientY, moved: false, state: currentRunDockState(dock) };
    dock.classList.add("is-dragging");
  });

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const viewportRect = { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;
    const localX = clampRunDockValue(e.clientX, 0, viewportRect.width);
    const localY = clampRunDockValue(e.clientY, 0, viewportRect.height);
    const edge = closestRunDockEdge(localX, localY, viewportRect);
    drag.state = placeRunDockAtPoint(dock, edge, localX, localY, viewportRect);
  });

  window.addEventListener("mouseup", () => {
    if (!drag) return;
    if (drag.moved && drag.state) saveRunDockState(drag.state);
    dock.classList.remove("is-dragging");
    drag = null;
  });

  window.addEventListener("resize", repositionRunDockFromCurrentState);
}

// ─── Past runs page ──────────────────────────────────────────────────────────

function runStatusText(status) {
  const raw = String(status || "?");
  return { done: "Done", failed: "Failed", running: "Running", queued: "Queued", cancelling: "Cancelling", cancelled: "Cancelled" }[raw] || raw;
}

function runIsActive(run) {
  const status = String(run?.status || "");
  return status === "running" || status === "queued" || status === "cancelling";
}

function formatRunTime(ts) {
  if (!ts) return "time unknown";
  return new Date(ts * 1000).toLocaleString();
}

function displayRunCommand(command) {
  if (Array.isArray(command)) return command.join(" ");
  return String(command || "");
}

function renderRunDetail(rec) {
  showRunLog();
  _runLogState.currentRunId = null;
  if (_runLogState.persistTimer) {
    clearTimeout(_runLogState.persistTimer);
    _runLogState.persistTimer = null;
  }
  _runLogState.linkedRunIds = new Set();
  updateRunLogStatus(rec.status || "done", rec.id);
  _runLogState.currentRunId = null;
  const title = document.getElementById("runLogTitle");
  const meta = document.getElementById("runLogMeta");
  const body = document.getElementById("runLogBody");
  const command = displayRunCommand(rec.command);
  if (title) title.textContent = rec.displayTitle || (rec.id ? `id ${rec.id}` : "run log");
  if (meta) {
    if (rec.displayMeta) {
      meta.textContent = rec.displayMeta;
    } else {
      const bits = [formatRunTime(rec.startedAt)];
      if (rec.returncode != null) bits.push(`rc=${rec.returncode}`);
      if (command) bits.push(command);
      meta.textContent = bits.join(" · ");
    }
  }
  if (body) {
    body.textContent = rec.displayOutput || rec.output || "(no output)";
    body.scrollTop = body.scrollHeight;
  }
}

async function refreshRunsList() {
  try {
    const data = await fetchJSON("/api/runs");
    const runs = Array.isArray(data.runs) ? data.runs : [];
    const list = document.getElementById("runsList");
    const meta = document.getElementById("runsPageMeta");
    const listMeta = document.getElementById("runsListMeta");
    const activeCount = runs.filter(runIsActive).length;
    if (meta) meta.textContent = runs.length ? `${runs.length} recent · ${activeCount} active` : "no runs yet";
    if (listMeta) listMeta.textContent = activeCount ? `${activeCount} active` : `${runs.length} total`;
    if (!list) return;
    list.innerHTML = "";
    if (runs.length === 0) {
      list.innerHTML = `<li class="ne-runs-empty">no runs yet</li>`;
      return;
    }
    for (const run of runs) {
      const li = document.createElement("li");
      li.className = "ne-run-item" + (run.id === _runLogState.lastShownRunId ? " is-selected" : "");
      li.dataset.runId = run.id;
      const command = displayRunCommand(run.command);
      const tail = String(run.outputTail || "").trim();
      li.innerHTML = `
        <span class="ne-run-status" data-state="${escAttr(run.status || "")}">${escHtml(runStatusText(run.status))}</span>
        <span class="ne-run-id" title="${escAttr(run.id)}">${escHtml(run.id || "run")}</span>
        <span class="ne-run-time">${escHtml(formatRunTime(run.startedAt))}</span>
        <span class="ne-run-cmd" title="${escAttr(command || tail)}">${escHtml(command || tail || "no command")}</span>`;
      li.addEventListener("click", () => openRunInLog(run.id));
      list.appendChild(li);
    }
  } catch (e) { /* ignore */ }
}
window.refreshRunsList = refreshRunsList;

async function openRunInLog(runId) {
  try {
    const rec = await fetchJSON(`/api/runs/${encodeURIComponent(runId)}`);
    _runLogState.lastShownRunId = runId;
    renderRunDetail(rec);
    refreshRunsList().catch(() => {});
  } catch (e) {
    setHint(`could not load run: ${e.message}`);
    setTimeout(clearHint, 2500);
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

let autosaveTimer = null;

const webStore = {
  loaded: false,
  state: {},
  saveTimer: null,
};

const graphLibrary = {
  loaded: false,
  graphs: [],
};

const runningGraphState = {
  running: false,
  tabId: null,
  name: "",
};

function updateCurrentTabButton() {
  const tab = getActiveTab();
  const nameEl = document.getElementById("currentTabName");
  const stateEl = document.getElementById("currentTabState");
  const button = document.getElementById("currentTabButton");
  if (!nameEl || !stateEl || !button) return;
  nameEl.textContent = tab?.name || "Untitled";
  const parts = [];
  if (tab?.dirty) parts.push("*");
  if (runningGraphState.running && tab?.id === runningGraphState.tabId) parts.push("running");
  stateEl.textContent = parts.join(" ");
  button.title = tab?.name || "Untitled";
}

function updateRunningGraphTag() {
  const tag = document.getElementById("runningGraphTag");
  const label = document.getElementById("runningGraphLabel");
  if (!tag || !label) return;
  if (!runningGraphState.running) {
    tag.hidden = true;
    label.textContent = "graph running";
    return;
  }
  const name = runningGraphState.name || "Untitled";
  label.textContent = `${name} running`;
  tag.hidden = false;
}

function setRunningGraphState(running, tab = null) {
  runningGraphState.running = Boolean(running);
  runningGraphState.tabId = running ? (tab?.id || tabsState.activeId || null) : null;
  runningGraphState.name = running ? (tab?.name || "Untitled") : "";
  updateRunningGraphTag();
  renderGraphTabs();
}

async function loadWebStore() {
  if (webStore.loaded) return webStore.state;
  try {
    const payload = await fetchJSON("/api/web-state");
    webStore.state = (payload && payload.state && typeof payload.state === "object") ? payload.state : {};
  } catch (_) {
    webStore.state = {};
  }
  webStore.loaded = true;
  return webStore.state;
}

function webLayoutState() {
  if (!webStore.state.layout || typeof webStore.state.layout !== "object") webStore.state.layout = {};
  return webStore.state.layout;
}

function paletteLayoutState() {
  const layout = webLayoutState();
  if (!layout.agentPalette || typeof layout.agentPalette !== "object") layout.agentPalette = {};
  return layout.agentPalette;
}

function clampPaletteNumber(value, min, max, fallback) {
  const n = Number(value);
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  if (!Number.isFinite(n)) return Math.max(lower, Math.min(upper, fallback));
  return Math.max(lower, Math.min(upper, n));
}

function paletteNodeViewportRect() {
  const wrap = document.getElementById("canvasWrap");
  const shell = document.querySelector(".ne-shell");
  if (!wrap || !shell) {
    return { left: 0, top: 52, width: window.innerWidth, height: Math.max(240, window.innerHeight - 52) };
  }
  const wrapRect = wrap.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  return {
    left: wrapRect.left - shellRect.left,
    top: wrapRect.top - shellRect.top,
    width: Math.max(0, wrapRect.width),
    height: Math.max(0, wrapRect.height),
  };
}

function migratePaletteStateToNodeViewport(state, viewport) {
  if (state.coordinateSpace === "node-viewport") return;
  const storedLeft = Number(state.x);
  const storedTop = Number(state.y);
  if (Number.isFinite(storedLeft)) state.x = storedLeft - viewport.left;
  if (Number.isFinite(storedTop)) state.y = storedTop - viewport.top;
  state.coordinateSpace = "node-viewport";
}

function paletteViewportDefaults(viewport = paletteNodeViewportRect()) {
  const edgePadding = 8;
  const availableWidth = Math.max(180, viewport.width - edgePadding * 2);
  const availableHeight = Math.max(160, viewport.height - edgePadding * 2);
  const minWidth = Math.min(260, availableWidth);
  const minHeight = Math.min(220, availableHeight);
  const width = Math.min(350, Math.max(minWidth, availableWidth));
  const height = Math.min(350, Math.max(minHeight, Math.min(availableHeight, 350)));
  return {
    w: width,
    h: height,
    x: Math.max(edgePadding, Math.round((viewport.width - width) / 2)),
    y: Math.max(edgePadding, Math.round(viewport.height - height - edgePadding)),
  };
}

function normalizedPaletteState() {
  const state = paletteLayoutState();
  const viewport = paletteNodeViewportRect();
  migratePaletteStateToNodeViewport(state, viewport);
  const defaults = paletteViewportDefaults(viewport);
  const edgePadding = 8;
  const availableWidth = Math.max(180, viewport.width - edgePadding * 2);
  const availableHeight = Math.max(160, viewport.height - edgePadding * 2);
  const minWidth = Math.min(260, availableWidth);
  const minHeight = Math.min(220, availableHeight);
  const width = clampPaletteNumber(state.w, minWidth, availableWidth, defaults.w);
  const height = clampPaletteNumber(state.h, minHeight, availableHeight, defaults.h);
  const maxLeft = Math.max(edgePadding, viewport.width - width - edgePadding);
  const maxTop = Math.max(edgePadding, viewport.height - height - edgePadding);
  const left = clampPaletteNumber(state.x, edgePadding, maxLeft, defaults.x);
  const top = clampPaletteNumber(state.y, edgePadding, maxTop, defaults.y);
  state.w = Math.round(width);
  state.h = Math.round(height);
  state.x = Math.round(left);
  state.y = Math.round(top);
  state.conversationCollapsed = Boolean(state.conversationCollapsed);
  state.fullscreen = Boolean(state.fullscreen);
  return state;
}

function paletteHandleSide(state, viewport) {
  return state.x + state.w / 2 < viewport.width / 2 ? "right" : "left";
}

function applyPaletteLayout(options = {}) {
  const root = document.getElementById("agentPalette");
  if (!root) return;
  const viewport = paletteNodeViewportRect();
  const state = normalizedPaletteState();
  const absoluteLeft = viewport.left + state.x;
  const absoluteTop = viewport.top + state.y;
  const conversationGap = 8;
  const paletteCenterY = state.y + state.h / 2;
  const conversationBelow = paletteCenterY < viewport.height / 2;
  const conversationHeight = Math.max(0, Math.floor(conversationBelow
    ? viewport.height - (state.y + state.h) - conversationGap
    : state.y - conversationGap));
  const fullscreenInset = 12;
  const fullscreenLeft = viewport.left + fullscreenInset;
  const fullscreenTop = viewport.top + fullscreenInset;
  const fullscreenWidth = Math.max(220, viewport.width - fullscreenInset * 2);
  const fullscreenHeight = Math.max(260, viewport.height - fullscreenInset * 2);
  const desiredHandleSide = paletteHandleSide(state, viewport);
  if (options.commitHandleSide || !["left", "right"].includes(state.handleSide) || (!root.classList.contains("is-dragging") && !root.classList.contains("is-resizing"))) {
    state.handleSide = desiredHandleSide;
  }
  root.style.setProperty("--agent-palette-w", `${state.w}px`);
  root.style.setProperty("--agent-palette-h", `${state.h}px`);
  root.style.setProperty("--agent-palette-x", `${absoluteLeft}px`);
  root.style.setProperty("--agent-palette-y", `${absoluteTop}px`);
  root.style.setProperty("--agent-conversation-h", `${conversationHeight}px`);
  root.style.setProperty("--agent-conversation-gap", `${conversationGap}px`);
  root.style.setProperty("--agent-palette-full-x", `${fullscreenLeft}px`);
  root.style.setProperty("--agent-palette-full-y", `${fullscreenTop}px`);
  root.style.setProperty("--agent-palette-full-w", `${fullscreenWidth}px`);
  root.style.setProperty("--agent-palette-full-h", `${fullscreenHeight}px`);
  root.classList.toggle("is-conversation-collapsed", state.conversationCollapsed);
  root.classList.toggle("is-conversation-below", conversationBelow);
  root.classList.toggle("is-conversation-above", !conversationBelow);
  root.classList.toggle("is-conversation-cramped", conversationHeight < 44);
  root.classList.toggle("is-fullscreen", state.fullscreen);
  root.classList.toggle("is-handle-right", state.handleSide === "right");
  root.classList.toggle("is-handle-left", state.handleSide !== "right");
  const collapse = document.getElementById("agentConversationToggle");
  if (collapse) {
    collapse.setAttribute("aria-pressed", String(state.conversationCollapsed));
    collapse.title = state.conversationCollapsed ? "Show conversation" : "Collapse conversation";
    collapse.setAttribute("aria-label", collapse.title);
  }
  const fullscreen = document.getElementById("agentPaletteFullscreen");
  if (fullscreen) {
    fullscreen.setAttribute("aria-pressed", String(state.fullscreen));
    fullscreen.title = state.fullscreen ? "Exit fullscreen" : "Fullscreen palette";
    fullscreen.setAttribute("aria-label", fullscreen.title);
  }
}

function setPalettePane(name = "chat") {
  const wanted = ["chat", "history", "agents", "tabs"].includes(name) ? name : "chat";
  document.querySelectorAll(".ne-palette-pane[data-palette-pane]").forEach((pane) => {
    const active = pane.dataset.palettePane === wanted;
    pane.hidden = !active;
    pane.classList.toggle("is-active", active);
  });
  const historyOpen = wanted === "history";
  const agentsOpen = wanted === "agents";
  const tabsOpen = wanted === "tabs";
  document.getElementById("agentHistoryBtn")?.setAttribute("aria-expanded", String(historyOpen));
  document.getElementById("agentSelectorBtn")?.setAttribute("aria-expanded", String(agentsOpen));
  document.getElementById("currentTabButton")?.setAttribute("aria-expanded", String(tabsOpen));
}

function isPalettePaneOpen(name) {
  const pane = document.querySelector(`.ne-palette-pane[data-palette-pane="${name}"]`);
  return Boolean(pane && !pane.hidden);
}

function togglePalettePane(name) {
  if (isPalettePaneOpen(name)) setPalettePane("chat");
  else setPalettePane(name);
}

function updateAgentInputLines() {
  const input = document.getElementById("agentInput");
  const lines = document.getElementById("agentInputLines");
  const surface = lines?.closest?.(".ne-string-surface");
  if (!input || !lines) return;
  const count = Math.max(1, String(input.value || "").split(/\n/).length);
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= count; i += 1) {
    const span = document.createElement("span");
    span.textContent = String(i);
    frag.appendChild(span);
  }
  lines.replaceChildren(frag);
  if (surface) surface.style.setProperty("--line-number-digits", String(String(count).length));
  lines.scrollTop = input.scrollTop || 0;
}

function setupAgentPalette() {
  const root = document.getElementById("agentPalette");
  if (!root) return;
  applyPaletteLayout();
  setPalettePane("chat");

  const input = document.getElementById("agentInput");
  if (input) {
    input.addEventListener("input", updateAgentInputLines);
    input.addEventListener("scroll", updateAgentInputLines, { passive: true });
    updateAgentInputLines();
  }

  document.getElementById("currentTabButton")?.addEventListener("click", (e) => {
    e.preventDefault();
    togglePalettePane("tabs");
  });
  document.getElementById("agentSelectorBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    togglePalettePane("agents");
    if (window.AgentChat && typeof window.AgentChat.requestAgents === "function") window.AgentChat.requestAgents();
  });
  document.querySelectorAll("[data-palette-close]").forEach((btn) => {
    btn.addEventListener("click", () => setPalettePane("chat"));
  });
  document.getElementById("agentConversationToggle")?.addEventListener("click", () => {
    const state = paletteLayoutState();
    state.conversationCollapsed = !state.conversationCollapsed;
    applyPaletteLayout();
    scheduleWebStoreSave();
  });
  document.getElementById("agentPaletteFullscreen")?.addEventListener("click", () => {
    const state = paletteLayoutState();
    state.fullscreen = !state.fullscreen;
    applyPaletteLayout();
    scheduleWebStoreSave();
  });

  const drag = document.getElementById("agentPaletteDrag");
  if (drag) {
    let start = null;
    drag.addEventListener("mousedown", (e) => {
      if (paletteLayoutState().fullscreen) return;
      e.preventDefault();
      const state = normalizedPaletteState();
      start = { x: e.clientX, y: e.clientY, px: state.x, py: state.y };
      root.classList.add("is-dragging");
      document.body.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", (e) => {
      if (!start) return;
      const state = paletteLayoutState();
      state.x = start.px + (e.clientX - start.x);
      state.y = start.py + (e.clientY - start.y);
      applyPaletteLayout();
    });
    window.addEventListener("mouseup", () => {
      if (!start) return;
      start = null;
      root.classList.remove("is-dragging");
      document.body.style.cursor = "";
      applyPaletteLayout({ commitHandleSide: true });
      scheduleWebStoreSave();
    });
  }

  const resize = document.getElementById("agentPaletteResize");
  if (resize) {
    let start = null;
    resize.addEventListener("mousedown", (e) => {
      if (paletteLayoutState().fullscreen) return;
      e.preventDefault();
      const state = normalizedPaletteState();
      start = { x: e.clientX, y: e.clientY, w: state.w, h: state.h };
      root.classList.add("is-resizing");
      document.body.style.cursor = "nwse-resize";
    });
    window.addEventListener("mousemove", (e) => {
      if (!start) return;
      const state = paletteLayoutState();
      state.w = start.w + (e.clientX - start.x);
      state.h = start.h + (e.clientY - start.y);
      applyPaletteLayout();
      updateAgentInputLines();
    });
    window.addEventListener("mouseup", () => {
      if (!start) return;
      start = null;
      root.classList.remove("is-resizing");
      document.body.style.cursor = "";
      applyPaletteLayout({ commitHandleSide: true });
      scheduleWebStoreSave();
    });
  }

  window.addEventListener("resize", () => {
    applyPaletteLayout({ commitHandleSide: true });
    scheduleWebStoreSave();
  });
}

window.RundeerPalette = {
  showPane: setPalettePane,
  togglePane: togglePalettePane,
  isPaneOpen: isPalettePaneOpen,
  updateInputLines: updateAgentInputLines,
};

function scheduleWebStoreSave() {
  if (!webStore.loaded) return;
  if (webStore.saveTimer) clearTimeout(webStore.saveTimer);
  webStore.saveTimer = setTimeout(() => { saveWebStoreNow().catch(() => {}); }, 350);
}

async function saveWebStoreNow() {
  if (!webStore.loaded) return;
  if (webStore.saveTimer) {
    clearTimeout(webStore.saveTimer);
    webStore.saveTimer = null;
  }
  await fetchJSON("/api/web-state", {
    method: "POST",
    body: JSON.stringify({ state: webStore.state || {} }),
  });
}

function sendWebStoreKeepalive() {
  if (!webStore.loaded) return;
  try {
    fetch("/api/web-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: webStore.state || {} }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
}

function tabsPayload() {
  return {
    activeId: tabsState.activeId,
    tabs: tabsState.tabs.map((t) => ({
      id: t.id,
      name: t.name,
      savedGraphId: t.savedGraphId || null,
      dirty: !!t.dirty,
      snapshot: t.snapshot || null,
      kind: t.kind || "workflow",
      agentId: t.agentId || null,
    })),
  };
}

// ─── Graph tabs + saved graphs library ───────────────────────────────────────
//
// tabsState.tabs is an ordered list of open documents. Each tab is:
//   { id, name, savedGraphId|null, dirty, snapshot }
// The active tab's `snapshot` is what's currently materialised in `graph`.
// When switching/closing, we serialize the live graph into the active tab
// before swapping. Persisted to .rundeer so reloads restore the layout.

const tabsState = {
  tabs: [],
  activeId: null,
  _suspendDirty: false,
};

window.addEventListener("agent:selected", (e) => {
  const agent = e.detail && e.detail.agent;
  if (!agent || !agent.id) return;
  let changed = false;
  for (const tab of tabsState.tabs) {
    if (tab.kind === "brain" && (tab.agentId || "default") === agent.id) {
      const nextName = brainTabNameForAgent(agent.name || agent.id);
      if (tab.name !== nextName) {
        tab.name = nextName;
        changed = true;
      }
    }
  }
  if (changed) {
    renderGraphTabs();
    persistTabs();
  }
});

function genStorageId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function refreshSavedGraphs(opts = {}) {
  try {
    const payload = await fetchJSON("/api/graphs");
    graphLibrary.graphs = Array.isArray(payload.graphs) ? payload.graphs : [];
    graphLibrary.loaded = true;
    if (opts.render !== false) renderGraphsPage();
  } catch (err) {
    graphLibrary.graphs = [];
    graphLibrary.loaded = true;
    if (opts.render !== false) {
      setHint(`graphs unavailable: ${err.message}`);
      setTimeout(clearHint, 2500);
      renderGraphsPage();
    }
  }
  return graphLibrary.graphs;
}

function getSavedGraphs() {
  return graphLibrary.graphs || [];
}

function upsertSavedGraph(saved) {
  if (!saved || !saved.id) return;
  const idx = graphLibrary.graphs.findIndex((g) => g.id === saved.id);
  if (idx >= 0) graphLibrary.graphs[idx] = saved;
  else graphLibrary.graphs.push(saved);
}

function findSavedGraph(id) {
  return getSavedGraphs().find((g) => g.id === id) || null;
}

function summarizeGraphData(data) {
  const nodeCount = data && data.nodes ? Object.keys(data.nodes).length : 0;
  const edgeCount = data && Array.isArray(data.edges) ? data.edges.length : 0;
  return { nodeCount, edgeCount };
}

function persistTabs() {
  webStore.state.tabs = tabsPayload();
  scheduleWebStoreSave();
}

function captureActiveSnapshot() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.snapshot = serializeGraph();
}

function getActiveTab() {
  return tabsState.tabs.find((t) => t.id === tabsState.activeId) || null;
}

function markActiveDirty() {
  if (tabsState._suspendDirty) return;
  const tab = getActiveTab();
  if (!tab) return;
  if (!tab.dirty) {
    tab.dirty = true;
    renderGraphTabs();
  }
}

function applyTabToCanvas(tab) {
  tabsState._suspendDirty = true;
  try {
    if (tab.snapshot) {
      loadGraphData(tab.snapshot);
    } else {
      graph.nodes = {}; graph.edges = []; graph._nextId = 1;
      ix.selection.clear();
      renderGraph();
      renderProps(null);
    }
  } finally {
    tabsState._suspendDirty = false;
  }
  requestAnimationFrame(() => { frameAll(); });
}

function activateTab(id, opts = {}) {
  if (tabsState.activeId === id) return;
  if (!opts.skipCapture) captureActiveSnapshot();
  const tab = tabsState.tabs.find((t) => t.id === id);
  if (!tab) return;
  tabsState.activeId = id;
  applyTabToCanvas(tab);
  applyShellKind(tab);
  renderGraphTabs();
  renderPalette();
  persistTabs();
}

function applyShellKind(tab) {
  const shell = document.querySelector(".ne-shell") || document.body;
  const isBrain = !!(tab && tab.kind === "brain");
  shell.classList.toggle("is-brain-tab", isBrain);
}

function newTab(opts = {}) {
  captureActiveSnapshot();
  const tab = {
    id: genStorageId("tab"),
    name: opts.name || "Untitled",
    savedGraphId: opts.savedGraphId || null,
    dirty: !!opts.dirty,
    snapshot: opts.snapshot || null,
    kind: opts.kind || "workflow",
    agentId: opts.agentId || null,
  };
  tabsState.tabs.push(tab);
  tabsState.activeId = tab.id;
  applyTabToCanvas(tab);
  applyShellKind(tab);
  renderGraphTabs();
  renderPalette();
  persistTabs();
  return tab;
}

function openSavedGraphInTab(savedId) {
  const saved = findSavedGraph(savedId);
  if (!saved) return;
  // If a tab for this saved graph is already open, focus it.
  const existing = tabsState.tabs.find((t) => t.savedGraphId === savedId);
  if (existing) { activateTab(existing.id); return; }
  newTab({
    name: saved.name,
    savedGraphId: savedId,
    dirty: false,
    snapshot: saved.data,
  });
}

async function closeTab(id) {
  const tab = tabsState.tabs.find((t) => t.id === id);
  if (!tab) return;
  // If this tab is the active one, capture latest before deciding.
  const isActive = tabsState.activeId === id;
  if (isActive) captureActiveSnapshot();
  if (tab.dirty) {
    const decision = await openAppDialog({
      title: "Unsaved graph",
      message: `"${tab.name}" has unsaved changes.`,
      confirmText: "Save",
      secondaryText: "Discard",
      cancelText: "Cancel",
      showInput: false,
    });
    if (decision.action === "cancel") return;
    if (decision.action === "confirm") {
      // Temporarily activate so saveCurrentGraph operates on this tab's data.
      if (!isActive) {
        const prevActive = tabsState.activeId;
        tabsState.activeId = id;
        applyTabToCanvas(tab);
        const ok = await saveCurrentGraph({ silent: true });
        if (!ok) {
          // User cancelled the name prompt — abort close.
          tabsState.activeId = prevActive;
          const prev = tabsState.tabs.find((t) => t.id === prevActive);
          if (prev) applyTabToCanvas(prev);
          renderGraphTabs();
          return;
        }
      } else {
        const ok = await saveCurrentGraph({ silent: true });
        if (!ok) return;
      }
    }
  }
  const idx = tabsState.tabs.findIndex((t) => t.id === id);
  tabsState.tabs.splice(idx, 1);
  if (isActive) {
    if (tabsState.tabs.length === 0) {
      // Always keep at least one tab around so the user has a canvas.
      const fresh = {
        id: genStorageId("tab"),
        name: "Untitled",
        savedGraphId: null,
        dirty: false,
        snapshot: null,
      };
      tabsState.tabs.push(fresh);
      tabsState.activeId = fresh.id;
      applyTabToCanvas(fresh);
    } else {
      const next = tabsState.tabs[Math.max(0, idx - 1)] || tabsState.tabs[0];
      tabsState.activeId = next.id;
      applyTabToCanvas(next);
    }
  }
  renderGraphTabs();
  renderGraphsPage();
  persistTabs();
}

function renameTab(id, name) {
  const tab = tabsState.tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.name = name;
  renderGraphTabs();
  persistTabs();
}

function renderGraphTabs() {
  const root = document.getElementById("graphTabs");
  updateCurrentTabButton();
  if (!root) return;
  root.innerHTML = "";
  for (const tab of tabsState.tabs) {
    const el = document.createElement("div");
    const isRunning = runningGraphState.running && tab.id === runningGraphState.tabId;
    el.className = "ne-graph-tab"
      + (tab.id === tabsState.activeId ? " is-active" : "")
      + (isRunning ? " is-running" : "");
    el.dataset.tabId = tab.id;
    el.dataset.tabKind = tab.kind || "workflow";
    el.title = tab.name + (tab.dirty ? " (unsaved)" : "");
    if (isRunning) {
      const runDot = document.createElement("span");
      runDot.className = "ne-graph-tab-run-dot";
      runDot.title = "Running";
      el.appendChild(runDot);
    }
    const name = document.createElement("span");
    name.className = "ne-graph-tab-name";
    name.textContent = tab.name;
    el.appendChild(name);
    if (tab.dirty) {
      const dot = document.createElement("span");
      dot.className = "ne-graph-tab-dirty";
      dot.textContent = "*";
      el.appendChild(dot);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ne-graph-tab-close";
    close.textContent = "×";
    close.title = "Close tab";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id).catch((err) => {
        setHint(`close failed: ${err.message}`);
        setTimeout(clearHint, 2500);
      });
    });
    el.appendChild(close);
    el.addEventListener("click", () => {
      activateTab(tab.id);
      window.RundeerPalette?.showPane?.("chat");
    });
    root.appendChild(el);
  }
}

// Save current canvas into .rundeer/graphs.
// Returns true on success, false if cancelled.
async function saveCurrentGraph(opts = {}) {
  const tab = getActiveTab();
  // Brain tabs save to their own server-backed agent graph.
  if (tab && tab.kind === "brain") {
    return saveBrainGraphTab(tab, opts);
  }
  const data = serializeGraph();
  let saved = null;
  if (tab && tab.savedGraphId) {
    saved = findSavedGraph(tab.savedGraphId);
  }
  let name = saved?.name || tab?.name || "Untitled";
  if (!saved) {
    const defaultName = tab?.name && tab.name !== "Untitled" ? tab.name : `graph-${new Date().toISOString().slice(0, 10)}`;
    const result = await openAppDialog({
      title: "Save graph",
      message: "This writes the graph to .rundeer/graphs.",
      inputLabel: "Graph name",
      defaultValue: defaultName,
      confirmText: "Save",
      cancelText: "Cancel",
    });
    if (result.action !== "confirm") return false;
    name = String(result.value || defaultName).trim() || defaultName;
  } else if (tab && tab.name && tab.name !== saved.name) {
    name = tab.name;
  }
  const oldId = tab?.savedGraphId || saved?.id || null;
  const response = await fetchJSON("/api/graphs", {
    method: "POST",
    body: JSON.stringify({ id: oldId, name, data }),
  });
  saved = response.graph;
  if (!saved || !saved.id) throw new Error("save did not return a graph id");
  upsertSavedGraph(saved);
  if (oldId && oldId !== saved.id) {
    graphLibrary.graphs = graphLibrary.graphs.filter((g) => g.id !== oldId);
    for (const t of tabsState.tabs) {
      if (t.savedGraphId === oldId) t.savedGraphId = saved.id;
    }
  }
  if (tab) {
    tab.savedGraphId = saved.id;
    tab.name = saved.name || name;
    tab.dirty = false;
    tab.snapshot = data;
  }
  renderGraphTabs();
  renderGraphsPage();
  persistTabs();
  if (!opts.silent) {
    setHint(`saved ${saved.path || saved.name}`);
    setTimeout(clearHint, 1500);
  }
  return true;
}

// ─── Agent brain tab ─────────────────────────────────────────────────────
// Brain tabs persist to the server (.rundeer/agent/brain.json) instead of
// regular graph state, and recompile the runtime config on every save so the next
// agent turn picks up the changes.

const BRAIN_TAB_NAME = "Agent Brain";

function selectedAgentId() {
  if (window.AgentChat && typeof window.AgentChat.getSelectedAgentId === "function") {
    return window.AgentChat.getSelectedAgentId() || "default";
  }
  return "default";
}

function selectedAgentName() {
  if (window.AgentChat && typeof window.AgentChat.getSelectedAgentName === "function") {
    return window.AgentChat.getSelectedAgentName() || "Default";
  }
  return "Default";
}

function brainTabNameForAgent(agentName) {
  return `${BRAIN_TAB_NAME} · ${agentName || "Default"}`;
}

async function openBrainTab(agentId = null) {
  const targetAgentId = agentId || selectedAgentId();
  // Focus existing brain tab if open.
  const existing = tabsState.tabs.find((t) => t.kind === "brain" && (t.agentId || "default") === targetAgentId);
  if (existing) { activateTab(existing.id); return existing; }
  let payload = null;
  try {
    const res = await fetch(`/api/agent/brain-graph?agent_id=${encodeURIComponent(targetAgentId)}`);
    if (res.ok) payload = await res.json();
  } catch (_) {}
  const snapshot = (payload && payload.graph) || { version: 1, nodes: {}, edges: [], _nextId: 1 };
  const tab = newTab({
    name: brainTabNameForAgent(targetAgentId === selectedAgentId() ? selectedAgentName() : targetAgentId),
    snapshot,
    kind: "brain",
    agentId: targetAgentId,
    dirty: false,
  });
  return tab;
}

function saveBrainGraphTab(tab, opts = {}) {
  const data = serializeGraph();
  fetch("/api/agent/brain-graph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: data, agent_id: tab?.agentId || selectedAgentId() }),
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      setHint(`brain save failed: ${err.slice(0, 120)}`);
      setTimeout(clearHint, 3000);
      return;
    }
    if (!opts.silent) {
      setHint("agent brain saved");
      setTimeout(clearHint, 1500);
    }
  }).catch((exc) => {
    setHint(`brain save failed: ${exc.message || exc}`);
    setTimeout(clearHint, 3000);
  });
  tab.snapshot = data;
  tab.dirty = false;
  renderGraphTabs();
  persistTabs();
  // Also notify the live agent WS so the running Conversation refreshes
  // its in-memory snapshot + runtime. The HTTP POST above already
  // persisted + recompiled on disk, so skip a second write here.
  try {
    if (window.AgentChat && typeof window.AgentChat.sendBrainSnapshot === "function" && (tab?.agentId || "default") === selectedAgentId()) {
      window.AgentChat.sendBrainSnapshot(data, { persist: false });
    }
  } catch (_) {}
  return true;
}

function applyBrainPatchOp(op) {
  // Brain patches use the same op shape as workflow patches; just dispatch
  // through the existing helper so add_node/remove_node/set_props/edge ops
  // mutate the live brain canvas. Only safe to call while the brain tab is
  // active.
  applyAgentPatchOp(op);
}

async function deleteSavedGraph(id) {
  const saved = findSavedGraph(id);
  if (!saved) return;
  const decision = await openAppDialog({
    title: "Delete graph",
    message: `Delete "${saved.name}" from .rundeer/graphs?`,
    confirmText: "Delete",
    cancelText: "Cancel",
    showInput: false,
  });
  if (decision.action !== "confirm") return;
  await fetchJSON("/api/graphs/delete", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  graphLibrary.graphs = getSavedGraphs().filter((g) => g.id !== id);
  // Detach any open tabs pointing at it (they remain as unsaved dirty tabs).
  for (const t of tabsState.tabs) {
    if (t.savedGraphId === id) { t.savedGraphId = null; t.dirty = true; }
  }
  renderGraphTabs();
  renderGraphsPage();
  persistTabs();
}

function renderGraphsPage() {
  const root = document.getElementById("graphsList");
  const meta = document.getElementById("graphsPageMeta");
  if (!root) return;
  const list = getSavedGraphs().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (meta) meta.textContent = list.length ? `${list.length} saved` : "no saved graphs yet";
  root.innerHTML = "";
  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.className = "ne-graphs-empty";
    empty.textContent = "No saved graphs yet. Use Save Current to store this graph.";
    root.appendChild(empty);
    return;
  }
  for (const g of list) {
    const li = document.createElement("li");
    li.className = "ne-graphs-item";
    const isOpen = tabsState.tabs.some((t) => t.savedGraphId === g.id);
    if (isOpen) li.classList.add("is-open");

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "ne-graphs-item-name";
    name.textContent = g.name;
    const summary = summarizeGraphData(g.data);
    const sub = document.createElement("div");
    sub.className = "ne-graphs-item-meta";
    const when = new Date(g.updatedAt || g.createdAt || Date.now()).toLocaleString();
    sub.textContent = `${summary.nodeCount} nodes · ${summary.edgeCount} links · saved ${when}${isOpen ? " · open" : ""}`;
    left.appendChild(name);
    left.appendChild(sub);

    const meta2 = document.createElement("div");
    meta2.className = "ne-graphs-item-meta";
    meta2.textContent = g.id.slice(-6);

    const actions = document.createElement("div");
    actions.className = "ne-graphs-item-actions";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn btn-ghost btn-tiny";
    openBtn.textContent = isOpen ? "focus" : "open";
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSavedGraphInTab(g.id);
      setActiveView("nodes");
    });
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn btn-ghost btn-tiny";
    renameBtn.textContent = "rename";
    renameBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const result = await openAppDialog({
        title: "Rename graph",
        message: "Update the graph name in .rundeer/graphs.",
        inputLabel: "Graph name",
        defaultValue: g.name,
        confirmText: "Rename",
        cancelText: "Cancel",
      });
      if (result.action !== "confirm") return;
      const trimmed = String(result.value || "").trim();
      if (!trimmed) return;
      const response = await fetchJSON("/api/graphs", {
        method: "POST",
        body: JSON.stringify({ id: g.id, name: trimmed }),
      });
      const renamed = response.graph;
      graphLibrary.graphs = getSavedGraphs().filter((x) => x.id !== g.id && x.id !== renamed.id);
      upsertSavedGraph(renamed);
      for (const t of tabsState.tabs) {
        if (t.savedGraphId === g.id) {
          t.savedGraphId = renamed.id;
          t.name = renamed.name;
        }
      }
      renderGraphsPage(); renderGraphTabs(); persistTabs();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-ghost btn-tiny";
    delBtn.textContent = "delete";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSavedGraph(g.id).catch((err) => {
        setHint(`delete failed: ${err.message}`);
        setTimeout(clearHint, 2500);
      });
    });
    actions.appendChild(openBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(meta2);
    li.appendChild(actions);
    li.addEventListener("click", () => {
      openSavedGraphInTab(g.id);
      setActiveView("nodes");
    });
    root.appendChild(li);
  }
}

async function initTabsSystem() {
  await loadWebStore();
  await refreshSavedGraphs({ render: false });
  const restored = webStore.state.tabs || null;
  if (restored && Array.isArray(restored.tabs) && restored.tabs.length > 0) {
    tabsState.tabs = restored.tabs.map((t) => ({
      id: t.id || genStorageId("tab"),
      name: t.name || "Untitled",
      savedGraphId: t.savedGraphId || null,
      dirty: !!t.dirty,
      snapshot: t.snapshot || null,
      kind: t.kind || "workflow",
      agentId: t.agentId || null,
    }));
    tabsState.activeId = restored.activeId && tabsState.tabs.find((t) => t.id === restored.activeId)
      ? restored.activeId
      : tabsState.tabs[0].id;
  } else {
    tabsState.tabs = [{
      id: genStorageId("tab"),
      name: "Untitled",
      savedGraphId: null,
      dirty: false,
      snapshot: null,
      kind: "workflow",
    }];
    tabsState.activeId = tabsState.tabs[0].id;
  }
  const active = getActiveTab();
  tabsState._suspendDirty = true;
  try {
    if (active && active.snapshot) loadGraphData(active.snapshot);
  } finally {
    tabsState._suspendDirty = false;
  }
  applyShellKind(active);
  renderGraphTabs();
  renderPalette();
  // Auto-fit once the canvas is laid out.
  requestAnimationFrame(() => requestAnimationFrame(() => frameAll()));
  persistTabs();
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  markActiveDirty();
  autosaveTimer = setTimeout(autosaveWorkspaceState, 400);
}

// ─── Preview auto-refresh ────────────────────────────────────────────────────
// Re-resolves preview nodes and live-update nodes in `lite` mode after any
// cheap upstream change (text-input edits, edge add/remove, etc.). Lite mode
// never invokes command nodes — those reuse their lastResult.

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
    const liveNodes = Object.values(graph.nodes).filter((n) => LIVE_UPDATE_TYPES.has(n.type) && !isNodeMuted(n));
    if (previews.length === 0 && liveNodes.length === 0) return;
    const cache = {};
    const resolveOpts = { lite: !opts.force };
    let changedAny = false;
    for (const node of liveNodes) {
      try {
        const before = JSON.stringify(node.lastResult || null);
        await resolveNode(node.id, cache, {}, resolveOpts);
        if (JSON.stringify(node.lastResult || null) !== before) changedAny = true;
      } catch (_) { /* ignore: leaves prior lastResult untouched */ }
    }
    for (const node of previews) {
      // `file` is a preview-style source: its value comes straight from the
      // `path` prop (or a wired prop-socket) — no upstream `in` to walk.
      if (node.type === "file") {
        const wiredEdge = graph.edges.find((e) => e.toNode === node.id && e.toSocket === "path");
        let value = "";
        try {
          if (wiredEdge) {
            const res = await resolveNode(wiredEdge.fromNode, cache, {}, resolveOpts);
            value = res[wiredEdge.fromSocket];
          } else {
            value = String(node.props?.path || "");
          }
        } catch (_) { value = String(node.props?.path || ""); }
        const kind = Array.isArray(value)
          ? (() => {
              const first = value.find((v) => v != null && v !== "");
              const k = inferPreviewMediaKind(node, "", String(first || ""));
              return k === "video" ? "video-bundle" : (k === "image" ? "image-bundle" : "any");
            })()
          : inferPreviewMediaKind(node, "", String(value || ""));
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
          changedAny = true;
          const el = document.querySelector(`[data-node-id="${node.id}"]`);
          if (el) el.dataset.signature = "stale";
        }
        continue;
      }
      // Most previews use an "in" socket. Render and any future preview
      // with bespoke inputs still need to refresh — accept any incoming edge.
      // Coordinate has no inputs but is self-driving from its props.
      if (node.type !== "coordinate" && !graph.edges.some((e) => e.toNode === node.id)) continue;
      try {
        const res = await resolveNode(node.id, cache, {}, resolveOpts);
        const def = NODE_BY_TYPE[node.type];
        const primaryOut = (def?.outputs || [])[0]?.id;
        let value;
        if (res.in !== undefined) value = res.in;
        else if (res.out !== undefined) value = res.out;
        else if (primaryOut && res[primaryOut] !== undefined) value = res[primaryOut];
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
        if (node._uvImage) {
          node.lastResult.image = node._uvImage;
          delete node._uvImage;
        }
        if (opts.force) {
          if (Array.isArray(value)) {
            for (const v of value) if (v) artifactURL.bump(String(v));
          } else if (value) {
            artifactURL.bump(String(value));
          }
        }
        if (JSON.stringify(node.lastResult) !== before) {
          changedAny = true;
          const el = document.querySelector(`[data-node-id="${node.id}"]`);
          if (el) el.dataset.signature = "stale";
        }
      } catch (_) { /* ignore: leaves prior lastResult untouched */ }
    }
    renderNodes();
    if (changedAny) scheduleAutosave();
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
  // Re-fetch the existing preview value without re-running upstream nodes.
  // Bump cache-bust tokens on each artifact path so <img>/<video>/thumb URLs
  // refetch, mark the node DOM as stale, and re-render just this node.
  const value = node.lastResult?.value;
  if (Array.isArray(value)) {
    for (const v of value) if (v) artifactURL.bump(String(v));
  } else if (value) {
    artifactURL.bump(String(value));
  }
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (el) el.dataset.signature = "stale-refresh";
  renderNodes();
}

function serializeGraph() {
  // Strip transient fields
  const cleanNodes = {};
  for (const [id, n] of Object.entries(graph.nodes)) {
    cleanNodes[id] = {
      id: n.id, type: n.type, x: n.x, y: n.y, props: n.props, width: n.width,
      title: n.title || "",
      height: n.height || null,
      previewMode: n.previewMode || null,
      previewIndex: Number.isFinite(Number(n.previewIndex)) ? Number(n.previewIndex) : null,
      previewZoom: Number.isFinite(Number(n.previewZoom)) ? Number(n.previewZoom) : null,
      previewPanX: Number.isFinite(Number(n.previewPanX)) ? Number(n.previewPanX) : 0,
      previewPanY: Number.isFinite(Number(n.previewPanY)) ? Number(n.previewPanY) : 0,
      textZoom: Number.isFinite(Number(n.textZoom)) ? Number(n.textZoom) : null,
      collapsed: Boolean(n.collapsed),
      foldLocked: Boolean(n.foldLocked),
      minimized: Boolean(n.minimized),
      muted: Boolean(n.muted),
      collapsedPanels: n.collapsedPanels || {},
      lastResult: n.lastResult || null,
      lastRunMs: typeof n.lastRunMs === "number" ? n.lastRunMs : null,
      lastRunStatus: n.lastRunStatus || null,
      lastRunCount: Math.max(0, Number(n.lastRunCount) || 0),
    };
  }
  return { version: 2, nodes: cleanNodes, edges: graph.edges, _nextId: graph._nextId };
}

function loadGraphData(data) {
  if (!data || !data.nodes) return false;
  graph.nodes = {};
  for (const [id, n] of Object.entries(data.nodes)) {
    // Legacy migration: collapse preview-image / preview-video / preview-text
    // into the unified `preview` node, and image-input / video-input /
    // filepath-input into the unified `file` node.
    let migrated = n;
    if (LEGACY_PREVIEW_TYPES.has(n.type)) migrated = { ...migrated, type: "preview" };
    if (LEGACY_FILE_TYPES.has(migrated.type)) migrated = { ...migrated, type: "file" };
    graph.nodes[id] = {
      ...migrated,
      title: typeof migrated.title === "string" ? migrated.title : "",
      minimized: Boolean(migrated.minimized),
      muted: Boolean(migrated.muted),
      foldLocked: Boolean(migrated.foldLocked),
      previewMode: migrated.previewMode === "slider" ? "slider" : (migrated.previewMode === "grid" ? "grid" : null),
      previewIndex: Number.isFinite(Number(migrated.previewIndex)) ? Number(migrated.previewIndex) : 0,
      previewZoom: Math.round(clampValue(Number(migrated.previewZoom) || 1, PREVIEW_ZOOM_MIN, PREVIEW_ZOOM_MAX) * 100) / 100,
      previewPanX: Number.isFinite(Number(migrated.previewPanX)) ? Number(migrated.previewPanX) : 0,
      previewPanY: Number.isFinite(Number(migrated.previewPanY)) ? Number(migrated.previewPanY) : 0,
      textZoom: Math.round(clampValue(Number(migrated.textZoom) || 1, TEXT_ZOOM_MIN, TEXT_ZOOM_MAX) * 100) / 100,
      collapsedPanels: migrated.collapsedPanels || {},
      lastRunMs: typeof migrated.lastRunMs === "number" ? migrated.lastRunMs : null,
      lastRunStatus: migrated.lastRunStatus || null,
      lastRunCount: Math.max(0, Number(migrated.lastRunCount) || 0),
      hidden: false,
      collapsedBy: null,
      foldAnchorId: null,
      foldIndex: null,
      foldCount: null,
    };
    migrateMixNode(graph.nodes[id]);
    sanitizeCommandProps(graph.nodes[id]);
  }
  graph.edges = (data.edges || []).map((e) => migrateMixEdge({ ...e, id: e.id || genEdgeId() }));
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

function autosaveWorkspaceState() {
  const data = serializeGraph();
  // Mirror into the active tab's snapshot so tabs persist across reloads.
  const tab = getActiveTab();
  if (tab) tab.snapshot = data;
  persistTabs();
  flashAutosave();
}

function flashAutosave() {
  const dot = document.getElementById("autosaveDot");
  if (!dot) return;
  dot.classList.add("is-saving");
  setTimeout(() => dot.classList.remove("is-saving"), 600);
}

function saveGraphToFile() {
  return saveCurrentGraph().catch((err) => {
    setHint(`save failed: ${err.message}`);
    setTimeout(clearHint, 2500);
    return false;
  });
}

function loadGraphFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(String(e.target.result));
      if (!data || !data.nodes) throw new Error("invalid graph file");
      const name = (file.name || "graph").replace(/\.json$/i, "");
      newTab({ name, snapshot: data, dirty: true });
      setHint(`loaded ${file.name}`);
      setTimeout(clearHint, 1800);
    } catch (err) {
      setHint(`load failed: ${err.message}`);
      setTimeout(clearHint, 2500);
    }
  };
  reader.readAsText(file);
}

async function clearGraph() {
  const decision = await openAppDialog({
    title: "Clear graph",
    message: "Clear the current canvas? Unsaved nodes and links will be removed.",
    confirmText: "Clear",
    cancelText: "Cancel",
    showInput: false,
  });
  if (decision.action !== "confirm") return;
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
  if (!el) return;
  const hidden = el.classList.contains("sr-only");
  el.textContent = text;
  el.className = `${hidden ? "sr-only " : ""}ne-status ${cls || ""}`.trim();
  if (graphStatusTimer) clearTimeout(graphStatusTimer);
  if (!cls) graphStatusTimer = setTimeout(() => {
    const stillHidden = el.classList.contains("sr-only");
    el.textContent = "ready";
    el.className = `${stillHidden ? "sr-only " : ""}ne-status`.trim();
  }, 3000);
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
    catEl.dataset.category = cat.category;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "ne-category-head";
    head.innerHTML = `<span class="ne-category-caret">▸</span><span class="ne-category-dot"></span>${escHtml(cat.category)}`;
    head.addEventListener("click", () => catEl.classList.toggle("is-open"));
    catEl.appendChild(head);
    const body = document.createElement("div");
    body.className = "ne-category-body";
    for (const nodeDef of matching) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ne-node-btn";
      btn.draggable = true;
      btn.dataset.nodeType = nodeDef.type;
      btn.dataset.category = cat.category;
      btn.title = nodeDef.desc;
      btn.innerHTML = `<span class="ne-node-dot"></span>${escHtml(nodeDef.label)}`;
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

async function loadState() {
  try {
    const data = await fetchJSON("/api/state?light=1");
    const versionEl = document.getElementById("versionTag");
    if (versionEl) versionEl.textContent = data.version || "?";
    const projectEl = document.getElementById("projectRoot");
    if (projectEl) projectEl.textContent = data.projectRoot || "?";
    const env = data.env || {};
    const keysOk = data.agent && typeof data.agent.api_key_present === "boolean"
      ? Boolean(data.agent.api_key_present)
      : Boolean(env.VISION_API_KEY || env.MODEL_API_KEY);
    const keyEl = document.getElementById("keyStatus");
    if (keyEl) {
      keyEl.textContent = keysOk ? "ok" : "missing";
      keyEl.classList.toggle("is-positive", keysOk);
      keyEl.classList.toggle("is-quiet", !keysOk);
    }
    const stylesEl = document.getElementById("stylesStat");
    if (stylesEl) stylesEl.textContent = String((data.styles || []).length);
    // Initialize agent chat once the state confirms it's available.
    if (data.agent && data.agent.enabled && data.agent.port && window.AgentChat && !window.AgentChat._inited) {
      window.AgentChat._inited = true;
      const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProto}//${location.hostname}:${data.agent.port}`;
      window.AgentChat.init({
        wsUrl,
        model: data.agent.model || "agent",
        apiKeyPresent: Boolean(data.agent.api_key_present),
        getGraphSnapshot: () => {
          // When the user is on the brain tab, the live `graph` holds the
          // brain graph — which must not be sent to the agent as the
          // workflow snapshot, or the conversation will see a huge spurious
          // diff every turn and try to operate on brain nodes with
          // workflow tools. Fall back to the most recent workflow tab's
          // saved snapshot instead.
          const active = getActiveTab();
          const isBrain = !!(active && active.kind === "brain");
          if (!isBrain) {
            return {
              nodes: graph && graph.nodes ? graph.nodes : {},
              edges: graph && Array.isArray(graph.edges) ? graph.edges : [],
              selection: ix && ix.selection ? [...ix.selection] : [],
            };
          }
          const wf = (tabsState.tabs || []).find((t) => (t.kind || "workflow") === "workflow");
          const snap = (wf && wf.snapshot) || null;
          return {
            nodes: (snap && snap.nodes) || {},
            edges: snap && Array.isArray(snap.edges) ? snap.edges : [],
            selection: [],
          };
        },
        applyGraphPatch: (ops) => {
          if (!Array.isArray(ops)) return;
          for (const op of ops) applyAgentPatchOp(op);
          window.dispatchEvent(new CustomEvent("agent:patch-applied"));
        },
        openBrainTab: (agentId) => openBrainTab(agentId),
        applyBrainPatch: (ops) => {
          if (!Array.isArray(ops)) return;
          // Ensure the brain tab is active so patches mutate the correct
          // graph; await it so add_node positions are well-defined.
          Promise.resolve(openBrainTab()).then(() => {
            for (const op of ops) applyAgentPatchOp(op);
            // Mark brain tab dirty + autosave-on-snapshot via WS.
            const active = getActiveTab();
            if (active && active.kind === "brain") {
              active.dirty = true;
              renderGraphTabs();
            }
            window.dispatchEvent(new CustomEvent("agent:brain-patch-applied"));
          });
        },
        getBrainSnapshot: () => {
          const active = getActiveTab();
          if (active && active.kind === "brain" && (active.agentId || "default") === selectedAgentId()) return serializeGraph();
          return null;
        },
      });
    }
  } catch (_) {
    const projectEl = document.getElementById("projectRoot");
    if (projectEl) projectEl.textContent = "unavailable";
  }
}

// Apply a single patch op emitted by the agent's mutate tools.
function applyAgentPatchOp(op) {
  if (!op || typeof op !== "object") return;
  try {
    switch (op.op) {
      case "add_node": {
        if (typeof addNode === "function") {
          const actualId = addNode(op.type, Number(op.x) || 0, Number(op.y) || 0, { id: op.id, props: op.props || {}, muted: Boolean(op.muted) });
          if (actualId && op.id && actualId !== op.id) {
            // Track remapping so subsequent ops can resolve aliases if needed.
            window.AgentChat._idAliases = window.AgentChat._idAliases || {};
            window.AgentChat._idAliases[op.id] = actualId;
          }
        }
        break;
      }
      case "remove_node": {
        const id = _resolveAgentId(op.id);
        if (id && typeof removeNode === "function") removeNode(id);
        break;
      }
      case "set_node_props": {
        const id = _resolveAgentId(op.id);
        if (!id || !graph.nodes[id]) break;
        const node = graph.nodes[id];
        const def = (window.NODE_REGISTRY || {})[node.type];
        for (const [rawKey, v] of Object.entries(op.props || {})) {
          const k = node.type === "mix" && rawKey === "color_a" ? "a"
            : (node.type === "mix" && rawKey === "color_b" ? "b" : rawKey);
          if (k === "muted") {
            node.muted = Boolean(v);
            continue;
          }
          if (def && typeof setNodePropValue === "function") {
            const propDef = (def.props || []).find((p) => p.id === k);
            if (propDef) {
              setNodePropValue(id, propDef, v);
              continue;
            }
          }
          node.props = node.props || {};
          node.props[k] = v;
        }
        if (typeof renderProps === "function") renderProps(id);
        break;
      }
      case "move_node": {
        const id = _resolveAgentId(op.id);
        if (!id || !graph.nodes[id]) break;
        graph.nodes[id].x = Number(op.x) || graph.nodes[id].x;
        graph.nodes[id].y = Number(op.y) || graph.nodes[id].y;
        if (typeof renderAll === "function") renderAll();
        else if (typeof renderGraph === "function") renderGraph();
        break;
      }
      case "add_edge": {
        const from = _resolveAgentId(op.fromNode);
        const to = _resolveAgentId(op.toNode);
        if (from && to && typeof addEdge === "function") {
          addEdge(from, op.fromSocket, to, op.toSocket);
        }
        break;
      }
      case "remove_edge": {
        if (typeof removeEdge === "function" && op.id) removeEdge(op.id);
        break;
      }
      case "clear_graph": {
        if (typeof clearGraph === "function") clearGraph();
        break;
      }
      case "run_graph": {
        const ids = Array.isArray(op.subset) ? op.subset.map(_resolveAgentId).filter(Boolean) : [];
        const opts = { dryRun: Boolean(op.dryRun) };
        if (ids.length) opts.subset = new Set(ids);
        if (typeof runGraph === "function") void runGraph(opts);
        break;
      }
      case "run_trigger": {
        const id = _resolveAgentId(op.id || op.triggerNode || op.trigger_node);
        if (id && typeof runFromTrigger === "function") void runFromTrigger(id, { dryRun: Boolean(op.dryRun) });
        break;
      }
      case "select": {
        if (Array.isArray(op.ids) && ix && ix.selection) {
          ix.selection = new Set(op.ids.map(_resolveAgentId).filter(Boolean));
          if (typeof renderAll === "function") renderAll();
        }
        break;
      }
      default:
        // Unknown op: ignore.
        break;
    }
  } catch (err) {
    console.warn("[agent patch] failed", op, err);
  }
}

function _resolveAgentId(id) {
  if (!id) return id;
  const aliases = (window.AgentChat && window.AgentChat._idAliases) || {};
  return aliases[id] || id;
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

let activeAppDialog = null;

function openAppDialog(opts = {}) {
  if (activeAppDialog) activeAppDialog("cancel");
  const overlay = document.getElementById("appDialog");
  const form = document.getElementById("appDialogForm");
  const title = document.getElementById("appDialogTitle");
  const message = document.getElementById("appDialogMessage");
  const field = document.getElementById("appDialogField");
  const input = document.getElementById("appDialogInput");
  const inputLabel = document.getElementById("appDialogInputLabel");
  const cancelBtn = document.getElementById("appDialogCancel");
  const secondaryBtn = document.getElementById("appDialogSecondary");
  const confirmBtn = document.getElementById("appDialogConfirm");
  if (!overlay || !form || !title || !message || !field || !input || !cancelBtn || !secondaryBtn || !confirmBtn) {
    return Promise.resolve({ action: "cancel", value: null });
  }
  const showInput = opts.showInput !== false;
  title.textContent = opts.title || "Confirm";
  message.textContent = opts.message || "";
  field.hidden = !showInput;
  if (inputLabel) inputLabel.textContent = opts.inputLabel || "Name";
  input.value = opts.defaultValue || "";
  cancelBtn.textContent = opts.cancelText || "Cancel";
  confirmBtn.textContent = opts.confirmText || "OK";
  secondaryBtn.hidden = !opts.secondaryText;
  secondaryBtn.textContent = opts.secondaryText || "";
  overlay.classList.remove("is-hidden");

  return new Promise((resolve) => {
    const finish = (action) => {
      overlay.classList.add("is-hidden");
      form.removeEventListener("submit", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
      secondaryBtn.removeEventListener("click", onSecondary);
      overlay.removeEventListener("mousedown", onOverlayMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      activeAppDialog = null;
      resolve({ action, value: showInput ? input.value : null });
    };
    const onSubmit = (e) => { e.preventDefault(); finish("confirm"); };
    const onCancel = () => finish("cancel");
    const onSecondary = () => finish("secondary");
    const onOverlayMouseDown = (e) => { if (e.target === overlay) finish("cancel"); };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish("cancel");
      }
    };
    activeAppDialog = finish;
    form.addEventListener("submit", onSubmit);
    cancelBtn.addEventListener("click", onCancel);
    secondaryBtn.addEventListener("click", onSecondary);
    overlay.addEventListener("mousedown", onOverlayMouseDown);
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => {
      if (showInput) {
        input.focus();
        input.select();
      } else {
        confirmBtn.focus();
      }
    });
  });
}

window.openAppDialog = openAppDialog;

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

// ─── View tabs (Explore / Nodes) ─────────────────────────────────────────────

function setActiveView(name, opts = {}) {
  if (name !== "explore" && name !== "nodes" && name !== "runs" && name !== "graphs" && name !== "settings") name = "nodes";
  const shell = document.querySelector(".ne-shell");
  if (!shell) return;
  shell.dataset.activeView = name;
  document.querySelectorAll(".view-tab").forEach((b) => {
    if (!b.dataset.view) return; // skip non-view buttons (e.g. Help)
    const active = b.dataset.view === name;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".ne-view").forEach((v) => {
    v.hidden = v.dataset.view !== name;
  });
  // Lazy-init explore tree the first time it's shown.
  if (name === "explore") initExplore();
  if (name === "runs" && window.refreshRunsList) window.refreshRunsList();
  if (name === "graphs") renderGraphsPage();
  if (name === "settings") renderShortcutSettings();
  // Update history without reload so deep links still work.
  const url = name === "explore"
    ? "/explore"
    : name === "runs"
      ? "/runs"
      : name === "graphs"
        ? "/graphs"
        : name === "settings"
          ? "/settings"
          : "/nodes";
  if (location.pathname !== url) {
    try {
      if (opts.history === false) history.replaceState({ view: name }, "", url);
      else history.pushState({ view: name }, "", url);
    } catch (_) {}
  }
  // Frame all when entering nodes (gives the canvas a chance to recompute size).
  if (name === "nodes") {
    requestAnimationFrame(() => { applyViewport(); renderConnections(); });
  }
}

function initialViewFromPath() {
  const p = location.pathname || "/";
  if (p === "/explore") return "explore";
  if (p === "/runs") return "runs";
  if (p === "/graphs") return "graphs";
  if (p === "/settings") return "settings";
  if (p === "/nodes") return "nodes";
  return "nodes";
}

// ─── Explore view ────────────────────────────────────────────────────────────

const explore = {
  initialized: false,
  treeRoot: null,
  open: new Set([""]),
  filter: "",
  selectedPath: null,
  loaded: false,
};

async function initExplore() {
  if (explore.initialized) return;
  explore.initialized = true;
  bindExploreHandlers();
  await loadExploreTree();
  // Restore previous split width.
  const saved = webLayoutState().exploreSplit;
  if (saved) document.getElementById("exShell").style.setProperty("--ex-split", saved);
  setupExploreResizer();
}

function bindExploreHandlers() {
  document.getElementById("exFileSearch").addEventListener("input", debounceExplore((e) => {
    explore.filter = e.target.value.trim().toLowerCase();
    renderExploreTree();
  }, 140));
  document.getElementById("exTreeRefresh").addEventListener("click", loadExploreTree);
  document.getElementById("exTreeExpandAll").addEventListener("click", () => {
    walkSetOpenExplore(explore.treeRoot, true);
  });
  document.getElementById("exTreeCollapseAll").addEventListener("click", () => {
    explore.open = new Set([""]);
    renderExploreTree();
  });
  document.getElementById("exPreviewOpen").addEventListener("click", () => {
    if (explore.selectedPath) window.open(`/api/file?path=${encodeURIComponent(explore.selectedPath)}`, "_blank");
  });
  document.getElementById("exPreviewCopy").addEventListener("click", () => {
    if (!explore.selectedPath) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(explore.selectedPath).catch(() => {});
    }
  });
}

function debounceExplore(fn, ms) {
  let t = null;
  return (...args) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function loadExploreTree() {
  try {
    const data = await fetchJSON("/api/tree");
    explore.treeRoot = data.tree;
    explore.open.add("");
    explore.loaded = true;
    document.getElementById("exFilesRoot").textContent = data.tree?.name ? `· ${data.tree.name}` : "";
    renderExploreTree();
  } catch (err) {
    document.getElementById("exFileTree").innerHTML = `<div class="file-empty">tree unavailable: ${escHtml(err.message)}</div>`;
  }
}

async function toggleExploreNode(node) {
  const key = node.path || "";
  if (explore.open.has(key)) {
    explore.open.delete(key);
    renderExploreTree();
    return;
  }
  explore.open.add(key);
  if (!node.loaded && !node.loading) {
    node.loading = true;
    renderExploreTree();
    try {
      const data = await fetchJSON(`/api/tree?path=${encodeURIComponent(node.path || "")}`);
      node.children = data.tree.children || [];
      node.loaded = true;
    } catch (err) {
      node.children = [{ name: `unavailable: ${err.message}`, path: `${node.path}/__error__`, kind: "file", size: 0 }];
    } finally {
      node.loading = false;
    }
  }
  renderExploreTree();
}

function walkSetOpenExplore(node, open) {
  if (!node) return;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.kind === "dir") {
      if (open) explore.open.add(n.path || ""); else explore.open.delete(n.path || "");
      (n.children || []).forEach((c) => stack.push(c));
    }
  }
  renderExploreTree();
}

function filterExploreTree(node, q) {
  if (!q) return node;
  if (node.kind === "dir") {
    const kids = (node.children || []).map((c) => filterExploreTree(c, q)).filter(Boolean);
    if (kids.length === 0 && !node.name.toLowerCase().includes(q)) return null;
    explore.open.add(node.path || "");
    return { ...node, children: kids };
  }
  return (node.path || "").toLowerCase().includes(q) || node.name.toLowerCase().includes(q) ? node : null;
}

function renderExploreTree() {
  const host = document.getElementById("exFileTree");
  if (!host) return;
  host.innerHTML = "";
  if (!explore.treeRoot) {
    host.innerHTML = `<div class="file-empty">loading…</div>`;
    return;
  }
  const filtered = filterExploreTree(explore.treeRoot, explore.filter);
  if (!filtered) { host.innerHTML = `<div class="file-empty">no matches</div>`; return; }
  (filtered.children || []).forEach((c) => host.appendChild(renderExploreNode(c, 0)));
}

function exploreFileGlyph(node) {
  const ext = (node.name || "").toLowerCase().split(".").pop();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "▣";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "▶";
  if (["md", "txt"].includes(ext)) return "▤";
  if (ext === "json") return "{ }";
  if (ext === "py") return "py";
  return "·";
}

function renderExploreNode(node, depth) {
  const row = document.createElement("div");
  row.className = "tree-node";
  row.style.setProperty("--depth", depth);
  if (node.kind === "dir") {
    const open = explore.open.has(node.path || "");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "tree-row tree-dir";
    const count = node.loaded ? (node.children || []).length : "…";
    head.innerHTML = `<span class="caret ${open ? "is-open" : ""}">▸</span><span class="tree-icon">▢</span><span class="tree-name">${escHtml(node.name)}</span><span class="tree-count">${count}</span>`;
    head.addEventListener("click", () => toggleExploreNode(node));
    row.appendChild(head);
    if (open) {
      const inner = document.createElement("div");
      inner.className = "tree-children";
      if (node.loading) {
        const loading = document.createElement("div");
        loading.className = "file-empty tree-loading";
        loading.textContent = "loading…";
        inner.appendChild(loading);
      } else {
        (node.children || []).forEach((c) => inner.appendChild(renderExploreNode(c, depth + 1)));
      }
      row.appendChild(inner);
    }
  } else {
    const head = document.createElement("button");
    head.type = "button";
    head.className = `tree-row tree-file${explore.selectedPath === node.path ? " is-selected" : ""}`;
    head.innerHTML = `<span class="caret"> </span><span class="tree-icon">${exploreFileGlyph(node)}</span><span class="tree-name" title="${escHtml(node.path)}">${escHtml(node.name)}</span>`;
    head.addEventListener("click", () => previewExploreFile(node));
    row.appendChild(head);
  }
  return row;
}

function previewExploreFile(node) {
  explore.selectedPath = node.path;
  const body = document.getElementById("exPreviewBody");
  const nameEl = document.getElementById("exPreviewName");
  nameEl.textContent = node.path;
  document.getElementById("exPreviewOpen").disabled = false;
  document.getElementById("exPreviewCopy").disabled = false;

  const ext = (node.name || "").toLowerCase().split(".").pop();
  const url = `/api/file?path=${encodeURIComponent(node.path)}`;
  body.innerHTML = "";

  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = node.name;
    body.appendChild(img);
  } else if (["mp4", "mov", "webm", "mkv"].includes(ext)) {
    const v = document.createElement("video");
    v.src = url;
    v.controls = true;
    v.autoplay = false;
    body.appendChild(v);
  } else if (["md", "txt", "json", "py", "csv", "log"].includes(ext)) {
    body.innerHTML = `<pre class="ex-preview-text">loading…</pre>`;
    const pre = body.querySelector("pre");
    fetch(url).then((r) => r.text()).then((t) => { pre.textContent = t; })
      .catch((err) => { pre.textContent = `unable to read file: ${err.message}`; });
  } else {
    body.innerHTML = `<div class="ex-preview-empty">no inline preview for .${escHtml(ext)} files</div>`;
  }
  // Re-render tree so selection highlight updates.
  renderExploreTree();
}

function setupSidePanelResizers() {
  const shell = document.querySelector(".ne-shell");
  if (!shell) return;
  // Restore saved widths.
  const layout = webLayoutState();
  if (layout.paletteW) shell.style.setProperty("--palette-w", layout.paletteW);
  if (layout.propsW) shell.style.setProperty("--props-w", layout.propsW);
  shell.classList.toggle("hide-n", Boolean(paletteLayoutState().hidden));

  const bind = (resizerId, varName, layoutKey, side) => {
    const resizer = document.getElementById(resizerId);
    if (!resizer) return;
    let dragging = false;
    const applyWidth = (w) => {
      const value = `${Math.round(w)}px`;
      if (side === "right") preserveCanvasRightEdge(() => shell.style.setProperty(varName, value));
      else shell.style.setProperty(varName, value);
      applyPaletteLayout({ commitHandleSide: true });
    };
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      resizer.classList.add("is-active");
      document.body.style.cursor = "col-resize";
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const rect = shell.getBoundingClientRect();
      const minW = 140;
      const maxW = Math.max(minW, rect.width - 400);
      let w = side === "left" ? (e.clientX - rect.left) : (rect.right - e.clientX);
      w = Math.max(minW, Math.min(maxW, w));
      applyWidth(w);
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove("is-active");
      document.body.style.cursor = "";
      const cur = getComputedStyle(shell).getPropertyValue(varName).trim();
      if (cur) {
        webLayoutState()[layoutKey] = cur;
        scheduleWebStoreSave();
      }
    });
  };

  bind("paletteResizer", "--palette-w", "paletteW", "left");
  bind("propsResizer", "--props-w", "propsW", "right");
}

function setupExploreResizer() {
  const shell = document.getElementById("exShell");
  const resizer = document.getElementById("exResizer");
  if (!shell || !resizer) return;
  let dragging = false;
  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add("is-active");
    document.body.style.cursor = "col-resize";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = shell.getBoundingClientRect();
    const pct = Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100));
    const val = `${pct.toFixed(1)}%`;
    shell.style.setProperty("--ex-split", val);
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("is-active");
    document.body.style.cursor = "";
    const cur = getComputedStyle(shell).getPropertyValue("--ex-split").trim();
    if (cur) {
      webLayoutState().exploreSplit = cur;
      scheduleWebStoreSave();
    }
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadWebStore();
  loadState();
  renderPalette();
  applyViewport();
  renderProps(null);
  setupSidePanelResizers();
  setupAgentPalette();

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

  // High-priority reroute placement commit/cancel: while E-placement is
  // active, clicks should place/cancel the draft instead of selecting nodes.
  window.addEventListener("mousedown", (e) => {
    if (!ix.reroutePlacement) return;
    if (e.button === 0) commitReroutePlacement();
    else if (e.button === 2) cancelReroutePlacement();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

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

  // Click anywhere outside the floating add-menu (including on the canvas)
  // closes it. The mention popup is a sibling element so we still leave it
  // intact via its own dismissal logic.
  document.addEventListener("mousedown", (e) => {
    const menu = document.getElementById("addMenu");
    if (menu.style.display === "none") return;
    if (menu.contains(e.target)) return;
    if (e.target.closest && e.target.closest(".ne-mention-popup")) return;
    hideAddMenu();
  });

  document.getElementById("paletteSearch").addEventListener("input", (e) => renderPalette(e.target.value.trim()));

  // Toolbar
  document.getElementById("runGraphBtn").addEventListener("click", () => runGraph());
  const stopGraphBtn = document.getElementById("stopGraphBtn");
  if (stopGraphBtn) stopGraphBtn.addEventListener("click", stopGraphRun);
  const pauseGraphBtn = document.getElementById("pauseGraphBtn");
  if (pauseGraphBtn) pauseGraphBtn.addEventListener("click", () => {
    if (!_graphRunState) return;
    if (_graphRunState.paused) resumeGraphRun("footer");
    else pauseGraphRun("manual");
  });
  const saveGraphBtn = document.getElementById("saveGraphBtn");
  if (saveGraphBtn) saveGraphBtn.addEventListener("click", saveGraphToFile);
  const loadGraphBtn = document.getElementById("loadGraphBtn");
  if (loadGraphBtn) loadGraphBtn.addEventListener("click", () => document.getElementById("loadGraphFile").click());
  const clearGraphBtn = document.getElementById("clearGraphBtn");
  if (clearGraphBtn) clearGraphBtn.addEventListener("click", () => clearGraph().catch(() => {}));
  const loadGraphFile = document.getElementById("loadGraphFile");
  if (loadGraphFile) loadGraphFile.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) loadGraphFromFile(e.target.files[0]);
    e.target.value = "";
  });
  const newTabBtn = document.getElementById("newTabBtn");
  if (newTabBtn) newTabBtn.addEventListener("click", () => newTab({ name: "Untitled" }));
  const refreshButton = document.getElementById("refreshButton");
  if (refreshButton) refreshButton.addEventListener("click", () => { loadState(); refreshRunsList(); });
  const runsPageRefresh = document.getElementById("runsPageRefresh");
  if (runsPageRefresh) runsPageRefresh.addEventListener("click", () => refreshRunsList());
  const graphsPageRefresh = document.getElementById("graphsPageRefresh");
  if (graphsPageRefresh) graphsPageRefresh.addEventListener("click", () => refreshSavedGraphs());
  const resetShortcutsBtn = document.getElementById("resetShortcutsBtn");
  if (resetShortcutsBtn) resetShortcutsBtn.addEventListener("click", resetAllShortcuts);

  // View tabs (Tree / Runs / Graphs / Explore) — switching is a CSS toggle
  // so state (graph, panels, run dock) is preserved without a reload. The
  // Help button shares the same nav element but has no data-view, so we
  // skip it here and bind it to the help modal separately.
  document.querySelectorAll(".view-tab").forEach((b) => {
    if (!b.dataset.view) return;
    b.addEventListener("click", () => setActiveView(b.dataset.view, { history: true }));
  });
  setActiveView(initialViewFromPath(), { history: false });
  window.addEventListener("popstate", (e) => {
    const v = (e.state && e.state.view) || initialViewFromPath();
    setActiveView(v, { history: false });
  });

  const runsPanelClose = document.getElementById("runsPanelClose");
  if (runsPanelClose) {
    runsPanelClose.addEventListener("click", () => {
      const overlay = document.getElementById("runsPanel");
      if (overlay) overlay.classList.remove("is-open");
    });
  }
  const runsToggle = document.getElementById("runsToggle");
  if (runsToggle) runsToggle.addEventListener("click", () => setActiveView("runs"));

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

  // Restore tabs and saved graphs from .rundeer.
  await initTabsSystem();
  refreshRunsList();
  setInterval(refreshRunsList, 4000);
  // Initial preview pass so non-command upstream values populate immediately.
  schedulePreviewRefresh();

  // Save before unload as a final safety net.
  window.addEventListener("beforeunload", () => {
    captureActiveSnapshot();
    persistTabs();
    sendWebStoreKeepalive();
  });
});
