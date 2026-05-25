(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["tool-flag"] = async function (node, inputs, outputs, props, helpers) {
  outputs.out = {
    tool_name: String(props.tool_name || ""),
    enabled: props.enabled !== false,
    description: String(props.description || ""),
    category: String(props.category || ""),
    destructive: props.destructive ?? "",
  };
};