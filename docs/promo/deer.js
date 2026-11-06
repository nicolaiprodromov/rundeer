import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { A, EV, DEER } from './timeline.js';
import { clamp, lerp, E, hash } from './lib.js';

const FZ = 0.4, SPD = 0.7, RAD = 4.84, ELV = 1, TY = 1, MW = 720, MH = 640, KS = 3, L = 4;
const PK = [255, 96, 255], VI = [107, 80, 255], WH = [255, 236, 255];
const LT = [[[4, 5, 3], 30, '#fff5e0'], [[-3, 3, 2], 12.2, '#c0d8ff'], [[-1, 4, -4], 30, '#ffe0d0']];
const B8 = new Float32Array(64);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  let v = 0;
  for (let k = 0; k < 3; k++) v = v << 2 | ((x ^ y) >> k & 1) << 1 | (y >> k & 1);
  B8[y * 8 + x] = (v + 0.5) / 64;
}
const bay = (i, j) => B8[(j & 7) * 8 + (i & 7)];
const hc = (i, j, s) => hash(i * 73.1 + j * 151.7 + s * 19.3);

let R, gl, sc, cam, mx, buf, ss = 2, img, ictx, gimg, gctx2;
const cache = new Map();
let ct = NaN;
const O3 = new THREE.Vector3();

const bsOf = h => Math.max(2, Math.round(0.28 * Math.sqrt(h)));

const rnd = (t, h, bs, az) => {
  if (t !== ct) { cache.clear(); ct = t; }
  const key = `${h}|${bs}|${az}|${t}`;
  if (cache.has(key)) return cache.get(key);
  const nx = Math.ceil(1.7 * h / bs), ny = Math.ceil(1.45 * h / bs);
  const k = Math.max(1, Math.min(KS, Math.floor(MW / nx), Math.floor(MH / ny)));
  const w = nx * k, hh = ny * k, fw = nx * bs, fh = ny * bs, D = Math.hypot(RAD, ELV);
  cam.fov = 2 * Math.atan(fh / h / D) * 180 / Math.PI;
  cam.aspect = fw / fh;
  cam.position.set(RAD * Math.sin(az), TY + ELV, RAD * Math.cos(az));
  cam.lookAt(0, TY, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  mx.setTime(t * SPD);
  R.setViewport(0, 0, w, hh);
  R.setScissor(0, 0, w, hh);
  R.setScissorTest(true);
  R.setClearColor(0x000000, 0);
  R.clear();
  R.render(sc, cam);
  gl.readPixels(0, 0, w, hh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  O3.set(Math.sin(az) * FZ, 0, Math.cos(az) * FZ).project(cam);
  const ox = (O3.x + 1) / 2 * nx, oy = (1 - O3.y) / 2 * ny;
  const lv = new Int8Array(nx * ny).fill(-1), kk = k * k * 255;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < k; sy++) {
      let p = ((hh - 1 - (j * k + sy)) * w + i * k) * 4;
      for (let sx = 0; sx < k; sx++, p += 4) { r += buf[p]; g += buf[p + 1]; b += buf[p + 2]; a += buf[p + 3]; }
    }
    if (!a) continue;
    const bv = bay(i, j), cv = a / kk;
    if (cv < CVT) continue;
    const lum = clamp(((0.2126 * r + 0.7152 * g + 0.0722 * b) / a * GAIN - 0.5) * CON + 0.5);
    lv[j * nx + i] = clamp(Math.floor(lum * L + DTH * (bv - 0.5) + 0.5), 0, L);
  }
  const fr = { nx, ny, bs, ox, oy, lv, top: oy - h / bs };
  cache.set(key, fr);
  return fr;
};

const GAIN = 1.45, CON = 1.6, CVT = 0.3, DTH = 0.9;
const LVM = [0.22, 0.46, 0.74, 1, 1];
const LVW = [0, 0, 0, 0, 0.72];
const GLA = [0, 0.03, 0.1, 0.24, 0.42];

const colr = (fr, j, q, w, o) => {
  const g = clamp((j + 0.5 - fr.top) / (fr.oy - fr.top));
  const m = lerp(LVM[q], 1, w), ww = Math.max(LVW[q], w * w * 0.6);
  for (let c = 0; c < 3; c++) o[c] = lerp(lerp(PK[c], VI[c], g) * m, WH[c], ww);
  return o;
};

