import { W, H, F, font, seg, inv, E, lerp, pad, tc, DUR, FPS } from './lib.js';
import { S, EV, WORD, A, dcFrame } from './timeline.js';
import { geo, thumbs } from './reveal.js';

const M = 40, L = 14;
const wa = a => `rgba(255,255,255,${a})`;
const WT = wa(0.92), GR = wa(0.52), QT = wa(0.3);
const CH = [[S.intro[0], 'COMPOSE'], [S.run[0], 'RUN'], [S.pause[0], 'HUMAN IN THE LOOP'], [S.loop[0], 'EMERGE'], [S.reveal[0], 'OUTPUT']];
const PT = [
  ['xAI', 14, 700, F.body, -0.2],
  ['ANTHROPIC', 9.5, 600, F.body, 2.6],
  ['python', 13.5, 600, F.body, 0.1],
  ['FFmpeg', 13, 700, F.body, 0],
  ['three.js', 12, 500, F.mono, 0],
];

const ft = (x, px, w = 400, fam = F.mono, ls = 1.6) => { x.font = font(px, w, fam); x.letterSpacing = `${ls}px`; return ls; };
const tw = (x, s, ls) => x.measureText(s).width - ls;

const runs = (x, ps, px, y, al, ls) => {
  const w = ps.reduce((a, [s]) => a + x.measureText(s).width, 0) - ls;
  let cx = Math.round(al === 'r' ? px - w : al === 'c' ? px - w / 2 : px);
  const x0 = cx;
  for (const [s, c] of ps) { x.fillStyle = c; x.fillText(s, cx, y); cx += x.measureText(s).width; }
  return [x0, w];
};

const chars = (x, t, s, cx, y, t0, st, d, v, col) => {
  const w = x.measureText(s).width - parseFloat(x.letterSpacing);
  const x0 = Math.round(cx - w / 2);
  x.fillStyle = col;
  for (let i = 0; i < s.length; i++) {
    const k = E.outQ(inv(t0 + i * st, t0 + i * st + d, t));
    if (k <= 0) continue;
    x.globalAlpha = v * k;
    x.fillText(s[i], x0 + x.measureText(s.slice(0, i)).width, y);
  }
  x.globalAlpha = 1;
};

const crop = x => {
  x.fillStyle = wa(0.38);
  for (const [cx, sx] of [[M, 1], [W - M, -1]]) for (const [cy, sy] of [[M, 1], [H - M, -1]]) {
    const ox = sx > 0 ? cx : cx - 1, oy = sy > 0 ? cy : cy - 1;
    x.fillRect(sx > 0 ? ox : ox - L + 1, oy, L, 1);
    x.fillRect(ox, sy > 0 ? oy : oy - L + 1, 1, L);
  }
};

const chap = (x, t, a) => {
  let i = 0;
  for (let j = 0; j < CH.length; j++) if (t >= CH[j][0]) i = j;
  const ls = ft(x, 9, 500);
  const by = H - M, lx = M + L + 10;
  const s = CH[i][1], n = pad(i + 1);
  const b = CH[i][0], nb = CH[i + 1] ? CH[i + 1][0] : DUR + 1;
  const nw = x.measureText(`${n}  `).width;
  for (let k = 0; k < n.length + s.length; k++) {
    const ki = k - n.length;
    const ch = ki < 0 ? n[k] : s[ki];
    const px = ki < 0 ? lx + x.measureText(n.slice(0, k)).width : lx + nw + x.measureText(s.slice(0, ki)).width;
    const e = i === 0 ? 1 : E.outQ(inv(b + k * 0.018, b + k * 0.018 + 0.2, t));
    const o = 1 - inv(nb - 0.22 + k * 0.006, nb - 0.1 + k * 0.006, t);
    const v = e * o;
    if (v <= 0) continue;
    x.globalAlpha = a * v;
    x.fillStyle = ki < 0 ? WT : GR;
    x.fillText(ch, px, by);
  }
  x.globalAlpha = a;
  const bw = 180, yy = by - 14;
  x.fillStyle = wa(0.13);
  x.fillRect(lx, yy, bw, 1);
  x.fillStyle = wa(0.75);
  x.fillRect(lx, yy, Math.round(bw * t / DUR * 2) / 2, 1);
  x.fillStyle = wa(0.32);
  for (const [c] of CH.slice(1)) x.fillRect(lx + Math.round(bw * c / DUR), yy - 3, 1, 3);
  x.fillRect(lx + bw - 1, yy - 3, 1, 3);
  x.globalAlpha = 1;
};

