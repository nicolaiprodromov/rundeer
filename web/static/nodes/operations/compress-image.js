(window.RundeerNodeResolvers = window.RundeerNodeResolvers || {})["compress-image"] = async function (node, inputs, outputs, props, helpers) {
  const v = inputs.in;
  if (Array.isArray(v)) {
    const items = v.filter((x) => x != null && x !== "").map((x) => String(x));
    if (items.length === 0) { outputs.out = ""; return; }
    helpers.appendRunLog(`  ↳ Zipping bundle (${items.length} item${items.length === 1 ? "" : "s"})…\n`);
    const result = await helpers.graphFetchJSON("/api/compress", {
      method: "POST",
      body: JSON.stringify({ kind: "bundle", paths: items }),
    }, helpers.opts);
    if (result.error) throw new Error(`compress: ${result.error}`);
    helpers.appendRunLog(`  ↳ → ${result.path} (${helpers.formatBytes(result.bytes)})\n`);
    outputs.out = result.path;
    return;
  }
  const str = (v == null) ? "" : String(v);
  if (!str) { outputs.out = ""; return; }
  const looksLikePath =
    /\.[A-Za-z0-9]{1,6}$/.test(str) &&
    !str.includes("\n") &&
    str.length < 512;
  const inEdge = helpers.activeIncomingEdges(helpers.nodeId, "in")[0];
  const inSockType = inEdge ? helpers.baseType(helpers.outputSocketDef(inEdge.fromNode, inEdge.fromSocket)?.type || "any") : "any";
  const isText = inSockType === "text" || (!looksLikePath && inSockType === "any");
  if (isText) {
    const instructions = inputs.instructions || helpers.COMPRESS_HELPER_PROMPT;
    helpers.appendRunLog(`  ↳ Compressing text via LLM…\n`);
    const result = await helpers.graphFetchJSON("/api/filter-prompt", {
      method: "POST",
      body: JSON.stringify({
        prompt: str,
        instructions,
        images: [],
      }),
    }, helpers.opts);
    if (result.error) throw new Error(`compress(text): ${result.error}`);
    outputs.out = result.filtered_prompt || str;
    helpers.appendRunLog(`  ↳ → ${(outputs.out || "").length} chars (was ${str.length})\n`);
    return;
  }
  helpers.appendRunLog(`  ↳ Compressing ${str} (q=${props.quality})…\n`);
  const result = await helpers.graphFetchJSON("/api/compress", {
    method: "POST",
    body: JSON.stringify({
      kind: "auto",
      path: str,
      quality: Number(props.quality ?? 75),
      max_dimension: Number(props.max_dimension ?? 0),
    }),
  }, helpers.opts);
  if (result.error) throw new Error(`compress: ${result.error}`);
  const ratio = result.originalBytes ? Math.round((result.bytes / result.originalBytes) * 100) : 0;
  helpers.appendRunLog(`  ↳ → ${result.path} (${helpers.formatBytes(result.bytes)}, ${ratio}% of original)\n`);
  outputs.out = result.path;
};