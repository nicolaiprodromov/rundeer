(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["vector-input"] = async function (node, inputs, outputs, props, helpers) {
  outputs.out = [Number(props.x ?? 0), Number(props.y ?? 0), Number(props.z ?? 0)];
};
