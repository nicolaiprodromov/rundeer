(window.RundeerNodes = window.RundeerNodes || {})["text-join"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const sep = props.sep ?? " ";
  outputs.out = [inputs.a, inputs.b].filter((v) => v != null && v !== "").join(sep);
} };