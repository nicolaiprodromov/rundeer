(window.RundeerNodes = window.RundeerNodes || {})["float-input"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = Number(props.value ?? 0);
} };
