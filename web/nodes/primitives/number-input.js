(window.RundeerNodes = window.RundeerNodes || {})["number-input"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = Number(props.value ?? 1);
} };
