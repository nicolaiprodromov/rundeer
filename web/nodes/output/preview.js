(window.RundeerNodes = window.RundeerNodes || {})["preview"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = inputs.in;
  outputs.in = inputs.in;
  const inc = helpers.activeIncomingEdges(helpers.nodeId, "in")[0];
  const src = inc ? helpers.graph.nodes[inc.fromNode] : null;
  const alias = src?._uvImage || src?.lastResult?.image || "";
  if (alias) node._uvImage = alias;
} };