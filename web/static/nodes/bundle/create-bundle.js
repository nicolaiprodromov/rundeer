(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["create-bundle"] = async function (node, inputs, outputs, props, helpers) {
  const collected = Array.isArray(inputs.items) ? inputs.items.slice() : [];
  outputs.out = collected;
};