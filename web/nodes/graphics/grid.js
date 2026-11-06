(window.RundeerNodes = window.RundeerNodes || {})["grid"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const ds = (Array.isArray(inputs.dims) ? inputs.dims : []).map((d) => helpers._coerceVector2Value(d, [0, 0]));
  if (!ds.length) throw new Error("grid: wire at least one Dims input");
  const nc = Math.round(Number(props.count) || 0);
  while (ds.length < nc) ds.push(ds[ds.length - 1]);
  const [W, H] = helpers._coerceVector2Value(props.size, [1080, 1350]);
  const f = (k, d) => { const v = Number(props[k]); return Number.isFinite(v) ? v : d; };
  const m = f("margin", 60), g = f("gap", 16), t = f("top", 0), b = f("bottom", 0);
  const c = Math.max(1, Math.round(f("cols", 3)));
  const r = Math.max(1, Math.round(f("rows", 0)) || Math.ceil(ds.length / c));
  const cw = (W - 2 * m - g * (c - 1)) / c;
  const ch = (H - 2 * m - t - b - g * (r - 1)) / r;
  const pos = [], scl = [];
  ds.forEach(([w, h], i) => {
    const s = w > 0 && h > 0 ? Math.min(cw / w, ch / h) : 1;
    const x = m + (i % c) * (cw + g) + (cw - w * s) / 2;
    const y = m + t + Math.floor(i / c) * (ch + g) + (ch - h * s) / 2;
    pos.push([Math.round(x), Math.round(H - y - h * s), 0]);
    scl.push([+s.toFixed(4), +s.toFixed(4), 0]);
  });
  outputs.positions = pos;
  outputs.scales = scl;
  outputs.cell = [Math.round(cw), Math.round(ch), 0];
  helpers.appendRunLog(`  ↳ Grid ${c}×${r} · ${ds.length} blocks · cell ${Math.round(cw)}×${Math.round(ch)}\n`);
} };
