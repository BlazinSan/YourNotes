// ============================================================
// Safe Haven — real-time WebGL 3D engine (Three.js) with real assets.
// CC0 furniture (Poly Haven glTF + PBR textures) lit by CC0 HDRI
// environments, plus a live fire light. Camera dollies between THREE
// fixed angles per scene. ACES tone-map + bloom.
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const BASE = import.meta.env.BASE_URL || './';
let renderer, scene, camera, composer, bloom, raf = 0, container, clock, pmrem;
let theme = 'cabin', spot = 0, mounted = false;
let sceneRoot = null, fireLight = null, flames = [];
let camA = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
let camB = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
let camMix = 1;
let mouse = { x: 0, y: 0 }, mouseT = { x: 0, y: 0 };
const currentTarget = new THREE.Vector3();

const ANGLES = {
  cabin: [
    { pos: [0, 1.5, 4.4], tgt: [0, 1.1, -2] },
    { pos: [2.5, 1.45, 2.8], tgt: [-0.6, 1.0, -1.8] },
    { pos: [-2.5, 1.45, 2.8], tgt: [0.6, 1.0, -1.8] },
  ],
  beach: [
    { pos: [0, 1.6, 6], tgt: [0, 1.5, -10] },
    { pos: [3.4, 1.6, 5], tgt: [-2, 1.4, -10] },
    { pos: [-3.4, 1.6, 5], tgt: [2, 1.4, -10] },
  ],
  city: [
    { pos: [0, 1.5, 4.2], tgt: [0, 1.4, -6] },
    { pos: [2.3, 1.4, 3.2], tgt: [-1.6, 1.3, -6] },
    { pos: [-2.3, 1.4, 3.2], tgt: [1.6, 1.3, -6] },
  ],
};

// ---------- async asset loaders (cached) ----------
const gltfLoader = new GLTFLoader(), rgbeLoader = new RGBELoader();
const modelCache = {}, hdriPromise = {}, hdriTex = {};
function loadModel(slug) {
  if (modelCache[slug]) return Promise.resolve(modelCache[slug]);
  return new Promise((res) => {
    gltfLoader.setPath(`${BASE}haven3d/models/${slug}/`).load(`${slug}_1k.gltf`, (g) => {
      g.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = false; if (o.material) o.material.envMapIntensity = 1.0; } });
      modelCache[slug] = g.scene; res(g.scene);
    }, undefined, () => { modelCache[slug] = new THREE.Group(); res(modelCache[slug]); });
  });
}
function loadHDRI(name) {
  if (hdriTex[name]) return Promise.resolve(hdriTex[name]);
  if (hdriPromise[name]) return hdriPromise[name];
  hdriPromise[name] = new Promise((res) => {
    rgbeLoader.load(`${BASE}haven3d/hdri/${name}.hdr`, (tex) => { tex.mapping = THREE.EquirectangularReflectionMapping; hdriTex[name] = tex; res(tex); }, undefined, () => res(null));
  });
  return hdriPromise[name];
}
function place(root, slug, x, y, z, s, ry, rx) { const m = modelCache[slug]; if (!m) return null; const c = m.clone(true); c.position.set(x, y, z); c.scale.setScalar(s); if (ry) c.rotation.y = ry; if (rx) c.rotation.x = rx; root.add(c); return c; }

