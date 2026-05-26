(window.RundeerNodes = window.RundeerNodes || {})["cmd-edit"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const result = await helpers.executeCommandNode(node, inputs, helpers.opts);
  if (Array.isArray(result.artifacts) && result.artifacts.length > 1) {
    outputs.out = result.artifacts;
  } else {
    outputs.out = result.firstArtifact || "";
  }
} };