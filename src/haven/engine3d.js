// ============================================================
// Safe Haven — real-time WebGL 3D engine (Three.js).
// Actual 3D rooms lit by image-based lighting + a warm fire light,
// with a camera that dollies between THREE fixed angles per scene
// (not a pan/zoom — genuinely different viewpoints of one 3D space).
// Post: ACES tone-map + Unreal bloom. Same public interface as before.
// ============================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

let renderer, scene, camera, composer, bloom, raf = 0, container, clock;
let theme = 'cabin', spot = 0, mounted = false;
let sceneRoot = null, fireLight = null, flames = [];
let camA = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };   // current
let camB = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };   // target angle
let camMix = 1;
let mouse = { x: 0, y: 0 }, mouseT = { x: 0, y: 0 };
let pmrem = null, envMap = null;

// ---- camera angles per theme (position + look-at target), in metres ----
const ANGLES = {
  cabin: [
    { pos: [0, 1.5, 4.6], tgt: [0, 1.15, -2] },
    { pos: [2.7, 1.45, 3.2], tgt: [-0.4, 1.1, -1.8] },
    { pos: [-2.7, 1.45, 3.2], tgt: [0.5, 1.1, -1.8] },
  ],
  beach: [
    { pos: [0, 1.6, 6], tgt: [0, 1.4, -8] },
    { pos: [3.2, 1.6, 5], tgt: [-2, 1.3, -8] },
    { pos: [-3.2, 1.6, 5], tgt: [2, 1.3, -8] },
  ],
  city: [
    { pos: [0, 1.5, 4.4], tgt: [0, 1.4, -6] },
    { pos: [2.4, 1.4, 3.4], tgt: [-1.5, 1.3, -6] },
    { pos: [-2.4, 1.4, 3.4], tgt: [1.5, 1.3, -6] },
  ],
};

// ---------- canvas-texture helpers (no external asset downloads) ----------
function tex(draw, w = 512, h = 512, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4; return t;
}
function woodTex() {
  return tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a3d22'); g.addColorStop(1, '#3a2614'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalAlpha = 0.25;
    for (let i = 0; i < 60; i++) { x.strokeStyle = i % 2 ? '#2a1a0e' : '#6a4a2a'; x.lineWidth = 1 + Math.random() * 2; x.beginPath(); const y = Math.random() * h; x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + (Math.random() * 20 - 10), w * 0.6, y + (Math.random() * 20 - 10), w, y); x.stroke(); }
    x.globalAlpha = 1; for (let px = 0; px < w; px += 64) { x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(px, 0, 2, h); }
  }, 512, 512, [4, 4]);
}
function stoneTex() {
  return tex((x, w, h) => {
    x.fillStyle = '#4a4038'; x.fillRect(0, 0, w, h);
    const bw = 84, bh = 42;
    for (let ry = 0, r = 0; ry < h; ry += bh, r++) for (let rx = -bw + (r % 2) * bw / 2; rx < w; rx += bw) {
      const t = 0.6 + Math.random() * 0.4; x.fillStyle = `rgb(${90 * t | 0},${78 * t | 0},${64 * t | 0})`; x.fillRect(rx + 3, ry + 3, bw - 6, bh - 6);
      x.fillStyle = 'rgba(255,240,220,0.12)'; x.fillRect(rx + 3, ry + 3, bw - 6, 4);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(rx + 3, ry + bh - 6, bw - 6, 3);
    }
  }, 512, 512, [2, 2]);
}
function booksTex() {
  return tex((x, w, h) => {
    x.fillStyle = '#160e07'; x.fillRect(0, 0, w, h);
    const cols = ['#8a3b34', '#c98a3a', '#3a6a5a', '#6a4a8a', '#3a5a8a', '#a0654a', '#4a7a4a', '#7a3a4a', '#d0a860'];
    const rows = 6, sh = h / rows;
    for (let r = 0; r < rows; r++) { let bx = 6; while (bx < w - 8) { const bw = 12 + Math.random() * 20, bh = sh * (0.7 + Math.random() * 0.26); x.fillStyle = cols[Math.random() * cols.length | 0]; x.fillRect(bx, r * sh + sh - bh - 6, bw, bh); x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(bx, r * sh + sh - bh - 6, bw * 0.3, bh); bx += bw + 3; } x.fillStyle = '#3a2818'; x.fillRect(0, r * sh + sh - 6, w, 6); }
  });
}
function skylineTex(night) {
  return tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    if (night) { g.addColorStop(0, '#0a1436'); g.addColorStop(0.6, '#1a2450'); g.addColorStop(1, '#2a2a52'); }
    else { g.addColorStop(0, '#243a6a'); g.addColorStop(0.55, '#8a4a6a'); g.addColorStop(0.8, '#e08a4a'); g.addColorStop(1, '#ffc06a'); }
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    // moon
    x.fillStyle = '#eef2ff'; x.beginPath(); x.arc(w * 0.7, h * 0.22, 26, 0, 7); x.fill();
    x.fillStyle = g; x.beginPath(); x.arc(w * 0.73, h * 0.19, 24, 0, 7); x.fill();
    // buildings + windows
    for (let layer = 0; layer < 3; layer++) {
      const base = h * (0.55 + layer * 0.12); x.fillStyle = ['#101a38', '#16213f', '#1c2947'][layer];
      let bx = 0; while (bx < w) { const bw = 30 + Math.random() * 60, bh = (60 + Math.random() * 160) * (1 + layer * 0.3); x.fillRect(bx, base - bh, bw, bh + 200); for (let wy = base - bh + 8; wy < base; wy += 12) for (let wx = bx + 5; wx < bx + bw - 5; wx += 10) if (Math.random() < 0.5) { x.fillStyle = Math.random() < 0.7 ? 'rgba(255,210,130,0.9)' : 'rgba(180,220,255,0.8)'; x.fillRect(wx, wy, 4, 6); x.fillStyle = ['#101a38', '#16213f', '#1c2947'][layer]; } bx += bw + 6; }
    }
  }, 1024, 512);
}
function fireSprite() {
  const t = tex((x, w, h) => { const g = x.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(0.3, 'rgba(255,170,60,0.9)'); g.addColorStop(0.7, 'rgba(255,90,20,0.3)'); g.addColorStop(1, 'rgba(255,60,10,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, 128, 128);
  return t;
}

// ---------- material helpers ----------
function stdMat(opts) { return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0.02, envMapIntensity: 0.9 }, opts)); }
function addBox(root, w, h, d, mat, x, y, z, ry) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (ry) m.rotation.y = ry; root.add(m); return m; }

