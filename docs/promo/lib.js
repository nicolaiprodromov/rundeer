export const W = 1920, H = 1080, FPS = 60, DUR = 30;

export const C = {
  bgDeep: '#050505', bg: '#0a0a0a', surface: '#111111', surface2: '#171717', surface3: '#1f1f1f',
  line: '#2a2a2a', lineStrong: '#3f3f3f', text: '#f2f2f2', textSoft: '#c9c9c9', muted: '#9b9b9b',
  quiet: '#666666', whisper: '#454545', accent: '#ffffff', bad: 'oklch(68% 0.17 25)',
  pink: '#ff60ff', violet: '#6b50ff',
  cat: {
    prim: 'oklch(72% 0.180 235)', prompt: 'oklch(72% 0.210 315)', cmd: 'oklch(84% 0.190 82)',
    coord: 'oklch(74% 0.16 340)', loop: 'oklch(76% 0.180 165)', out: 'oklch(74% 0.180 35)',
  },
  sock: {
    text: 'oklch(74% 0.180 235)', image: 'oklch(84% 0.190 82)', video: 'oklch(72% 0.210 315)',
    number: 'oklch(76% 0.180 165)', bool: 'oklch(78% 0.190 45)', def: 'oklch(76% 0.170 185)',
    file: 'oklch(80% 0.180 58)', any: 'oklch(75% 0.035 80)',
  },
};

export const F = {
  disp: '"Bricolage Grotesque", sans-serif',
  body: '"Hanken Grotesk", sans-serif',
  mono: '"Geist Mono", monospace',
};

export const font = (px, w = 400, fam = F.body) => `${w} ${px}px ${fam}`;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const inv = (a, b, t) => clamp((t - a) / (b - a));
export const mix = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));

export const E = {
  lin: k => k,
  inQ: k => k * k * k,
  outQ: k => 1 - Math.pow(1 - k, 3),
  ioQ: k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
  outX: k => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k),
  inX: k => k <= 0 ? 0 : Math.pow(2, 10 * k - 10),
  ioX: k => k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2,
  ioQ5: k => k < 0.5 ? 16 * k ** 5 : 1 - Math.pow(-2 * k + 2, 5) / 2,
  outB: (k, s = 1.4) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2),
};

export const seg = (t, a, b, ease = E.lin) => ease(inv(a, b, t));

export const rng = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let r = Math.imul(seed ^ seed >>> 15, 1 | seed);
  r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
  return ((r ^ r >>> 14) >>> 0) / 4294967296;
};

export const hash = n => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export const noise1 = x => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
};

const _img = new Map();
export const loadImg = src => {
  if (_img.has(src)) return _img.get(src);
  const p = new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('img ' + src));
    im.src = src;
  });
  _img.set(src, p);
  return p;
};

export const pad = (n, l = 2) => String(n).padStart(l, '0');

export const tc = t => {
  const f = Math.floor((t % 1) * FPS);
  const s = Math.floor(t);
  return `00:00:${pad(s)}:${pad(f)}`;
};

export const cover = (iw, ih, w, h) => {
  const s = Math.max(w / iw, h / ih);
  return { sw: w / s, sh: h / s, sx: (iw - w / s) / 2, sy: (ih - h / s) / 2 };
};

export const drawCover = (ctx, im, x, y, w, h, zoom = 1, ox = 0, oy = 0) => {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const c = cover(iw, ih, w, h);
  const rw = c.sw / zoom, rh = c.sh / zoom;
  const cx = clamp(iw / 2 + ox * iw, rw / 2, iw - rw / 2), cy = clamp(ih / 2 + oy * ih, rh / 2, ih - rh / 2);
  ctx.drawImage(im, cx - rw / 2, cy - rh / 2, rw, rh, x, y, w, h);
};

export const roundPx = v => Math.round(v * 2) / 2;
