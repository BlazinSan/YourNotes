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
let isMobile = false;
let sceneRoot = null, fireLight = null, flames = [];
let camA = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
let camB = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
let camMix = 1;
let waveFrame = 0;
const basePos = new THREE.Vector3();   // camera position WITHOUT idle sway (sway added every frame on top)
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
    { pos: [0, 1.35, 5.35], tgt: [0, 1.05, -3.25] },
    { pos: [2.45, 1.32, 3.65], tgt: [-1.9, 1.08, -3.9] },
    { pos: [-2.55, 1.36, 3.8], tgt: [1.7, 1.05, -4.2] },
  ],
};

// ---------- async asset loaders (cached) ----------
const gltfLoader = new GLTFLoader(), rgbeLoader = new RGBELoader();
const modelCache = {}, hdriPromise = {}, hdriTex = {};
function loadModel(slug) {
  if (modelCache[slug]) return Promise.resolve(modelCache[slug]);
  return new Promise((res) => {
    gltfLoader.setPath(`${BASE}haven3d/models/${slug}/`).load(`${slug}_1k.gltf`, (g) => {
      g.scene.traverse(o => {
        if (o.isMesh) {
          o.userData.keep = true;
          o.castShadow = o.receiveShadow = false;
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const mat of mats) {
            mat.envMapIntensity = 0.8;
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
              if (mat[k]) mat[k].anisotropy = isMobile ? 1 : 4;
            }
          }
        }
      });
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
function place(root, slug, x, y, z, s, ry, rx, rz) {
  const m = modelCache[slug]; if (!m) return null;
  const c = m.clone(true); c.position.set(x, y, z);
  Array.isArray(s) ? c.scale.set(s[0], s[1], s[2]) : c.scale.setScalar(s);
  if (ry) c.rotation.y = ry; if (rx) c.rotation.x = rx; if (rz) c.rotation.z = rz;
  root.add(c); return c;
}

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
  fireLight = new THREE.PointLight(0xff7a2a, 24, 11, 2); fireLight.position.set(x, y + scale * 0.6, z + 0.25); fireLight.castShadow = true; fireLight.shadow.mapSize.set(1024, 1024); fireLight.shadow.camera.near = 0.3; fireLight.shadow.camera.far = 12; fireLight.shadow.bias = -0.004; root.add(fireLight);
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
function rock(root, x, z, s, col) {
  const geo = new THREE.DodecahedronGeometry(s, 0); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const j = 0.72 + (Math.abs(Math.sin(i * 12.9 + x)) * 0.5); p.setXYZ(i, p.getX(i) * j, p.getY(i) * (0.6 + 0.4 * j), p.getZ(i) * j); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, stdMat({ color: col || 0x2a2438, roughness: 1 })); m.position.set(x, s * 0.35, z); m.rotation.set(x, z, x * 0.5); root.add(m); return m;
}
function buildBeach(root) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(140, isMobile ? 28 : 44, isMobile ? 14 : 22), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#171949'); g.addColorStop(0.28, '#42316f'); g.addColorStop(0.46, '#954980');
    g.addColorStop(0.58, '#dd715d'); g.addColorStop(0.66, '#ffb068'); g.addColorStop(0.74, '#4e6e98'); g.addColorStop(1, '#18264e');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 190; i++) { x.fillStyle = `rgba(240,235,255,${0.18 + Math.random() * 0.55})`; x.fillRect(Math.random() * w, Math.random() * h * 0.42, 1.5, 1.5); }
    for (let i = 0; i < 18; i++) {
      const cx = Math.random() * w, cy = h * (0.28 + Math.random() * 0.26), sw = 70 + Math.random() * 180;
      const cg = x.createRadialGradient(cx, cy, 0, cx, cy, sw * 0.55);
      cg.addColorStop(0, 'rgba(255,160,140,0.42)'); cg.addColorStop(1, 'rgba(255,160,140,0)');
      x.fillStyle = cg; x.fillRect(cx - sw, cy - sw * 0.35, sw * 2, sw * 0.7);
    }
  }, 1600, 900) }));
  sky.material.toneMapped = true; sky.userData.noShadow = true; root.add(sky);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(420, 260, isMobile ? 52 : 96, isMobile ? 28 : 54), new THREE.MeshStandardMaterial({ color: 0x42658f, roughness: 0.68, metalness: 0.05, envMapIntensity: 0.26 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.12, -70); sea.userData.noShadow = true; root.add(sea); root.userData.sea = sea;

  const wetTex = tex((x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#4f4b77'); g.addColorStop(0.42, '#6b5670'); g.addColorStop(1, '#2d2543'); x.fillStyle = g; x.fillRect(0, 0, w, h); for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(255,225,190,${Math.random() * 0.08})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 1); } }, 512, 512, [3, 2]);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(90, 44, 1, 1), stdMat({ map: wetTex, roughness: 0.92, metalness: 0.03 })); sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0, 12); sand.receiveShadow = true; sand.userData.noShadow = true; root.add(sand);

  const foamTex = tex((x, w, h) => { x.clearRect(0, 0, w, h); for (let i = 0; i < 40; i++) { const cx = 10 + i * (w - 20) / 39, cy = h * 0.5 + Math.sin(i * 0.8) * 6; const r = 7 + Math.random() * 12; const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,248,230,0.8)'); g.addColorStop(1, 'rgba(255,248,230,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); } }, 256, 64);
  const foamBands = [];
  for (const [z, w, op] of [[-3.2, 72, 0.34], [-2.0, 62, 0.24], [-0.85, 54, 0.18]]) {
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.35), new THREE.MeshBasicMaterial({ map: foamTex, color: 0xffe5d8, transparent: true, opacity: op, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.015, z); foam.userData.noShadow = true; root.add(foam); foamBands.push({ mesh: foam, z0: z, op });
  }

  const sunT = tex((x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,235,190,1)'); g.addColorStop(0.32, 'rgba(255,205,130,1)'); g.addColorStop(0.5, 'rgba(255,170,110,0.55)'); g.addColorStop(1, 'rgba(255,150,100,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, 128, 128);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunT, transparent: true, depthWrite: false })); sun.position.set(-1.2, 1.5, -72); sun.scale.set(23, 23, 1); sun.material.toneMapped = true; root.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 })); sunGlow.position.set(-1.2, 1.6, -71); sunGlow.scale.set(70, 58, 1); root.add(sunGlow);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(8, 72), new THREE.MeshBasicMaterial({ map: sunT, color: 0xffb36a, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })); path.rotation.x = -Math.PI / 2; path.position.set(-1.2, 0.04, -34); path.scale.x = 0.45; path.userData.noShadow = true; root.add(path);
  const sunL = new THREE.DirectionalLight(0xffcaa0, 1.5); sunL.position.set(-5, 6, -6); sunL.castShadow = true; sunL.shadow.mapSize.set(1024, 1024); const sc = sunL.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 0.5; sc.far = 40; sunL.shadow.bias = -0.003; root.add(sunL);
  root.add(new THREE.HemisphereLight(0xffc08a, 0x25295c, 0.6));

  const pierMat = stdMat({ color: 0x3a2430, roughness: 0.9 });
  for (let i = 0; i < 11; i++) {
    const plank = addBox(root, 4.4 - i * 0.13, 0.08, 0.42, pierMat, 0, 0.08, 5.8 - i * 0.72);
    plank.rotation.y = (i % 2 ? 0.018 : -0.018);
  }
  for (const x of [-2.25, 2.25]) for (let i = 0; i < 7; i++) addBox(root, 0.12, 0.9, 0.12, pierMat, x, 0.45, 5.2 - i * 1.05);
  place(root, 'modular_wooden_pier', -6.1, -0.03, -4.6, 0.34, -0.35);
  place(root, 'outdoor_table_chair_set_01', 2.15, 0.09, 3.0, 1.35, -0.65);
  place(root, 'Ukulele_01', 1.72, 0.83, 2.95, 0.76, -0.25, Math.PI / 2, -0.22);
  place(root, 'potted_plant_04', 2.64, 0.86, 3.24, 1.25, 0.2);
  place(root, 'painted_wooden_bench', -1.25, 0.07, 4.1, 1.05, Math.PI + 0.12);

  palm(root, -6.4, 0.3); palm(root, -8.3, -1.8); palm(root, 6.5, 1.5);
  rock(root, 3.6, -1.6, 0.6, 0x342945); rock(root, 4.5, -0.8, 0.36, 0x2a2438); rock(root, -3.2, 1.3, 0.45, 0x352a42); rock(root, 5.4, 3.7, 0.35, 0x32283d);
  hut(root, 8.6, -12.5);
  const tableGlow = new THREE.PointLight(0xffb36b, 1.1, 6, 2); tableGlow.position.set(2.2, 1.0, 3.1); root.add(tableGlow);
  root.userData.beachFX = { foamBands, path, sunGlow };
  scene.fog = new THREE.FogExp2(0x2a2050, 0.008);
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
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(260, 118), new THREE.MeshBasicMaterial({ map: tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#18295c'); g.addColorStop(0.36, '#46508b'); g.addColorStop(0.58, '#d26965'); g.addColorStop(0.74, '#ff9c55'); g.addColorStop(1, '#211832');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const cx = Math.random() * w, cy = h * (0.24 + Math.random() * 0.38), sw = 60 + Math.random() * 170; const cg = x.createRadialGradient(cx, cy, 0, cx, cy, sw); cg.addColorStop(0, 'rgba(255,155,110,0.28)'); cg.addColorStop(1, 'rgba(255,155,110,0)'); x.fillStyle = cg; x.fillRect(cx - sw, cy - sw * 0.35, sw * 2, sw * 0.7); }
    for (let i = 0; i < 130; i++) { x.fillStyle = `rgba(230,235,255,${Math.random() * 0.42})`; x.fillRect(Math.random() * w, Math.random() * h * 0.34, 1.3, 1.3); }
  }, 1200, 620) }));
  sky.material.toneMapped = true; sky.position.set(0, 17, -55); sky.userData.noShadow = true; root.add(sky);
  // real 3D building field (parallax depth as the camera moves between angles)
  const texes = [bldgTex(), bldgTex(), bldgTex(), bldgTex()];
  const rand = (i) => { let s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < (isMobile ? 30 : 48); i++) {
    const w = 1.6 + rand(i) * 3.0, d = 1.6 + rand(i + 99) * 3.0, hh = 5 + rand(i + 7) * 14;
    const t = texes[i % 4].clone(); t.repeat.set(Math.max(1, w / 2 | 0), Math.max(1, hh / 4 | 0)); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), new THREE.MeshBasicMaterial({ map: t }));
    b.position.set((rand(i + 3) - 0.5) * 96, hh / 2 - 15.5, -28 - rand(i + 21) * 58); b.userData.noShadow = true; root.add(b);
  }
}
function cityArt(root, x, y, z, ry, kind) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.4, 1.8), stdMat({ color: 0x241812, roughness: 0.7 })); g.add(frame);
  const t = tex((cx, w, h) => {
    if (kind === 'car') { const gr = cx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a1a3a'); gr.addColorStop(1, '#8a3a5a'); cx.fillStyle = gr; cx.fillRect(0, 0, w, h); cx.fillStyle = '#12101f'; cx.fillRect(w * 0.12, h * 0.5, w * 0.76, h * 0.34); cx.fillStyle = '#ff8a5a'; cx.fillRect(w * 0.2, h * 0.56, w * 0.6, 8); }
    else { const gr = cx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#33356a'); gr.addColorStop(0.6, '#c86a5a'); gr.addColorStop(1, '#f0a060'); cx.fillStyle = gr; cx.fillRect(0, 0, w, h); cx.fillStyle = '#ffe0a0'; cx.beginPath(); cx.arc(w * 0.5, h * 0.62, w * 0.16, 0, 7); cx.fill(); }
  }, 256, 320);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.55), new THREE.MeshBasicMaterial({ map: t })); art.position.x = 0.05; art.rotation.y = Math.PI / 2; art.userData.noShadow = true; g.add(art);
  g.position.set(x, y, z); g.rotation.y = ry; root.add(g);
}
function buildCity(root) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), stdMat({ map: woodTex(), color: 0x5a4a56, roughness: 0.72, metalness: 0.02 })); floor.rotation.x = -Math.PI / 2; root.add(floor);
  const wmat = stdMat({ color: 0x120e1b, roughness: 1 });
  addBox(root, 16, 0.9, 0.3, wmat, 0, 5.95, -3.5);
  addBox(root, 16, 0.35, 0.3, wmat, 0, 0.18, -3.5);
  addBox(root, 1.35, 6.2, 0.3, wmat, -7.32, 3.1, -3.5);
  addBox(root, 1.35, 6.2, 0.3, wmat, 7.32, 3.1, -3.5);
  addBox(root, 0.3, 6.4, 14, wmat, -7.9, 3.2, 0); addBox(root, 0.3, 6.4, 14, wmat, 7.9, 3.2, 0);
  addBox(root, 16, 0.3, 14, stdMat({ color: 0x0d0913, roughness: 1 }), 0, 6.3, 0);
  cityBuildings(root);

  const fm = stdMat({ color: 0x181a2c, roughness: 0.6, metalness: 0.3 });
  addBox(root, 13.2, 0.14, 0.14, fm, 0, 3.05, -3.32);
  for (const x of [-6.55, -3.25, 0, 3.25, 6.55]) addBox(root, 0.14, 5.7, 0.14, fm, x, 3.05, -3.32);
  addBox(root, 13.2, 0.1, 0.14, fm, 0, 0.56, -3.31); addBox(root, 13.2, 0.1, 0.14, fm, 0, 5.5, -3.31);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(13.05, 5.25), new THREE.MeshBasicMaterial({ color: 0xf4d6ff, transparent: true, opacity: 0.055, depthWrite: false })); glass.position.set(0, 3.02, -3.25); glass.userData.noShadow = true; root.add(glass);

  root.add(new THREE.HemisphereLight(0x9a87bb, 0x26162c, 0.58));
  const sunsetFill = new THREE.PointLight(0xff8b58, 2.6, 24, 2); sunsetFill.position.set(-1.6, 3.8, -2.7); root.add(sunsetFill);
  const roomLamp = new THREE.PointLight(0xffb070, 4.8, 12, 2); roomLamp.position.set(5.35, 1.35, 0.7); roomLamp.castShadow = !isMobile; roomLamp.shadow.mapSize.set(isMobile ? 512 : 1024, isMobile ? 512 : 1024); roomLamp.shadow.camera.far = 14; roomLamp.shadow.bias = -0.004; root.add(roomLamp);
  const softDesk = new THREE.PointLight(0xffc085, 2.1, 7, 2); softDesk.position.set(-4.7, 1.2, -1.5); root.add(softDesk);

  const deskMat = stdMat({ color: 0x3a2118, roughness: 0.78 });
  addBox(root, 9.6, 0.16, 1.0, deskMat, -0.55, 0.72, -2.48);
  for (const x of [-4.8, -1.4, 2.2]) addBox(root, 0.12, 0.72, 0.12, deskMat, x, 0.36, -2.12);
  const laptop = new THREE.Group();
  addBox(laptop, 0.9, 0.035, 0.58, stdMat({ color: 0x18131c, roughness: 0.6, metalness: 0.15 }), 0, 0.02, 0);
  const screen = addBox(laptop, 0.86, 0.55, 0.035, stdMat({ color: 0x101827, roughness: 0.5, metalness: 0.08, emissive: 0x182a44, emissiveIntensity: 0.25 }), 0, 0.31, -0.28);
  screen.rotation.x = -0.18; laptop.position.set(-0.9, 0.82, -2.42); laptop.rotation.y = -0.12; root.add(laptop);
  place(root, 'industrial_pipe_lamp', -4.35, 0.81, -2.45, 1.35, 0.35);
  place(root, 'potted_plant_04', 3.55, 0.82, -2.48, 2.2, -0.15);

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.1), stdMat({ color: 0x2d2440, roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.02, 2.1); rug.receiveShadow = true; root.add(rug);
  const rug2 = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.0), stdMat({ color: 0x6d4554, roughness: 1 })); rug2.rotation.x = -Math.PI / 2; rug2.position.set(0, 0.03, 2.1); root.add(rug2);

  place(root, 'vintage_day_bed', 3.75, 0, 1.55, 1.02, -0.65);
  place(root, 'painted_wooden_nightstand', 5.85, 0, 0.26, 0.86, -0.3);
  place(root, 'industrial_pipe_lamp', 5.85, 0.72, 0.18, 1.35, -0.75);
  place(root, 'alarm_clock_01', 5.58, 1.27, 0.22, 1.45, -0.15);

  place(root, 'sofa_03', -4.45, 0, 1.55, 1.04, 0.5);
  place(root, 'mid_century_lounge_chair', -2.25, 0, -1.25, 1.0, 0.85);
  place(root, 'round_wooden_table_01', -0.6, 0, 2.35, 0.68, 0.15);
  place(root, 'chess_set', -0.6, 0.72, 2.35, 1.15, 0.3);
  place(root, 'book_encyclopedia_set_01', -0.1, 0.74, 2.82, 0.64, -0.25);
  place(root, 'Camera_01', -1.08, 0.72, 2.0, 1.55, 0.8);

  place(root, 'steel_frame_shelves_03', -6.75, 0, -1.15, 1.0, Math.PI / 2);
  place(root, 'boombox', -6.78, 1.62, -1.15, 0.72, Math.PI / 2);
  place(root, 'potted_plant_04', -6.55, 2.2, -0.42, 2.1, 0.1);
  place(root, 'potted_plant_04', 6.95, 0, -1.8, 4.8, -0.2);
  place(root, 'fancy_picture_frame_01', -7.7, 3.25, 1.05, 2.6, Math.PI / 2);
  cityArt(root, 7.72, 3.25, 0.85, Math.PI, 'sunset');
  scene.fog = null;
}
const BUILDERS = { cabin: buildCabin, beach: buildBeach, city: buildCity };
const HDRI_FOR = { cabin: 'cabin', beach: 'sandsloot', city: 'industrial_sunset_02_puresky' };
const MODELS_FOR = {
  cabin: ['modern_arm_chair_01', 'coffee_table_round_01', 'potted_plant_01', 'brass_candleholders', 'book_encyclopedia_set_01'],
  beach: ['painted_wooden_bench', 'modular_wooden_pier', 'outdoor_table_chair_set_01', 'Ukulele_01', 'potted_plant_04'],
  city: ['vintage_day_bed', 'painted_wooden_nightstand', 'industrial_pipe_lamp', 'alarm_clock_01', 'sofa_03', 'mid_century_lounge_chair', 'round_wooden_table_01', 'chess_set', 'book_encyclopedia_set_01', 'Camera_01', 'steel_frame_shelves_03', 'boombox', 'potted_plant_04', 'fancy_picture_frame_01'],
};
const MOBILE_SKIP = {
  city: new Set(['chess_set', 'Camera_01', 'boombox', 'fancy_picture_frame_01']),
};