// ---------- fire (additive billboard flames + flickering light) ----------
function makeFire(root, x, y, z, scale) {
  const spr = fireSprite();
  flames = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.SpriteMaterial({ map: spr, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
    const s = new THREE.Sprite(mat); const sc = scale * (0.9 - i * 0.12);
    s.scale.set(sc, sc * 1.5, sc); s.position.set(x + (i - 2) * scale * 0.16, y + scale * 0.4, z);
    s.userData = { ph: Math.random() * 6, bx: s.position.x, by: s.position.y, sc };
    root.add(s); flames.push(s);
  }
  fireLight = new THREE.PointLight(0xff7a2a, 26, 9, 2); fireLight.position.set(x, y + scale * 0.5, z + 0.2); root.add(fireLight);
  // ember glow disc on the floor
  const gm = new THREE.Mesh(new THREE.CircleGeometry(scale * 1.6, 24), new THREE.MeshBasicMaterial({ map: spr, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5 }));
  gm.rotation.x = -Math.PI / 2; gm.position.set(x, 0.02, z + 0.4); root.add(gm);
}

// ---------- scene builders ----------
function buildCabin(root) {
  const wood = woodTex(), stone = stoneTex(), books = booksTex();
  const floorMat = stdMat({ map: wood, roughness: 0.7 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), floorMat); floor.rotation.x = -Math.PI / 2; root.add(floor);
  const wallMat = stdMat({ map: woodTex(), roughness: 0.9 });
  addBox(root, 9, 5, 0.2, wallMat, 0, 2.5, -3);          // back wall
  addBox(root, 0.2, 5, 9, wallMat, -4.5, 2.5, 0);         // left wall
  addBox(root, 0.2, 5, 9, wallMat, 4.5, 2.5, 0);          // right wall
  // ceiling (dark)
  addBox(root, 9, 0.2, 9, stdMat({ color: 0x1a120a, roughness: 1 }), 0, 5, 0);
  // fireplace
  addBox(root, 2.6, 3, 0.6, stdMat({ map: stone, roughness: 0.95 }), 0, 1.5, -2.7);
  addBox(root, 1.5, 1.7, 0.4, stdMat({ color: 0x0a0604, roughness: 1 }), 0, 0.95, -2.55);   // opening recess
  addBox(root, 3, 0.28, 0.7, stdMat({ color: 0x2a1a0e, roughness: 0.8 }), 0, 2.5, -2.55);  // mantel
  // bookshelves flanking
  for (const bx of [-2.7, 2.7]) { addBox(root, 1.8, 3.4, 0.5, stdMat({ color: 0x2a1c10 }), bx, 1.7, -2.78); addBox(root, 1.55, 3.15, 0.35, stdMat({ map: books, emissive: 0x120a04, emissiveIntensity: 0.3 }), bx, 1.65, -2.66); }
  // window (left wall) — night skyline, emissive
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.2), new THREE.MeshBasicMaterial({ map: skylineTex(true) })); win.position.set(-4.38, 1.8, 0.4); win.rotation.y = Math.PI / 2; root.add(win);
  addBox(root, 0.12, 2.5, 0.14, stdMat({ color: 0x1a120a }), -4.36, 1.8, -0.75); addBox(root, 0.12, 2.5, 0.14, stdMat({ color: 0x1a120a }), -4.36, 1.8, 1.55); addBox(root, 0.12, 0.14, 2.5, stdMat({ color: 0x1a120a }), -4.36, 1.8, 0.4);
  // armchairs (foreground) + sofa
  chair(root, -1.4, 1.0, 0.35, 0x8a4a30); chair(root, 1.5, 1.05, -0.35, 0x9a6a3f);
  // rug
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), stdMat({ color: 0x7a2f2f, roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.015, 0.4); root.add(rug);
  const rug2 = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), stdMat({ color: 0xb5673a, roughness: 1 })); rug2.rotation.x = -Math.PI / 2; rug2.position.set(0, 0.02, 0.4); root.add(rug2);
  // coffee table
  addBox(root, 1.1, 0.1, 0.6, stdMat({ map: wood }), 0, 0.5, 0.5); addBox(root, 0.08, 0.5, 0.08, stdMat({ color: 0x2a1a0e }), -0.5, 0.25, 0.75); addBox(root, 0.08, 0.5, 0.08, stdMat({ color: 0x2a1a0e }), 0.5, 0.25, 0.75);
  makeFire(root, 0, 0.2, -2.15, 0.8);
  // gentle warm fill so the room isn't pitch black away from the fire
  root.add(new THREE.HemisphereLight(0x3a2414, 0x0a0604, 0.35));
  scene.fog = new THREE.FogExp2(0x140a06, 0.05);
  return { warm: 0x3a2416 };
}
function chair(root, x, z, ry, col) {
  const g = new THREE.Group(); const m = stdMat({ color: col, roughness: 0.9 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.0), m); seat.position.y = 0.5; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.25), m); back.position.set(0, 0.95, -0.4); g.add(back);
  for (const ax of [-0.5, 0.5]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 1.0), m); arm.position.set(ax, 0.7, 0); g.add(arm); }
  g.position.set(x, 0, z); g.rotation.y = ry; root.add(g);
}
function buildBeach(root) {
  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: tex((x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#241a52'); g.addColorStop(0.34, '#6a3f8e'); g.addColorStop(0.52, '#b8567e'); g.addColorStop(0.64, '#d87a52'); g.addColorStop(0.71, '#e89a5a'); g.addColorStop(0.735, '#eaa864'); g.addColorStop(0.75, '#3f5f8e'); g.addColorStop(1, '#243056'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    // sun glow + disc sitting on the horizon band (warm, not white)
    const sy = h * 0.715, gl = x.createRadialGradient(w * 0.5, sy, 0, w * 0.5, sy, 190); gl.addColorStop(0, 'rgba(255,178,96,0.55)'); gl.addColorStop(0.5, 'rgba(255,150,90,0.22)'); gl.addColorStop(1, 'rgba(255,150,90,0)'); x.fillStyle = gl; x.fillRect(w * 0.5 - 190, sy - 190, 380, 380);
    x.fillStyle = '#ffbc6a'; x.beginPath(); x.arc(w * 0.5, sy, 38, 0, 7); x.fill();
    for (let i = 0; i < 240; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.7})`; x.fillRect(Math.random() * w, Math.random() * h * 0.45, 1.5, 1.5); }
  }, 2048, 1024), color: 0xa8a8a8 }));   // color multiplier dims the sky so the sun doesn't clip to white under bloom
  sky.material.toneMapped = true; root.add(sky);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(160, 160, 70, 70), new THREE.MeshStandardMaterial({ color: 0x2e2c56, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.12 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.2; root.add(sea); root.userData.sea = sea;
  const sun = new THREE.DirectionalLight(0xffcaa0, 2.4); sun.position.set(0, 6, -30); root.add(sun);
  root.add(new THREE.HemisphereLight(0xffb488, 0x2a2a5a, 0.7));
  // stilt hut (right)
  hut(root, 5, -10);
  palm(root, -5, -9); palm(root, -6.5, -11);
  scene.fog = new THREE.FogExp2(0x2a2050, 0.012);
  return { warm: 0x40306a };
}
function hut(root, x, z) {
  const g = new THREE.Group(); const m = stdMat({ color: 0x140c26, roughness: 1 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4), m); leg.position.set(dx, 0.8, dz); g.add(leg); }
  addBox(g, 2.6, 1.6, 2.6, m, 0, 2.6, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.4, 4), m); roof.position.set(0, 4, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffb060 }); const wi = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), winMat); wi.position.set(-1.32, 2.6, 0); wi.rotation.y = -Math.PI / 2; g.add(wi);
  const wl = new THREE.PointLight(0xffb060, 3, 8); wl.position.set(-1.5, 2.6, 0); g.add(wl);
  g.position.set(x, 0, z); root.add(g);
}
function palm(root, x, z) {
  const g = new THREE.Group(); const m = stdMat({ color: 0x0e0820, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 4.6, 8), m); trunk.position.y = 2.3; trunk.rotation.z = 0.14; g.add(trunk);
  const crown = new THREE.Vector3(0.6, 4.6, 0);
  for (let i = 0; i < 8; i++) { const frond = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.6, 5), m); frond.position.copy(crown); const ang = i / 8 * Math.PI * 2; frond.rotation.set(Math.PI / 2 - 0.5, ang, 0); frond.position.x += Math.cos(ang) * 1.0; frond.position.z += Math.sin(ang) * 1.0; frond.position.y -= 0.3; g.add(frond); }
  const coco = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), m); coco.position.copy(crown); g.add(coco);
  g.position.set(x, 0, z); root.add(g);
}
function buildCity(root) {
  addBox(root, 12, 6, 0.2, stdMat({ color: 0x120e18, roughness: 1 }), 0, 3, -3.4);      // back interior wall (with window cut visually via emissive plane)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), stdMat({ color: 0x1a1420, roughness: 0.6 })); floor.rotation.x = -Math.PI / 2; root.add(floor);
  // big window with dusk skyline
  const win = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.MeshBasicMaterial({ map: skylineTex(false) })); win.position.set(0, 2.2, -3.3); root.add(win);
  root.userData.cityGlow = new THREE.PointLight(0xff9a5a, 4, 30); root.userData.cityGlow.position.set(0, 2, -3); root.add(root.userData.cityGlow);
  // frame mullions
  const fm = stdMat({ color: 0x20233a });
  addBox(root, 0.12, 4, 0.12, fm, 0, 2.2, -3.25); addBox(root, 7, 0.12, 0.12, fm, 0, 2.2, -3.25);
  addBox(root, 0.12, 4, 0.12, fm, -2.3, 2.2, -3.25); addBox(root, 0.12, 4, 0.12, fm, 2.3, 2.2, -3.25);
  root.add(new THREE.HemisphereLight(0x6a5a8a, 0x201828, 0.45));
  const warmLamp = new THREE.PointLight(0xffb070, 1.6, 8); warmLamp.position.set(3.2, 1.7, 1.6); root.add(warmLamp);
  // bed / sofa foreground
  addBox(root, 4, 0.7, 2.2, stdMat({ color: 0x2a3550, roughness: 0.8 }), 0, 0.5, 1.2);
  addBox(root, 3.7, 0.18, 2.0, stdMat({ color: 0x3a4a72, roughness: 0.9 }), 0, 0.9, 1.3);   // blanket
  addBox(root, 1.1, 0.34, 0.62, stdMat({ color: 0xcabfa6, roughness: 0.95 }), 1.2, 1.05, 1.2);  // pillow
  chair(root, -3, 1, 0.4, 0x3a4a66);
  scene.fog = new THREE.FogExp2(0x140e18, 0.03);
  return { warm: 0x2a2440 };
}

const BUILDERS = { cabin: buildCabin, beach: buildBeach, city: buildCity };

function buildScene() {
  if (sceneRoot) { scene.remove(sceneRoot); disposeTree(sceneRoot); }
  fireLight = null; flames = [];
  sceneRoot = new THREE.Group();
  scene.fog = null;
  (BUILDERS[theme] || buildCabin)(sceneRoot);
  scene.add(sceneRoot);
  applyAngle(spot, true);
}
function disposeTree(obj) { obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach(mm => { for (const k in mm) { if (mm[k] && mm[k].isTexture) mm[k].dispose(); } mm.dispose && mm.dispose(); }); } }); }

function applyAngle(sp, instant) {
  const a = (ANGLES[theme] || ANGLES.cabin)[sp] || ANGLES[theme][0];
  camB.pos.set(a.pos[0], a.pos[1], a.pos[2]); camB.tgt.set(a.tgt[0], a.tgt[1], a.tgt[2]);
  if (instant) { camA.pos.copy(camB.pos); camA.tgt.copy(camB.tgt); camMix = 1; camera.position.copy(camB.pos); camera.lookAt(camB.tgt); }
  else { camA.pos.copy(camera.position); camA.tgt.copy(currentTarget); camMix = 0; }
}
const currentTarget = new THREE.Vector3();

function resize() {
  const r = container.getBoundingClientRect(); const w = r.width || innerWidth, h = r.height || innerHeight;
  renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function onMove(e) { mouseT.x = (e.clientX / innerWidth) * 2 - 1; mouseT.y = (e.clientY / innerHeight) * 2 - 1; }

function loop() {
  raf = requestAnimationFrame(loop);
  const t = clock.getElapsedTime(), dt = Math.min(0.05, clock.getDelta());
  // camera angle tween (ease)
  if (camMix < 1) { camMix = Math.min(1, camMix + dt / 1.1); const e = camMix < 0.5 ? 2 * camMix * camMix : 1 - Math.pow(-2 * camMix + 2, 2) / 2; camera.position.lerpVectors(camA.pos, camB.pos, e); currentTarget.lerpVectors(camA.tgt, camB.tgt, e); }
  else currentTarget.copy(camB.tgt);
  // subtle idle sway + mouse parallax
  mouse.x += (mouseT.x - mouse.x) * 0.04; mouse.y += (mouseT.y - mouse.y) * 0.04;
  const sway = new THREE.Vector3(Math.sin(t * 0.3) * 0.05 + mouse.x * 0.25, Math.cos(t * 0.24) * 0.03 - mouse.y * 0.12, 0);
  const p = camMix < 1 ? camera.position.clone() : camB.pos.clone().add(sway);
  camera.position.copy(p); camera.lookAt(currentTarget);
  // fire animation
  if (fireLight) { fireLight.intensity = 22 + Math.sin(t * 12) * 5 + Math.sin(t * 27) * 3 + (Math.random() - 0.5) * 3; }
  for (const f of flames) { const u = f.userData; const fl = 1 + 0.14 * Math.sin(t * 9 + u.ph) + 0.08 * Math.sin(t * 17 + u.ph); f.scale.set(u.sc * (0.9 + 0.1 * Math.sin(t * 7 + u.ph)), u.sc * 1.5 * fl, u.sc); f.position.x = u.bx + Math.sin(t * 3 + u.ph) * 0.03; f.position.y = u.by + (fl - 1) * 0.2; f.material.rotation = Math.sin(t * 2 + u.ph) * 0.1; }
  // sea shimmer
  if (theme === 'beach' && sceneRoot.userData.sea) { const g = sceneRoot.userData.sea.geometry, pos = g.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, Math.sin(x * 0.3 + t) * 0.08 + Math.cos(y * 0.4 + t * 0.8) * 0.06); } pos.needsUpdate = true; }
  composer.render();
}

// ---------- public interface ----------
export async function openHaven3D(el, th, sp) {
  container = el; theme = th || 'cabin'; spot = sp || 0;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));   // cap for mobile GPU perf
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  container.appendChild(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0705);
  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
  pmrem = new THREE.PMREMGenerator(renderer); envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = envMap;
  scene.environmentIntensity = 0.4;   // dim ambient IBL so the fire/lamp key-lights read (moody, not flat)
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.7, 0.92); composer.addPass(bloom);
  clock = new THREE.Clock();
  buildScene(); resize();
  addEventListener('resize', resize); addEventListener('mousemove', onMove);
  mounted = true; loop();
  window.__hv3 = { scene, camera, renderer, bloom, get theme() { return theme; }, get spot() { return spot; } };
}
export function closeHaven3D() {
  mounted = false; cancelAnimationFrame(raf); raf = 0;
  removeEventListener('resize', resize); removeEventListener('mousemove', onMove);
  if (sceneRoot) disposeTree(sceneRoot);
  if (envMap) envMap.dispose(); if (pmrem) pmrem.dispose();
  if (renderer) { renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
  renderer = scene = camera = composer = sceneRoot = null;
}
export async function setHavenTheme3D(th) { if (th === theme) return; theme = th; buildScene(); }
export function setHavenSeat3D(sp) { if (sp === spot) return; spot = sp; applyAngle(sp, false); }
