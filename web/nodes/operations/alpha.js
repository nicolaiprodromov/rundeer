(window.RundeerNodes = window.RundeerNodes || {})["alpha"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const mode = String(props.mode || "replace");
  const imgRaw = inputs.image !== undefined && inputs.image !== "" && inputs.image !== null
    ? inputs.image : (props.image ?? "");
  const aRaw = inputs.alpha !== undefined && inputs.alpha !== "" && inputs.alpha !== null
    ? inputs.alpha : Number(props.alpha ?? 1);

  const processOne = async (img) => {
    const image = helpers._coerceMixInput(img, {});
    const a = helpers._coerceMixInput(aRaw, { isFactor: true });
    if (!image.isPath && !a.isPath) {
      const col = image.color || [Number(image.scalar) || 0, Number(image.scalar) || 0, Number(image.scalar) || 0, 1];
      const av = Number(a.scalar ?? a.color?.[0] ?? 1);
      const out = col.slice(0, 4);
      while (out.length < 4) out.push(1);
      out[3] = mode === "multiply" ? out[3] * av : av;
      return helpers._rgbaToHex(out);
    }
    const result = await helpers.graphFetchJSON("/api/uv/alpha", {
      method: "POST",
      body: JSON.stringify({ image: image.payload, alpha: a.payload, mode }),
    }, helpers.opts);
    if (result.error) throw new Error(`alpha: ${result.error}`);
    if (result.path) { node._uvImage = result.image || result.path; return result.path; }
    if (result.color) return helpers._rgbaToHex(result.color);
    return "";
  };

  helpers.appendRunLog(`  ↳ Alpha ${mode}\n`);
  const v = imgRaw;
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) { const r = await processOne(item); if (r) out.push(r); }
    outputs.out = out;
    return;
  }
  outputs.out = await processOne(v);
} };
