function _nextLoopId(ctx) {
  const used = new Set(
    Object.values(ctx.graph.nodes)
      .filter((n) => n.type === "loop-decompose" || n.type === "loop-output")
      .map((n) => String(n.props.loop_id || ""))
  );
  let i = 1;
  while (used.has(`loop${i}`)) i++;
  return `loop${i}`;
}

(window.RundeerNodes = window.RundeerNodes || {})["loop-decompose"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const loopId = String(node.props.loop_id || "loop1");
  const ctx = helpers.loopCtx[loopId];
  const bundle = inputs.bundle;
  const items = Array.isArray(bundle) ? bundle : (bundle ? [bundle] : []);
  const i = ctx ? ctx.i : 0;
  outputs.item = items[i] !== undefined ? items[i] : "";
  outputs.index = i;
  outputs.count = items.length;
},

  createPair(canvasX, canvasY, opts, ctx) {
    const loopId = _nextLoopId(ctx);
    const decDef = ctx.NODE_BY_TYPE["loop-decompose"];
    const decProps = {};
    for (const p of decDef.props || []) decProps[p.id] = p.default ?? "";
    Object.assign(decProps, opts.props || {});
    decProps.loop_id = loopId;
    const decId = ctx.genNodeId(opts.id);
    ctx.graph.nodes[decId] = {
      id: decId, type: "loop-decompose",
      x: canvasX, y: canvasY, props: decProps,
      title: "",
      width: decDef.defaultWidth || 220,
      height: decDef.defaultHeight || null,
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
    const outDef = ctx.NODE_BY_TYPE["loop-output"];
    const outProps = {};
    for (const p of outDef.props || []) outProps[p.id] = p.default ?? "";
    outProps.loop_id = loopId;
    const outId = ctx.genNodeId();
    ctx.graph.nodes[outId] = {
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
    ctx.renderGraph();
    if (!opts.skipSelect) ctx.selectOnly(decId);
    ctx.scheduleAutosave();
    return decId;
  },

  nextLoopId(ctx) {
    return _nextLoopId(ctx);
  },
};