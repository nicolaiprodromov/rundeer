(window.RundeerNodes = window.RundeerNodes || {})["canvas"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const images = helpers._mediaPathList(inputs.images);
  if (images.length === 0) { outputs.out = ""; return; }
  const rawPositions = Array.isArray(inputs.positions) ? inputs.positions : (inputs.positions ? [inputs.positions] : []);
  const positions = images.map((_, i) => {
    const raw = rawPositions[i];
    const bad = helpers._vectorSocketUnparseableSource(raw);
    if (bad) helpers.appendRunLog(`  ↳ ⚠ Canvas position[${i}] received "${bad}" (not a vector) — using [0,0]\n`);
    return helpers._coerceVector2Value(bad ? "" : raw, [0, 0]);
  });
  const rawScales = Array.isArray(inputs.scales) ? inputs.scales : (inputs.scales ? [inputs.scales] : []);
  const scales = images.map((_, i) => {
    const raw = rawScales[i];
    const bad = helpers._vectorSocketUnparseableSource(raw);
    if (bad) helpers.appendRunLog(`  ↳ ⚠ Canvas scale[${i}] received "${bad}" (not a vector) — using [1,1]\n`);
    return helpers._coerceVector2Value(bad ? "" : raw, [1, 1]);
  });
  const rawRotations = Array.isArray(inputs.rotations) ? inputs.rotations : (inputs.rotations ? [inputs.rotations] : []);
  const rotations = images.map((_, i) => {
    const n = Number(rawRotations[i]);
    return Number.isFinite(n) ? n : 0;
  });
  const sizeWired = inputs.size;
  const sizeBad = helpers._vectorSocketUnparseableSource(sizeWired);
  if (sizeBad) helpers.appendRunLog(`  ↳ ⚠ Canvas size socket received "${sizeBad}" (not a vector) — using default\n`);
  const size = helpers._coerceVector2Value(sizeBad ? "" : props.size, [1024, 1024]);
  const sizeTag = (sizeWired !== undefined && sizeWired !== "" && sizeWired !== null && !sizeBad) ? " [wired]" : "";
  const wiredCount = (arr) => arr.filter((p) => p !== undefined && p !== "" && p !== null).length;
  const parts = [];
  const wiredPosCount = wiredCount(rawPositions);
  if (wiredPosCount > 0) parts.push(`${wiredPosCount}/${images.length} positions`);
  const wiredScaleCount = wiredCount(rawScales);
  if (wiredScaleCount > 0) parts.push(`${wiredScaleCount}/${images.length} scales`);
  const wiredRotCount = wiredCount(rawRotations);
  if (wiredRotCount > 0) parts.push(`${wiredRotCount}/${images.length} rotations`);
  const xformSummary = parts.length > 0 ? ` (${parts.join(", ")} wired)` : "";
  helpers.appendRunLog(`  ↳ Canvas ${images.length} image${images.length === 1 ? "" : "s"} ${Math.round(size[0])}×${Math.round(size[1])}${sizeTag}${xformSummary}\n`);
  const result = await helpers.graphFetchJSON("/api/media/canvas", {
    method: "POST",
    body: JSON.stringify({ images, positions, scales, rotations, size }),
  }, helpers.opts);
  if (result.error) throw new Error(`canvas: ${result.error}`);
  outputs.out = result.path;
} };