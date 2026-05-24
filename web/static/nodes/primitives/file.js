(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["file"] = async function (node, inputs, outputs, props, helpers) {
  outputs.out = String(props.path ?? "");
};
window.RundeerNodeResolvers["image-input"] = window.RundeerNodeResolvers["file"];
window.RundeerNodeResolvers["video-input"] = window.RundeerNodeResolvers["file"];
window.RundeerNodeResolvers["filepath-input"] = window.RundeerNodeResolvers["file"];
