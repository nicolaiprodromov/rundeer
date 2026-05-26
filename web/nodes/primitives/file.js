(window.RundeerNodes = window.RundeerNodes || {})["file"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = String(props.path ?? "");
} };

