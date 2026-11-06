(window.RundeerNodes = window.RundeerNodes || {})["barcode"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const body = {};
  for (const k of ["text", "bar", "height", "quiet", "color", "bg", "dark_bars"]) body[k] = props[k];
  const r = await helpers.graphFetchJSON("/api/graphics/barcode", { method: "POST", body: JSON.stringify(body) }, helpers.opts);
  if (r.error) throw new Error(`barcode: ${r.error}`);
  node._uvImage = r.image || r.path;
  outputs.out = r.path;
  outputs.dims = [r.width, r.height, 0];
  helpers.appendRunLog(`  ↳ Barcode "${String(body.text ?? "").slice(0, 32)}" ${r.width}×${r.height}\n`);
} };
