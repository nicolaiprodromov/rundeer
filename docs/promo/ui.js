import { F, clamp, lerp, E, seg, hash, loadImg, pad } from './lib.js';
import { EV, HANDOFF, NOTE, A, dcFrame } from './timeline.js';
import { deerSprite } from './deer.js';
import { V, setV, sn, X, Y, sr, rect, box, tx, tw, ca, wa, sock, bzG, sub, at, stroke, arrow, ibeam, spring } from './ui-kit.js';
import { N, NL, ED, HD, FT, CAT, ST, sp, area, bbox } from './ui-graph.js';

const WX = 140, WY = 72, WW = 1640, WH = 922, MH = 38;
const CY0 = WY + MH, CH = WH - MH, CCX = WX + WW / 2, CCY = CY0 + CH / 2;
const DH = 34, DX = WX + 14, DY = CY0 + CH - 14 - DH, DW = 452;
const K = { mast: '#0a0a0a', node: '#161616', fld: '#030303', ln: '#292929', tx: '#f2f2f2', soft: '#c4c4c4', lab: '#b5b5b5', mut: '#929292', q: '#5e5e5e', wh: '#3d3d3d' };

const T_IN = EV.uiIn, T_OUT = EV.uiOut, T_END = 25.6;
const RUN = EV.runClick, PZ0 = EV.pauseHit, PZ1 = EV.resume, VS = EV.videoStart;
const POP = { pr: 0, br: 0, ag: 3.72, ld: 5.34, im: 6.22, pz: 6.4, lo: 6.58, vd: 6.76, op: 6.94 };
const CON = [4.4, 5.02, 5.96, 6.3, 6.48, 6.66, 6.84, 7.02];
const DRW = 0.16;
const DRAG = [[0, 4.0, 4.4], [1, 4.64, 5.02], [2, 5.58, 5.96]];
const CLK = [3.72, 5.34, 6.22, RUN, EV.pick, 15.22, PZ1];
const IT0 = [9.5, 10.36, 11.22, 12.08, 18.55, 19.33, 19.95, 20.45, 20.87];
const ITD = [0.86, 0.86, 0.86, 0.86, 0.84, 0.72, 0.62, 0.54, 0.48];
const ITS = [4.12, 3.86, 4.41, 3.97, 4.08, 3.74, 3.69, 3.58, 3.52];
const ip = (k, f) => IT0[k] + ITD[k] * f;
const LDONE = ip(8, 1), VD = [21.62, 21.7, 21.8, 22.12, 22.3];
const RESP = ['moebius ligne claire · vast', 'aerial grid of datacenters ·', 'desert haze · film grain · b/w'];
const PROMPT = ['aerial · endless datacenters ·', 'desert · b/w film still'];
const PICK = 3;

const PU = [[0, 8.46, 8.68], [1, 8.5, 8.72], [2, 9.3, 9.48]];
for (let k = 0; k < 9; k++) {
  for (let j = 0; j <= Math.max(0, Math.ceil((k - 3) / 2)); j++) {
    const o = j * 0.045, s = j ? 0.62 : 1;
    PU.push([3, ip(k, 0) + o, ip(k, 0.16) + o, s], [4, ip(k, 0.7) + o, ip(k, 0.8) + o, s], [5, ip(k, 0.8) + o, ip(k, 0.9) + o, s]);
  }
}
PU.push([6, 21.4, 21.62], [6, 21.45, 21.66], [6, 21.5, 21.7], [7, 22.28, 22.4]);

const ACT = {
  pr: [[8.42, 8.52]], br: [[8.44, 8.56]], ag: [[8.68, 9.3]], ld: [[9.48, PZ0], [PZ1 + 0.02, LDONE]],
  im: IT0.map((_, k) => [ip(k, 0.16), ip(k, 0.7)]), pz: IT0.map((_, k) => [ip(k, 0.78), ip(k, 0.86)]),
  lo: IT0.map((_, k) => [ip(k, 0.9), ip(k, 1) + 0.08]), vd: [[VD[0], VD[4]]], op: [[VS, VS + 0.24]],
};
const DONE = { pr: 8.52, br: 8.56, ag: 9.3, ld: LDONE, im: ip(0, 0.7), pz: ip(0, 0.86), lo: ip(0, 1) + 0.08, vd: VD[4], op: VS + 0.24 };

const cTimes = [];
for (let i = 0; i < NOTE.length; i++) cTimes.push(EV.typeA + (i + 0.5 + 0.38 * (hash(i * 3.7) - 0.5)) * (EV.typeB - EV.typeA) / NOTE.length);

let SS = 2, L = null, Lg = null, SHD = null, CAM = [], MV = [];
const TH = [], TS = [], TP = [], DC = [];

const cam = t => {
  let i = 0;
  while (i < CAM.length - 2 && t >= CAM[i + 1][0]) i++;
  const a = CAM[i], b = CAM[i + 1], k = (b[4] || E.ioQ)(clamp((t - a[0]) / (b[0] - a[0])));
  return { cx: lerp(a[1], b[1], k), cy: lerp(a[2], b[2], k), z: Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), k)) };
};

const camV = t => {
  const c = cam(t);
  return [CCX - c.cx * c.z, CCY - c.cy * c.z, c.z];
};

const res = (p, t) => {
  if (p.s) return p.s;
  const [ox, oy, z] = camV(t);
  const g = p.g || (() => { const q = sp(p.k[0], p.k[1]); return [q.x, q.y]; })();
  return [ox + g[0] * z, oy + g[1] * z];
};

const cur = t => {
  let i = 0;
  while (i < MV.length - 1 && t >= MV[i + 1][0]) i++;
  const [t0, t1, to] = MV[i];
  const B = res(to, t);
  if (t >= t1 || i === 0) return B;
  const Aq = res(MV[i - 1][2], t), k = spring((t - t0) / (t1 - t0));
  const dx = B[0] - Aq[0], dy = B[1] - Aq[1], d = Math.hypot(dx, dy), bend = (hash(i * 1.37) > 0.5 ? 1 : -1) * 0.07 * Math.sin(Math.PI * clamp(k));
  return [Aq[0] + dx * k - dy * bend, Aq[1] + dy * k + dx * bend];
};

const iv = (list, t, r = 0.06) => {
  let v = 0;
  for (const [a, b] of list) v = Math.max(v, Math.min(seg(t, a - r, a), 1 - seg(t, b, b + r * 1.6)));
  return v;
};

const press = t => {
  let v = 0;
  for (const c of CLK) v = Math.max(v, 1 - clamp(Math.abs(t - c - 0.01) / 0.07));
  for (const [, a, b] of DRAG) v = Math.max(v, Math.min(seg(t, a - 0.05, a), 1 - seg(t, b, b + 0.06)));
  return v;
};

const conAt = i => CON[i] + (i > 2 ? DRW : 0);
const sockOn = (id, s, t) => ED.some((e, i) => t >= conAt(i) && ((e.fa === id && e.fs === s) || (e.ta === id && e.ts === s)));

