(window.RundeerNodes = window.RundeerNodes || {})["brain"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const sections = Array.isArray(inputs.sections)
    ? inputs.sections
    : (inputs.sections != null && inputs.sections !== "" ? [inputs.sections] : []);
  outputs.out = sections
    .map((value) => String(value == null ? "" : value).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
} };