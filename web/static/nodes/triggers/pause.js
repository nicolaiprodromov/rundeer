(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["pause"] = async function (node, inputs, outputs, props, helpers) {
  outputs.out = inputs.in;
  outputs.in = inputs.in;
  await helpers.pauseGraphAtNode(helpers.nodeId, outputs, helpers.opts);
};