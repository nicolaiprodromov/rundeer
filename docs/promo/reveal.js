import { W, H, lerp, seg, E, loadImg, drawCover, clamp } from './lib.js';
import { HANDOFF, A, dcFrame } from './timeline.js';

const R0 = HANDOFF.rect, R1 = { x: 400, y: 104, w: 1120, h: 840 };
const T0 = HANDOFF.t, TG = T0 + 1.15, TEND = 28.4;
const dc = [], bl = [];
export const thumbs = [];

export const geo = t => {
  const k = seg(t, T0, TG, E.ioX);
  const s = 1 - 0.03 * seg(t, 27.0, 27.45, E.ioQ);
  const c = seg(t, 27.12, 27.5, E.ioX);
  const w = lerp(R0.w, R1.w, k) * s, h = lerp(R0.h, R1.h, k) * s;
  const cx = lerp(R0.x + R0.w / 2, R1.x + R1.w / 2, k), cy = lerp(R0.y + R0.h / 2, R1.y + R1.h / 2, k);
  return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, k, c, vh: h * (1 - c) };
};

const crush = (mk, im) => {
  const c = mk(320, 240), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(im, 0, 0, 320, 240);
  const d = x.getImageData(0, 0, 320, 240), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = (p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722) / 255;
    p[i] = p[i + 1] = p[i + 2] = 255 * Math.pow(clamp((l - 0.56) / 0.44), 1.5);
  }
  x.putImageData(d, 0, 0);
  return c;
};

const thumb = (mk, im) => {
  const a = mk(128, 96), b = mk(32, 24), ax = a.getContext('2d'), bx = b.getContext('2d');
  ax.imageSmoothingQuality = bx.imageSmoothingQuality = 'high';
  ax.drawImage(im, 0, 0, 128, 96);
  bx.drawImage(a, 0, 0, 32, 24);
  return b;
};

const band = (x, x0, x1, y0, y1, p, bw, a, op) => {
  const an = 0.62, dx = Math.cos(an), dy = Math.sin(an);
  const pr = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([u, v]) => u * dx + v * dy);
  const c = lerp(Math.min(...pr) - bw, Math.max(...pr) + bw, p);
  const g = x.createLinearGradient((c - bw) * dx, (c - bw) * dy, (c + bw) * dx, (c + bw) * dy);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.3, `rgba(255,255,255,${a * 0.18})`);
  g.addColorStop(0.5, `rgba(255,255,255,${a})`);
  g.addColorStop(0.7, `rgba(255,255,255,${a * 0.18})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.globalCompositeOperation = op;
  x.fillStyle = g;
  x.fillRect(x0, y0, x1 - x0, y1 - y0);
};

const glare = (x, r, t, m, op) => {
  const p = seg(t, 25.0, 25.9, E.ioQ);
  if (p <= 0 || p >= 1) return;
  const e = Math.sin(Math.PI * p) * m;
  band(x, r.x, r.x + r.w, r.y, r.y + r.h, p, 170, 0.1 * e, op);
  band(x, r.x, r.x + r.w, r.y, r.y + r.h, clamp(p * 1.06 - 0.03), 14, 0.2 * e, op);
};

export default {
  name: 'reveal',
  async init(env) {
    const ds = await Promise.all(Array.from({ length: A.dcN }, (_, i) => loadImg(A.dc(i + 1))));
    const is = await Promise.all(Array.from({ length: A.iterN }, (_, i) => loadImg(A.iter(i + 1))));
    for (const im of ds) { dc.push(im); bl.push(crush(env.mk, im)); }
    for (const im of is) thumbs.push(thumb(env.mk, im));
  },
  draw(ctx, glow, t) {
    if (t < T0 || t >= TEND) return;
    const g = geo(t), n = dcFrame(t) - 1;
    const dk = seg(t, T0, T0 + 1.2, E.ioQ) * (1 - seg(t, 27.0, 27.6, E.ioQ));
    if (dk > 0) {
      ctx.fillStyle = `rgba(0,0,0,${0.55 * dk})`;
      ctx.fillRect(0, 0, W, H);
      const v = ctx.createRadialGradient(g.cx, g.cy, 420, g.cx, g.cy, 1250);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(0,0,0,${0.5 * dk})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    const z = 1 + 0.04 * seg(t, T0, 27.6, E.ioQ);
    const vy = g.cy - g.vh / 2, r = { x: g.x, y: vy, w: g.w, h: g.vh };
    if (g.vh > 0.25) {
      for (const [x, src, a] of [[ctx, dc[n], 1], [glow, bl[n], 0.035 * seg(t, T0, TG, E.ioQ)]]) {
        if (a <= 0) continue;
        x.save();
        if (g.c > 0) { x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip(); }
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = 'high';
        x.globalAlpha = a;
        drawCover(x, src, g.x, g.y, g.w, g.h, z);
        x.restore();
      }
      const tn = 0.13 * seg(t, T0, TG, E.ioQ);
      if (tn > 0) { ctx.fillStyle = `rgba(0,0,0,${tn})`; ctx.fillRect(r.x, r.y, r.w, r.h); }
      for (const [x, m, op] of [[ctx, 1, 'screen'], [glow, 0.35, 'lighter']]) {
        x.save();
        x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip();
        glare(x, r, t, m, op);
        x.restore();
      }
    }
    const la = seg(t, 27.36, 27.5) * (1 - seg(t, 27.5, 27.64, E.inQ));
    if (la > 0) {
      const lw = g.w * (1 - 0.5 * seg(t, 27.5, 27.64, E.inQ)), lx = g.cx - lw / 2;
      ctx.fillStyle = `rgba(255,255,255,${0.9 * la})`;
      ctx.fillRect(lx, g.cy - 0.5, lw, 1);
      glow.fillStyle = `rgba(255,255,255,${0.45 * la})`;
      glow.fillRect(lx, g.cy - 1.5, lw, 3);
    }
  },
};
