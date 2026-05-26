(window.RundeerNodes = window.RundeerNodes || {})["tool-flag"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  outputs.out = {
    tool_name: String(props.tool_name || ""),
    enabled: props.enabled !== false,
    description: String(props.description || ""),
    category: String(props.category || ""),
    destructive: props.destructive ?? "",
  };
} };