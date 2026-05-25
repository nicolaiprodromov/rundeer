(window.RundeerNodes = window.RundeerNodes || {})["crop-media"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const sizeWired = inputs.size;
  const positionWired = inputs.position;
  const sizeBad = helpers._vectorSocketUnparseableSource(sizeWired);
  const positionBad = helpers._vectorSocketUnparseableSource(positionWired);
  if (sizeBad) helpers.appendRunLog(`  ↳ ⚠ Crop size socket received "${sizeBad}" (not a vector) — using default\n`);
  if (positionBad) helpers.appendRunLog(`  ↳ ⚠ Crop position socket received "${positionBad}" (not a vector) — using default\n`);
  const size = helpers._coerceVector2Value(sizeBad ? "" : props.size, [512, 512]);
  const position = helpers._coerceVector2Value(positionBad ? "" : props.position, [0, 0]);
  const sizeTag = (sizeWired !== undefined && sizeWired !== "" && sizeWired !== null && !sizeBad) ? " [wired]" : "";
  const posTag = (positionWired !== undefined && positionWired !== "" && positionWired !== null && !positionBad) ? " [wired]" : "";
  const cropOne = async (path) => {
    const p = String(path || "").trim();
    if (!p) return "";
    helpers.appendRunLog(`  ↳ Cropping ${p} ${Math.round(size[0])}×${Math.round(size[1])}${sizeTag} @ ${Math.round(position[0])},${Math.round(position[1])}${posTag}\n`);
    const result = await helpers.graphFetchJSON("/api/media/crop", {
      method: "POST",
      body: JSON.stringify({ path: p, size, position }),
    }, helpers.opts);
    if (result.error) throw new Error(`crop: ${result.error}`);
    helpers.appendRunLog(`  ↳ → ${result.path}\n`);
    return result.path;
  };
  const v = inputs.in;
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) {
      const cropped = await cropOne(item);
      if (cropped) out.push(cropped);
    }
    outputs.out = out;
    return;
  }
  outputs.out = await cropOne(v);
} };