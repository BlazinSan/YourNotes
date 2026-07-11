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
let lastFrame = 0;
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
    { pos: [0, 2.25, 8.2], tgt: [0, 0.62, -4.8] },
    { pos: [4.2, 2.0, 7.2], tgt: [-1.4, 0.58, -5.4] },
    { pos: [-4.2, 2.0, 7.2], tgt: [1.6, 0.58, -5.2] },
  ],
  city: [
    { pos: [0, 1.72, 7.55], tgt: [0, 1.02, -1.28] },
    { pos: [4.05, 1.62, 6.35], tgt: [-1.25, 1.0, -1.75] },
    { pos: [-4.1, 1.62, 6.35], tgt: [1.15, 1.0, -1.75] },
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
          o.castShadow = o.receiveShadow = !isMobile;
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
function addContactShadow(root, x, z, sx, sz, opacity = 0.34, y = 0.026) {
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: tex((ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.82)');
      g.addColorStop(0.42, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }, 128, 128),
    transparent: true,
    opacity,
    depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(x, y, z); shadow.scale.set(sx, sz, 1); shadow.userData.noShadow = true; root.add(shadow); return shadow;
}
function addMug(root, x, y, z, s = 1, ry = 0, color = 0xdcc7a1) {
  const g = new THREE.Group();
  const ceramic = stdMat({ color, roughness: 0.78, metalness: 0.02 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.105 * s, 0.22 * s, 20), ceramic);
  cup.position.y = 0.11 * s; g.add(cup);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.095 * s, 20), new THREE.MeshBasicMaterial({ color: 0x1b0d08 }));
  coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.224 * s; coffee.userData.noShadow = true; g.add(coffee);
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.11 * s, 0.17 * s, 0),
    new THREE.Vector3(0.2 * s, 0.16 * s, 0),
    new THREE.Vector3(0.2 * s, 0.06 * s, 0),
    new THREE.Vector3(0.11 * s, 0.055 * s, 0),
  ]);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 10, 0.018 * s, 8), ceramic);
  g.add(handle); g.position.set(x, y, z); g.rotation.y = ry; root.add(g); return g;
}
function addLampGlow(root, x, y, z, sx, sy, color = 0xffb16a, opacity = 0.52) {
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: fireSprite(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity,
    color,
  }));
  glow.position.set(x, y, z); glow.scale.set(sx, sy, 1); glow.userData.noShadow = true; root.add(glow); return glow;
}

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
    g.addColorStop(0, '#12163f'); g.addColorStop(0.28, '#392b68'); g.addColorStop(0.45, '#8d477c');
    g.addColorStop(0.58, '#db725e'); g.addColorStop(0.69, '#ffc177'); g.addColorStop(0.76, '#4c7596'); g.addColorStop(1, '#183a55');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(240,235,255,${0.16 + Math.random() * 0.46})`; x.fillRect(Math.random() * w, Math.random() * h * 0.38, 1.4, 1.4); }
    for (let i = 0; i < 20; i++) {
      const cx = Math.random() * w, cy = h * (0.28 + Math.random() * 0.26), sw = 70 + Math.random() * 180;
      const cg = x.createRadialGradient(cx, cy, 0, cx, cy, sw * 0.55);
      cg.addColorStop(0, 'rgba(255,160,140,0.42)'); cg.addColorStop(1, 'rgba(255,160,140,0)');
      x.fillStyle = cg; x.fillRect(cx - sw, cy - sw * 0.35, sw * 2, sw * 0.7);
    }
  }, 1600, 900) }));
  sky.material.toneMapped = true; sky.userData.noShadow = true; root.add(sky);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(430, 190, isMobile ? 44 : 88, isMobile ? 24 : 48), new THREE.MeshStandardMaterial({ color: 0x315f7d, roughness: 0.42, metalness: 0.06, envMapIntensity: 0.42 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.1, -42); sea.userData.noShadow = true; root.add(sea); root.userData.sea = sea;

  const sandTex = tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#b78361'); g.addColorStop(0.36, '#d39b6c'); g.addColorStop(1, '#7c5662');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const a = Math.random() * 0.12; x.fillStyle = `rgba(${190 + Math.random() * 55 | 0},${140 + Math.random() * 55 | 0},${95 + Math.random() * 35 | 0},${a})`; x.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    x.globalAlpha = 0.18; x.strokeStyle = '#553646'; for (let i = 0; i < 18; i++) { const y = h * (0.12 + i * 0.045); x.beginPath(); x.moveTo(0, y); for (let px = 0; px <= w; px += 36) x.lineTo(px, y + Math.sin(px * 0.02 + i) * 5); x.stroke(); } x.globalAlpha = 1;
  }, 768, 512, [2.2, 1.4]);
  const sandGeo = new THREE.PlaneGeometry(104, 56, isMobile ? 12 : 24, isMobile ? 8 : 16);
  const sp = sandGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getX(i) * 0.22) * 0.018 + Math.cos(sp.getY(i) * 0.4) * 0.014);
  sandGeo.computeVertexNormals();
  const sand = new THREE.Mesh(sandGeo, stdMat({ map: sandTex, roughness: 0.96, metalness: 0.01 }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0, 13); sand.receiveShadow = true; root.add(sand);

  const wetTex = tex((x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#385e76'); g.addColorStop(0.5, '#6c6075'); g.addColorStop(1, '#a47461'); x.fillStyle = g; x.fillRect(0, 0, w, h); for (let i = 0; i < 360; i++) { x.fillStyle = `rgba(255,225,190,${Math.random() * 0.09})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 1); } }, 512, 256, [2, 1]);
  const wet = new THREE.Mesh(new THREE.PlaneGeometry(104, 12), stdMat({ map: wetTex, roughness: 0.48, metalness: 0.04, envMapIntensity: 0.32 }));
  wet.rotation.x = -Math.PI / 2; wet.position.set(0, 0.012, -2.8); wet.receiveShadow = true; root.add(wet);

  const foamTex = tex((x, w, h) => { x.clearRect(0, 0, w, h); for (let i = 0; i < 40; i++) { const cx = 10 + i * (w - 20) / 39, cy = h * 0.5 + Math.sin(i * 0.8) * 6; const r = 7 + Math.random() * 12; const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,248,230,0.8)'); g.addColorStop(1, 'rgba(255,248,230,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); } }, 256, 64);
  const foamBands = [];
  for (const [z, w, op] of [[-6.0, 84, 0.34], [-4.1, 78, 0.32], [-2.35, 68, 0.26], [-0.75, 58, 0.2], [0.8, 48, 0.16]]) {
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.18), new THREE.MeshBasicMaterial({ map: foamTex, color: 0xffeadc, transparent: true, opacity: op, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.015, z); foam.userData.noShadow = true; root.add(foam); foamBands.push({ mesh: foam, z0: z, op });
  }

  const sunT = tex((x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,235,190,1)'); g.addColorStop(0.32, 'rgba(255,205,130,1)'); g.addColorStop(0.5, 'rgba(255,170,110,0.55)'); g.addColorStop(1, 'rgba(255,150,100,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, 128, 128);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunT, transparent: true, depthWrite: false })); sun.position.set(-1.2, 1.5, -72); sun.scale.set(23, 23, 1); sun.material.toneMapped = true; root.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 })); sunGlow.position.set(-1.2, 1.6, -71); sunGlow.scale.set(70, 58, 1); root.add(sunGlow);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(8, 72), new THREE.MeshBasicMaterial({ map: sunT, color: 0xffb36a, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })); path.rotation.x = -Math.PI / 2; path.position.set(-1.2, 0.04, -34); path.scale.x = 0.45; path.userData.noShadow = true; root.add(path);
  const sunL = new THREE.DirectionalLight(0xffcaa0, 1.9); sunL.position.set(-5, 6, -6); sunL.castShadow = !isMobile; sunL.shadow.mapSize.set(1024, 1024); const sc = sunL.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 0.5; sc.far = 40; sunL.shadow.bias = -0.003; root.add(sunL);
  root.add(new THREE.HemisphereLight(0xffc08a, 0x25295c, 0.72));

  const pierMat = stdMat({ color: 0x3a2430, roughness: 0.9 });
  addContactShadow(root, 0, 1.5, 5.5, 10.5, 0.34);
  for (let i = 0; i < 15; i++) {
    const plank = addBox(root, 4.7 - i * 0.1, 0.08, 0.42, pierMat, 0, 0.08, 6.4 - i * 0.72);
    plank.rotation.y = (i % 2 ? 0.018 : -0.018);
  }
  for (const x of [-2.35, 2.35]) for (let i = 0; i < 9; i++) addBox(root, 0.12, 1.0, 0.12, pierMat, x, 0.48, 5.6 - i * 1.05);
  place(root, 'modular_wooden_pier', -3.55, -0.05, -6.0, 0.38, -0.25);
  place(root, 'modular_wooden_pier', 3.2, -0.05, -7.6, 0.34, 0.22);
  addContactShadow(root, 2.1, 3.15, 3.1, 2.3, 0.42);
  place(root, 'outdoor_table_chair_set_01', 2.05, 0.09, 3.15, 1.3, -0.58);
  place(root, 'Ukulele_01', 1.62, 0.84, 3.05, 0.78, -0.25, Math.PI / 2, -0.22);
  place(root, 'potted_plant_04', 2.58, 0.86, 3.36, 1.2, 0.2);
  addMug(root, 2.0, 0.87, 2.78, 0.86, -0.35, 0xf1d7b8);
  addContactShadow(root, -2.45, 4.1, 2.8, 1.3, 0.35);
  place(root, 'painted_wooden_bench', -2.45, 0.07, 4.2, 0.94, Math.PI + 0.18);

  palm(root, -6.4, 0.3); palm(root, -8.3, -1.8); palm(root, 6.5, 1.5);
  rock(root, 3.6, -1.6, 0.6, 0x342945); rock(root, 4.5, -0.8, 0.36, 0x2a2438); rock(root, -3.2, 1.3, 0.45, 0x352a42); rock(root, 5.4, 3.7, 0.35, 0x32283d);
  hut(root, 8.6, -12.5);
  const tableGlow = new THREE.PointLight(0xffb36b, 1.4, 6, 2); tableGlow.position.set(2.2, 1.05, 3.1); root.add(tableGlow); addLampGlow(root, 2.1, 0.95, 3.0, 1.6, 1.1, 0xffa664, 0.22);
  root.userData.beachFX = { foamBands, path, sunGlow };
  scene.fog = new THREE.FogExp2(0x2a2050, 0.006);
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
    const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#071126'); g.addColorStop(0.5, '#101733'); g.addColorStop(1, '#050b1a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,0.045)'; x.fillRect(0, 0, 4, h); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(w - 5, 0, 5, h);
    for (let wy = 12; wy < h - 10; wy += 18) for (let wx = 9; wx < w - 9; wx += 15) {
      const r = Math.random(); x.fillStyle = r < 0.4 ? (Math.random() < 0.72 ? '#ffd48a' : '#bfe0ff') : '#0d1830'; x.fillRect(wx, wy, 8, 10);
      if (r < 0.28) { x.fillStyle = 'rgba(255,210,120,0.24)'; x.fillRect(wx - 1, wy - 1, 10, 12); }
    }
  }, 128, 256);
}
function cityBuildings(root) {
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(260, 118), new THREE.MeshBasicMaterial({ map: tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#172452'); g.addColorStop(0.32, '#474d86'); g.addColorStop(0.55, '#d06c68'); g.addColorStop(0.72, '#ff9d55'); g.addColorStop(1, '#20172e');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const cx = Math.random() * w, cy = h * (0.24 + Math.random() * 0.38), sw = 60 + Math.random() * 170; const cg = x.createRadialGradient(cx, cy, 0, cx, cy, sw); cg.addColorStop(0, 'rgba(255,155,110,0.28)'); cg.addColorStop(1, 'rgba(255,155,110,0)'); x.fillStyle = cg; x.fillRect(cx - sw, cy - sw * 0.35, sw * 2, sw * 0.7); }
    for (let i = 0; i < 130; i++) { x.fillStyle = `rgba(230,235,255,${Math.random() * 0.42})`; x.fillRect(Math.random() * w, Math.random() * h * 0.34, 1.3, 1.3); }
    x.fillStyle = 'rgba(28,24,45,0.62)'; x.fillRect(0, h * 0.72, w, h * 0.28);
    for (let i = 0; i < 26; i++) { x.strokeStyle = `rgba(255,135,90,${0.08 + Math.random() * 0.16})`; x.lineWidth = 1 + Math.random() * 2; x.beginPath(); const y = h * (0.76 + Math.random() * 0.18); x.moveTo(Math.random() * w, y); x.lineTo(Math.random() * w, y + Math.random() * 20); x.stroke(); }
  }, 1200, 620) }));
  sky.material.toneMapped = true; sky.position.set(0, 17, -55); sky.userData.noShadow = true; root.add(sky);
  // real 3D building field (parallax depth as the camera moves between angles)
  const texes = [bldgTex(), bldgTex(), bldgTex(), bldgTex()];
  const rand = (i) => { let s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < (isMobile ? 24 : 38); i++) {
    const w = 1.2 + rand(i) * 3.2, d = 1.3 + rand(i + 99) * 3.0, hh = 4.5 + rand(i + 7) * 12.5;
    const t = texes[i % 4].clone(); t.repeat.set(Math.max(1, w / 2 | 0), Math.max(1, hh / 4 | 0)); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), new THREE.MeshBasicMaterial({ map: t }));
    b.position.set((rand(i + 3) - 0.5) * 106, hh / 2 - 8.2, -42 - rand(i + 21) * 74); b.userData.noShadow = true; root.add(b);
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
function wallPoster(root, x, y, z, w, h, ry, kind) {
  const g = new THREE.Group();
  addBox(g, w + 0.16, h + 0.16, 0.08, stdMat({ color: 0x251719, roughness: 0.66, metalness: 0.04 }), 0, 0, 0);
  const artTex = tex((ctx, tw, th) => {
    const grad = ctx.createLinearGradient(0, 0, 0, th);
    if (kind === 'car') { grad.addColorStop(0, '#201a44'); grad.addColorStop(0.62, '#bf475e'); grad.addColorStop(1, '#ff955c'); }
    else { grad.addColorStop(0, '#23356a'); grad.addColorStop(0.54, '#b84f65'); grad.addColorStop(1, '#ffad63'); }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, tw, th);
    ctx.fillStyle = 'rgba(255,229,160,0.9)'; ctx.beginPath(); ctx.arc(tw * 0.58, th * 0.58, tw * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(17,18,40,0.78)'; ctx.fillRect(0, th * 0.68, tw, th * 0.32);
    for (let i = 0; i < 12; i++) { const bx = i * tw / 12; const bh = th * (0.12 + Math.random() * 0.22); ctx.fillStyle = 'rgba(22,24,48,0.9)'; ctx.fillRect(bx, th * 0.68 - bh, tw / 15, bh); }
  }, 320, 420);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: artTex }));
  art.position.z = 0.052; art.userData.noShadow = true; g.add(art);
  g.position.set(x, y, z); g.rotation.y = ry; root.add(g); return g;
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

  root.add(new THREE.HemisphereLight(0x8f87bb, 0x1b1025, 0.48));
  const sunsetFill = new THREE.PointLight(0xff7f58, 3.2, 26, 2); sunsetFill.position.set(-1.2, 3.6, -2.65); root.add(sunsetFill);
  const cityRim = new THREE.PointLight(0x6aa8ff, 1.65, 18, 2); cityRim.position.set(3.4, 3.2, -2.8); root.add(cityRim);
  const roomLamp = new THREE.PointLight(0xffb070, 5.2, 12, 2); roomLamp.position.set(4.95, 1.38, 0.95); roomLamp.castShadow = !isMobile; roomLamp.shadow.mapSize.set(isMobile ? 512 : 1024, isMobile ? 512 : 1024); roomLamp.shadow.camera.far = 14; roomLamp.shadow.bias = -0.004; root.add(roomLamp);
  const deskSpot = new THREE.SpotLight(0xffbd7a, 4.1, 8, 0.72, 0.55, 2);
  deskSpot.position.set(-3.65, 1.65, -1.9); deskSpot.castShadow = !isMobile; deskSpot.shadow.mapSize.set(768, 768); deskSpot.shadow.bias = -0.004;
  const deskTarget = new THREE.Object3D(); deskTarget.position.set(-1.2, 0.82, -1.85); root.add(deskTarget); deskSpot.target = deskTarget; root.add(deskSpot);
  addLampGlow(root, -3.65, 1.32, -1.86, 1.7, 1.25, 0xffb06a, 0.28);
  addLampGlow(root, 4.95, 1.28, 0.95, 2.1, 1.45, 0xffa65f, 0.24);

  const deskMat = stdMat({ color: 0x3b2318, roughness: 0.78 });
  addContactShadow(root, -0.55, -1.6, 9.5, 1.45, 0.38);
  addBox(root, 9.8, 0.18, 1.12, deskMat, -0.45, 0.76, -2.08);
  addBox(root, 9.9, 0.13, 0.22, stdMat({ color: 0x17111d, roughness: 0.7, metalness: 0.12 }), -0.45, 0.93, -2.72);
  for (const x of [-4.95, -1.3, 2.25, 4.1]) addBox(root, 0.12, 0.78, 0.12, deskMat, x, 0.39, -1.72);
  const laptop = new THREE.Group();
  addBox(laptop, 0.98, 0.035, 0.62, stdMat({ color: 0x17131b, roughness: 0.58, metalness: 0.15 }), 0, 0.02, 0);
  const screen = addBox(laptop, 0.94, 0.58, 0.035, stdMat({ color: 0x101827, roughness: 0.48, metalness: 0.08, emissive: 0x24486f, emissiveIntensity: 0.38 }), 0, 0.33, -0.29);
  screen.rotation.x = -0.2; laptop.position.set(-0.65, 0.87, -2.03); laptop.rotation.y = -0.12; root.add(laptop);
  place(root, 'desk_lamp_arm_01', -3.62, 0.84, -2.02, 0.92, 0.62);
  place(root, 'potted_plant_04', 3.0, 0.85, -2.18, 1.8, -0.2);
  addMug(root, -1.55, 0.86, -1.82, 0.9, -0.35, 0xd8c2a1);
  place(root, 'book_encyclopedia_set_01', 1.02, 0.86, -1.82, 0.58, -0.18);
  place(root, 'alarm_clock_01', 1.82, 0.86, -1.82, 1.02, 0.05);

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(7.1, 4.55), stdMat({ color: 0x2d2440, roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.02, 2.05); rug.receiveShadow = true; root.add(rug);
  const rug2 = new THREE.Mesh(new THREE.PlaneGeometry(5.7, 3.25), stdMat({ color: 0x794d5a, roughness: 1 })); rug2.rotation.x = -Math.PI / 2; rug2.position.set(0, 0.03, 2.05); root.add(rug2);

  addContactShadow(root, 0.05, 1.62, 2.25, 2.05, 0.42);
  place(root, 'round_wooden_table_01', 0.05, 0, 1.62, 0.76, 0.12);
  place(root, 'chess_set', -0.16, 0.79, 1.56, 1.06, 0.35);
  place(root, 'Camera_01', -0.78, 0.8, 1.27, 1.24, 0.72);
  place(root, 'book_encyclopedia_set_01', 0.58, 0.82, 1.95, 0.55, -0.28);
  addMug(root, 0.7, 0.8, 1.18, 0.86, 0.2, 0xf0d6b0);
  place(root, 'Ukulele_01', 1.06, 0.81, 1.75, 0.62, -0.52, Math.PI / 2, -0.18);

  addContactShadow(root, -4.15, 1.46, 3.1, 1.5, 0.36);
  place(root, 'sofa_03', -4.15, 0, 1.45, 0.94, 0.42);
  addContactShadow(root, 3.25, 1.18, 1.8, 1.65, 0.32);
  place(root, 'mid_century_lounge_chair', 3.25, 0, 1.18, 0.9, -0.68);
  addContactShadow(root, 5.1, 2.18, 2.6, 2.2, 0.38);
  place(root, 'vintage_day_bed', 5.05, 0, 2.18, 0.86, -0.62);
  place(root, 'painted_wooden_nightstand', 5.75, 0, 0.62, 0.78, -0.22);
  place(root, 'industrial_pipe_lamp', 5.78, 0.68, 0.55, 1.18, -0.7);
  place(root, 'alarm_clock_01', 5.42, 1.18, 0.58, 1.22, -0.12);

  addContactShadow(root, -5.65, 0.36, 1.25, 2.3, 0.4);
  place(root, 'steel_frame_shelves_03', -5.8, 0, 0.34, 0.9, Math.PI / 2);
  place(root, 'boombox', -5.85, 1.52, 0.28, 0.68, Math.PI / 2);
  place(root, 'book_encyclopedia_set_01', -5.82, 0.96, -0.32, 0.48, Math.PI / 2);
  place(root, 'potted_plant_04', -5.6, 2.03, 1.02, 1.55, 0.1);
  wallPoster(root, -5.85, 3.35, 0.18, 1.2, 1.58, 0, 'sunset');
  place(root, 'fancy_picture_frame_01', -7.72, 3.08, 1.22, 2.25, Math.PI / 2);
  cityArt(root, 7.72, 3.08, 1.1, Math.PI, 'sunset');
  scene.fog = null;
}
const BUILDERS = { cabin: buildCabin, beach: buildBeach, city: buildCity };
const HDRI_FOR = { cabin: 'cabin', beach: 'sandsloot', city: 'industrial_sunset_02_puresky' };
const MODELS_FOR = {
  cabin: ['modern_arm_chair_01', 'coffee_table_round_01', 'potted_plant_01', 'brass_candleholders', 'book_encyclopedia_set_01'],
  beach: ['painted_wooden_bench', 'modular_wooden_pier', 'outdoor_table_chair_set_01', 'Ukulele_01', 'potted_plant_04'],
  city: ['vintage_day_bed', 'painted_wooden_nightstand', 'industrial_pipe_lamp', 'desk_lamp_arm_01', 'alarm_clock_01', 'sofa_03', 'mid_century_lounge_chair', 'round_wooden_table_01', 'chess_set', 'book_encyclopedia_set_01', 'Camera_01', 'steel_frame_shelves_03', 'boombox', 'potted_plant_04', 'fancy_picture_frame_01', 'Ukulele_01'],
};
const MOBILE_SKIP = {
  city: new Set(),
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
  applyRenderMood();
  applyAngle(spot, true);
}
function disposeTree(obj) { obj.traverse(o => { if (o.geometry && !o.userData.keep) o.geometry.dispose(); if (o.material && !o.userData.keep) { const arr = Array.isArray(o.material) ? o.material : [o.material]; arr.forEach(m => { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose && m.dispose(); }); } }); }
function applyRenderMood() {
  const wide = camera && camera.aspect > 1.35 && !isMobile;
  const fov = theme === 'city' ? (wide ? 60 : 54) : (theme === 'beach' ? (wide ? 58 : 52) : 52);
  camera.fov = fov; camera.updateProjectionMatrix();
  const mood = theme === 'city'
    ? { exposure: 1.1, strength: 0.48, radius: 0.78, threshold: 0.86 }
    : theme === 'beach'
      ? { exposure: 1.07, strength: 0.42, radius: 0.74, threshold: 0.88 }
      : { exposure: 1.0, strength: 0.34, radius: 0.7, threshold: 0.92 };
  renderer.toneMappingExposure = mood.exposure;
  bloom.strength = mood.strength; bloom.radius = mood.radius; bloom.threshold = mood.threshold;
}

