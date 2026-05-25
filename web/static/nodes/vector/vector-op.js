(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["vector-op"] = async function (node, inputs, outputs, props, helpers) {
  const op = String(props.op || "add");
  const payload = {
    op,
    a: helpers._coerceVectorInput(inputs.a),
    b: helpers._coerceVectorInput(inputs.b),
  };
  helpers.appendRunLog(`  ↳ Vector ${op}\n`);
  const result = await helpers.graphFetchJSON("/api/uv/vector", {
    method: "POST",
    body: JSON.stringify(payload),
  }, helpers.opts);
  if (result.error) throw new Error(`vector: ${result.error}`);
  outputs.out = (result.value != null) ? result.value : result.path;
  node._uvImage = result.image || result.preview || "";
};