// ---------- canvas textures (walls / shelves / skyline) ----------
function tex(draw, w = 512, h = 512, repeat) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); } t.anisotropy = 4; return t; }
function woodTex() { return tex((x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a3d22'); g.addColorStop(1, '#38230f'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.globalAlpha = 0.22; for (let i = 0; i < 60; i++) { x.strokeStyle = i % 2 ? '#241408' : '#6a4a2a'; x.lineWidth = 1 + Math.random() * 2; x.beginPath(); const y = Math.random() * h; x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + (Math.random() * 18 - 9), w * 0.6, y + (Math.random() * 18 - 9), w, y); x.stroke(); } x.globalAlpha = 1; for (let px = 0; px < w; px += 64) { x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(px, 0, 2, h); } }, 512, 512, [4, 4]); }
function stoneTex() { return tex((x, w, h) => { x.fillStyle = '#463c34'; x.fillRect(0, 0, w, h); const bw = 84, bh = 42; for (let ry = 0, r = 0; ry < h; ry += bh, r++) for (let rx = -bw + (r % 2) * bw / 2; rx < w; rx += bw) { const t = 0.6 + Math.random() * 0.4; x.fillStyle = `rgb(${88 * t | 0},${76 * t | 0},${62 * t | 0})`; x.fillRect(rx + 3, ry + 3, bw - 6, bh - 6); x.fillStyle = 'rgba(255,238,214,0.1)'; x.fillRect(rx + 3, ry + 3, bw - 6, 4); x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(rx + 3, ry + bh - 6, bw - 6, 3); } }, 512, 512, [2, 2]); }
function booksTex() { return tex((x, w, h) => { x.fillStyle = '#160e07'; x.fillRect(0, 0, w, h); const cols = ['#8a3b34', '#c98a3a', '#3a6a5a', '#6a4a8a', '#3a5a8a', '#a0654a', '#4a7a4a', '#7a3a4a', '#d0a860']; const rows = 6, sh = h / rows; for (let r = 0; r < rows; r++) { let bx = 6; while (bx < w - 8) { const bw = 12 + Math.random() * 20, bh = sh * (0.7 + Math.random() * 0.26); x.fillStyle = cols[Math.random() * cols.length | 0]; x.fillRect(bx, r * sh + sh - bh - 6, bw, bh); x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(bx, r * sh + sh - bh - 6, bw * 0.3, bh); bx += bw + 3; } x.fillStyle = '#3a2818'; x.fillRect(0, r * sh + sh - 6, w, 6); } }); }
function skylineTex(night) { return tex((x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); if (night) { g.addColorStop(0, '#0a1436'); g.addColorStop(0.6, '#1a2450'); g.addColorStop(1, '#2a2a52'); } else { g.addColorStop(0, '#243a6a'); g.addColorStop(0.55, '#8a4a6a'); g.addColorStop(0.8, '#e08a4a'); g.addColorStop(1, '#ffc06a'); } x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#eef2ff'; x.beginPath(); x.arc(w * 0.7, h * 0.22, 24, 0, 7); x.fill(); x.fillStyle = g; x.beginPath(); x.arc(w * 0.73, h * 0.19, 22, 0, 7); x.fill(); for (let layer = 0; layer < 3; layer++) { const base = h * (0.55 + layer * 0.12); const bc = ['#101a38', '#16213f', '#1c2947'][layer]; let bx = 0; while (bx < w) { const bw = 30 + Math.random() * 60, bh = (60 + Math.random() * 160) * (1 + layer * 0.3); x.fillStyle = bc; x.fillRect(bx, base - bh, bw, bh + 220); for (let wy = base - bh + 8; wy < base; wy += 12) for (let wx = bx + 5; wx < bx + bw - 5; wx += 10) if (Math.random() < 0.5) { x.fillStyle = Math.random() < 0.7 ? 'rgba(255,210,130,0.95)' : 'rgba(180,220,255,0.85)'; x.fillRect(wx, wy, 4, 6); x.fillStyle = bc; } bx += bw + 6; } } }, 1024, 512); }
function fireSprite() { return tex((x, w, h) => { const g = x.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(0.3, 'rgba(255,170,60,0.9)'); g.addColorStop(0.7, 'rgba(255,90,20,0.3)'); g.addColorStop(1, 'rgba(255,60,10,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, 128, 128); }
// flame-tongue shape (teardrop, hot core at the base)
function flameTex() { return tex((x, w, h) => { const cx = w / 2; const g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, 'rgba(255,70,10,0)'); g.addColorStop(0.12, 'rgba(255,90,20,0.85)'); g.addColorStop(0.45, 'rgba(255,150,45,0.95)'); g.addColorStop(0.78, 'rgba(255,215,110,0.98)'); g.addColorStop(1, 'rgba(255,248,210,1)'); x.fillStyle = g; x.beginPath(); x.moveTo(cx, 8); x.bezierCurveTo(cx + w * 0.44, h * 0.32, cx + w * 0.3, h * 0.92, cx, h - 6); x.bezierCurveTo(cx - w * 0.3, h * 0.92, cx - w * 0.44, h * 0.32, cx, 8); x.fill(); }, 128, 192); }

function stdMat(o) { return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0.02 }, o)); }
function addBox(root, w, h, d, mat, x, y, z, ry) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; root.add(m); return m; }

function makeFire(root, x, y, z, scale) {
  const glowT = fireSprite(), flameT = flameTex(); flames = [];
  // dark logs at the base
  const logMat = stdMat({ color: 0x1c1008, roughness: 1 });
  const l1 = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.16, scale * 0.16, scale * 1.5, 8), logMat); l1.rotation.set(0, 0, Math.PI / 2 + 0.12); l1.position.set(x, y + scale * 0.12, z); root.add(l1);
  const l2 = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.15, scale * 0.15, scale * 1.4, 8), logMat); l2.rotation.set(0.1, 0.4, Math.PI / 2 - 0.14); l2.position.set(x, y + scale * 0.26, z + 0.05); root.add(l2);
  // base ember glow
  const base = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85, color: 0xff5a18 })); base.scale.set(scale * 2.1, scale * 1.1, 1); base.position.set(x, y + scale * 0.3, z); root.add(base);
  // layered flame tongues
  const cols = [0xff3808, 0xff5c18, 0xff8a28, 0xffb040, 0xffd870, 0xfff0b0];
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.SpriteMaterial({ map: flameT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: cols[i % cols.length], opacity: 0.9 });
    const s = new THREE.Sprite(mat); const sc = scale * (1.05 - i * 0.11);
    s.center.set(0.5, 0);                                    // pivot at the base so it grows upward
    s.scale.set(sc * 0.72, sc * 1.7, 1); s.position.set(x + (i - 3) * scale * 0.1, y + scale * 0.18, z);
    s.userData = { ph: Math.random() * 6, bx: s.position.x, by: s.position.y, sc }; root.add(s); flames.push(s);
  }
  fireLight = new THREE.PointLight(0xff7a2a, 24, 11, 2); fireLight.position.set(x, y + scale * 0.6, z + 0.25); root.add(fireLight);
  const gm = new THREE.Mesh(new THREE.CircleGeometry(scale * 1.8, 24), new THREE.MeshBasicMaterial({ map: glowT, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.4 })); gm.rotation.x = -Math.PI / 2; gm.position.set(x, 0.02, z + 0.5); root.add(gm);
}

