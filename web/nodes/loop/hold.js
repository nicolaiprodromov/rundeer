(window.RundeerNodes = window.RundeerNodes || {})["hold"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const o = helpers.loopCtx[String(node.props.loop_id || "loop1")]?.outer;
  const e = helpers.activeIncomingEdges(helpers.nodeId, "in")[0];
  if (!e) { outputs.out = ""; return; }
  const r = await helpers.resolveNode(e.fromNode, o ? o.cache : helpers.cache, o ? o.ctx : helpers.loopCtx, helpers.opts);
  outputs.out = r[e.fromSocket];
} };
