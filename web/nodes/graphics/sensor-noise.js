(window.RundeerNodes = window.RundeerNodes || {})["sensor-noise"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const has = (v) => v !== undefined && v !== "" && v !== null;
  const img = has(inputs.image) ? inputs.image : (props.image ?? "");
  const amt = helpers._coerceMixInput(has(inputs.amount) ? inputs.amount : Number(props.amount ?? 0.2), { isFactor: true });
  const grain = Math.max(1, Math.round(Number(props.grain ?? 1)) || 1);
  const mono = props.mono === undefined ? true : Boolean(props.mono);
  const seed = Math.trunc(Number(props.seed ?? 0)) || 0;

  const one = async (v) => {
    if (!has(v)) return "";
    const im = helpers._coerceMixInput(v, {});
    if (!im.isPath) throw new Error("sensor-noise: image input must be an image");
    const r = await helpers.graphFetchJSON("/api/graphics/sensor-noise", {
      method: "POST",
      body: JSON.stringify({ image: im.payload, amount: amt.payload, grain, mono, seed }),
    }, helpers.opts);
    if (r.error) throw new Error(`sensor-noise: ${r.error}`);
    node._uvImage = r.image || r.path;
    return r.path;
  };

  helpers.appendRunLog(`  ↳ Sensor Noise seed=${seed} grain=${grain}\n`);
  if (Array.isArray(img)) {
    const out = [];
    for (const it of img) { const r = await one(it); if (r) out.push(r); }
    outputs.out = out;
    return;
  }
  outputs.out = await one(img);
} };
