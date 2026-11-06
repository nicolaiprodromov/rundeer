import { F, clamp, lerp } from './lib.js';

export const V = { ox: 0, oy: 0, z: 1, ss: 2 };
export const setV = (ox, oy, z) => { V.ox = ox; V.oy = oy; V.z = z; };
export const sn = v => Math.round(v * V.ss) / V.ss;
export const X = x => V.ox + x * V.z;
export const Y = y => V.oy + y * V.z;

const _rgb = new Map();
let _cx = null;
export const toRgb = col => {
  if (_rgb.has(col)) return _rgb.get(col);
  if (!_cx) { const c = document.createElement('canvas'); c.width = c.height = 1; _cx = c.getContext('2d', { willReadFrequently: true }); }
  _cx.clearRect(0, 0, 1, 1);
  _cx.fillStyle = col;
  _cx.fillRect(0, 0, 1, 1);
  const d = _cx.getImageData(0, 0, 1, 1).data, r = [d[0], d[1], d[2]];
  _rgb.set(col, r);
  return r;
};
export const ca = (col, a = 1) => { const [r, g, b] = toRgb(col); return `rgba(${r},${g},${b},${a})`; };
export const wa = (v, a = 1) => `rgba(${v},${v},${v},${a})`;

export const sr = (x, y, w, h) => {
  const a = sn(X(x)), b = sn(Y(y)), r = sn(X(x + w)), d = sn(Y(y + h));
  return [a, b, r - a, d - b];
};

export const rect = (c, x, y, w, h, col) => {
  const [a, b, rw, rh] = sr(x, y, w, h);
  c.fillStyle = col;
  c.fillRect(a, b, rw, rh);
};

export const box = (c, x, y, w, h, col, lw = 1) => {
  const [a, b, rw, rh] = sr(x, y, w, h);
  c.fillStyle = col;
  c.fillRect(a, b, rw, lw);
  c.fillRect(a, b + rh - lw, rw, lw);
  c.fillRect(a, b + lw, lw, rh - 2 * lw);
  c.fillRect(a + rw - lw, b + lw, lw, rh - 2 * lw);
};

export const fnt = (c, px, w = 400, f = F.mono, ls = 0) => {
  const sz = px * V.z;
  c.font = `${w} ${sz}px ${f}`;
  c.letterSpacing = ls ? `${ls * sz}px` : '0px';
  return sz;
};

export const tw = (c, s, px, w = 400, f = F.mono, ls = 0) => {
  fnt(c, px, w, f, ls);
  return c.measureText(s).width / V.z;
};

export const tx = (c, s, x, y, px, col, o = {}) => {
  const sz = fnt(c, px, o.w || 400, o.f || F.mono, o.ls || 0);
  const ls = (o.ls || 0) * sz, al = o.al || 'left';
  c.textAlign = al;
  c.textBaseline = 'alphabetic';
  c.fillStyle = col;
  let sx = X(x);
  if (al === 'right') sx += ls;
  else if (al === 'center') sx += ls / 2;
  c.fillText(o.up ? s.toUpperCase() : s, sn(sx), sn(Y(y) + sz * (o.dy ?? 0.34)));
};

export const sock = (c, x, y, col, on, o = {}) => {
  const k = o.k || 1, s = 18 * k, h = s / 2;
  if (o.ring) box(c, x - h - 1, y - h - 1, s + 2, s + 2, ca(col, o.ring), 1);
  rect(c, x - h, y - h, s, s, '#030303');
  if (o.dash) {
    const [a, b, rw, rh] = sr(x - h + 2 * k, y - h + 2 * k, s - 4 * k, s - 4 * k);
    c.save();
    c.strokeStyle = col;
    c.lineWidth = 1;
    c.setLineDash([2, 2]);
    c.strokeRect(a + 0.5, b + 0.5, rw - 1, rh - 1);
    c.restore();
    return;
  }
  rect(c, x - h + 2 * k, y - h + 2 * k, s - 4 * k, s - 4 * k, col);
  if (on) rect(c, x - 3 * k, y - 3 * k, 6 * k, 6 * k, 'rgba(250,250,250,0.8)');
};

