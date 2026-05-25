(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["loop-decompose"] = async function (node, inputs, outputs, props, helpers) {
  const loopId = String(node.props.loop_id || "loop1");
  const ctx = helpers.loopCtx[loopId];
  const bundle = inputs.bundle;
  const items = Array.isArray(bundle) ? bundle : (bundle ? [bundle] : []);
  const i = ctx ? ctx.i : 0;
  outputs.item = items[i] !== undefined ? items[i] : "";
  outputs.index = i;
  outputs.count = items.length;
};