import { mkLut } from './ui-kit.js';

export const HD = 34, RH = 30, FT = 26, PT = 4, PB = 6;

export const CAT = {
  prim: 'oklch(53.5% 0.3 250)', brain: 'oklch(50% 0.2 350)', loop: 'oklch(50% 0.2 330)',
  grok: 'oklch(100% 1 7)', trig: 'oklch(55% 0.25 90)', out: 'oklch(55% 0.25 25)',
};

export const ST = {
  text: 'oklch(74% 0.180 235)', image: 'oklch(84% 0.190 82)', video: 'oklch(72% 0.210 315)',
  int: 'oklch(74% 0.17 196)', any: 'oklch(75% 0.035 80)', bundle: 'oklch(88% 0.220 88)', run: 'oklch(80% 0.180 100)',
};

const o = (id, l, ty) => ({ k: 'o', id, l, ty });
const i = (id, l, ty, v, x) => ({ k: 'i', id, l, ty, v, ...x });
const p = (id, l, ty, v) => ({ k: 'p', id, l, ty, v });
const a = (id, h) => ({ k: 'a', id, h });

const SPEC = [
  ['pr', 0, -300, 264, 'prim', 'Prompt', 'string · primitives', [o('out', 'string', 'text'), a('txt', 88)]],
  ['br', 0, -66, 264, 'brain', 'Moebius', 'brain · agent brain', [o('out', 'brain', 'text'), i('sec', 'sections', 'text', null, { tag: '11 docs' }), i('tools', 'tools', 'any', null, { tag: 'web · vision' })]],
  ['ag', 328, -190, 260, 'brain', 'art director', 'agent · agent brain', [o('out', 'prompt', 'text'), i('prompt', 'prompt', 'text'), i('brain', 'brain', 'text'), p('model', 'model', 'text', 'opus-5.5'), a('resp', 58)]],
  ['ld', 652, -160, 230, 'loop', 'Loop · Decompose', 'decompose · loop', [o('item', 'item', 'text'), o('index', 'index', 'int'), i('seed', 'seed', 'any'), i('times', 'times', 'int', '9'), a('ctr', 54)]],
  ['im', 946, -130, 250, 'grok', 'Image', 'image · grok imagine', [o('image', 'image', 'image'), i('subject', 'subject', 'text'), i('ref', 'reference images', 'image', null, { ph: 1 }), p('style', 'style', 'text', 'Moebius'), p('model', 'model', 'text', 'grok-imagine'), p('aspect', 'aspect', 'text', '4:3 · 1184×888'), a('st', 32)]],
  ['pz', 1260, -96, 284, 'trig', 'Pause', 'pause · triggers', [o('out', 'out', 'image'), i('in', 'in', 'image'), p('every', 'every', 'int', '4'), a('pst', 24), a('grid', 210), a('note', 34), a('btn', 42)]],
  ['lo', 1608, -60, 284, 'loop', 'Loop · Output', 'output · loop', [o('out', 'bundle', 'bundle'), i('item', 'item', 'image'), a('hdr', 22), a('grid', 212)]],
  ['vd', 1956, -40, 250, 'grok', 'Video', 'video · grok imagine', [o('video', 'video', 'video'), i('start', 'start frame', 'image'), i('motion', 'motion', 'text', 'slow aerial drift'), p('model', 'model', 'text', 'grok-imagine'), p('len', 'length', 'text', '4.0 s · 24 fps'), a('st', 32)]],
  ['op', 2270, 66, 400, 'out', 'Output', 'preview · output', [{ k: 'io', i: 'in', il: 'in', ity: 'video', o: 'out', ol: 'out', oty: 'any' }, a('pv', 300), a('tr', 26)]],
];

export const N = {};
export const NL = [];

for (const [id, x, cy, w, cat, t, f, rows] of SPEC) {
  let y = HD + PT;
  const R = {};
  for (const r of rows) {
    r.h = r.h || RH;
    r.y = y;
    y += r.h;
    R[r.id || r.i] = r;
  }
  const h = y + PB + FT;
  const n = { id, x, y: Math.round(cy - h / 2), w, h, cat, t, f, rows, R };
  N[id] = n;
  NL.push(n);
}

export const sp = (id, s) => {
  const n = N[id];
  for (const r of n.rows) {
    if (r.k === 'io') {
      if (r.i === s) return { x: n.x, y: n.y + r.y + r.h / 2, out: 0 };
      if (r.o === s) return { x: n.x + n.w, y: n.y + r.y + r.h / 2, out: 1 };
    } else if (r.id === s) {
      return { x: r.k === 'o' ? n.x + n.w : n.x, y: n.y + r.y + r.h / 2, out: r.k === 'o' ? 1 : 0 };
    }
  }
  return null;
};

export const area = (id, a) => {
  const n = N[id], r = n.R[a];
  return { x: n.x, y: n.y + r.y, w: n.w, h: r.h };
};

export const ED = [
  ['pr', 'out', 'ag', 'prompt', 'text'],
  ['br', 'out', 'ag', 'brain', 'text'],
  ['ag', 'out', 'ld', 'seed', 'text'],
  ['ld', 'item', 'im', 'subject', 'text'],
  ['im', 'image', 'pz', 'in', 'image'],
  ['pz', 'out', 'lo', 'item', 'image'],
  ['lo', 'out', 'vd', 'start', 'bundle'],
  ['vd', 'video', 'op', 'in', 'video'],
].map(([fa, fs, ta, ts, ty]) => {
  const A = sp(fa, fs), B = sp(ta, ts);
  const dx = Math.max(Math.abs(B.x - A.x) * 0.5, 60);
  const g = [A.x, A.y, A.x + dx, A.y, B.x - dx, B.y, B.x, B.y];
  return { fa, fs, ta, ts, ty, g, lut: mkLut(g) };
});

export const bbox = ids => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const id of ids) {
    const n = N[id];
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
};
