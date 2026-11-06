import { W, H, inv, E } from './lib.js';
import { EV } from './timeline.js';

const L = {}, QW = W / 4, QH = H / 4;

const lv = (env, k, d, cpu = true) => { L[k] = env.mk(Math.round(W / d), Math.round(H / d)).getContext('2d', cpu ? { willReadFrequently: true } : {}); };

const clr = x => {
  x.filter = 'none'; x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#000'; x.fillRect(0, 0, x.canvas.width, x.canvas.height);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'low';
  return x;
};

const put = (k, src, f = 'none') => {
  const x = clr(L[k]);
  x.filter = f;
  x.drawImage(src, 0, 0, x.canvas.width, x.canvas.height);
  x.filter = 'none';
  return x.canvas;
};

const add = (x, c, a) => { if (a > 0.002) { x.globalAlpha = Math.min(1, a); x.drawImage(c, 0, 0, x.canvas.width, x.canvas.height); } };

const pass = (src, dst, st, g) => {
  const x = clr(L[dst]), ws = [];
  for (let i = -2; i <= 2; i++) ws.push(Math.pow(0.84, Math.abs(i) * st));
  const n = g / ws.reduce((p, q) => p + q, 0);
  x.globalCompositeOperation = 'lighter';
  ws.forEach((w, j) => { x.globalAlpha = Math.min(1, w * n); x.drawImage(src, (j - 2) * st, 0); });
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  return x.canvas;
};

const streak = () => {
  pass(L.g4.canvas, 's1', 1, 2.4);
  pass(L.s1.canvas, 's2', 5, 2.2);
  const c = pass(L.s2.canvas, 's1', 25, 1.7), x = L.s1;
  x.globalCompositeOperation = 'multiply'; x.fillStyle = '#c2d2ff'; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  return c;
};

const pulse = (t, e, a = 0.06, d = 0.42) => t < e ? 0 : t < e + a ? E.outQ((t - e) / a) : Math.exp(-(t - e - a) / d);

export default {
  name: 'fx',
  async init(env) {
    lv(env, 'm2', 2, false); lv(env, 'o4', 4, false);
    [['q4', 4], ['b4', 4], ['b8', 8], ['b16', 16], ['b32', 32], ['h4', 4], ['hb8', 8], ['hb16', 16], ['g4', 4], ['s1', 4], ['s2', 4], ['acc', 4], ['bl', 4]].forEach(([k, d]) => lv(env, k, d));
  },
  draw(out, scene, glow, t, env) {
    const fl = 0.55 * pulse(t, EV.runClick) + 0.7 * pulse(t, EV.resume, 0.08, 0.5) + 0.9 * pulse(t, EV.heroIn, 0.1, 0.6);
    const k = 1 + 1.2 * fl;
    out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'low';
    out.globalCompositeOperation = 'source-over'; out.globalAlpha = 1;
    out.drawImage(scene, 0, 0, W, H);
    put('m2', glow);
    put('o4', out.canvas);
    const q = put('q4', L.m2.canvas);
    put('b4', q, 'blur(1px)');
    put('b8', L.b4.canvas, 'blur(1.5px)');
    put('b16', L.b8.canvas, 'blur(2px)');
    put('b32', L.b16.canvas, 'blur(2.5px)');
    put('h4', L.o4.canvas, 'brightness(0.5) contrast(4) brightness(2)');
    put('hb8', L.h4.canvas, 'blur(2px)');
    put('hb16', L.hb8.canvas, 'blur(3px)');
    put('g4', q, 'brightness(0.5) contrast(3) brightness(2)');
    const sc = streak();
    const a = clr(L.acc);
    a.globalCompositeOperation = 'lighter';
    add(a, L.b4.canvas, 0.85 * k);
    add(a, L.b8.canvas, 0.42 * k);
    add(a, L.b16.canvas, 0.3 * k);
    add(a, L.b32.canvas, 0.24 * k);
    add(a, L.hb8.canvas, 0.14 * k);
    add(a, L.hb16.canvas, 0.12 * k);
    const b = put('bl', a.canvas, 'blur(0.6px)'), bx = L.bl;
    bx.globalCompositeOperation = 'lighter';
    add(bx, sc, 0.4 * k);
    out.globalCompositeOperation = 'lighter';
    if (fl > 0.01) { out.globalAlpha = Math.min(1, 0.2 * fl); out.drawImage(out.canvas, 0, 0); }
    out.globalAlpha = 1; out.imageSmoothingQuality = 'medium';
    out.drawImage(b, 0, 0, W, H);
    out.globalCompositeOperation = 'source-over';
    const vg = out.createRadialGradient(W / 2, H * 0.46, W * 0.3, W / 2, H * 0.46, W * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(0.5, 'rgba(0,0,0,0.14)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    out.fillStyle = vg; out.fillRect(0, 0, W, H);
    const fi = E.outQ(inv(0, 0.6, t)), fo = 1 - E.ioQ(inv(EV.fadeOut, 29.95, t)), bk = 1 - fi * fo;
    if (bk > 0.001) { out.fillStyle = `rgba(0,0,0,${Math.min(1, bk)})`; out.fillRect(0, 0, W, H); }
  },
};
