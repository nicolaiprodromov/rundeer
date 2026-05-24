(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["resize-media"] = async function (node, inputs, outputs, props, helpers) {
  const sizeWired = inputs.size;
  const modeWired = inputs.mode;
  const sizeBad = helpers._vectorSocketUnparseableSource(sizeWired);
  if (sizeBad) helpers.appendRunLog(`  ↳ ⚠ Resize size socket received "${sizeBad}" (not a vector) — using default\n`);
  const size = helpers._coerceVector2Value(sizeBad ? "" : props.size, [1024, 1024]);
  const mode = String(props.mode || "contain").trim().toLowerCase();
  const sizeTag = (sizeWired !== undefined && sizeWired !== "" && sizeWired !== null && !sizeBad) ? " [wired]" : "";
  const modeTag = (modeWired !== undefined && modeWired !== "" && modeWired !== null) ? " [wired]" : "";
  const resizeOne = async (path) => {
    const p = String(path || "").trim();
    if (!p) return "";
    helpers.appendRunLog(`  ↳ Resizing ${p} ${Math.round(size[0])}×${Math.round(size[1])}${sizeTag} (${mode}${modeTag})\n`);
    const result = await helpers.graphFetchJSON("/api/media/resize", {
      method: "POST",
      body: JSON.stringify({ path: p, size, mode }),
    }, helpers.opts);
    if (result.error) throw new Error(`resize: ${result.error}`);
    helpers.appendRunLog(`  ↳ → ${result.path}\n`);
    return result.path;
  };
  const v = inputs.in;
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) {
      const resized = await resizeOne(item);
      if (resized) out.push(resized);
    }
    outputs.out = out;
    return;
  }
  outputs.out = await resizeOne(v);
};