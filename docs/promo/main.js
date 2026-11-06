import { W, H, DUR, F } from './lib.js';
import bg from './bg.js';
import ui from './ui.js';
import deer from './deer.js';
import reveal from './reveal.js';
import fx from './fx.js';
import hud from './hud.js';

const q = new URLSearchParams(location.search);
const SS = +(q.get('ss') || 2);
const solo = q.get('solo') ? q.get('solo').split(',') : null;
const on = m => !solo || solo.includes(m.name);

const out = document.getElementById('c');
out.width = W; out.height = H;
const octx = out.getContext('2d');

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
const scene = mk(W * SS, H * SS), glow = mk(W * SS, H * SS);
const sctx = scene.getContext('2d'), gctx = glow.getContext('2d');

const env = { W, H, SS, scene, glow, out, q, mk };
const layers = [bg, ui, deer, reveal];

const fonts = async () => {
  const fams = [[F.disp, [500, 700, 800]], [F.body, [300, 400, 500, 600]], [F.mono, [400, 500, 600]]];
  await Promise.all(fams.flatMap(([f, ws]) => ws.map(w => document.fonts.load(`${w} 16px ${f}`))));
  await document.fonts.ready;
};

const frame = t => {
  for (const [c, x] of [[scene, sctx], [glow, gctx]]) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
    x.clearRect(0, 0, c.width, c.height);
    x.setTransform(SS, 0, 0, SS, 0, 0);
  }
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, W, H);
  for (const m of layers) {
    if (!on(m)) continue;
    sctx.save(); gctx.save();
    m.draw(sctx, gctx, t, env);
    sctx.restore(); gctx.restore();
  }
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over'; octx.filter = 'none';
  octx.clearRect(0, 0, W, H);
  octx.save();
  fx.draw(octx, scene, glow, t, env);
  octx.restore();
  if (on(hud)) { octx.save(); hud.draw(octx, t, env); octx.restore(); }
};

window.__ready = (async () => {
  await fonts();
  await Promise.all([...layers, fx, hud].map(m => m.init ? m.init(env) : null));
  return true;
})();

window.__frame = t => { frame(Math.min(DUR - 1e-6, Math.max(0, t))); return true; };

if (q.has('play') || q.has('t')) {
  window.__ready.then(() => {
    if (q.has('t')) { window.__frame(+q.get('t')); return; }
    let t0 = performance.now(), t = +(q.get('from') || 0), paused = false;
    addEventListener('keydown', e => {
      if (e.key === ' ') paused = !paused;
      if (e.key === 'ArrowRight') t += 1;
      if (e.key === 'ArrowLeft') t = Math.max(0, t - 1);
    });
    const loop = now => {
      const dt = (now - t0) / 1000; t0 = now;
      if (!paused) t = (t + dt) % DUR;
      window.__frame(t);
      document.title = t.toFixed(2);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
