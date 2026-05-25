(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["coordinate"] = async function (node, inputs, outputs, props, helpers) {
  const w = Math.max(1, Math.round(Number(props.width ?? 1024)));
  const h = Math.max(1, Math.round(Number(props.height ?? 1024)));
  const dpi = Math.max(1, Math.round(Number(props.dpi ?? 72)));
  const space = String(props.space || "uv");
  helpers.appendRunLog(`  ↳ Coord ${w}×${h}${space === "screen" ? " (screen)" : ""}\n`);
  const result = await helpers.graphFetchJSON("/api/uv/coordinate", {
    method: "POST",
    body: JSON.stringify({ width: w, height: h, dpi, space }),
  }, helpers.opts);
  if (result.error) throw new Error(`coordinate: ${result.error}`);
  outputs.uv = result.path;
  node._uvImage = result.image || result.preview || "";
};