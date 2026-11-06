const _PAL_OFF = { complementary: [180], analogous: [32, -32], triadic: [120, -120], split: [150, -150], mono: [0] };
const _palRr = (a, b) => a + Math.random() * (b - a);
const _palCl = (v) => Math.max(0, Math.min(1, v));
const _palHsl = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
};
const _palLum = (c) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const _palCr = (a, b) => {
  const x = _palLum(a), y = _palLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const _palHex = (c) => "#" + c.map((v) => Math.round(_palCl(v) * 255).toString(16).padStart(2, "0")).join("");

(window.RundeerNodes = window.RundeerNodes || {})["palette"] = { resolve: async function (node, inputs, outputs, props, helpers) {
  const ks = Object.keys(_PAL_OFF);
  let md = String(props.harmony || "random");
  if (!_PAL_OFF[md]) md = ks[Math.floor(Math.random() * ks.length)];
  const offs = _PAL_OFF[md];
  const h = _palRr(0, 360);
  const h2 = (h + offs[Math.floor(Math.random() * offs.length)] + _palRr(-10, 10) + 360) % 360;
  const lt = Math.random() < Number(props.light ?? 0.3);
  const base = _palHsl(h, _palRr(0.4, 0.85), lt ? _palRr(0.72, 0.88) : _palRr(0.2, 0.42));
  const s2 = md === "mono" ? _palRr(0.5, 0.9) : _palRr(0.3, 0.75);
  let l2 = lt ? _palRr(0.25, 0.5) : _palRr(0.55, 0.8);
  let acc = _palHsl(h2, s2, l2);
  const cmin = Number(props.contrast ?? 2);
  for (let i = 0; i < 50 && _palCr(base, acc) < cmin; i++) {
    l2 = _palCl(l2 + (lt ? -0.02 : 0.02));
    acc = _palHsl(h2, s2, l2);
  }
  const wi = _palHsl(h, 0.3, 0.97), dk = _palHsl(h, 0.4, 0.08);
  const ink = _palCr(base, wi) >= _palCr(base, dk) ? wi : dk;
  outputs.base = _palHex(base);
  outputs.accent = _palHex(acc);
  outputs.ink = _palHex(ink);
  helpers.appendRunLog(`  ↳ Palette ${md}${lt ? " light" : ""} ${outputs.base} ${outputs.accent} ${outputs.ink}\n`);
} };
