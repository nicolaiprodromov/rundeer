(window.RundeerNodes = window.RundeerNodes || {})["folder-bundle"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const folderPath = String(props.path || "").trim();
  if (!folderPath) { outputs.out = []; return; }
  const kind = String(props.kind || "all");
  const recursive = props.recursive ? "1" : "0";
  const params = { path: folderPath, kind, recursive };
  const fps = Number(props.fps);
  if (Number.isFinite(fps) && fps > 0) params.fps = String(fps);
  const modulo = Number(props.modulo);
  if (Number.isFinite(modulo) && modulo > 1) params.modulo = String(Math.round(modulo));
  const start = Number(props.start);
  if (Number.isFinite(start) && start > 0) params.start = String(Math.round(start));
  const end = Number(props.end);
  if (Number.isFinite(end) && end > 0) params.end = String(Math.round(end));
  const fmt = String(props.format || "").trim();
  if (fmt) params.format = fmt;
  const qs = new URLSearchParams(params).toString();
  helpers.appendRunLog(`  ↳ Bundle ${folderPath}…\n`);
  const result = await helpers.graphFetchJSON(`/api/folder-list?${qs}`, {}, helpers.opts);
  if (result.error) throw new Error(`bundle: ${result.error}`);
  const paths = Array.isArray(result.paths) ? result.paths : [];
  const tag = result.source === "frames" ? `frames${result.cached ? ", cached" : ""}` : "files";
  helpers.appendRunLog(`  ↳ → ${paths.length} ${tag}\n`);
  outputs.out = paths;
} };