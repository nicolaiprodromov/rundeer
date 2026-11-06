import { pad } from './lib.js';

export const S = {
  intro: [0, 3.4],
  build: [3.4, 8.2],
  run: [8.2, 13.0],
  pause: [13.0, 18.6],
  loop: [18.6, 24.0],
  reveal: [24.0, 27.6],
  end: [27.6, 30.0],
};

export const EV = {
  uiIn: 2.7,
  runClick: 8.4,
  pauseHit: 13.0,
  pick: 14.6,
  typeA: 15.4,
  typeB: 17.4,
  resume: 18.2,
  videoStart: 22.4,
  heroIn: 24.0,
  uiOut: 24.6,
  endCard: 27.6,
  fadeOut: 29.55,
};

export const HANDOFF = { t: 24.0, rect: { x: 1286, y: 520, w: 384, h: 288 } };

export const DEER = { intro: { x: 960, y: 790, h: 540 }, end: { x: 960, y: 588, h: 250 } };

export const WORD = { intro: { x: 960, y: 846 }, end: { x: 960, y: 652 } };

export const NOTE ='lower sun · more dust · keep the grid';

export const A = {
  iter: i => `assets/iter/${pad(i)}.jpg`,
  iterN: 9,
  dc: i => `assets/dc/${pad(i, 3)}.jpg`,
  dcN: 97,
  dcFps: 24,
  glb: '../../deer-walk/source/Deer%20walk.glb',
};

export const dcFrame = t => Math.min(A.dcN, 1 + Math.floor(Math.max(0, t - EV.videoStart) * A.dcFps) % A.dcN);