const furn = (x, t, a) => {
  if (a <= 0) return;
  x.globalAlpha = a;
  crop(x);
  const by = M + 7, lx = M + L + 10, rx = W - M - L - 10;
  const ls = ft(x, 9, 500);
  runs(x, [['RUNDEER', WT], ['  —  NODE WORKBENCH FOR AI IMAGE + VIDEO', GR]], lx, by, 'l', ls);
  const [x0] = runs(x, [['REC.01 / 1920×1080 / 60P', GR], ['   ', GR], [tc(t), WT]], rx, by, 'r', ls);
  x.fillStyle = wa((t % 1) < 0.5 ? 0.9 : 0.22);
  x.fillRect(x0 - 11, by - 6, 5, 5);
  runs(x, [['FRAME ', GR], [pad(Math.min(DUR * FPS - 1, Math.floor(t * FPS)), 4), WT], [` / ${DUR * FPS}`, GR]], rx, H - M, 'r', ls);
  chap(x, t, a);
  x.globalAlpha = 1;
};

const partners = (x, t, a) => {
  if (a <= 0) return;
  const by = H - M, gap = 34;
  const ls = ft(x, 8, 500, F.mono, 1.8);
  const lw = tw(x, 'BUILT WITH', ls);
  const ws = PT.map(([s, px, w, fam, l]) => { ft(x, px, w, fam, l); return tw(x, s, l); });
  const tot = lw + 26 + ws.reduce((p, v) => p + v, 0) + gap * (PT.length - 1);
  let cx = Math.round(W / 2 - tot / 2);
  x.globalAlpha = a;
  ft(x, 8, 500, F.mono, 1.8);
  x.fillStyle = wa(0.7);
  x.fillText('BUILT WITH', cx, by);
  cx += lw + 26;
  x.fillStyle = wa(1);
  PT.forEach(([s, px, w, fam, l], i) => {
    const k = E.outQ(inv(1.0 + i * 0.07, 1.6 + i * 0.07, t));
    ft(x, px, w, fam, l);
    x.globalAlpha = a * k;
    x.fillText(s, Math.round(cx), by);
    cx += ws[i] + gap;
  });
  x.globalAlpha = 1;
};

const word = (x, t, s, cx, top, px, tin, tout, av, ga, gb) => {
  ft(x, px, 700, F.disp, 0);
  const tw0 = x.measureText(s).width;
  const asc = x.measureText('d').actualBoundingBoxAscent, dsc = Math.max(2, x.measureText('r').actualBoundingBoxDescent);
  const by = Math.round(top + asc), x0 = Math.round(cx - tw0 / 2);
  const hh = asc + dsc + 6;
  let pin = 0, pout = 0;
  for (let i = 0; i < s.length; i++) {
    const ei = E.outX(inv(tin + i * 0.045, tin + i * 0.045 + 0.75, t));
    const eo = E.inQ(inv(tout + i * 0.025, tout + i * 0.025 + 0.3, t));
    pin += ei / s.length; pout += eo / s.length;
    const v = ei * (1 - eo);
    if (v <= 0) continue;
    const xi = x0 + x.measureText(s.slice(0, i)).width;
    x.save();
    x.beginPath(); x.rect(x0 - px, by - asc - 3, tw0 + px * 2, asc + dsc + 6); x.clip();
    x.globalAlpha = av * Math.min(1, v * 1.4);
    x.fillStyle = '#fff';
    x.fillText(s[i], xi, by + (1 - ei) * hh - eo * hh);
    x.restore();
  }
  const gv = pin * pin * (1 - pout);
  if (gv > 0) {
    x.save();
    x.filter = `blur(${gb}px)`;
    x.globalAlpha = av * ga * gv;
    x.globalCompositeOperation = 'lighter';
    x.fillStyle = '#fff';
    x.fillText(s, x0, by);
    x.restore();
  }
  return by;
};

const intro = (x, t) => {
  if (t < 0.55 || t > 3.1) return;
  const by = word(x, t, 'rundeer', WORD.intro.x, WORD.intro.y, 32, 0.6, 2.2, 1, 0.26, 9);
  ft(x, 9, 400, F.mono, 1.5);
  chars(x, t, 'v0.3.5 — emergent workflows for image & video', WORD.intro.x, by + 24, 1.15, 0.012, 0.25, 1 - seg(t, 2.1, 2.4, E.ioQ), GR);
};

