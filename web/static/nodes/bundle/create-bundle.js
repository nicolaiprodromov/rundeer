(window.RundeerNodes = window.RundeerNodes || {})["create-bundle"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const collected = Array.isArray(inputs.items) ? inputs.items.slice() : [];
  outputs.out = collected;
} };