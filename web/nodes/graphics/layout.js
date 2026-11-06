(window.RundeerNodes = window.RundeerNodes || {})["layout"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const dims = (Array.isArray(inputs.dims) ? inputs.dims : []).map((d) => helpers._coerceVector2Value(d, [0, 0]));
  if (!dims.length) throw new Error("layout: wire at least one Dims input");
  const size = helpers._coerceVector2Value(props.size, [1080, 1350]);
  const r = await helpers.graphFetchJSON("/api/graphics/layout", {
    method: "POST",
    body: JSON.stringify({ dims, size, preset: props.preset || "random", margin: Number(props.margin ?? 60), row_gap: Number(props.row_gap ?? 12), col_gap: Number(props.col_gap ?? 14) }),
  }, helpers.opts);
  if (r.error) throw new Error(`layout: ${r.error}`);
  outputs.positions = r.positions;
  outputs.scales = r.scales;
  outputs.preset = r.preset;
  helpers.appendRunLog(`  ↳ Layout ${r.preset} · ${dims.length} blocks\n`);
} };
