(window.RundeerNodes = window.RundeerNodes || {})["pick"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const r = await helpers.graphFetchJSON("/api/pick", {
    method: "POST",
    body: JSON.stringify({ list: props.list ?? "", file: props.file ?? "", count: Number(props.count ?? 1), sep: props.sep ?? ", " }),
  }, helpers.opts);
  if (r.error) throw new Error(`pick: ${r.error}`);
  outputs.out = r.value;
  helpers.appendRunLog(`  ↳ Pick → ${Array.isArray(r.value) ? `${r.value.length} items` : String(r.value).slice(0, 60)}\n`);
} };
