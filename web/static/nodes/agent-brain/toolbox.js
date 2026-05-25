(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["toolbox"] = async function (node, inputs, outputs, props, helpers) {
  const disabledStr = String(props.disabled_tools || "");
  const disabledNames = disabledStr.split(",").map((s) => s.trim()).filter(Boolean);
  const overrides = {};
  for (const name of disabledNames) {
    overrides[name] = { enabled: false };
  }
  outputs.out = overrides;
};