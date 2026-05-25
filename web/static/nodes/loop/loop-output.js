(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["loop-output"] = async function (node, inputs, outputs, props, helpers) {
  const loopId = String(node.props.loop_id || "loop1");
  const decomposeNodeId = Object.keys(helpers.graph.nodes).find((id) => {
    const n = helpers.graph.nodes[id];
    return n.type === "loop-decompose" && String(n.props.loop_id || "loop1") === loopId;
  });
  if (!decomposeNodeId) throw new Error(`loop-output: no matching loop-decompose with loop_id="${loopId}"`);
  const decomposeBundleEdges = helpers.activeIncomingEdges(decomposeNodeId, "bundle");
  let bundleValue = [];
  if (decomposeBundleEdges.length > 0) {
    const edge = decomposeBundleEdges[0];
    const src = await helpers.resolveNodeWithPausedWork(helpers.work, edge.fromNode, helpers.cache, helpers.loopCtx, helpers.opts);
    const v = src[edge.fromSocket];
    bundleValue = Array.isArray(v) ? v : (v ? [v] : []);
  }
  const itemEdges = helpers.activeIncomingEdges(helpers.nodeId, "item");
  const collected = [];
  for (let i = 0; i < bundleValue.length; i++) {
    await helpers.waitForGraphRunReady(helpers.opts);
    const subCtx = { ...helpers.loopCtx, [loopId]: { i, total: bundleValue.length, items: bundleValue } };
    const subCache = {};
    if (itemEdges.length > 0) {
      const edge = itemEdges[0];
      const r = await helpers.resolveNodeWithPausedWork(helpers.work, edge.fromNode, subCache, subCtx, helpers.opts);
      const v = r[edge.fromSocket];
      if (Array.isArray(v)) collected.push(...v);
      else collected.push(v);
    } else {
      collected.push(node.props.item ?? "");
    }
  }
  if (itemEdges.length > 0) {
    const srcNodeId = itemEdges[0].fromNode;
    const srcNode = helpers.graph.nodes[srcNodeId];
    if (srcNode) {
      let bk = "any";
      const first = collected.find((v) => v != null && v !== "");
      if (typeof first === "string") {
        if (/\.(mp4|mov|webm|mkv)$/i.test(first)) bk = "video-bundle";
        else if (/\.(png|jpe?g|webp|gif)$/i.test(first)) bk = "image-bundle";
      }
      srcNode.lastResult = { kind: bk, value: collected.slice() };
      for (const v of collected) if (v) helpers.artifactURL.bump(String(v));
      const el = document.querySelector(`[data-node-id="${srcNodeId}"]`);
      if (el) el.dataset.signature = "stale";
    }
  }
  outputs.out = collected;
};