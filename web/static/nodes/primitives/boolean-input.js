(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["boolean-input"] = async function (node, inputs, outputs, props, helpers) {
  outputs.out = Boolean(props.value);
};