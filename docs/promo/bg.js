import { W, H, clamp, lerp, inv, E, rng } from './lib.js';
import { S, EV } from './timeline.js';

const CS = 4, BW = W / CS, BH = H / CS, NU = 2400, NV = 96, TA = 0.36, D = 9, NB = 6;
const TP = Math.PI * 2;
let P, N, U, zb, sh, su, bl, bn, B8, dots;

const nz = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const kn = f => { const r = 2 + Math.cos(3 * f); return [r * Math.cos(2 * f), r * Math.sin(2 * f), -1.15 * Math.sin(3 * f)]; };

const bay = () => {
  let m = [[0]];
  while (m.length < 8) {
    const n = m.length, o = [];
    for (let y = 0; y < 2 * n; y++) {
      o[y] = [];
      for (let x = 0; x < 2 * n; x++) o[y][x] = 4 * m[y % n][x % n] + [[0, 2], [3, 1]][y / n | 0][x / n | 0];
    }
    m = o;
  }
  return Float32Array.from(m.flat(), v => (v + 0.5) / 64);
};

const geo = () => {
  const n = NU * NV;
  P = new Float32Array(n * 3); N = new Float32Array(n * 3); U = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < NU; i++) {
    const f = i / NU * TP, c = kn(f), a = kn(f + 1e-3), b = kn(f - 1e-3);
    const t = nz([a[0] - b[0], a[1] - b[1], a[2] - b[2]]), bn = nz(cr(t, c)), nn = cr(bn, t);
    for (let v = 0; v < NV; v++) {
      const g = (v + (i & 1) * 0.5) / NV * TP, cg = Math.cos(g), sg = Math.sin(g);
      for (let d = 0; d < 3; d++) {
        const q = nn[d] * cg + bn[d] * sg;
        N[j * 3 + d] = q; P[j * 3 + d] = c[d] + TA * q;
      }
      U[j++] = i / NU;
    }
  }
};

const bump = (t, a, r, d) => t < a ? 0 : t < a + r ? E.ioQ((t - a) / r) : Math.exp(-(t - a - r) / d);

const pres = t => {
  let k = 1;
  k = lerp(k, 0.42, E.ioQ(inv(EV.uiIn, S.build[0] + 0.6, t)));
  k += 0.3 * bump(t, EV.resume - 0.15, 0.35, 1.6);
  k = lerp(k, 0.78, E.ioQ(inv(S.reveal[0] - 0.2, S.reveal[0] + 0.8, t)));
  k = lerp(k, 1, E.ioQ(inv(S.end[0] - 0.3, S.end[0] + 0.7, t)));
  return k * E.outQ(inv(0, 0.8, t));
};

const rot = t => {
  const kick = 0.75 * E.ioQ(inv(EV.resume, EV.resume + 3.2, t)) + 0.35 * E.ioQ(inv(S.reveal[0], S.reveal[1], t));
  const a = 0.52 + 0.1 * Math.sin(t * 0.13), b = t * 0.085 + kick, c = -0.38 + t * 0.021;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb], rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca], rz = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  const mm = (p, q) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = p[i * 3] * q[j] + p[i * 3 + 1] * q[3 + j] + p[i * 3 + 2] * q[6 + j]; return o; };
  return mm(rz, mm(rx, ry));
};

const cam = t => {
  const u = t / 30;
  return { x: lerp(1480, 1400, E.ioQ(u)), y: lerp(286, 330, u) - 18 * E.ioQ(inv(S.end[0], S.end[1], t)), s: lerp(158, 172, u) };
};