// ---------- scenes ----------
function buildCabin(root) {
  const wood = woodTex(), stone = stoneTex(), books = booksTex();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), stdMat({ map: wood, roughness: 0.7 })); floor.rotation.x = -Math.PI / 2; root.add(floor);
  const wallMat = stdMat({ map: woodTex(), roughness: 0.92 });
  addBox(root, 9, 5, 0.2, wallMat, 0, 2.5, -3); addBox(root, 0.2, 5, 9, wallMat, -4.5, 2.5, 0); addBox(root, 0.2, 5, 9, wallMat, 4.5, 2.5, 0);
  addBox(root, 9, 0.2, 9, stdMat({ color: 0x140d07, roughness: 1 }), 0, 5, 0);
  // fireplace (geometry) + fire
  addBox(root, 2.6, 3, 0.6, stdMat({ map: stone, roughness: 0.95 }), 0, 1.5, -2.7);
  addBox(root, 1.5, 1.7, 0.4, stdMat({ color: 0x0a0604, roughness: 1 }), 0, 0.95, -2.55);
  addBox(root, 3, 0.28, 0.7, stdMat({ map: wood, roughness: 0.8 }), 0, 2.5, -2.55);
  for (const bx of [-2.7, 2.7]) { addBox(root, 1.8, 3.4, 0.5, stdMat({ color: 0x241708 }), bx, 1.7, -2.78); addBox(root, 1.55, 3.15, 0.34, stdMat({ map: books, emissive: 0x0e0703, emissiveIntensity: 0.25 }), bx, 1.65, -2.66); }
  // window w/ night skyline
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.2), new THREE.MeshBasicMaterial({ map: skylineTex(true) })); win.position.set(-4.38, 1.8, 0.4); win.rotation.y = Math.PI / 2; root.add(win);
  addBox(root, 0.12, 2.4, 0.14, stdMat({ color: 0x1a120a }), -4.36, 1.8, -0.75); addBox(root, 0.12, 2.4, 0.14, stdMat({ color: 0x1a120a }), -4.36, 1.8, 1.55); addBox(root, 0.12, 0.14, 2.4, stdMat({ color: 0x1a120a }), -4.36, 1.8, 0.4);
  // real furniture models
  place(root, 'modern_arm_chair_01', -1.5, 0, 0.9, 1.15, 0.5);
  place(root, 'modern_arm_chair_01', 1.5, 0, 0.9, 1.15, -0.5);
  place(root, 'coffee_table_round_01', 0, 0, 0.5, 1.05, 0);
  place(root, 'potted_plant_01', 3.5, 0, -2.2, 1.0, 0);
  place(root, 'brass_candleholders', 0.7, 2.66, -2.5, 1.0, 0);
  place(root, 'book_encyclopedia_set_01', -0.7, 2.64, -2.5, 0.9, 0.3);
  // rug
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.8, 44), stdMat({ color: 0x7a2f2f, roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.015, 0.5); root.add(rug);
  const rug2 = new THREE.Mesh(new THREE.CircleGeometry(1.15, 44), stdMat({ color: 0xb5673a, roughness: 1 })); rug2.rotation.x = -Math.PI / 2; rug2.position.set(0, 0.02, 0.5); root.add(rug2);
  makeFire(root, 0, 0.15, -2.15, 0.8);
  root.add(new THREE.HemisphereLight(0x4a2e18, 0x0a0604, 0.42));
  scene.fog = new THREE.FogExp2(0x140a06, 0.05);
}
function cozyBed(root, x, z, ry) {
  const g = new THREE.Group();
  const wood = stdMat({ color: 0x2e2016, roughness: 0.65 });
  addBox(g, 2.4, 0.5, 2.3, wood, 0, 0.25, 0);                                                     // frame
  addBox(g, 2.4, 1.1, 0.22, wood, 0, 0.85, -1.14);                                                // headboard
  addBox(g, 2.2, 0.36, 2.06, stdMat({ color: 0xe4dccb, roughness: 0.96 }), 0, 0.6, 0.06);          // mattress
  // duvet with a turned-down fold near the head
  const duvet = stdMat({ color: 0x415f8e, roughness: 0.95 });
  addBox(g, 2.24, 0.26, 1.5, duvet, 0, 0.72, 0.34);
  addBox(g, 2.24, 0.14, 0.34, stdMat({ color: 0x5f7cad, roughness: 0.95 }), 0, 0.86, -0.42);       // fold
  // pillows (slightly tilted against the headboard)
  for (const px of [-0.56, 0.56]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.26, 0.56), stdMat({ color: 0xf1ebdc, roughness: 0.98 })); p.position.set(px, 0.86, -0.78); p.rotation.x = -0.32; g.add(p); }
  g.position.set(x, 0, z); if (ry) g.rotation.y = ry; root.add(g);
}
function buildBeach(root) {
  // stylized gradient sunset sky (matches the lofi inspiration better than a photo HDRI)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 40, 20), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0xb0b0b0, map: tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#241a52'); g.addColorStop(0.34, '#6a3f8e'); g.addColorStop(0.52, '#b8567e'); g.addColorStop(0.64, '#d87a52'); g.addColorStop(0.71, '#e89a5a'); g.addColorStop(0.735, '#eaa864'); g.addColorStop(0.75, '#3f5f8e'); g.addColorStop(1, '#243056'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.6})`; x.fillRect(Math.random() * w, Math.random() * h * 0.45, 1.5, 1.5); }
  }, 2048, 1024) }));
  sky.material.toneMapped = true; root.add(sky);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 80, 80), new THREE.MeshStandardMaterial({ color: 0x38355e, roughness: 0.88, metalness: 0.04, envMapIntensity: 0.12 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.2; root.add(sea); root.userData.sea = sea;
  // real sun on the horizon (world space, so it reads the same from every angle)
  const sunT = tex((x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,235,190,1)'); g.addColorStop(0.32, 'rgba(255,205,130,1)'); g.addColorStop(0.5, 'rgba(255,170,110,0.55)'); g.addColorStop(1, 'rgba(255,150,100,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, 128, 128);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunT, transparent: true, depthWrite: false })); sun.position.set(0, 1.4, -62); sun.scale.set(26, 26, 1); sun.material.toneMapped = true; root.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 })); sunGlow.position.set(0, 1.4, -61); sunGlow.scale.set(60, 60, 1); root.add(sunGlow);
  const sunL = new THREE.DirectionalLight(0xffcaa0, 1.1); sunL.position.set(0, 4, -30); root.add(sunL);
  root.add(new THREE.HemisphereLight(0xffb488, 0x2a2a5a, 0.55));
  hut(root, 5, -9.5); palm(root, -4.6, -7.5); palm(root, -6.6, -10.5);
  scene.fog = new THREE.FogExp2(0x2a2050, 0.009);
}
function hut(root, x, z) {
  const g = new THREE.Group(); const m = stdMat({ color: 0x1a1226, roughness: 0.9 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4), m); leg.position.set(dx, 0.8, dz); g.add(leg); }
  addBox(g, 2.6, 1.6, 2.6, m, 0, 2.6, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.4, 4), m); roof.position.set(0, 4, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  const wi = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), new THREE.MeshBasicMaterial({ color: 0xffb060 })); wi.position.set(-1.32, 2.6, 0); wi.rotation.y = -Math.PI / 2; g.add(wi);
  const wl = new THREE.PointLight(0xffb060, 3, 8); wl.position.set(-1.6, 2.6, 0); g.add(wl);
  g.position.set(x, 0, z); root.add(g);
}
function palm(root, x, z) {
  const g = new THREE.Group(); const m = stdMat({ color: 0x141026, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.17, 4.8, 8), m); trunk.position.y = 2.4; trunk.rotation.z = 0.13; g.add(trunk);
  const top = new THREE.Vector3(0.6, 4.7, 0);
  // drooping fronds radiating from the crown (arc out then down)
  for (let i = 0; i < 8; i++) {
    const ang = i / 8 * Math.PI * 2; const droop = 0.7 + (i % 2) * 0.25;
    const fg = new THREE.Group(); fg.position.copy(top); fg.rotation.y = ang;
    const fr = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.7, 5), m); fr.scale.set(1, 1, 0.3); fr.position.set(0, 0.05, 1.2); fr.rotation.x = Math.PI / 2 + droop; fg.add(fr); g.add(fg);
  }
  const coco = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), m); coco.position.copy(top); g.add(coco);
  g.position.set(x, 0, z); root.add(g);
}
function bldgTex() {
  return tex((x, w, h) => {
    x.fillStyle = '#0b1226'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,0.03)'; x.fillRect(0, 0, 4, h);
    for (let wy = 12; wy < h - 10; wy += 18) for (let wx = 9; wx < w - 9; wx += 15) {
      const r = Math.random(); x.fillStyle = r < 0.46 ? (Math.random() < 0.72 ? '#ffd487' : '#bfe0ff') : '#111a30'; x.fillRect(wx, wy, 8, 10);
    }
  }, 128, 256);
}
function cityBuildings(root) {
  // dusk sky backdrop far behind the city
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(240, 110), new THREE.MeshBasicMaterial({ map: tex((x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0c1230'); g.addColorStop(0.55, '#2a2450'); g.addColorStop(0.8, '#5a3a62'); g.addColorStop(1, '#8a4a5a'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#eef2ff'; x.beginPath(); x.arc(w * 0.72, h * 0.24, 26, 0, 7); x.fill(); x.fillStyle = g; x.beginPath(); x.arc(w * 0.75, h * 0.2, 24, 0, 7); x.fill(); for (let i = 0; i < 140; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.6})`; x.fillRect(Math.random() * w, Math.random() * h * 0.4, 1.4, 1.4); } }, 1024, 512) }));
  sky.material.toneMapped = true; sky.position.set(0, 18, -48); root.add(sky);
  // real 3D building field (parallax depth as the camera moves between angles)
  const texes = [bldgTex(), bldgTex(), bldgTex(), bldgTex()];
  const rand = (i) => { let s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < 46; i++) {
    const w = 2 + rand(i) * 3.5, d = 2 + rand(i + 99) * 3.5, hh = 6 + rand(i + 7) * 18;
    const t = texes[i % 4].clone(); t.repeat.set(Math.max(1, w / 2 | 0), Math.max(1, hh / 4 | 0)); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), new THREE.MeshBasicMaterial({ map: t }));
    b.position.set((rand(i + 3) - 0.5) * 70, hh / 2 - 14.5, -7 - rand(i + 21) * 30); root.add(b);
  }
}
function buildCity(root) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), stdMat({ color: 0x191420, roughness: 0.55, metalness: 0.1 })); floor.rotation.x = -Math.PI / 2; root.add(floor);
  // wall with a real window OPENING (segments around it) so the 3D city shows through
  const wmat = stdMat({ color: 0x140f1c, roughness: 1 });
  addBox(root, 16, 1.6, 0.3, wmat, 0, 5.4, -3.5);          // above window
  addBox(root, 16, 0.7, 0.3, wmat, 0, 0.3, -3.5);          // sill
  addBox(root, 4.4, 6, 0.3, wmat, -5.9, 3, -3.5);          // left of window
  addBox(root, 4.4, 6, 0.3, wmat, 5.9, 3, -3.5);           // right of window
  addBox(root, 0.3, 6.4, 14, wmat, -7.9, 3.2, 0); addBox(root, 0.3, 6.4, 14, wmat, 7.9, 3.2, 0);  // side walls
  addBox(root, 16, 0.3, 14, stdMat({ color: 0x0e0a14, roughness: 1 }), 0, 6.3, 0);                 // ceiling
  cityBuildings(root);
  // mullion frame in the opening
  const fm = stdMat({ color: 0x181a2c, roughness: 0.6, metalness: 0.3 });
  addBox(root, 7.6, 0.14, 0.14, fm, 0, 2.9, -3.32); addBox(root, 0.14, 5, 0.14, fm, 0, 2.9, -3.32); addBox(root, 0.14, 5, 0.14, fm, -2.5, 2.9, -3.32); addBox(root, 0.14, 5, 0.14, fm, 2.5, 2.9, -3.32);
  root.add(new THREE.HemisphereLight(0x8a7aa8, 0x241a30, 0.6));
  const lamp = new THREE.PointLight(0xffb070, 3.6, 10); lamp.position.set(3.4, 1.6, 2.0); root.add(lamp);
  const fill = new THREE.PointLight(0xbfc0e0, 1.0, 16); fill.position.set(-1, 3.4, 2.4); root.add(fill);
  cozyBed(root, 0.8, 1.9, 0);
  place(root, 'sofa_02', -3.6, 0, 0.9, 1.0, 0.6);
  place(root, 'potted_plant_02', 4.6, 0, -1.4, 1.0, 0);
  place(root, 'desk_lamp_arm_01', 3.1, 0.62, 2.0, 1.0, -0.6);
  place(root, 'coffee_table_round_01', -1.9, 0, 2.6, 0.9, 0);
  scene.fog = null;
}
const BUILDERS = { cabin: buildCabin, beach: buildBeach, city: buildCity };
const HDRI_FOR = { cabin: 'cabin', beach: 'beach', city: 'city' };
const MODELS_FOR = {
  cabin: ['modern_arm_chair_01', 'coffee_table_round_01', 'potted_plant_01', 'brass_candleholders', 'book_encyclopedia_set_01'],
  beach: [],
  city: ['sofa_02', 'potted_plant_02', 'desk_lamp_arm_01', 'coffee_table_round_01'],
};

