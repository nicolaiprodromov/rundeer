(window.RundeerNodes = window.RundeerNodes || {})["integer-input"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = Math.trunc(Number(props.value ?? 0));
} };