const form = (ctx, glow, t, pr) => {
  const m = rot(t), c = cam(t), F = c.s * D;
  const L = nz([-0.55, -0.72, -0.42]), Hh = nz([L[0], L[1], L[2] - 1]);
  zb.fill(1e9);
  const n = NU * NV;
  for (let j = 0; j < n; j++) {
    const i3 = j * 3, nx = N[i3], ny = N[i3 + 1], nzv = N[i3 + 2];
    const rz = m[6] * nx + m[7] * ny + m[8] * nzv;
    if (rz > 0.08) continue;
    const x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
    const qz = m[6] * x + m[7] * y + m[8] * z + D, s = F / qz;
    const ix = (c.x + (m[0] * x + m[1] * y + m[2] * z) * s) / CS | 0, iy = (c.y + (m[3] * x + m[4] * y + m[5] * z) * s) / CS | 0;
    if (ix < 0 || iy < 0 || ix >= BW || iy >= BH) continue;
    const k = iy * BW + ix;
    if (qz >= zb[k]) continue;
    zb[k] = qz;
    const rx = m[0] * nx + m[1] * ny + m[2] * nzv, ry = m[3] * nx + m[4] * ny + m[5] * nzv;
    const lam = Math.max(0, rx * L[0] + ry * L[1] + rz * L[2]);
    const nv = clamp(-rz), rim = Math.pow(1 - nv, 3);
    const sp = Math.pow(Math.max(0, rx * Hh[0] + ry * Hh[1] + rz * Hh[2]), 28);
    const fog = clamp(1.25 - (qz - D) * 0.22, 0.35, 1);
    sh[k] = (0.16 * lam + 0.62 * rim * (0.35 + 0.65 * lam) + 0.95 * sp) * fog;
    su[k] = U[j];
  }
  bn.fill(0);
  const dens = 0.55 + 0.45 * pr;
  for (let iy = 0; iy < BH; iy++) {
    const by = (iy & 7) * 8;
    for (let ix = 0; ix < BW; ix++) {
      const k = iy * BW + ix;
      if (zb[k] > 1e8) continue;
      const v = sh[k] * dens;
      if (v <= B8[by + (ix & 7)]) continue;
      const q = Math.min(NB - 1, v * 1.1 * NB | 0) * 2 + (Math.sin(su[k] * TP * 2) > 0 ? 1 : 0);
      bl[q][bn[q]++] = k;
      if (v > 0.74) { const g = 2 * NB + Math.min(2, (v - 0.74) * 10 | 0); bl[g][bn[g]++] = k; }
    }
  }
  for (let q = 0; q < 2 * NB + 3; q++) {
    if (!bn[q]) continue;
    const gl = q >= 2 * NB, x = gl ? glow : ctx, f = (q >> 1) / NB, a = bl[q];
    if (gl) { x.fillStyle = '#fff'; x.globalAlpha = 0.045 * (q - 2 * NB + 1) * pr; }
    else {
      const br = lerp(120, 245, f + 0.5 / NB), tn = 0.13 * (1 - f), w = q & 1;
      x.fillStyle = `rgb(${lerp(br, w ? 255 : 107, tn) | 0},${lerp(br, w ? 96 : 80, tn) | 0},${lerp(br, 255, tn) | 0})`;
      x.globalAlpha = 0.3 * pr;
    }
    for (let i = 0, e = bn[q]; i < e; i++) { const k = a[i]; x.fillRect((k % BW) * CS, (k / BW | 0) * CS, CS, CS); }
  }
  ctx.globalAlpha = 1; glow.globalAlpha = 1;
  rings(ctx, glow, t, pr, m, c, F);
};

