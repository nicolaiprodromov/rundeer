const _EXP_VID = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const _expExt = (p) => { const m = String(p).match(/(\.[a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ""; };

function _expImgBundle(nodeId, ctx) {
  const e = ctx.activeIncomingEdges(nodeId, "in")[0];
  if (!e) return false;
  const t = ctx.outputSocketDef(e.fromNode, e.fromSocket)?.type || "any";
  if (t === "image-bundle") return true;
  return ctx.outputProducesBundle(e.fromNode, e.fromSocket) && ctx.baseType(t) === "image";
}

(window.RundeerNodes = window.RundeerNodes || {})["export"] = {
  resolve: async function (node, inputs, outputs, props, helpers) {
    const name = String(inputs.name ?? props.name ?? "").trim();
    if (!name) throw new Error("export: name (with extension) required");
    const fps = Math.max(0, Number(props.fps ?? 0));
    const fmt = String(props.fmt || "mp4");
    const crf = Number(props.crf ?? 18);
    const loop = Number(props.loop ?? 0);

    const v = inputs.in;
    const edge = helpers.activeIncomingEdges(helpers.nodeId, "in")[0];
    const upT = edge ? helpers.baseType(helpers.outputSocketDef(edge.fromNode, edge.fromSocket)?.type || "any") : "any";

    if (Array.isArray(v)) {
      const items = v.filter((x) => x != null && x !== "").map((x) => String(x));
      if (!items.length) { outputs.out = ""; return; }
      const itemType = (upT === "video" || _EXP_VID.has(_expExt(items[0]))) ? "video" : "image";
      if (itemType === "image" && fps > 0) {
        helpers.appendRunLog(`  ↳ Assembling ${items.length} frames → ${name} (${fmt}, ${fps}fps)…\n`);
        const r = await helpers.graphFetchJSON("/api/export", {
          method: "POST",
          body: JSON.stringify({ mode: "sequence", paths: items, name, fps, fmt, crf, loop }),
        }, helpers.opts);
        if (r.error) throw new Error(`export: ${r.error}`);
        helpers.appendRunLog(`  ↳ → ${r.path}\n`);
        outputs.out = r.path;
      } else {
        helpers.appendRunLog(`  ↳ Exporting bundle (${items.length} ${itemType}${items.length === 1 ? "" : "s"})…\n`);
        const r = await helpers.graphFetchJSON("/api/export", {
          method: "POST",
          body: JSON.stringify({ mode: "files", paths: items, name, asType: itemType, crf }),
        }, helpers.opts);
        if (r.error) throw new Error(`export: ${r.error}`);
        helpers.appendRunLog(`  ↳ → ${r.count} file${r.count === 1 ? "" : "s"}\n`);
        outputs.out = r.paths;
      }
      return;
    }

    const str = v == null ? "" : String(v);
    const looksPath = /\.[A-Za-z0-9]{1,6}$/.test(str) && !str.includes("\n") && str.length < 512;
    const isText = upT === "text" || upT === "number" || upT === "boolean" || (!looksPath && upT === "any");
    if (isText) {
      helpers.appendRunLog(`  ↳ Exporting text → ${name}…\n`);
      const r = await helpers.graphFetchJSON("/api/export", {
        method: "POST",
        body: JSON.stringify({ mode: "text", text: str, name }),
      }, helpers.opts);
      if (r.error) throw new Error(`export: ${r.error}`);
      helpers.appendRunLog(`  ↳ → ${r.path} (${helpers.formatBytes(r.bytes)})\n`);
      outputs.out = r.path;
    } else {
      const media = (upT === "video" || _EXP_VID.has(_expExt(str))) ? "video" : "image";
      helpers.appendRunLog(`  ↳ Exporting ${media} → ${name}…\n`);
      const r = await helpers.graphFetchJSON("/api/export", {
        method: "POST",
        body: JSON.stringify({ mode: "file", path: str, name, asType: media, crf }),
      }, helpers.opts);
      if (r.error) throw new Error(`export: ${r.error}`);
      helpers.appendRunLog(`  ↳ → ${r.path}\n`);
      outputs.out = r.path;
    }
  },

  isInputVisible(node, sock, ctx) {
    if (sock.id === "fps" || sock.id === "fmt" || sock.id === "crf" || sock.id === "loop") {
      return _expImgBundle(node.id, ctx);
    }
    return true;
  },
};