async function buildScene() {
  const skip = isMobile && MOBILE_SKIP[theme] ? MOBILE_SKIP[theme] : null;
  const models = (MODELS_FOR[theme] || []).filter(slug => !(skip && skip.has(slug)));
  await Promise.all([loadHDRI(HDRI_FOR[theme]), ...models.map(loadModel)]);
  if (!renderer) return;
  if (sceneRoot) { scene.remove(sceneRoot); disposeTree(sceneRoot); }
  fireLight = null; flames = []; waveFrame = 0; scene.fog = null;
  const hdri = hdriTex[HDRI_FOR[theme]];
  scene.environment = hdri || null;
  scene.environmentIntensity = theme === 'beach' ? 0.62 : (theme === 'city' ? 0.45 : 0.66);
  scene.background = theme === 'beach' ? null : new THREE.Color(0x0a0705);
  scene.backgroundBlurriness = 0;
  sceneRoot = new THREE.Group();
  (BUILDERS[theme] || buildCabin)(sceneRoot);
  // Shadows ground the furniture on desktop; mobile relies on painted/contact shadows and lower GPU pressure.
  sceneRoot.traverse(o => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = !isMobile; o.receiveShadow = !isMobile; } });
  scene.add(sceneRoot);
  applyAngle(spot, true);
}
function disposeTree(obj) { obj.traverse(o => { if (o.geometry && !o.userData.keep) o.geometry.dispose(); if (o.material && !o.userData.keep) { const arr = Array.isArray(o.material) ? o.material : [o.material]; arr.forEach(m => { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose && m.dispose(); }); } }); }

