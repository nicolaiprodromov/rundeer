const _COMPRESS_HELPER_PROMPT =
  "Summarize and compress the input text. Keep all the same meaning, intent, " +
  "facts, and tone \u2014 strip filler, redundancy, and rephrase verbose passages " +
  "into tighter prose. Do not invent or omit information. Return only the " +
  "compressed text, no preamble.";

function _hasTextUpstream(nodeId, ctx) {
  const edge = ctx.activeIncomingEdges(nodeId, "in")[0];
  if (!edge) return false;
  const sock = ctx.outputSocketDef(edge.fromNode, edge.fromSocket);
  return ctx.baseType(sock?.type || "any") === "text";
}

(window.RundeerNodes = window.RundeerNodes || {})["compress-image"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const v = inputs.in;
  if (Array.isArray(v)) {
    const items = v.filter((x) => x != null && x !== "").map((x) => String(x));
    if (items.length === 0) { outputs.out = ""; return; }
    helpers.appendRunLog(`  ↳ Zipping bundle (${items.length} item${items.length === 1 ? "" : "s"})…\n`);
    const result = await helpers.graphFetchJSON("/api/compress", {
      method: "POST",
      body: JSON.stringify({ kind: "bundle", paths: items }),
    }, helpers.opts);
    if (result.error) throw new Error(`compress: ${result.error}`);
    helpers.appendRunLog(`  ↳ → ${result.path} (${helpers.formatBytes(result.bytes)})\n`);
    outputs.out = result.path;
    return;
  }
  const str = (v == null) ? "" : String(v);
  if (!str) { outputs.out = ""; return; }
  const looksLikePath =
    /\.[A-Za-z0-9]{1,6}$/.test(str) &&
    !str.includes("\n") &&
    str.length < 512;
  const inEdge = helpers.activeIncomingEdges(helpers.nodeId, "in")[0];
  const inSockType = inEdge ? helpers.baseType(helpers.outputSocketDef(inEdge.fromNode, inEdge.fromSocket)?.type || "any") : "any";
  const isText = inSockType === "text" || (!looksLikePath && inSockType === "any");
  if (isText) {
    const instructions = inputs.instructions || _COMPRESS_HELPER_PROMPT;
    helpers.appendRunLog(`  ↳ Compressing text via LLM…\n`);
    const result = await helpers.graphFetchJSON("/api/filter-prompt", {
      method: "POST",
      body: JSON.stringify({
        prompt: str,
        instructions,
        images: [],
      }),
    }, helpers.opts);
    if (result.error) throw new Error(`compress(text): ${result.error}`);
    outputs.out = result.filtered_prompt || str;
    helpers.appendRunLog(`  ↳ → ${(outputs.out || "").length} chars (was ${str.length})\n`);
    return;
  }
  helpers.appendRunLog(`  ↳ Compressing ${str} (q=${props.quality})…\n`);
  const result = await helpers.graphFetchJSON("/api/compress", {
    method: "POST",
    body: JSON.stringify({
      kind: "auto",
      path: str,
      quality: Number(props.quality ?? 75),
      max_dimension: Number(props.max_dimension ?? 0),
    }),
  }, helpers.opts);
  if (result.error) throw new Error(`compress: ${result.error}`);
  const ratio = result.originalBytes ? Math.round((result.bytes / result.originalBytes) * 100) : 0;
  helpers.appendRunLog(`  ↳ → ${result.path} (${helpers.formatBytes(result.bytes)}, ${ratio}% of original)\n`);
  outputs.out = result.path;
},

  isInputVisible(node, sock, ctx) {
    if (sock.id === "instructions") return _hasTextUpstream(node.id, ctx);
    return true;
  },

  onEdgeChange(nodeId, changedSocket, ctx) {
    const node = ctx.graph.nodes[nodeId];
    if (!node) return;
    if (changedSocket !== "in" && changedSocket !== "instructions") return;
    const hasText = _hasTextUpstream(nodeId, ctx);
    if (!hasText) {
      ctx.graph.edges = ctx.graph.edges.filter(
        (e) => !(e.toNode === nodeId && e.toSocket === "instructions")
      );
      return;
    }
    const existing = ctx.graph.edges.find(
      (e) => e.toNode === nodeId && e.toSocket === "instructions"
    );
    if (existing) return;
    node.props ||= {};
    let helperId = node.props._instructionsHelperId;
    if (!helperId || !ctx.graph.nodes[helperId]) {
      const def = ctx.NODE_BY_TYPE["text-input"];
      const hid = ctx.genNodeId();
      const hProps = {};
      for (const p of (def.inputs || []).filter(e => e.kind)) hProps[p.id] = p.default ?? "";
      hProps.value = _COMPRESS_HELPER_PROMPT;
      const width = def.defaultWidth || 280;
      ctx.graph.nodes[hid] = {
        id: hid, type: "text-input",
        x: (node.x || 0) - width - 40,
        y: (node.y || 0) + 30,
        props: hProps,
        title: "Compress \u00b7 Instructions",
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
      helperId = hid;
      node.props._instructionsHelperId = helperId;
    }
    ctx.graph.edges.push({
      id: ctx.genEdgeId(),
      fromNode: helperId,
      fromSocket: "out",
      toNode: nodeId,
      toSocket: "instructions",
    });
  },
};