function applyAngle(sp, instant) {
  const a = (ANGLES[theme] || ANGLES.cabin)[sp] || ANGLES[theme][0];
  camB.pos.set(a.pos[0], a.pos[1], a.pos[2]); camB.tgt.set(a.tgt[0], a.tgt[1], a.tgt[2]);
  if (instant) { camA.pos.copy(camB.pos); camA.tgt.copy(camB.tgt); camMix = 1; basePos.copy(camB.pos); currentTarget.copy(camB.tgt); camera.position.copy(camB.pos); camera.lookAt(camB.tgt); }
  else { camA.pos.copy(basePos); camA.tgt.copy(currentTarget); camMix = 0; }
}
function resize() { const r = container.getBoundingClientRect(); const w = r.width || innerWidth, h = r.height || innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; if (renderer) applyRenderMood(); else camera.updateProjectionMatrix(); }
function onMove(e) { mouseT.x = (e.clientX / innerWidth) * 2 - 1; mouseT.y = (e.clientY / innerHeight) * 2 - 1; }

function loop(now = 0) {
  raf = requestAnimationFrame(loop);
  if (!mounted || document.hidden) return;
  const frameInterval = isMobile ? 1000 / 30 : 1000 / 60;
  if (now - lastFrame < frameInterval) return;
  lastFrame = now - ((now - lastFrame) % frameInterval);
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
  mounted = true; lastFrame = 0;
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
export async function retryHaven3D() { if (!container || !renderer) return false; await buildScene(); return true; }
