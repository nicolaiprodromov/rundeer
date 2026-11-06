(window.RundeerNodes = window.RundeerNodes || {})["wave"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const g = (k, d) => { const v = Number(props[k]); return Number.isFinite(v) ? v : d; };
  const n = g("n", 24) || 1;
  let x = (g("cycles", 1) * g("t", 0)) / n + g("shift", 0);
  x -= Math.floor(x);
  const fs = {
    sine: () => Math.sin(2 * Math.PI * x),
    cosine: () => Math.cos(2 * Math.PI * x),
    triangle: () => 1 - 4 * Math.abs(x - 0.5),
    saw: () => 2 * x - 1,
    square: () => (x < 0.5 ? 1 : -1),
  };
  const r = g("offset", 0) + g("amp", 1) * (fs[props.shape] || fs.sine)();
  outputs.out = r;
  helpers.appendRunLog(`  ↳ Wave(${props.shape || "sine"}) → ${r.toFixed(4)}\n`);
} };
