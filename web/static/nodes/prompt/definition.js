(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["definition"] = async function (node, inputs, outputs, props, helpers) {
  const name = String(props.name || "").trim().replace(/^@+/, "");
  if (!name) throw new Error("Definition node has no name");
  const args = String(inputs.args || "").trim();
  let token = `@${name}`;
  if (args) token += `:${args}`;
  outputs.out = token;
};