async function buildScene() {
  await Promise.all([loadHDRI(HDRI_FOR[theme]), ...MODELS_FOR[theme].map(loadModel)]);
  if (!renderer) return;
  if (sceneRoot) { scene.remove(sceneRoot); disposeTree(sceneRoot); }
  fireLight = null; flames = []; scene.fog = null;
  const hdri = hdriTex[HDRI_FOR[theme]];
  scene.environment = hdri || null;
  scene.environmentIntensity = theme === 'beach' ? 0.5 : 0.66;
  scene.background = theme === 'beach' ? null : new THREE.Color(0x0a0705);
  scene.backgroundBlurriness = 0;
  sceneRoot = new THREE.Group();
  (BUILDERS[theme] || buildCabin)(sceneRoot);
  scene.add(sceneRoot);
  applyAngle(spot, true);
}
function disposeTree(obj) { obj.traverse(o => { if (o.geometry && !o.userData.keep) o.geometry.dispose(); if (o.material) { const arr = Array.isArray(o.material) ? o.material : [o.material]; arr.forEach(m => { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose && m.dispose(); }); } }); }

function applyAngle(sp, instant) {
  const a = (ANGLES[theme] || ANGLES.cabin)[sp] || ANGLES[theme][0];
  camB.pos.set(a.pos[0], a.pos[1], a.pos[2]); camB.tgt.set(a.tgt[0], a.tgt[1], a.tgt[2]);
  if (instant) { camA.pos.copy(camB.pos); camA.tgt.copy(camB.tgt); camMix = 1; camera.position.copy(camB.pos); currentTarget.copy(camB.tgt); camera.lookAt(camB.tgt); }
  else { camA.pos.copy(camera.position); camA.tgt.copy(currentTarget); camMix = 0; }
}
function resize() { const r = container.getBoundingClientRect(); const w = r.width || innerWidth, h = r.height || innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
function onMove(e) { mouseT.x = (e.clientX / innerWidth) * 2 - 1; mouseT.y = (e.clientY / innerHeight) * 2 - 1; }

function loop() {
  raf = requestAnimationFrame(loop);
  // NOTE: getDelta() must be read first — getElapsedTime() also consumes the
  // internal delta, which would leave dt≈0 and freeze the camera tween.
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  if (camMix < 1) { camMix = Math.min(1, camMix + dt / 1.1); const e = camMix < 0.5 ? 2 * camMix * camMix : 1 - Math.pow(-2 * camMix + 2, 2) / 2; camera.position.lerpVectors(camA.pos, camB.pos, e); currentTarget.lerpVectors(camA.tgt, camB.tgt, e); }
  else currentTarget.copy(camB.tgt);
  mouse.x += (mouseT.x - mouse.x) * 0.04; mouse.y += (mouseT.y - mouse.y) * 0.04;
  if (camMix >= 1) camera.position.set(camB.pos.x + Math.sin(t * 0.3) * 0.05 + mouse.x * 0.22, camB.pos.y + Math.cos(t * 0.24) * 0.03 - mouse.y * 0.1, camB.pos.z);
  camera.lookAt(currentTarget);
  if (fireLight) fireLight.intensity = 20 + Math.sin(t * 12) * 5 + Math.sin(t * 27) * 3 + (Math.random() - 0.5) * 3;
  for (const f of flames) { const u = f.userData; const fl = 1 + 0.18 * Math.sin(t * 9 + u.ph) + 0.1 * Math.sin(t * 19 + u.ph); f.scale.set(u.sc * 0.72 * (0.9 + 0.1 * Math.sin(t * 7 + u.ph)), u.sc * 1.7 * fl, 1); f.position.x = u.bx + Math.sin(t * 3 + u.ph) * 0.04; f.material.rotation = Math.sin(t * 2.3 + u.ph) * 0.13; }
  if (theme === 'beach' && sceneRoot && sceneRoot.userData.sea) { const g = sceneRoot.userData.sea.geometry, pos = g.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, Math.sin(x * 0.25 + t) * 0.09 + Math.cos(y * 0.35 + t * 0.8) * 0.06); } pos.needsUpdate = true; g.computeVertexNormals(); }
  composer.render();
}

export async function openHaven3D(el, th, sp) {
  container = el; theme = th || 'cabin'; spot = sp || 0;
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  container.appendChild(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0705);
  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300);
  pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.7, 0.92); composer.addPass(bloom);
  clock = new THREE.Clock(); resize();
  addEventListener('resize', resize); addEventListener('mousemove', onMove);
  mounted = true;
  await buildScene();
  if (mounted) loop();
  window.__hv3 = { scene, camera, renderer, bloom, get theme() { return theme; }, get spot() { return spot; } };
}
export function closeHaven3D() {
  mounted = false; cancelAnimationFrame(raf); raf = 0;
  removeEventListener('resize', resize); removeEventListener('mousemove', onMove);
  if (sceneRoot) disposeTree(sceneRoot);
  if (pmrem) pmrem.dispose();
  if (renderer) { renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
  renderer = scene = camera = composer = sceneRoot = null;
}
export async function setHavenTheme3D(th) { if (th === theme) return; theme = th; await buildScene(); }
export function setHavenSeat3D(sp) { if (sp === spot) return; spot = sp; applyAngle(sp, false); }
