(window.RundeerNodes = window.RundeerNodes || {})["boolean-input"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = Boolean(props.value);
} };