const end = (x, t, fo) => {
  if (t < EV.endCard || fo <= 0) return;
  const by = word(x, t, 'rundeer', WORD.end.x, WORD.end.y, 68, 27.7, 99, fo, 0.28, 16);
  ft(x, 10, 500, F.mono, 2);
  chars(x, t, 'node-based workbench for ai image & video', WORD.end.x, by + 36, 28.05, 0.008, 0.22, fo, wa(0.72));
  ft(x, 8.5, 400, F.mono, 1.6);
  chars(x, t, 'v0.3.5 · local-first · open graph format', WORD.end.x, by + 56, 28.28, 0.007, 0.22, fo, wa(0.4));
};

const hero = (x, t) => {
  if (t < 24.5 || t > 27.7) return;
  const g = geo(t);
  const fa = seg(t, 24.55, 25.15, E.outQ) * (1 - seg(t, 27.42, 27.56));
  const X = Math.round(g.x), Wd = Math.round(g.w), Y = Math.round(g.cy - g.vh / 2), Hh = Math.max(0, Math.round(g.vh));
  if (fa > 0) {
    x.globalAlpha = fa;
    x.fillStyle = wa(0.25);
    x.fillRect(X - 1, Y - 1, Wd + 2, 1);
    x.fillRect(X - 1, Y + Hh, Wd + 2, 1);
    x.fillRect(X - 1, Y, 1, Hh);
    x.fillRect(X + Wd, Y, 1, Hh);
    const ta = 1 - seg(t, 26.95, 27.15);
    x.globalAlpha = fa * ta;
    x.fillStyle = wa(0.6);
    const o = 6, l = 7;
    for (const [cx, sx] of [[X - 1, -1], [X + Wd, 1]]) for (const [cy, sy] of [[Y - 1, -1], [Y + Hh, 1]]) {
      x.fillRect(sx < 0 ? cx - o - l : cx + 1 + o, cy, l, 1);
      x.fillRect(cx, sy < 0 ? cy - o - l : cy + 1 + o, 1, l);
    }
  }
  const ma = seg(t, 24.9, 25.6, E.outQ) * (1 - seg(t, 26.85, 27.1, E.ioQ));
  if (ma <= 0) { x.globalAlpha = 1; return; }
  x.globalAlpha = ma;
  const ls = ft(x, 9, 500);
  const ty = Y - 1 - 20, bt = Y + Hh + 1, sy = bt + 20, my = sy + 15;
  runs(x, [['OUTPUT · VIDEO · ', GR], ['GROK IMAGINE', WT]], X, ty, 'l', ls);
  runs(x, [['ITER ', GR], ['09/09', WT], ['  ·  SEED ', GR], ['7731', WT]], X + Wd, ty, 'r', ls);
  runs(x, [['1280×960', WT], ['  ·  24 FPS  ·  4.0 S', GR]], X, my, 'l', ls);
  const f = dcFrame(t) - 1;
  runs(x, [['TC ', GR], [`00:00:${pad(Math.floor(f / A.dcFps))}:${pad(f % A.dcFps)}`, WT], [' / 00:00:04:00', GR]], X + Wd, my, 'r', ls);
  const cw = 32, chh = 24, cg = 4, n = thumbs.length, x0 = Math.round(960 - (n * cw + (n - 1) * cg) / 2);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  thumbs.forEach((im, i) => {
    const k = E.outQ(inv(25.15 + i * 0.045, 25.5 + i * 0.045, t));
    if (k <= 0) return;
    const cx = x0 + i * (cw + cg);
    x.globalAlpha = ma * k * (i === 3 ? 1 : 0.42);
    x.drawImage(im, cx, sy, cw, chh);
    if (i === 3) {
      x.globalAlpha = ma * k;
      x.fillStyle = wa(0.95);
      x.fillRect(cx - 2, sy - 2, cw + 4, 1);
      x.fillRect(cx - 2, sy + chh + 1, cw + 4, 1);
      x.fillRect(cx - 2, sy - 1, 1, chh + 2);
      x.fillRect(cx + cw + 1, sy - 1, 1, chh + 2);
    }
  });
  x.globalAlpha = 1;
};

export default {
  name: 'hud',
  async init(env) {},
  draw(ctx, t, env) {
    const fo = 1 - seg(t, EV.fadeOut, 29.95, E.ioQ);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    furn(ctx, t, seg(t, 0.6, 1.5, E.outQ) * fo);
    partners(ctx, t, seg(t, 1.0, 1.6, E.outQ) * fo * lerp(0.46, 0.64, seg(t, 27.8, 28.6, E.ioQ)));
    intro(ctx, t);
    hero(ctx, t);
    end(ctx, t, fo);
  },
};