const rings = (ctx, glow, t, pr, m, c, F) => {
  const pj = (x, y, z) => {
    const qz = m[6] * x + m[7] * y + m[8] * z + D, s = F / qz;
    return [c.x + (m[0] * x + m[1] * y + m[2] * z) * s, c.y + (m[3] * x + m[4] * y + m[5] * z) * s, qz];
  };
  const def = [[4.05, 0.0, 0.22], [4.55, 1.05, -0.5]];
  ctx.lineWidth = 0.6;
  def.forEach(([r, ph, tl], ri) => {
    const ct = Math.cos(tl), st = Math.sin(tl), cp = Math.cos(ph), sp = Math.sin(ph);
    const at = g => { const x = r * Math.cos(g), y0 = r * Math.sin(g); const y = y0 * ct, z = y0 * st; return pj(x * cp - y * sp, x * sp + y * cp, z); };
    const al = (ri ? 0.1 : 0.14) * pr;
    ctx.strokeStyle = `rgba(210,210,220,${al})`;
    ctx.beginPath();
    for (let i = 0; i <= 360; i++) { const p = at(i / 360 * TP); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
    ctx.stroke();
    ctx.strokeStyle = `rgba(210,210,220,${al * 1.2})`;
    ctx.beginPath();
    for (let i = 0; i < 72; i++) {
      const g = i / 72 * TP, a = at(g), l = i % 6 ? 0.06 : 0.17;
      const x = (r + l) * Math.cos(g), y0 = (r + l) * Math.sin(g), y = y0 * ct, z = y0 * st;
      const b = pj(x * cp - y * sp, x * sp + y * cp, z);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    const g = (ri ? -1 : 1) * t * (ri ? 0.11 : 0.16) + ph * 2, p = at(g), q = clamp(1.3 - (p[2] - D) * 0.25, 0.3, 1);
    ctx.fillStyle = `rgba(255,255,255,${0.75 * pr * q})`;
    ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
    glow.fillStyle = `rgba(255,255,255,${0.8 * pr * q})`;
    glow.fillRect(p[0] - 2, p[1] - 2, 4, 4);
  });
};

const field = (ctx, t, pr) => {
  const ox = lerp(-140, 140, t / 30) + 40 * E.ioQ(inv(EV.resume, EV.resume + 3, t)), oy = lerp(40, -40, t / 30);
  ctx.fillStyle = '#dcdce4';
  for (const d of dots) {
    const x = ((d.x - ox / d.z) % W + W) % W, y = ((d.y - oy / d.z) % H + H) % H;
    ctx.globalAlpha = d.a * pr;
    ctx.fillRect(Math.round(x * 2) / 2, Math.round(y * 2) / 2, d.s, d.s);
  }
  ctx.globalAlpha = 1;
};

const stage = (ctx, t, pr) => {
  const g = ctx.createRadialGradient(960, 360, 0, 960, 360, 1250);
  [[0, 0.06], [0.2, 0.05], [0.42, 0.032], [0.66, 0.014], [0.86, 0.004], [1, 0]].forEach(([o, a]) => g.addColorStop(o, `rgba(225,226,235,${a * (0.6 + 0.4 * pr)})`));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const hy = 812, a = 0.07 * pr;
  for (const [x0, x1, f] of [[72, 780, 1], [1140, 1848, -1]]) {
    const lg = ctx.createLinearGradient(x0, 0, x1, 0);
    lg.addColorStop(0, `rgba(220,220,230,0)`); lg.addColorStop(f > 0 ? 0.35 : 0.65, `rgba(220,220,230,${a})`); lg.addColorStop(1, `rgba(220,220,230,0)`);
    ctx.fillStyle = lg;
    ctx.fillRect(x0, hy, x1 - x0, 0.6);
    for (let x = x0 + 24; x < x1; x += 48) ctx.fillRect(x, hy + 3, 0.6, (x - x0) % 240 < 48 ? 5 : 2.5);
  }
  ctx.fillStyle = `rgba(220,220,230,${0.1 * pr})`;
  for (const [x, y] of [[96, 96], [W - 96, 96], [96, H - 96], [W - 96, H - 96]]) {
    ctx.fillRect(x - 6, y - 0.3, 12, 0.6); ctx.fillRect(x - 0.3, y - 6, 0.6, 12);
  }
};

export default {
  name: 'bg',
  async init(env) {
    B8 = bay(); geo();
    zb = new Float32Array(BW * BH); sh = new Float32Array(BW * BH); su = new Float32Array(BW * BH);
    bl = Array.from({ length: 2 * NB + 3 }, () => new Int32Array(BW * BH)); bn = new Int32Array(2 * NB + 3);
    const r = rng(7331);
    dots = Array.from({ length: 280 }, () => {
      const z = 1 + r() * 3.2;
      return { x: r() * W, y: r() * H, z, s: z < 1.6 ? 1.5 : 1, a: (0.05 + 0.2 * r()) / z * 1.6 };
    });
  },
  draw(ctx, glow, t, env) {
    const pr = pres(t);
    stage(ctx, t, pr);
    field(ctx, t, pr);
    form(ctx, glow, t, pr);
  },
};
