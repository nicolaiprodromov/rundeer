(window.RundeerNodes = window.RundeerNodes || {})["uv-render"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const pixel = inputs.pixel;
  const uv = inputs.uv;
  if (!pixel) throw new Error("render: pixel input required");
  if (!uv) throw new Error("render: UV input required");
  const payload = {
    pixel: String(pixel),
    uv: { path: String(uv) },
    interp: String(props.interp || "bilinear"),
    extension: String(props.extension || "clamp"),
  };
  helpers.appendRunLog(`  ↳ Render (${payload.interp}, ${payload.extension})\n`);
  const result = await helpers.graphFetchJSON("/api/uv/render", {
    method: "POST",
    body: JSON.stringify(payload),
  }, helpers.opts);
  if (result.error) throw new Error(`render: ${result.error}`);
  outputs.out = result.path;
} };