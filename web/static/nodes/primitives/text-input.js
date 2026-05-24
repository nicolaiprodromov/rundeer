(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["text-input"] = async function (node, inputs, outputs, props, helpers) {
  outputs.out = String(props.value || "");
};