export const bzG = p => [X(p[0]), Y(p[1]), X(p[2]), Y(p[3]), X(p[4]), Y(p[5]), X(p[6]), Y(p[7])];

export const split = (p, t) => {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const ax = lerp(x0, x1, t), ay = lerp(y0, y1, t), bx = lerp(x1, x2, t), by = lerp(y1, y2, t);
  const cx = lerp(x2, x3, t), cy = lerp(y2, y3, t), dx = lerp(ax, bx, t), dy = lerp(ay, by, t);
  const ex = lerp(bx, cx, t), ey = lerp(by, cy, t), fx = lerp(dx, ex, t), fy = lerp(dy, ey, t);
  return [[x0, y0, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, x3, y3]];
};

export const sub = (p, a, b) => {
  b = clamp(b, 0, 1); a = clamp(a, 0, b);
  if (b <= 0) return null;
  const r = b >= 1 ? p : split(p, b)[0];
  return a <= 0 ? r : split(r, a / b)[1];
};

export const at = (p, t) => {
  const u = 1 - t;
  return [
    u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
    u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7],
  ];
};

export const stroke = (c, p, col, lw, dash) => {
  c.beginPath();
  c.moveTo(p[0], p[1]);
  c.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]);
  c.strokeStyle = col;
  c.lineWidth = lw;
  c.lineCap = 'round';
  c.setLineDash(dash || []);
  c.stroke();
  if (dash) c.setLineDash([]);
};

export const mkLut = p => {
  const n = 64, L = [0];
  let [px, py] = at(p, 0), s = 0;
  for (let i = 1; i <= n; i++) {
    const [x, y] = at(p, i / n);
    s += Math.hypot(x - px, y - py);
    L.push(s);
    px = x; py = y;
  }
  return u => {
    const g = clamp(u) * s;
    let i = 1;
    while (i < n && L[i] < g) i++;
    const f = (g - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
    return (i - 1 + clamp(f)) / n;
  };
};

const ARW = [[0, 0], [0, 16.6], [4.1, 12.7], [6.9, 19.3], [9.7, 18.1], [6.9, 11.7], [12.5, 11.7]];

export const arrow = (c, x, y, s, a) => {
  c.save();
  c.globalAlpha *= a;
  c.translate(x, y);
  c.scale(s, s);
  c.beginPath();
  ARW.forEach(([u, v], i) => (i ? c.lineTo(u, v) : c.moveTo(u, v)));
  c.closePath();
  c.shadowColor = 'rgba(0,0,0,0.55)';
  c.shadowBlur = 5 * V.ss;
  c.shadowOffsetY = 1.5 * V.ss;
  c.fillStyle = '#ffffff';
  c.fill();
  c.shadowColor = 'transparent';
  c.lineJoin = 'miter';
  c.lineWidth = 1.05;
  c.strokeStyle = '#0a0a0a';
  c.stroke();
  c.restore();
};

export const ibeam = (c, x, y, s, a) => {
  c.save();
  c.globalAlpha *= a;
  c.translate(x, y);
  c.scale(s, s);
  c.beginPath();
  c.moveTo(-3.5, -9); c.lineTo(-1.5, -9); c.lineTo(0, -7.8); c.lineTo(1.5, -9); c.lineTo(3.5, -9);
  c.moveTo(0, -7.8); c.lineTo(0, 7.8);
  c.moveTo(-3.5, 9); c.lineTo(-1.5, 9); c.lineTo(0, 7.8); c.lineTo(1.5, 9); c.lineTo(3.5, 9);
  c.lineCap = 'square';
  c.shadowColor = 'rgba(0,0,0,0.5)';
  c.shadowBlur = 4 * V.ss;
  c.shadowOffsetY = 1 * V.ss;
  c.strokeStyle = '#0a0a0a';
  c.lineWidth = 3.2;
  c.stroke();
  c.shadowColor = 'transparent';
  c.strokeStyle = '#ffffff';
  c.lineWidth = 1.3;
  c.stroke();
  c.restore();
};

export const spring = k => {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const m = clamp(k / 0.8), b = Math.sin(Math.PI * clamp((k - 0.66) / 0.34));
  return m * m * m * (10 - 15 * m + 6 * m * m) + 0.03 * b * b;
};