const EO = { al: 1, w: 0, dx: 0, dy: 0, s: 1, on: true };
const CO = [0, 0, 0];

const paint = (ctx, glow, fr, x, y, a, eff, fr2, lf = 0) => {
  const { nx, ny, bs, lv } = fr;
  const L0 = Math.round((x - fr.ox * bs) * ss) / ss, T0 = Math.round((y - fr.oy * bs) * ss) / ss;
  const id = ictx.createImageData(nx, ny), gd = gctx2.createImageData(nx, ny);
  const P = id.data, Q = gd.data;
  const fly = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const n = j * nx + i;
    const q = lv[n], q2 = fr2 ? fr2.lv[n] : -1;
    if (q < 0 && q2 < 0) continue;
    EO.al = 1; EO.w = 0; EO.dx = 0; EO.dy = 0; EO.s = 1; EO.on = true;
    const q0 = eff ? eff(i, j, EO, q, q2) : q;
    if (q0 < 0 || !EO.on) continue;
    const qq = Math.min(L, q0 + lf);
    colr(fr, j, qq, EO.w, CO);
    const al = a * EO.al, ga = clamp(a * EO.al * (GLA[qq] + EO.w * 0.9));
    if (EO.dx || EO.dy || EO.s !== 1) { fly.push([i, j, CO[0], CO[1], CO[2], al, ga, EO.dx, EO.dy, EO.s]); continue; }
    const p = n * 4;
    P[p] = CO[0]; P[p + 1] = CO[1]; P[p + 2] = CO[2]; P[p + 3] = al * 255;
    if (ga > 0) { Q[p] = CO[0]; Q[p + 1] = CO[1]; Q[p + 2] = CO[2]; Q[p + 3] = ga * 255; }
  }
  ictx.putImageData(id, 0, 0);
  gctx2.putImageData(gd, 0, 0);
  for (const [c, s] of [[ctx, img], [glow, gimg]]) {
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(s, 0, 0, nx, ny, L0, T0, nx * bs, ny * bs);
    c.restore();
  }
  if (!fly.length) return;
  for (const [c, gi] of [[ctx, 5], [glow, 6]]) {
    c.save();
    for (const f of fly) {
      if (f[gi] <= 0.003) continue;
      const z = Math.max(1 / ss, Math.round(bs * f[9] * ss) / ss);
      const px = Math.round((L0 + f[0] * bs + f[7] + (bs - z) / 2) * ss) / ss;
      const py = Math.round((T0 + f[1] * bs + f[8] + (bs - z) / 2) * ss) / ss;
      c.globalAlpha = f[gi];
      c.fillStyle = `rgb(${f[2] | 0},${f[3] | 0},${f[4] | 0})`;
      c.fillRect(px, py, z, z);
    }
    c.restore();
  }
};

const AZS = 0.12;
const azI = t => 0.3 + 0.15 * t;
const azE = t => 0.25 + 0.06 * (t - EV.endCard);

export function deerSprite(ctx, glow, t, { x, y, h, a = 1 }) {
  if (!mx || a <= 0) return;
  const bs = bsOf(h);
  paint(ctx, glow, rnd(t, h, bs, AZS), x, y, a, null, null, h < 120 ? 1 : 0);
}

const resolve = (p, i, j, o, q) => {
  const b = bay(i, j), u = p / 0.22;
  if (u < 1 && b > u) return -1;
  if (p < 0.3) { o.w = clamp(1 - (u - b) / 0.5) * 0.7; return q; }
  const f = p < 0.55 ? (p - 0.3) / 0.2 : (p - 0.55) / 0.3;
  o.w = clamp(1 - f) * (p < 0.55 ? 0.45 : 0.3) * (0.5 + 0.5 * b);
  return q;
};

const stage = p => p < 0.3 ? 4 : p < 0.55 ? 2 : 1;

