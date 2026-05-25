(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["mapping"] = async function (node, inputs, outputs, props, helpers) {
  const uv = inputs.uv;
  if (!uv) throw new Error("mapping: UV input required");
  const payload = {
    uv: { path: String(uv) },
    location_x: Number(props.location_x ?? 0),
    location_y: Number(props.location_y ?? 0),
    rotation: Number(props.rotation ?? 0),
    scale_x: Number(props.scale_x ?? 1),
    scale_y: Number(props.scale_y ?? 1),
    pivot_x: Number(props.pivot_x ?? 0.5),
    pivot_y: Number(props.pivot_y ?? 0.5),
  };
  helpers.appendRunLog(`  ↳ Mapping rot=${payload.rotation}° scale=(${payload.scale_x},${payload.scale_y})\n`);
  const result = await helpers.graphFetchJSON("/api/uv/mapping", {
    method: "POST",
    body: JSON.stringify(payload),
  }, helpers.opts);
  if (result.error) throw new Error(`mapping: ${result.error}`);
  outputs.out = result.path;
  node._uvImage = result.image || result.preview || "";
};