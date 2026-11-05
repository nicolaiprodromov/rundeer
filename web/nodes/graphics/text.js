(window.RundeerNodes = window.RundeerNodes || {})["text-image"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const ks = ["text", "font", "bold_font", "size", "color", "shape", "bg", "stroke", "stroke_color", "pad_x", "pad_y", "tracking", "split", "gap"];
  const body = {};
  for (const k of ks) {
    const v = inputs[k];
    body[k] = v !== undefined && v !== "" && v !== null ? v : props[k];
  }
  const r = await helpers.graphFetchJSON("/api/graphics/text", {
    method: "POST",
    body: JSON.stringify(body),
  }, helpers.opts);
  if (r.error) throw new Error(`text: ${r.error}`);
  node._uvImage = r.image || r.path;
  outputs.out = r.path;
  outputs.dims = [r.width, r.height, 0];
  helpers.appendRunLog(`  ↳ Text "${String(body.text ?? "").slice(0, 40)}" ${r.width}×${r.height}\n`);
} };
