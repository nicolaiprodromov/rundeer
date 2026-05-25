const _VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const _extOf = (p) => { const m = String(p).match(/(\.[a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ""; };

(window.RundeerNodes = window.RundeerNodes || {})["blur-image"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const radius = Math.max(0, Number(props.radius ?? 4));
  const lite = helpers.opts.lite || helpers.opts.liteCommands;
  const blurOne = async (path) => {
    const p = String(path || "").trim();
    if (!p) return "";
    if (lite && _VIDEO_EXTS.has(_extOf(p))) return p;
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
} };