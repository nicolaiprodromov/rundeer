(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["canvas"] = async function (node, inputs, outputs, props, helpers) {
  const images = helpers._mediaPathList(inputs.images);
  if (images.length === 0) { outputs.out = ""; return; }
  const rawPositions = Array.isArray(inputs.positions) ? inputs.positions : (inputs.positions ? [inputs.positions] : []);
  const positions = images.map((_, i) => {
    const raw = rawPositions[i];
    const bad = helpers._vectorSocketUnparseableSource(raw);
    if (bad) helpers.appendRunLog(`  ↳ ⚠ Canvas position[${i}] received "${bad}" (not a vector) — using [0,0]\n`);
    return helpers._coerceVector2Value(bad ? "" : raw, [0, 0]);
  });
  const sizeWired = inputs.size;
  const sizeBad = helpers._vectorSocketUnparseableSource(sizeWired);
  if (sizeBad) helpers.appendRunLog(`  ↳ ⚠ Canvas size socket received "${sizeBad}" (not a vector) — using default\n`);
  const size = helpers._coerceVector2Value(sizeBad ? "" : props.size, [1024, 1024]);
  const sizeTag = (sizeWired !== undefined && sizeWired !== "" && sizeWired !== null && !sizeBad) ? " [wired]" : "";
  const wiredPosCount = rawPositions.filter((p) => p !== undefined && p !== "" && p !== null).length;
  const posSummary = wiredPosCount > 0 ? ` (${wiredPosCount}/${images.length} positions wired)` : "";
  helpers.appendRunLog(`  ↳ Canvas ${images.length} image${images.length === 1 ? "" : "s"} ${Math.round(size[0])}×${Math.round(size[1])}${sizeTag}${posSummary}\n`);
  const result = await helpers.graphFetchJSON("/api/media/canvas", {
    method: "POST",
    body: JSON.stringify({ images, positions, size }),
  }, helpers.opts);
  if (result.error) throw new Error(`canvas: ${result.error}`);
  outputs.out = result.path;
};