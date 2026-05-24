(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["blur-image"] = async function (node, inputs, outputs, props, helpers) {
  const radius = Math.max(0, Number(props.radius ?? 4));
  const blurOne = async (path) => {
    const p = String(path || "").trim();
    if (!p) return "";
    helpers.appendRunLog(`  ↳ Blurring ${p} (r=${radius})…\n`);
    const result = await helpers.graphFetchJSON("/api/blur-image", {
      method: "POST",
      body: JSON.stringify({ path: p, radius }),
    }, helpers.opts);
    if (result.error) throw new Error(`blur: ${result.error}`);
    helpers.appendRunLog(`  ↳ → ${result.path}\n`);
    return result.path;
  };
  const v = inputs.in;
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) {
      const blurred = await blurOne(item);
      if (blurred) out.push(blurred);
    }
    outputs.out = out;
    return;
  }
  outputs.out = await blurOne(v);
};