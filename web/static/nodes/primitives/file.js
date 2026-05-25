(window.RundeerNodes = window.RundeerNodes || {})["file"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = String(props.path ?? "");
} };
window.RundeerNodes["image-input"] = window.RundeerNodes["file"];
window.RundeerNodes["video-input"] = window.RundeerNodes["file"];
window.RundeerNodes["filepath-input"] = window.RundeerNodes["file"];