const elapsed = t => {
  const e = Math.max(0, Math.min(t, VD[4]) - RUN) - Math.max(0, Math.min(t, PZ1) - PZ0);
  return e * 8.2;
};
const clock = s => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}.${Math.floor((s * 10) % 10)}`;

const itersDone = t => IT0.reduce((n, _, k) => n + (t >= ip(k, 0.9) ? 1 : 0), 0);
const itersOn = t => IT0.reduce((n, _, k) => n + (t >= IT0[k] ? 1 : 0), 0);

const chipCol = s => ({
  idle: [K.wh, K.q], queued: ['#3d3d3d', K.mut], submitted: ['#5e5e5e', K.soft], polling: ['#a8a8a8', K.tx],
  downloading: ['#ffffff', '#ffffff'], done: ['#ffffff', '#ffffff'], paused: ['#ffffff', '#030303', '#ffffff'],
  passthrough: [K.wh, K.mut], resumed: ['#8a8a8a', K.soft], running: ['#ffffff', '#ffffff'],
}[s]);

const chip = (c, x, cy, s) => {
  const [bc, tc, bg] = chipCol(s);
  const w = tw(c, s, 7.6, 500, F.mono, 0.12) + 12;
  if (bg) rect(c, x, cy - 8, w, 16, bg);
  else rect(c, x, cy - 8, w, 16, '#0b0b0b');
  box(c, x, cy - 8, w, 16, bg || bc);
  tx(c, s, x + 6, cy, 7.6, tc, { w: 500, ls: 0.12, up: 1, dy: 0.36 });
  return w;
};

const field = (c, x, y, w, h, v, col = K.soft, px = 10.6) => {
  rect(c, x, y, w, h, K.fld);
  box(c, x, y, w, h, K.ln);
  if (v != null) tx(c, v, x + 7, y + h / 2, px, col);
};

const thumb = (k, w) => (w * V.z * SS > 190 ? TH[k] : TS[k]);

const reveal = (c, g, im, tiny, x, y, w, h, tf, dur, t, dir = 0) => {
  const p = (t - tf) / dur;
  if (p <= 0) return 0;
  const [a, b, rw, rh] = sr(x, y, w, h);
  if (p >= 1) { c.drawImage(im, a, b, rw, rh); return 1; }
  const e = E.outQ(p);
  const cl = (u, v, uw, vh) => { c.save(); c.beginPath(); c.rect(u, v, uw, vh); c.clip(); };
  if (dir) {
    const xx = sn(a + rw * e), bw = Math.min(rw * 0.28, a + rw - xx);
    cl(a, b, xx - a, rh); c.drawImage(im, a, b, rw, rh); c.restore();
    if (bw > 0) { cl(xx, b, bw, rh); c.imageSmoothingEnabled = false; c.globalAlpha *= 0.85; c.drawImage(tiny, a, b, rw, rh); c.restore(); }
    c.fillStyle = 'rgba(255,255,255,0.95)'; c.fillRect(xx, b, 1, rh);
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(xx - 0.5, b, 2, rh);
  } else {
    const yy = sn(b + rh * e), bh = Math.min(rh * 0.34, b + rh - yy);
    cl(a, b, rw, yy - b); c.drawImage(im, a, b, rw, rh); c.restore();
    if (bh > 0) { cl(a, yy, rw, bh); c.imageSmoothingEnabled = false; c.globalAlpha *= 0.85; c.drawImage(tiny, a, b, rw, rh); c.restore(); }
    c.fillStyle = 'rgba(255,255,255,0.95)'; c.fillRect(a, yy, rw, 1);
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(a, yy - 0.5, rw, 2);
  }
  return 1;
};

const hov = (t, x, y, w, h) => {
  const [cx, cy] = cur(t), [a, b, rw, rh] = sr(x, y, w, h);
  return cx >= a && cx <= a + rw && cy >= b && cy <= b + rh;
};

const AREAS = {
  pr_txt(c, g, n, x, y, w, t) {
    rect(c, x + 12, y + 2, 34, 15, '#262626');
    tx(c, 'edit', x + 29, y + 9.5, 7.2, K.soft, { al: 'center', ls: 0.14, up: 1, w: 500 });
    box(c, x + 49, y + 2, 50, 15, K.ln);
    tx(c, 'preview', x + 74, y + 9.5, 7.2, K.q, { al: 'center', ls: 0.14, up: 1 });
    ['B', 'I', '~', 'H', '¶', '@'].forEach((s, i) => tx(c, s, x + 116 + i * 16, y + 9.5, 8.6, K.wh, { al: 'center', w: 600 }));
    field(c, x + 12, y + 21, w - 24, 50);
    rect(c, x + 31, y + 22, 1, 48, '#151515');
    tx(c, '1', x + 25, y + 34, 9, K.wh, { al: 'right' });
    tx(c, '2', x + 25, y + 51, 9, K.wh, { al: 'right' });
    tx(c, PROMPT[0], x + 37, y + 34, 10.8, K.soft);
    tx(c, PROMPT[1], x + 37, y + 51, 10.8, K.soft);
    tx(c, '54 chars · md', x + 12, y + 80, 8.6, K.wh, { ls: 0.04 });
    tx(c, 'ln 2 · col 24', x + w - 12, y + 80, 8.6, K.wh, { al: 'right', ls: 0.04 });
    sock(c, x, y + 46, ST.text, 0, { k: 0.85 });
  },
  ag_resp(c, g, n, x, y, w, t) {
    field(c, x + 12, y + 3, w - 24, 50);
    const tot = RESP.join('').length, k = seg(t, 8.72, 9.26), nn = Math.floor(tot * k);
    if (t < 8.72) { tx(c, 'reply · idle', x + 20, y + 15, 9.4, K.wh); return; }
    let left = nn, ly = y + 15, lx = x + 20, last = [lx, ly];
    for (const s of RESP) {
      const q = s.slice(0, Math.max(0, left));
      if (q.length) { tx(c, q, lx, ly, 9.4, K.soft); last = [lx + tw(c, q, 9.4), ly]; }
      left -= s.length;
      if (left <= 0) break;
      ly += 14;
    }
    if (k < 1) rect(c, last[0] + 1, last[1] - 5, 5, 10, '#ffffff');
  },
  ld_ctr(c, g, n, x, y, w, t) {
    const on = itersOn(t), done = t >= LDONE;
    tx(c, 'iter', x + 12, y + 10, 7.2, K.q, { ls: 0.16, up: 1 });
    tx(c, 'loop1', x + w - 12, y + 10, 8.2, K.wh, { al: 'right', ls: 0.04 });
    const s = pad(Math.max(on, 0));
    tx(c, s, x + 12, y + 33, 22, on ? K.tx : K.q, { w: 500, dy: 0.36 });
    tx(c, '/09', x + 12 + tw(c, s, 22, 500) + 3, y + 35, 11.5, K.q, { dy: 0.36 });
    const pw = 9, gp = 4, px0 = x + w - 12 - (9 * pw + 8 * gp);
    for (let k = 0; k < 9; k++) {
      const px = px0 + k * (pw + gp), py = y + 28;
      const fin = t >= ip(k, 0.9), run = t >= IT0[k] && !fin;
      if (fin) rect(c, px, py, pw, pw, '#9a9a9a');
      else if (run) {
        rect(c, px, py, pw, pw, '#ffffff');
        rect(g, px, py, pw, pw, 'rgba(255,255,255,0.8)');
      } else box(c, px, py, pw, pw, '#3a3a3a');
    }
    const lab = done ? 'done' : t >= PZ0 && t < PZ1 ? 'waiting' : on ? 'running' : 'idle';
    tx(c, lab, x + w - 12, y + 46, 7.6, done || (on && lab === 'running') ? K.soft : K.q, { al: 'right', ls: 0.12, up: 1 });
  },
  im_st(c, g, n, x, y, w, t) {
    let s = 'idle', pr = 0, it = 0;
    for (let k = 0; k < 9; k++) {
      if (t < IT0[k]) break;
      const f = (t - IT0[k]) / ITD[k];
      it = k + 1;
      s = f < 0.16 ? 'queued' : f < 0.24 ? 'queued' : f < 0.34 ? 'submitted' : f < 0.56 ? 'polling' : f < 0.7 ? 'downloading' : 'done';
      pr = s === 'downloading' ? (f - 0.56) / 0.14 : s === 'done' ? 1 : 0;
    }
    status(c, g, x, y, w, s, pr, it ? `it ${pad(it)}` : '—');
  },
  vd_st(c, g, n, x, y, w, t) {
    const s = t < VD[0] ? 'idle' : t < VD[1] ? 'queued' : t < VD[2] ? 'submitted' : t < VD[3] ? 'polling' : t < VD[4] ? 'downloading' : 'done';
    status(c, g, x, y, w, s, s === 'downloading' ? (t - VD[3]) / (VD[4] - VD[3]) : s === 'done' ? 1 : 0, t < VD[0] ? '—' : '1 clip');
  },
  pz_pst(c, g, n, x, y, w, t) {
    const s = t >= PZ0 && t < PZ1 ? 'paused' : t >= PZ1 ? 'resumed' : 'passthrough';
    chip(c, x + 12, y + 12, s);
    const r = s === 'paused' ? 'awaiting artist' : s === 'resumed' ? 'ref 04 · note' : `held ${Math.min(4, IT0.filter((_, k) => k < 4 && t >= ip(k, 0.8)).length)}/4`;
    tx(c, r, x + w - 12, y + 12, 9.4, s === 'paused' ? K.tx : K.mut, { al: 'right' });
  },
  pz_grid(c, g, n, x, y, w, t) {
    const cw = (w - 20) / 2, chh = cw * 0.75, pk = seg(t, EV.pick, EV.pick + 0.18, E.outQ), pkd = t >= PZ1 ? 0.5 : 1;
    for (let k = 0; k < 4; k++) {
      const cx = x + 8 + (k % 2) * (cw + 4), cy = y + 4 + Math.floor(k / 2) * (chh + 4);
      rect(c, cx, cy, cw, chh, '#0a0a0a');
      const tf = ip(k, 0.8);
      const got = reveal(c, g, thumb(k, cw), TP[k], cx, cy, cw, chh, tf, 0.16, t);
      if (!got) tx(c, pad(k + 1), cx + cw / 2, cy + chh / 2, 9, K.wh, { al: 'center' });
      if (got) {
        rect(c, cx + 4, cy + chh - 17, 21, 13, 'rgba(0,0,0,0.72)');
        tx(c, pad(k + 1), cx + 14.5, cy + chh - 10.5, 8.2, K.soft, { al: 'center' });
      }
      const fl = 1 - seg(t, tf + 0.16, tf + 0.5);
      if (k !== PICK && pk > 0) rect(c, cx, cy, cw, chh, `rgba(0,0,0,${0.58 * pk * pkd})`);
      const hv = t > 13.6 && t < EV.pick + 0.05 && hov(t, cx, cy, cw, chh);
      if (k === PICK && pk > 0) {
        box(c, cx, cy, cw, chh, '#ffffff', 2);
        box(g, cx, cy, cw, chh, `rgba(255,255,255,${0.55 * pkd})`, 2);
        rect(c, cx + cw - 32, cy + 4, 28, 13, '#ffffff');
        tx(c, 'ref', cx + cw - 18, cy + 10.5, 7.4, '#030303', { al: 'center', up: 1, ls: 0.12, w: 600 });
      } else box(c, cx, cy, cw, chh, hv ? '#bdbdbd' : got && fl > 0 ? wa(255, 0.25 + 0.6 * fl) : K.ln);
    }
  },
  pz_note(c, g, n, x, y, w, t) {
    const foc = t >= 15.22 && t < PZ1;
    rect(c, x + 8, y + 4, w - 16, 26, K.fld);
    box(c, x + 8, y + 4, w - 16, 26, foc ? '#ffffff' : t >= PZ0 && t < PZ1 && hov(t, x + 8, y + 4, w - 16, 26) ? '#6a6a6a' : K.ln);
    const nn = cTimes.filter(ct => t >= ct).length, s = NOTE.slice(0, nn);
    if (!nn && !foc) tx(c, 'direction note…', x + 16, y + 17, 10.2, K.wh);
    if (nn) tx(c, s, x + 16, y + 17, 10.2, t >= PZ1 ? K.soft : K.tx);
    if (foc) {
      const lt = nn ? cTimes[nn - 1] : 15.22, bl = (t - lt) < 0.45 || ((t - lt - 0.45) % 1.06) < 0.53;
      if (bl) rect(c, x + 16 + (nn ? tw(c, s, 10.2) : 0) + 1, y + 10, 1.4, 14, '#ffffff');
    }
  },
  pz_btn(c, g, n, x, y, w, t) {
    const on = t >= PZ0 && t < PZ1 + 0.06, pr = 1 - clamp(Math.abs(t - PZ1 - 0.02) / 0.07);
    const bx = x + 8, by = y + 4 + (pr > 0.3 ? 1 : 0), bw = w - 16, bh = 32;
    const hv = on && t > 17.9 && hov(t, bx, by, bw, bh);
    const lab = 'continue ▸';
    if (on) {
      rect(c, bx, by, bw, bh, hv ? '#e2e2e2' : '#ffffff');
      tx(c, lab, bx + bw / 2, by + bh / 2, 10.4, '#030303', { al: 'center', ls: 0.14, up: 1, w: 600 });
      const br = 0.18 + 0.12 * Math.sin((t - PZ0) * 4.4);
      box(g, bx, by, bw, bh, `rgba(255,255,255,${br})`, 1);
    } else {
      rect(c, bx, by, bw, bh, '#121212');
      box(c, bx, by, bw, bh, '#383838');
      tx(c, lab, bx + bw / 2, by + bh / 2, 10.4, K.q, { al: 'center', ls: 0.14, up: 1, w: 600 });
    }
    const fl = seg(t, PZ1, PZ1 + 0.05) * (1 - seg(t, PZ1 + 0.05, PZ1 + 0.5, E.outQ));
    if (fl > 0) {
      box(g, bx - 1, by - 1, bw + 2, bh + 2, `rgba(255,255,255,${0.8 * fl})`, 3);
      box(c, bx - 1, by - 1, bw + 2, bh + 2, `rgba(255,255,255,${0.9 * fl})`, 1);
    }
  },
  lo_hdr(c, g, n, x, y, w, t) {
    const d = itersDone(t);
    tx(c, 'bundle', x + 12, y + 11, 7.2, K.q, { ls: 0.16, up: 1 });
    tx(c, `${pad(d)} / 09`, x + w - 12, y + 11, 9.6, d ? K.soft : K.q, { al: 'right' });
    rect(c, x + 66, y + 11, w - 66 - 58, 1, '#232323');
    if (d) rect(c, x + 66, y + 11, (w - 66 - 58) * d / 9, 1, '#9a9a9a');
  },
  lo_grid(c, g, n, x, y, w, t) {
    const cw = (w - 24) / 3, chh = cw * 0.75;
    for (let k = 0; k < 9; k++) {
      const cx = x + 8 + (k % 3) * (cw + 4), cy = y + 4 + Math.floor(k / 3) * (chh + 4);
      rect(c, cx, cy, cw, chh, '#0a0a0a');
      const tf = ip(k, 0.9), got = reveal(c, g, thumb(k, cw), TP[k], cx, cy, cw, chh, tf, Math.min(0.2, ITD[k] * 0.22), t);
      if (!got) tx(c, pad(k + 1), cx + cw / 2, cy + chh / 2, 8.4, K.wh, { al: 'center' });
      else {
        rect(c, cx + 3, cy + chh - 14, 18, 11, 'rgba(0,0,0,0.72)');
        tx(c, pad(k + 1), cx + 12, cy + chh - 8.5, 7.2, K.soft, { al: 'center' });
      }
      const fl = 1 - seg(t, tf + 0.2, tf + 0.6);
      box(c, cx, cy, cw, chh, got && fl > 0 ? wa(255, 0.2 + 0.7 * fl) : K.ln);
      if (got && fl > 0) box(g, cx, cy, cw, chh, wa(255, 0.5 * fl));
    }
  },
  op_pv(c, g, n, x, y, w, t) {
    const px = x + 8, py = y + 6, pw = 384, ph = 288;
    rect(c, px, py, pw, ph, '#080808');
    const [a, b, rw, rh] = sr(px, py, pw, ph);
    const lifted = t >= HANDOFF.t;
    if (t < VS || lifted) {
      c.save(); c.beginPath(); c.rect(a, b, rw, rh); c.clip();
      const cs = 16 * V.z;
      c.fillStyle = '#101010';
      for (let j = 0; j * cs < rh; j++) for (let i = j % 2; i * cs < rw; i += 2) c.fillRect(a + i * cs, b + j * cs, cs, cs);
      c.restore();
      if (!lifted) tx(c, 'awaiting video', px + pw / 2, py + ph / 2, 9.6, K.q, { al: 'center', ls: 0.06 });
    } else {
      const im = DC[dcFrame(t) - 1];
      reveal(c, g, im, TP[9], px, py, pw, ph, VS, 0.22, t, 1);
      const ta = seg(t, VS + 0.25, VS + 0.45);
      if (ta > 0) {
        c.globalAlpha *= ta;
        rect(c, px + 6, py + 6, 92, 15, 'rgba(0,0,0,0.66)');
        tx(c, 'mp4 · 1280×960', px + 12, py + 13.5, 7.6, K.soft, { ls: 0.06 });
        c.globalAlpha /= ta;
      }
    }
    box(c, px, py, pw, ph, K.ln);
  },
  op_tr(c, g, n, x, y, w, t) {
    const pl = t >= VS && t < HANDOFF.t, f = t >= VS ? dcFrame(Math.min(t, HANDOFF.t)) : 1, cy = y + 13;
    c.fillStyle = pl ? '#ffffff' : K.q;
    const p0 = [X(x + 12), Y(cy - 4)], p1 = [X(x + 12), Y(cy + 4)], p2 = [X(x + 18.5), Y(cy)];
    c.beginPath(); c.moveTo(...p0); c.lineTo(...p1); c.lineTo(...p2); c.closePath(); c.fill();
    const s = (f - 1) / 24;
    tx(c, `00:${pad(Math.floor(s))}.${pad(Math.floor((s % 1) * 100))}`, x + 26, cy, 9.4, pl ? K.soft : K.q);
    const sx0 = x + 92, sx1 = x + w - 104, pr = (f - 1) / (A.dcN - 1);
    rect(c, sx0, cy, sx1 - sx0, 1, '#2e2e2e');
    if (t >= VS) {
      rect(c, sx0, cy, (sx1 - sx0) * pr, 1, '#ffffff');
      rect(c, sx0 + (sx1 - sx0) * pr - 1, cy - 4, 2, 9, '#ffffff');
    }
    tx(c, `f ${pad(f, 3)}/${A.dcN} · 24fps`, x + w - 12, cy, 8.4, K.q, { al: 'right' });
  },
};

const status = (c, g, x, y, w, s, pr, it) => {
  const cw = chip(c, x + 12, y + 15, s);
  const b0 = x + 12 + cw + 9, b1 = x + w - 52;
  rect(c, b0, y + 15, b1 - b0, 2, '#232323');
  if (pr > 0) rect(c, b0, y + 15, (b1 - b0) * clamp(pr), 2, s === 'done' ? '#8a8a8a' : '#ffffff');
  if (s === 'polling') {
    const q = ((TT * 1.6) % 1);
    rect(c, b0 + (b1 - b0) * q * 0.82, y + 15, (b1 - b0) * 0.18, 2, '#cfcfcf');
  }
  tx(c, it, x + w - 12, y + 15, 8.8, K.mut, { al: 'right' });
};
let TT = 0;

const hbtns = (c, r, y) => {
  for (let i = 0; i < 3; i++) {
    const bx = r - 22 - i * 26;
    rect(c, bx, y, 22, 22, 'rgba(9,9,9,0.8)');
    box(c, bx, y, 22, 22, 'rgba(245,245,245,0.2)');
    if (i === 0) rect(c, bx + 7, y + 10.5, 8, 1.6, '#f2f2f2');
    else if (i === 1) { box(c, bx + 6.5, y + 7.5, 9, 7, '#f2f2f2'); rect(c, bx + 10, y + 10, 2, 2, '#f2f2f2'); }
    else rect(c, bx + 8, y + 8, 6, 6, '#f2f2f2');
  }
};

const ROWL = 11.2;

const node = (c, g, n, t, sel) => {
  const { x, y, w, h } = n;
  const act = n.id === 'pz' ? Math.max(iv(ACT.pz, t), iv([[PZ0, PZ1]], t, 0.08)) : iv(ACT[n.id], t);
  const done = t >= DONE[n.id] ? 1 : 0;
  rect(c, x, y, w, h, K.node);
  rect(c, x, y, w, HD, CAT[n.cat]);
  rect(c, x, y, w, 1, 'rgba(255,255,255,0.12)');
  rect(c, x, y + HD - 1, w, 1, 'rgba(0,0,0,0.25)');
  rect(c, x + 11, y + 13, 8, 8, 'rgba(255,255,255,0.5)');
  tx(c, n.t, x + 27, y + 17.5, 13.2, '#070707', { w: 700, f: F.body, dy: 0.35 });
  hbtns(c, x + w - 8, y + 6);
  for (const r of n.rows) {
    const ry = y + r.y, cy = ry + r.h / 2;
    if (r.k === 'o') {
      tx(c, r.l, x + w - 18, cy, ROWL, K.lab, { al: 'right' });
      sock(c, x + w, cy, ST[r.ty], sockOn(n.id, r.id, t));
    } else if (r.k === 'i') {
      if (r.ph) {
        c.globalAlpha *= 0.55;
        tx(c, r.l, x + 18, cy, ROWL, K.q, { f: F.mono });
        sock(c, x, cy, ST[r.ty], 0, { dash: 1 });
        c.globalAlpha /= 0.55;
        continue;
      }
      tx(c, r.l, x + 18, cy, ROWL, K.lab);
      if (r.v != null) {
        const fx = x + Math.max(92, tw(c, r.l, ROWL) + 30);
        field(c, fx, ry + 3, x + w - 10 - fx, r.h - 6, r.v);
      }
      if (r.tag) tx(c, r.tag, x + w - 14, cy, 9.2, K.q, { al: 'right' });
      sock(c, x, cy, ST[r.ty], sockOn(n.id, r.id, t));
    } else if (r.k === 'p') {
      tx(c, r.l, x + 18, cy, 10, K.q);
      field(c, x + 74, ry + 3, w - 84, r.h - 6, r.v);
      sock(c, x, cy, ST[r.ty], 0, { k: 0.85 });
    } else if (r.k === 'io') {
      tx(c, r.il, x + 18, cy, ROWL, K.lab);
      tx(c, r.ol, x + w - 18, cy, ROWL, K.lab, { al: 'right' });
      sock(c, x, cy, ST[r.ity], sockOn(n.id, r.i, t));
      sock(c, x + w, cy, ST[r.oty], 0);
    } else AREAS[`${n.id}_${r.id}`](c, g, n, x, ry, w, t);
  }
  const fy = y + h - FT;
  rect(c, x, fy, w, FT, '#0e0e0e');
  rect(c, x, fy, w, 1, '#272727');
  tx(c, n.f, x + 12, fy + 13, 9.6, K.q, { ls: 0.06 });
  const [rt, rc] = runtime(n.id, t);
  tx(c, rt, x + w - 12, fy + 13, 9.6, rc, { al: 'right', w: 500 });
  box(c, x, y, w, h, '#2b2b2b');
  const wb = Math.max(done * 0.42, act, sel);
  if (wb > 0) box(c, x, y, w, h, wa(255, wb));
  if (sel > 0) box(c, x - 1, y - 1, w + 2, h + 2, wa(255, 0.42 * sel));
  if (act > 0) {
    const br = n.id === 'pz' && t >= PZ0 && t < PZ1 ? 0.75 + 0.25 * Math.sin((t - PZ0) * 4.4) : 1;
    box(g, x - 1, y - 1, w + 2, h + 2, wa(255, 0.85 * act * br), 2);
    box(g, x - 4, y - 4, w + 8, h + 8, wa(255, 0.12 * act * br), 3);
    box(c, x - 1, y - 1, w + 2, h + 2, wa(255, 0.35 * act));
  }
  if (sel > 0) box(g, x - 1, y - 1, w + 2, h + 2, wa(255, 0.22 * sel));
};

const runtime = (id, t) => {
  const on = iv(ACT[id], t, 1e-4) > 0;
  const W_ = K.soft, R_ = '#ffffff';
  if (id === 'pz') {
    if (t >= PZ0 && t < PZ1) return ['paused', R_];
    if (t >= PZ1) return [`${itersDone(t)}x · 2 ms`, W_];
    return t >= DONE.pz ? [`${IT0.filter((_, k) => t >= ip(k, 0.86)).length}x · 1 ms`, W_] : ['not run', W_];
  }
  if (id === 'im') {
    const n = IT0.filter((_, k) => t >= ip(k, 0.16)).length;
    if (on) return [n > 1 ? `${n}x · running` : 'running', R_];
    const d = IT0.filter((_, k) => t >= ip(k, 0.7)).length;
    return d ? [`${d > 1 ? d + 'x · ' : ''}${ITS[d - 1].toFixed(2)} s`, W_] : ['not run', W_];
  }
  if (id === 'ld') {
    if (t >= LDONE) return ['9x · 41.6 s', W_];
    if (t >= PZ0 && t < PZ1) return ['waiting', W_];
    return on ? [`${itersOn(t)}x · running`, R_] : ['not run', W_];
  }
  if (id === 'lo') {
    const d = itersDone(t);
    return d ? [`${d}/9 · ${t >= LDONE ? 'done' : 'collecting'}`, d === 9 ? W_ : R_] : ['not run', W_];
  }
  if (id === 'op') return t >= VS ? [t < HANDOFF.t ? 'playing' : 'hero ↗', R_] : ['not run', W_];
  if (on) return ['running', R_];
  const fin = { pr: '1 ms', br: '3 ms', ag: '2.41 s', vd: '38.6 s' };
  return t >= DONE[id] ? [fin[id], W_] : ['not run', W_];
};

const dimOf = (id, t) => {
  const d = seg(t, PZ0, PZ0 + 0.45, E.outQ) * (1 - seg(t, PZ1 + 0.06, PZ1 + 0.6, E.ioQ));
  return id === 'pz' ? 0 : id === 'lo' ? 0.45 * d : 0.66 * d;
};

const selOf = (id, t) => {
  if (t < 3.72 || t > 7.6) return 0;
  let best = null;
  for (const k of ['ag', 'ld', 'im', 'pz', 'lo', 'vd', 'op']) if (t >= POP[k]) best = k;
  return best === id ? 1 - seg(t, 7.3, 7.6) : 0;
};

const grid = (c, ox, oy, z) => {
  const s = 50 * z, x0 = WX, y0 = CY0;
  const i0 = Math.ceil((x0 - ox) / s), i1 = Math.floor((x0 + WW - ox) / s);
  const j0 = Math.ceil((y0 - oy) / s), j1 = Math.floor((y0 + CH - oy) / s);
  c.fillStyle = '#0d0d0d';
  for (let i = i0; i <= i1; i++) if (i % 5 === 0) c.fillRect(sn(ox + i * s), y0, 1, CH);
  for (let j = j0; j <= j1; j++) if (j % 5 === 0) c.fillRect(x0, sn(oy + j * s), WW, 1);
  const d = 1.5;
  for (let i = i0; i <= i1; i++) {
    const px = sn(ox + i * s - d / 2);
    for (let j = j0; j <= j1; j++) {
      const mj = i % 5 === 0 && j % 5 === 0;
      c.fillStyle = mj ? '#2e2e2e' : '#1b1b1b';
      c.fillRect(px, sn(oy + j * s - d / 2), mj ? 2 : d, mj ? 2 : d);
    }
  }
};

const wireLW = z => 1.3 + 0.95 * z;

const wires = (c, g, t, z) => {
  ED.forEach((e, i) => {
    const t0 = CON[i];
    if (t < t0) return;
    const dk = i > 2 ? E.outQ(clamp((t - t0) / DRW)) : 1;
    let p = bzG(e.g);
    if (dk < 1) p = sub(p, 0, dk);
    if (!p) return;
    const dm = Math.max(dimOf(e.fa, t), dimOf(e.ta, t)) * (i === 4 || i === 5 ? 0.6 : 1);
    const col = ST[e.ty];
    stroke(c, p, ca(col, 0.92 * (1 - dm)), wireLW(z), e.ty === 'bundle' ? [7, 5] : null);
    const fl = 1 - seg(t, conAt(i), conAt(i) + 0.4, E.outQ);
    if (fl > 0 && fl < 1) stroke(g, p, ca(col, 0.9 * fl), wireLW(z) + 1);
  });
};

const pulses = (c, g, t, z) => {
  for (const [i, t0, t1, s = 1] of PU) {
    if (t < t0 || t > t1 + 0.05) continue;
    const e = ED[i], u = E.ioQ(clamp((t - t0) / (t1 - t0)));
    const a = s * Math.min(seg(t, t0, t0 + 0.04), 1 - seg(t, t1 - 0.01, t1 + 0.05)) * (1 - Math.max(dimOf(e.fa, t), dimOf(e.ta, t)));
    if (a <= 0) continue;
    const p = bzG(e.g), hu = e.lut(u), tu = e.lut(Math.max(0, u - 0.3 * s));
    const sp_ = sub(p, tu, hu);
    if (!sp_) continue;
    const [hx, hy] = at(p, hu), [qx, qy] = at(p, tu), col = ST[e.ty];
    for (const [x, aa, lw, cc] of [[c, a, wireLW(z) + 1.4 * s, col], [g, a * 0.95, wireLW(z) + 2.6 * s, col]]) {
      const gr = x.createLinearGradient(qx, qy, hx, hy);
      gr.addColorStop(0, ca(cc, 0));
      gr.addColorStop(1, ca(cc, aa));
      stroke(x, sp_, gr, lw);
    }
    const hs = (4 + 2.6 * z) * (0.55 + 0.45 * s);
    c.fillStyle = `rgba(255,255,255,${a})`;
    c.fillRect(sn(hx - hs / 2), sn(hy - hs / 2), sn(hs), sn(hs));
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(sn(hx - hs), sn(hy - hs), sn(hs * 2), sn(hs * 2));
  }
};

const dragWire = (c, g, t, z) => {
  for (const [i, a, b] of DRAG) {
    if (t < a || t >= b) continue;
    const e = ED[i], A0 = sp(e.fa, e.fs), B0 = sp(e.ta, e.ts);
    const sx = X(A0.x), sy = Y(A0.y), tgx = X(B0.x), tgy = Y(B0.y);
    let [cx, cy] = cur(t);
    const dd = Math.hypot(cx - tgx, cy - tgy), snap = dd < 26;
    if (snap) { cx = tgx; cy = tgy; }
    const dx = Math.max(Math.abs(cx - sx) * 0.5, 60 * z);
    const p = [sx, sy, sx + dx, sy, cx - dx, cy, cx, cy];
    c.save();
    c.lineDashOffset = -t * 18;
    stroke(c, p, snap ? ca(ST[e.ty], 0.95) : 'rgba(255,255,255,0.85)', snap ? wireLW(z) : 1.5, snap ? null : [4, 3]);
    c.restore();
    const pr = clamp(1 - dd / 90);
    if (pr > 0) {
      const k = 1 + 0.45 * pr;
      sock(c, B0.x, B0.y, ST[e.ty], 0, { k, ring: 0.6 * pr });
      box(g, B0.x - 9 * k - 2, B0.y - 9 * k - 2, 18 * k + 4, 18 * k + 4, ca(ST[e.ty], 0.5 * pr), 1);
    }
    const so = sp(e.fa, e.fs);
    box(g, so.x - 10, so.y - 10, 20, 20, wa(255, 0.35), 1);
  }
};

const mast = (c, g, t) => {
  setV(0, 0, 1);
  rect(c, WX, WY, WW, MH, K.mast);
  rect(c, WX, WY + MH - 1, WW, 1, '#1d1d1d');
  const my = WY + MH / 2;
  tx(c, 'rundeer', WX + 15, my, 15.5, K.tx, { w: 700, f: F.disp, dy: 0.3 });
  let x = WX + 15 + tw(c, 'rundeer', 15.5, 700, F.disp) + 10;
  const vw = tw(c, 'v0.3.5', 10.4, 400, F.mono, 0.08) + 12;
  rect(c, x, my - 9, vw, 18, '#0e0e0e');
  box(c, x, my - 9, vw, 18, '#343434');
  tx(c, 'v0.3.5', x + 6, my, 10.4, '#9b9b9b', { ls: 0.08 });
  x += vw + 9;
  rect(c, x, my - 1.5, 3, 3, '#4a4a4a');
  x += 11;
  tx(c, '~/studio/desert-dc', x, my, 11, '#c9c9c9');
  x += tw(c, '~/studio/desert-dc', 11) + 22;
  const ra = seg(t, RUN + 0.05, RUN + 0.25) * (1 - seg(t, VD[4] + 0.3, VD[4] + 0.6));
  if (ra > 0) {
    const ps = t >= PZ0 && t < PZ1, lab = `desert_dc · ${ps ? 'paused' : 'running'}`;
    const lw = tw(c, lab, 9.6, 400, F.mono, 0.08) + 34;
    c.globalAlpha = ra;
    rect(c, x, my - 11, lw, 22, '#151515');
    box(c, x, my - 11, lw, 22, '#5a5a5a');
    const pu = ps ? 0.9 : 0.55 + 0.45 * Math.sin(t * 4.5);
    rect(c, x + 10, my - 3.5, 7, 7, wa(255, pu));
    rect(g, x + 8, my - 5.5, 11, 11, wa(255, 0.6 * pu * ra));
    tx(c, lab, x + 25, my, 9.6, K.soft, { up: 1, ls: 0.08 });
    c.globalAlpha = 1;
  }
  const tw_ = 30, gx1 = WX + WW - 12, gx0 = gx1 - (tw_ * 4 + 6);
  rect(c, gx0, my - 13, gx1 - gx0, 26, '#050505');
  box(c, gx0, my - 13, gx1 - gx0, 26, '#262626');
  rect(c, gx0 + 2, my - 11, tw_, 22, '#242424');
  const ix = gx0 + 2 + tw_ / 2;
  box(c, ix - 6, my - 5, 12, 10, '#ffffff');
  rect(c, ix - 0.5, my - 5, 1, 10, '#ffffff');
  rect(c, ix - 6, my - 0.5, 12, 1, '#ffffff');
  const i2 = ix + tw_ + 1;
  box(c, i2 - 5, my - 5, 10, 10, '#7a7a7a');
  const i3 = i2 + tw_ + 1;
  c.save();
  c.strokeStyle = '#7a7a7a'; c.lineWidth = 1.2;
  c.beginPath(); c.arc(i3, my, 3.6, 0, Math.PI * 2); c.stroke();
  for (let k = 0; k < 8; k++) {
    const an = k * Math.PI / 4;
    c.fillStyle = '#7a7a7a';
    c.fillRect(i3 + Math.cos(an) * 5.4 - 0.9, my + Math.sin(an) * 5.4 - 0.9, 1.8, 1.8);
  }
  c.restore();
  rect(c, i3 + tw_ / 2 + 2, my - 9, 1, 18, '#2c2c2c');
  tx(c, '?', i3 + tw_ + 3, my, 12, K.soft, { al: 'center', w: 600 });
};

const dock = (c, g, t) => {
  setV(0, 0, 1);
  rect(c, DX, DY, DW, DH, 'rgba(4,4,4,0.94)');
  box(c, DX, DY, DW, DH, '#3a3a3a');
  for (let r = 0; r < 3; r++) for (let q = 0; q < 2; q++) rect(c, DX + 7 + q * 3.5, DY + 11 + r * 4, 1.6, 1.6, '#4c4c4c');
  const bx = DX + 20, by = DY + 4;
  const running = t >= RUN + 0.06 && t < VD[4], paused = t >= PZ0 && t < PZ1;
  const [cx, cy] = cur(t), hv = !running && t < RUN + 0.06 && cx > bx - 2 && cx < bx + 26 && cy > by - 2 && cy < by + 26;
  const pr = 1 - clamp(Math.abs(t - RUN - 0.01) / 0.07);
  if (!running) {
    const o = pr > 0.3 ? 1 : 0;
    rect(c, bx, by + o, 24, 24, hv ? '#dcdcdc' : '#ffffff');
    tri(c, bx + 9.5, by + 12 + o, 7, '#050505');
  } else {
    rect(c, bx, by, 24, 24, 'oklch(68% 0.17 25)');
    rect(c, bx + 8.5, by + 8.5, 7, 7, '#050505');
    rect(c, bx + 26, by, 24, 24, paused ? '#ffffff' : '#c8c8c8');
    if (paused) tri(c, bx + 35.5, by + 12, 7, '#050505');
    else { rect(c, bx + 34, by + 8, 2, 8, '#050505'); rect(c, bx + 38, by + 8, 2, 8, '#050505'); }
  }
  const fl = seg(t, RUN, RUN + 0.04) * (1 - seg(t, RUN + 0.04, RUN + 0.45, E.outQ));
  if (fl > 0) rect(g, bx - 3, by - 3, 30, 30, wa(255, 0.8 * fl));
  let x = DX + 82;
  tx(c, 'tab', x, DY + 16, 8, K.wh, { up: 1, ls: 0.14 });
  x += 26;
  tx(c, 'desert_dc', x, DY + 16, 10.4, K.mut, { w: 600, ls: 0.04 });
  x += tw(c, 'desert_dc', 10.4, 600, F.mono, 0.04) + 14;
  const d = Math.max(itersDone(t), t >= LDONE ? 9 : 0);
  const st = t < RUN + 0.06 ? 'ready · 9 nodes' : t >= VD[4] ? `done · 9/9 · ${clock(elapsed(t))}` : `${paused ? 'paused' : 'running'} · ${d}/9 · ${clock(elapsed(t))}`;
  tx(c, st, x, DY + 16, 9.2, t < RUN + 0.06 ? K.q : t >= VD[4] ? '#ffffff' : paused ? K.soft : '#e8e8e8', { ls: 0.03 });
  const lx0 = DX + DW - 150, lx1 = DX + DW - 62;
  const da = seg(t, RUN + 0.1, RUN + 0.5);
  if (da > 0) {
    c.globalAlpha = da;
    const off = (t * 26) % 6;
    for (let q = lx0 + 6 - off; q < lx1; q += 6) if (q > lx0) rect(c, q, DY + 27, 2, 1, '#3a3a3a');
    c.globalAlpha = 1;
    deerSprite(c, g, t, { x: (lx0 + lx1) / 2, y: DY + 27, h: 26, a: da });
  }
  rect(c, DX + DW - 52, by, 24, 24, '#ffffff');
  rect(c, DX + DW - 44.5, by + 11.25, 9, 1.5, '#050505');
  rect(c, DX + DW - 40.75, by + 7.5, 1.5, 9, '#050505');
  c.save();
  c.strokeStyle = '#7a7a7a'; c.lineWidth = 1.3;
  c.beginPath(); c.moveTo(DX + DW - 19, DY + 18); c.lineTo(DX + DW - 14, DY + 13); c.lineTo(DX + DW - 9, DY + 18); c.stroke();
  c.restore();
};

const tri = (c, x, y, s, col) => {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(X(x - s * 0.4), Y(y - s * 0.6));
  c.lineTo(X(x - s * 0.4), Y(y + s * 0.6));
  c.lineTo(X(x + s * 0.65), Y(y));
  c.closePath();
  c.fill();
};

const windowBody = (c, g, t) => {
  const bgG = c.createLinearGradient(0, CY0, 0, CY0 + CH);
  bgG.addColorStop(0, '#070707');
  bgG.addColorStop(1, '#040404');
  c.fillStyle = bgG;
  c.fillRect(WX, CY0, WW, CH);
  const [ox, oy, z] = camV(t);
  c.save(); g.save();
  for (const x of [c, g]) { x.beginPath(); x.rect(WX, CY0, WW, CH); x.clip(); }
  grid(c, ox, oy, z);
  setV(ox, oy, z);
  wires(c, g, t, z);
  dragWire(c, g, t, z);
  for (const n of NL) {
    const t0 = POP[n.id];
    if (t < t0) continue;
    const k = t0 ? seg(t, t0, t0 + 0.26, E.outX) : 1;
    const sc = 0.93 + 0.07 * k, ncx = n.x + n.w / 2, ncy = n.y + n.h / 2;
    setV(X(ncx) - ncx * z * sc, Y(ncy) - ncy * z * sc, z * sc);
    c.globalAlpha = k; g.globalAlpha = k;
    node(c, g, n, t, Math.max(selOf(n.id, t), k < 1 ? 1 : 0));
    const dm = dimOf(n.id, t);
    if (dm > 0) {
      rect(c, n.x - 11, n.y - 2, n.w + 22, n.h + 4, `rgba(3,3,3,${dm})`);
      g.globalCompositeOperation = 'destination-out';
      rect(g, n.x - 11, n.y - 5, n.w + 22, n.h + 10, `rgba(0,0,0,${dm})`);
      g.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = 1; g.globalAlpha = 1;
    setV(ox, oy, z);
  }
  pulses(c, g, t, z);
  c.restore(); g.restore();
  mast(c, g, t);
  dock(c, g, t);
  setV(0, 0, 1);
  box(c, WX, WY, WW, WH, '#2a2a2a');
  rect(c, WX + 1, WY + 1, WW - 2, 1, 'rgba(255,255,255,0.05)');
};

const cursorL = (c, g, t) => {
  const a = seg(t, 3.4, 3.58) * (1 - seg(t, 22.6, 23.0));
  if (a <= 0) return;
  for (const tc of [...CLK, ...DRAG.flatMap(d => [d[1], d[2]])]) {
    const k = (t - tc) / 0.42;
    if (k < 0 || k > 1) continue;
    const [rx, ry] = cur(tc), r = 3 + 15 * E.outQ(k), al = 0.85 * (1 - k) * a;
    for (const [x, m] of [[c, 1], [g, 0.8]]) {
      x.beginPath(); x.arc(rx, ry, r, 0, Math.PI * 2);
      x.strokeStyle = `rgba(255,255,255,${al * m})`; x.lineWidth = 1.2; x.stroke();
    }
  }
  const [x, y] = cur(t), s = 1 - 0.1 * press(t);
  const beam = (t > 15.02 && t < 15.42);
  if (beam) ibeam(c, x, y, s, a);
  else arrow(c, x, y, s, a);
};

export default {
  name: 'ui',
  async init(env) {
    SS = env.SS;
    V.ss = SS;
    await Promise.all([document.fonts.load(`700 13px ${F.body}`), document.fonts.load(`600 11px ${F.mono}`), document.fonts.load(`700 15px ${F.disp}`)]);
    L = env.mk(env.W * SS, env.H * SS);
    Lg = env.mk(env.W, env.H);
    L.getContext('2d', { willReadFrequently: true });
    Lg.getContext('2d', { willReadFrequently: true });
    SHD = env.mk(470, 296);
    const sx = SHD.getContext('2d', { willReadFrequently: true });
    sx.filter = 'blur(14px)';
    sx.fillStyle = 'rgba(0,0,0,0.9)';
    sx.fillRect(30, 23.5, 410, 230.5);
    const its = await Promise.all(Array.from({ length: A.iterN }, (_, i) => loadImg(A.iter(i + 1))));
    const dcs = await Promise.all(Array.from({ length: A.dcN }, (_, i) => loadImg(A.dc(i + 1))));
    DC.push(...dcs);
    const mkT = (im, w, h) => {
      const cv = env.mk(w, h), x = cv.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(im, 0, 0, w, h);
      return cv;
    };
    for (const im of its) {
      const b = mkT(im, 480, 360);
      TH.push(b);
      TS.push(mkT(b, 200, 150));
      TP.push(mkT(mkT(b, 64, 48), 16, 12));
    }
    TP.push(mkT(mkT(dcs[0], 64, 48), 20, 15));
    const bA = bbox(['pr', 'br', 'ag', 'ld', 'im']), all = bbox(NL.map(n => n.id));
    const ovz = Math.min((WW - 110) / all.w, (CH - 260) / all.h);
    const OV = [all.cx, all.cy - 10, ovz];
    const pz = N.pz, pv = area('op', 'pv'), pvx = pv.x + 8, pvy = pv.y + 6;
    const KF = [pvx - (HANDOFF.rect.x - CCX), pvy - (HANDOFF.rect.y - CCY), HANDOFF.rect.w / 384];
    const PZC = [pz.x + pz.w / 2 + 165, pz.y + pz.h / 2 + 4, 1.5];
    CAM = [
      [2.7, 610, bA.cy, 0.98],
      [6.15, 650, bA.cy, 1.03, E.ioQ],
      [7.75, OV[0], OV[1], OV[2], E.ioQ5],
      [12.98, OV[0] + 12, OV[1] - 4, OV[2] * 1.015, E.ioQ],
      [13.95, PZC[0], PZC[1], PZC[2], E.ioQ5],
      [PZ1 + 0.04, PZC[0] + 12, PZC[1] + 8, PZC[2] * 1.06, E.ioQ],
      [19.5, OV[0], OV[1], OV[2], E.ioQ5],
      [22.0, OV[0] + 14, OV[1] + 3, OV[2] * 1.015, E.ioQ],
      [23.55, KF[0], KF[1], KF[2], E.ioQ5],
      [40, KF[0], KF[1], KF[2]],
    ];
    const S = (x, y) => ({ s: [x, y] }), G = (x, y) => ({ g: [x, y] }), Kp = (id, s) => ({ k: [id, s] });
    const nh = id => G(N[id].x + N[id].w * 0.46, N[id].y + 17);
    const pg = area('pz', 'grid'), cw = (pz.w - 20) / 2, chh = cw * 0.75;
    const c4 = G(pz.x + 8 + cw + 4 + cw * 0.56, pg.y + 4 + chh + 4 + chh * 0.48);
    const nt = area('pz', 'note'), bt = area('pz', 'btn');
    MV = [
      [3.4, 3.4, S(1330, 972)],
      [3.42, 3.7, nh('ag')],
      [3.74, 3.98, Kp('pr', 'out')],
      [4.0, 4.38, Kp('ag', 'prompt')],
      [4.42, 4.62, Kp('br', 'out')],
      [4.64, 5.0, Kp('ag', 'brain')],
      [5.04, 5.31, nh('ld')],
      [5.36, 5.56, Kp('ag', 'out')],
      [5.58, 5.94, Kp('ld', 'seed')],
      [5.98, 6.19, nh('im')],
      [6.32, 7.05, S(1190, 908)],
      [7.22, 8.27, S(DX + 33, DY + 17)],
      [8.52, 9.35, S(520, 868)],
      [13.15, 14.46, c4],
      [14.68, 15.18, G(nt.x + 70, nt.y + 17)],
      [15.34, 15.72, G(pz.x + pz.w + 40, nt.y + 2)],
      [17.46, 18.1, G(bt.x + pz.w * 0.56, bt.y + 21)],
      [18.32, 19.4, S(1560, 940)],
    ];
  },
  draw(ctx, glow, t, env) {
    if (t < T_IN || t > 25.7) return;
    TT = t;
    const ai = seg(t, T_IN, T_IN + 0.7, E.outX), ao = seg(t, T_OUT, T_END, E.ioQ);
    const wa_ = ai * (1 - ao), ws = lerp(0.965, 1, ai) * lerp(1, 0.985, ao);
    if (wa_ <= 0.001) return;
    const cx = WX + WW / 2, cy = WY + WH / 2;
    const sc = x => { x.translate(cx, cy); x.scale(ws, ws); x.translate(-cx, -cy); };
    const c = L.getContext('2d'), g = Lg.getContext('2d');
    const bx = WX - 2, by = WY - 2, bw = WW + 4, bh = WH + 4;
    for (const [x, k] of [[c, SS], [g, 1]]) { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(bx * k, by * k, bw * k, bh * k); x.setTransform(k, 0, 0, k, 0, 0); x.save(); sc(x); }
    windowBody(c, g, t);
    c.restore(); g.restore();
    c.save(); g.save();
    c.beginPath(); c.rect(bx, by, bw, bh); c.clip();
    g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
    setV(0, 0, 1);
    cursorL(c, g, t);
    c.restore(); g.restore();
    ctx.save(); sc(ctx); ctx.globalAlpha = wa_;
    for (const [u, v, w, h] of [[0, 0, 470, 17.5], [0, 248, 470, 48], [0, 17.5, 30, 230.5], [440, 17.5, 30, 230.5]]) ctx.drawImage(SHD, u, v, w, h, WX - 120 + u * 4, WY - 70 + v * 4, w * 4, h * 4);
    ctx.restore();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = wa_;
    ctx.drawImage(L, bx * SS, by * SS, bw * SS, bh * SS, bx * SS, by * SS, bw * SS, bh * SS);
    ctx.restore();
    glow.save(); sc(glow);
    glow.globalCompositeOperation = 'destination-out';
    glow.fillStyle = `rgba(0,0,0,${wa_})`;
    glow.fillRect(WX, WY, WW, WH);
    glow.restore();
    glow.save(); glow.globalAlpha = wa_;
    glow.drawImage(Lg, bx, by, bw, bh, bx, by, bw, bh);
    glow.restore();
  },
};