function applyAngle(sp, instant) {
  const a = (ANGLES[theme] || ANGLES.cabin)[sp] || ANGLES[theme][0];
  camB.pos.set(a.pos[0], a.pos[1], a.pos[2]); camB.tgt.set(a.tgt[0], a.tgt[1], a.tgt[2]);
  if (instant) { camA.pos.copy(camB.pos); camA.tgt.copy(camB.tgt); camMix = 1; basePos.copy(camB.pos); currentTarget.copy(camB.tgt); camera.position.copy(camB.pos); camera.lookAt(camB.tgt); }
  else { camA.pos.copy(basePos); camA.tgt.copy(currentTarget); camMix = 0; }
}
function resize() { const r = container.getBoundingClientRect(); const w = r.width || innerWidth, h = r.height || innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
function onMove(e) { mouseT.x = (e.clientX / innerWidth) * 2 - 1; mouseT.y = (e.clientY / innerHeight) * 2 - 1; }

function loop() {
  raf = requestAnimationFrame(loop);
  // NOTE: getDelta() must be read first — getElapsedTime() also consumes the
  // internal delta, which would leave dt≈0 and freeze the camera tween.
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  if (camMix < 1) { camMix = Math.min(1, camMix + dt / 1.1); const e = camMix < 0.5 ? 2 * camMix * camMix : 1 - Math.pow(-2 * camMix + 2, 2) / 2; basePos.lerpVectors(camA.pos, camB.pos, e); currentTarget.lerpVectors(camA.tgt, camB.tgt, e); }
  else { basePos.copy(camB.pos); currentTarget.copy(camB.tgt); }
  mouse.x += (mouseT.x - mouse.x) * 0.04; mouse.y += (mouseT.y - mouse.y) * 0.04;
  // idle sway + mouse parallax applied continuously on top of the base position (no jump at transition end)
  camera.position.set(basePos.x + Math.sin(t * 0.3) * 0.05 + mouse.x * 0.22, basePos.y + Math.cos(t * 0.24) * 0.03 - mouse.y * 0.1, basePos.z);
  camera.lookAt(currentTarget);
  if (fireLight) fireLight.intensity = 20 + Math.sin(t * 12) * 5 + Math.sin(t * 27) * 3 + (Math.random() - 0.5) * 3;
  for (const f of flames) { const u = f.userData; const fl = 1 + 0.18 * Math.sin(t * 9 + u.ph) + 0.1 * Math.sin(t * 19 + u.ph); f.scale.set(u.sc * 0.72 * (0.9 + 0.1 * Math.sin(t * 7 + u.ph)), u.sc * 1.7 * fl, 1); f.position.x = u.bx + Math.sin(t * 3 + u.ph) * 0.04; f.material.rotation = Math.sin(t * 2.3 + u.ph) * 0.13; }
  if (theme === 'beach' && sceneRoot && sceneRoot.userData.sea) {
    const g = sceneRoot.userData.sea.geometry, pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, Math.sin(x * 0.16 + t * 0.72) * 0.07 + Math.cos(y * 0.22 + t * 0.62) * 0.045); }
    pos.needsUpdate = true;
    if ((waveFrame++ & 3) === 0) g.computeVertexNormals();
    const fx = sceneRoot.userData.beachFX;
    if (fx) {
      fx.path.material.opacity = 0.22 + 0.06 * Math.sin(t * 1.4);
      fx.path.scale.x = 0.42 + 0.04 * Math.sin(t * 0.8);
      fx.sunGlow.material.opacity = 0.5 + 0.04 * Math.sin(t * 0.9);
      for (let i = 0; i < fx.foamBands.length; i++) {
        const f = fx.foamBands[i], s = Math.sin(t * (0.45 + i * 0.09) + i * 1.7);
        f.mesh.position.z = f.z0 + s * 0.28;
        f.mesh.material.opacity = f.op * (0.7 + 0.35 * Math.max(0, s));
      }
    }
  }
  composer.render();
}

export async function openHaven3D(el, th, sp) {
  container = el; theme = th || 'cabin'; spot = sp || 0;
  isMobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !isMobile; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
