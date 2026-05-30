import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const ASSETS = '/splash-assets';

const PixelShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    pixelSize: { value: 4.0 },
    colorLevels: { value: 256.0 },
    ditherAmount: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float pixelSize;
    uniform float colorLevels;
    uniform float ditherAmount;
    varying vec2 vUv;

    float dither8x8(vec2 position) {
      int x = int(mod(position.x, 8.0));
      int y = int(mod(position.y, 8.0));
      int index = x + y * 8;
      float limit = 0.0;
      if (index ==  0) limit = 0.015625;
      else if (index ==  1) limit = 0.515625;
      else if (index ==  2) limit = 0.140625;
      else if (index ==  3) limit = 0.640625;
      else if (index ==  4) limit = 0.046875;
      else if (index ==  5) limit = 0.546875;
      else if (index ==  6) limit = 0.171875;
      else if (index ==  7) limit = 0.671875;
      else if (index ==  8) limit = 0.765625;
      else if (index ==  9) limit = 0.265625;
      else if (index == 10) limit = 0.890625;
      else if (index == 11) limit = 0.390625;
      else if (index == 12) limit = 0.796875;
      else if (index == 13) limit = 0.296875;
      else if (index == 14) limit = 0.921875;
      else if (index == 15) limit = 0.421875;
      else if (index == 16) limit = 0.203125;
      else if (index == 17) limit = 0.703125;
      else if (index == 18) limit = 0.078125;
      else if (index == 19) limit = 0.578125;
      else if (index == 20) limit = 0.234375;
      else if (index == 21) limit = 0.734375;
      else if (index == 22) limit = 0.109375;
      else if (index == 23) limit = 0.609375;
      else if (index == 24) limit = 0.953125;
      else if (index == 25) limit = 0.453125;
      else if (index == 26) limit = 0.828125;
      else if (index == 27) limit = 0.328125;
      else if (index == 28) limit = 0.984375;
      else if (index == 29) limit = 0.484375;
      else if (index == 30) limit = 0.859375;
      else if (index == 31) limit = 0.359375;
      else if (index == 32) limit = 0.0625;
      else if (index == 33) limit = 0.5625;
      else if (index == 34) limit = 0.1875;
      else if (index == 35) limit = 0.6875;
      else if (index == 36) limit = 0.03125;
      else if (index == 37) limit = 0.53125;
      else if (index == 38) limit = 0.15625;
      else if (index == 39) limit = 0.65625;
      else if (index == 40) limit = 0.8125;
      else if (index == 41) limit = 0.3125;
      else if (index == 42) limit = 0.9375;
      else if (index == 43) limit = 0.4375;
      else if (index == 44) limit = 0.78125;
      else if (index == 45) limit = 0.28125;
      else if (index == 46) limit = 0.90625;
      else if (index == 47) limit = 0.40625;
      else if (index == 48) limit = 0.25;
      else if (index == 49) limit = 0.75;
      else if (index == 50) limit = 0.125;
      else if (index == 51) limit = 0.625;
      else if (index == 52) limit = 0.21875;
      else if (index == 53) limit = 0.71875;
      else if (index == 54) limit = 0.09375;
      else if (index == 55) limit = 0.59375;
      else if (index == 56) limit = 1.0;
      else if (index == 57) limit = 0.5;
      else if (index == 58) limit = 0.875;
      else if (index == 59) limit = 0.375;
      else if (index == 60) limit = 0.96875;
      else if (index == 61) limit = 0.46875;
      else if (index == 62) limit = 0.84375;
      else if (index == 63) limit = 0.34375;
      return limit;
    }

    void main() {
      vec2 dxy = pixelSize / resolution;
      vec2 coord = dxy * floor(vUv / dxy) + dxy * 0.5;
      vec4 color = texture2D(tDiffuse, coord);

      if (colorLevels < 256.0) {
        float levels = colorLevels - 1.0;
        vec2 pixelCoord = vUv * resolution;
        float d = dither8x8(pixelCoord) - 0.5;
        color.rgb += ditherAmount * d / levels;
        color.rgb = floor(color.rgb * levels + 0.5) / levels;
      }

      gl_FragColor = color;
    }
  `
};

function addSpotLight(scene, lightCfg) {
  if (!lightCfg.enabled) return;
  const light = new THREE.SpotLight(new THREE.Color(lightCfg.color), lightCfg.intensity);
  light.position.set(...lightCfg.position);
  light.target.position.set(0, 0.5, 0);
  light.angle = lightCfg.angle;
  light.penumbra = lightCfg.penumbra;
  light.decay = 1.5;
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 30;
  scene.add(light);
  scene.add(light.target);
}

function loadModel(scene, controls, cfg) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(`${ASSETS}/source/Deer walk.glb`, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const targetHeight = 2.0;
      const scale = targetHeight / size.y;
      model.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(model);
      const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
      model.position.x -= scaledCenter.x;
      model.position.z -= scaledCenter.z;
      model.position.y -= scaledBox.min.y;

      model.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          m.side = THREE.DoubleSide;
          if (m.transparent) { m.transparent = false; m.alphaTest = 0.5; }
          m.depthWrite = true;
          m.needsUpdate = true;
        });
      });

      scene.add(model);

      let mixer = null;
      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        mixer.timeScale = cfg.animation.speed;
        const clip = gltf.animations[0];
        const filtered = clip.tracks.filter(t => {
          const isRoot = t.name.startsWith('Armature.') || t.name.split('.')[0] === clip.tracks[0].name.split('.')[0];
          return !(isRoot && t.name.endsWith('.position'));
        });
        const clean = new THREE.AnimationClip(clip.name, clip.duration, filtered);
        const action = mixer.clipAction(clean);
        action.setLoop(THREE.LoopRepeat);
        if (cfg.animation.playing) action.play();
      }

      controls.target.set(0, targetHeight * 0.5, 0);
      controls.update();
      resolve(mixer);
    }, undefined, reject);
  });
}

async function init() {
  const container = document.getElementById('rundeer-splash');
  if (!container) return;

  let cfg;
  try {
    cfg = await (await fetch(`${ASSETS}/config.json`)).json();
  } catch { return; }

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000);
  renderer.shadowMap.enabled = cfg.environment.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = cfg.camera;
  const camera = new THREE.PerspectiveCamera(cam.fov, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(...cam.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...cam.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enabled = false;
  controls.autoRotate = cam.autoRotate;
  controls.autoRotateSpeed = cam.autoRotateSpeed;
  controls.update();

  scene.add(new THREE.AmbientLight(
    new THREE.Color(cfg.environment.ambientColor),
    cfg.environment.ambientIntensity
  ));

  addSpotLight(scene, cfg.lights.key);
  addSpotLight(scene, cfg.lights.fill);
  addSpotLight(scene, cfg.lights.rim);

  if (cfg.environment.groundPlane) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const pixelPass = new ShaderPass(PixelShader);
  pixelPass.enabled = cfg.pixelation.enabled;
  pixelPass.uniforms.pixelSize.value = cfg.pixelation.pixelSize;
  pixelPass.uniforms.colorLevels.value = cfg.pixelation.colorLevels;
  pixelPass.uniforms.ditherAmount.value = cfg.pixelation.dither;
  composer.addPass(pixelPass);

  let mixer = null;
  try {
    mixer = await loadModel(scene, controls, cfg);
  } catch { /* model load failed, splash will just be black */ }

  let stopped = false;
  let animFrame = 0;
  const clock = new THREE.Clock();

  function animate() {
    if (stopped) return;
    animFrame = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    controls.update();
    if (cfg.pixelation.enabled) composer.render();
    else renderer.render(scene, camera);
  }
  animate();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    pixelPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  function teardown() {
    stopped = true;
    cancelAnimationFrame(animFrame);
    window.removeEventListener('resize', onResize);
    if (mixer) mixer.stopAllAction();
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    composer.dispose();
    renderer.dispose();
    container.remove();
  }

  window.__rundeerSplash = {
    resolve() {
      setTimeout(() => {
        container.style.opacity = '0';
        setTimeout(teardown, 600);
      }, 1000);
    }
  };
}

init();