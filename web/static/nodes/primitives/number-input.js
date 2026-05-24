(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["number-input"] = async function (node, inputs, outputs, props, helpers) {
  outputs.out = Number(props.value ?? 1);
};
