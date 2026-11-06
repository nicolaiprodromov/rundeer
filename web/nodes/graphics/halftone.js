(window.RundeerNodes = window.RundeerNodes || {})["halftone"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const v = inputs.image;
  if (v === undefined || v === "" || v === null) throw new Error("halftone: image input is required");
  const im = helpers._coerceMixInput(v, {});
  if (!im.isPath) throw new Error("halftone: image input must be an image");
  const body = { image: im.payload };
  for (const k of ["cell", "angle", "shape", "gain", "gamma", "soft", "invert"]) body[k] = props[k];
  const r = await helpers.graphFetchJSON("/api/graphics/halftone", { method: "POST", body: JSON.stringify(body) }, helpers.opts);
  if (r.error) throw new Error(`halftone: ${r.error}`);
  node._uvImage = r.image || r.path;
  outputs.out = r.path;
  helpers.appendRunLog(`  ↳ Halftone ${body.shape || "dot"} cell=${body.cell} ∠${body.angle}\n`);
} };