const hero = (ctx, glow, t, D, t0, rd, az, exit) => {
  const base = bsOf(D.h), p = clamp((t - t0) / rd);
  const m = p < 1 ? stage(p) : 1, bs = base * m;
  const fr = rnd(t, D.h, bs, az(t));
  if (p < 1) return paint(ctx, glow, fr, D.x, D.y, 1, (i, j, o, q) => q < 0 ? -1 : resolve(p, i, j, o, q), null);
  if (!exit || t < exit[0]) return paint(ctx, glow, fr, D.x, D.y, 1, null, null);
  const e = (t - exit[0]) / (exit[1] - exit[0]);
  const fz = rnd(exit[0], D.h, bs, az(exit[0]));
  const cx = fr.nx / 2, cy = fr.oy - D.h / bs * 0.5;
  return paint(ctx, glow, fr, D.x, D.y, 1, (i, j, o, q, q2) => {
    const sc0 = 0.55 * (0.62 * bay(i, j) + 0.38 * hc(i, j, 1));
    if (e < sc0) return q;
    if (q2 < 0) return -1;
    const k = clamp((e - sc0) / 0.45);
    const ang = Math.atan2(j - cy, i - cx) + (hc(i, j, 2) - 0.5) * 0.9;
    const dist = Math.pow(k, 1.5) * (30 + 240 * hc(i, j, 3));
    o.dx = Math.cos(ang) * dist;
    o.dy = Math.sin(ang) * dist * 0.6 - (40 + 140 * hc(i, j, 4)) * E.outQ(k);
    o.al = Math.pow(1 - k, 1.4);
    o.w = clamp(1 - k * 3) * 0.6;
    o.s = 1 - 0.3 * k;
    return q2;
  }, fz);
};

export default {
  name: 'deer',
  async init(env) {
    ss = env.SS;
    const cv = env.mk(MW, MH);
    R = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
    R.setPixelRatio(1);
    R.setSize(MW, MH, false);
    R.setClearColor(0x000000, 0);
    R.shadowMap.enabled = true;
    R.shadowMap.type = THREE.PCFSoftShadowMap;
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 1;
    R.outputColorSpace = THREE.SRGBColorSpace;
    gl = R.getContext();
    buf = new Uint8Array(MW * MH * 4);
    sc = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    sc.add(new THREE.AmbientLight(new THREE.Color('#404050'), 0.15));
    for (const [p, i, c] of LT) {
      const l = new THREE.SpotLight(new THREE.Color(c), i);
      l.position.set(...p);
      l.target.position.set(0, 0.5, 0);
      l.angle = 1.0472; l.penumbra = 0.6; l.decay = 1.5;
      l.castShadow = true;
      l.shadow.mapSize.set(512, 512);
      l.shadow.bias = -0.0005; l.shadow.normalBias = 0.02;
      l.shadow.camera.near = 0.5; l.shadow.camera.far = 30;
      sc.add(l, l.target);
    }
    const g = await new GLTFLoader().loadAsync(A.glb);
    const md = g.scene;
    const sz = new THREE.Box3().setFromObject(md).getSize(new THREE.Vector3());
    md.scale.setScalar(2 / sz.y);
    const bx = new THREE.Box3().setFromObject(md), ce = bx.getCenter(new THREE.Vector3());
    md.position.x -= ce.x; md.position.z -= ce.z; md.position.y -= bx.min.y;
    md.traverse(c => {
      if (!c.isMesh) return;
      c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false;
      for (const m of [].concat(c.material)) {
        m.side = THREE.DoubleSide;
        if (m.transparent) { m.transparent = false; m.alphaTest = 0.5; }
        m.depthWrite = true; m.needsUpdate = true;
      }
    });
    sc.add(md);
    mx = new THREE.AnimationMixer(md);
    const cl = g.animations[0], r0 = cl.tracks[0].name.split('.')[0];
    const tr = cl.tracks.filter(k => !((k.name.startsWith('Armature.') || k.name.split('.')[0] === r0) && k.name.endsWith('.position')));
    mx.clipAction(new THREE.AnimationClip(cl.name, cl.duration, tr)).setLoop(THREE.LoopRepeat).play();
    img = env.mk(256, 256); ictx = img.getContext('2d', { willReadFrequently: true });
    gimg = env.mk(256, 256); gctx2 = gimg.getContext('2d', { willReadFrequently: true });
  },
  draw(ctx, glow, t, env) {
    if (t < EV.uiIn + 0.7) hero(ctx, glow, t, DEER.intro, 0, 0.9, azI, [EV.uiIn, EV.uiIn + 0.7]);
    else if (t >= EV.endCard) hero(ctx, glow, t, DEER.end, EV.endCard, 0.6, azE, null);
  },
};
