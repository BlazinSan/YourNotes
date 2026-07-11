// cabin.js — RAINY LOG CABIN AT NIGHT
// Intimate amber hearth against a cool, rain-washed pine forest.
import * as THREE from 'three';

export function build(ctx) {
  const { scene, quality } = ctx;
  const mobile = !!(quality && quality.mobile);
  const SEG = mobile ? 8 : 16;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- textures
  function makeTex(w, h, draw, repeatX, repeatY) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeatX || repeatY) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeatX || 1, repeatY || 1);
    }
    return t;
  }

  function drawLogs(g, w, h) {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#4a2f1c'); grd.addColorStop(1, '#2e1c0e');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const tone = 0.85 + Math.random() * 0.3;
      g.fillStyle = `rgba(${(74 * tone) | 0},${(47 * tone) | 0},${(28 * tone) | 0},0.55)`;
      g.fillRect(0, y + 2, w, rh - 4);
      // rounded log highlight + shadow seam
      g.fillStyle = 'rgba(255,200,140,0.07)';
      g.fillRect(0, y + rh * 0.18, w, rh * 0.16);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, y + rh - 3, w, 3);
      // grain streaks
      g.strokeStyle = 'rgba(20,10,4,0.25)'; g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const gy = y + rand(4, rh - 4);
        g.beginPath(); g.moveTo(rand(-20, 0), gy);
        g.bezierCurveTo(w * 0.3, gy + rand(-3, 3), w * 0.7, gy + rand(-3, 3), w + 20, gy);
        g.stroke();
      }
      // occasional knot
      if (Math.random() < 0.7) {
        const kx = rand(30, w - 30), ky = y + rh * 0.5;
        g.fillStyle = 'rgba(25,13,5,0.6)';
        g.beginPath(); g.ellipse(kx, ky, 7, 4, 0, 0, TAU); g.fill();
      }
    }
  }
  const wallTex = makeTex(512, 512, drawLogs, 1.6, 1);

  const floorTex = makeTex(512, 512, (g, w, h) => {
    g.fillStyle = '#33200f'; g.fillRect(0, 0, w, h);
    const cols = 6, cw = w / cols;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const x = cIdx * cw, tone = 0.8 + Math.random() * 0.35;
      g.fillStyle = `rgb(${(58 * tone) | 0},${(36 * tone) | 0},${(20 * tone) | 0})`;
      g.fillRect(x + 2, 0, cw - 4, h);
      g.strokeStyle = 'rgba(15,8,3,0.5)'; g.lineWidth = 1;
      for (let k = 0; k < 10; k++) {
        const gx = x + rand(6, cw - 6);
        g.beginPath(); g.moveTo(gx, -10);
        g.bezierCurveTo(gx + rand(-4, 4), h * 0.33, gx + rand(-4, 4), h * 0.66, gx, h + 10);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, 0, 2, h);
    }
  }, 2.4, 2.8);

  const stoneTex = makeTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2c2925'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = rand(0, w), y = rand(0, h), rx = rand(22, 55), ry = rand(16, 34);
      const v = rand(0.7, 1.15);
      g.fillStyle = `rgb(${(102 * v) | 0},${(97 * v) | 0},${(88 * v) | 0})`;
      g.beginPath(); g.ellipse(x, y, rx, ry, rand(0, TAU), 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,240,220,0.08)';
      g.beginPath(); g.ellipse(x - rx * 0.2, y - ry * 0.3, rx * 0.55, ry * 0.45, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(15,13,10,0.55)'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.stroke();
    }
  }, 1.4, 1.4);

  const rugTex = makeTex(512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#7a2e2e'; g.beginPath(); g.arc(cx, cy, 256, 0, TAU); g.fill();
    g.fillStyle = '#5e2222'; g.beginPath(); g.arc(cx, cy, 250, 0, TAU); g.fill();
    g.fillStyle = '#7a2e2e'; g.beginPath(); g.arc(cx, cy, 220, 0, TAU); g.fill();
    g.strokeStyle = '#8d4436'; g.lineWidth = 10;
    g.setLineDash([26, 18]);
    g.beginPath(); g.arc(cx, cy, 190, 0, TAU); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#4e1c1c'; g.lineWidth = 14;
    g.beginPath(); g.arc(cx, cy, 140, 0, TAU); g.stroke();
    g.fillStyle = '#8d4436'; g.beginPath(); g.arc(cx, cy, 60, 0, TAU); g.fill();
    // weave speckle
    for (let i = 0; i < 1400; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * 250;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,210,160,0.05)';
      g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 2);
    }
  });

  const flameTex = makeTex(128, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let grd = g.createRadialGradient(64, 200, 8, 64, 158, 118);
    grd.addColorStop(0, 'rgba(255,220,160,0.95)');
    grd.addColorStop(0.3, 'rgba(255,154,61,0.85)');
    grd.addColorStop(0.62, 'rgba(255,90,26,0.35)');
    grd.addColorStop(1, 'rgba(255,60,10,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    grd = g.createRadialGradient(64, 214, 4, 64, 196, 52);
    grd.addColorStop(0, 'rgba(255,247,224,1)');
    grd.addColorStop(0.5, 'rgba(255,220,160,0.9)');
    grd.addColorStop(1, 'rgba(255,180,90,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });

  const nightTex = makeTex(512, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0b1424'); grd.addColorStop(0.55, '#16233d'); grd.addColorStop(1, '#22335a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // Cloud-filtered moon glow. The soft pool of light reads through wet glass
    // without turning the exterior into a star-field backdrop.
    const mg = g.createRadialGradient(w * 0.68, h * 0.25, 4, w * 0.68, h * 0.25, 150);
    mg.addColorStop(0, 'rgba(210,225,235,0.7)');
    mg.addColorStop(0.3, 'rgba(120,155,185,0.24)');
    mg.addColorStop(1, 'rgba(80,115,140,0)');
    g.fillStyle = mg; g.fillRect(0, 0, w, h);
    // layered wet forest floor and mist
    g.fillStyle = '#10211f'; g.fillRect(0, h * 0.78, w, h * 0.22);
    const mist = g.createLinearGradient(0, h * 0.58, 0, h * 0.9);
    mist.addColorStop(0, 'rgba(130,160,165,0)');
    mist.addColorStop(0.52, 'rgba(130,160,165,0.16)');
    mist.addColorStop(1, 'rgba(40,70,65,0)');
    g.fillStyle = mist; g.fillRect(0, h * 0.5, w, h * 0.45);
    // pine silhouettes in three depths
    for (let layer = 0; layer < 3; layer++) {
      g.fillStyle = ['#142c2b', '#0d2323', '#08191a'][layer];
      const count = 10 + layer * 4;
      for (let i = 0; i < count; i++) {
        const x = rand(-20, w + 20), base = h * rand(0.79, 0.9), ph = rand(90, 190) * (0.8 + layer * 0.16), pw = ph * 0.42;
      for (let tier = 0; tier < 3; tier++) {
        const ty = base - ph * tier * 0.28, s = 1 - tier * 0.26;
        g.beginPath();
        g.moveTo(x - pw * s, ty); g.lineTo(x, ty - ph * 0.55 * s); g.lineTo(x + pw * s, ty);
        g.closePath(); g.fill();
      }
      }
    }
  });

  const rainGlassTex = makeTex(256, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 74; i++) {
      const x = rand(4, w - 4), y = rand(0, h), r = rand(1.2, 4.6);
      const drop = g.createRadialGradient(x - r * 0.35, y - r * 0.45, 0.2, x, y, r);
      drop.addColorStop(0, 'rgba(235,248,255,0.82)');
      drop.addColorStop(0.38, 'rgba(160,195,210,0.34)');
      drop.addColorStop(1, 'rgba(110,155,175,0)');
      g.fillStyle = drop; g.beginPath(); g.ellipse(x, y, r * 0.72, r, 0, 0, TAU); g.fill();
      if (i % 5 === 0) {
        g.strokeStyle = 'rgba(185,220,230,0.2)';
        g.lineWidth = Math.max(0.7, r * 0.28);
        g.beginPath(); g.moveTo(x, y + r); g.bezierCurveTo(x + rand(-2, 2), y + 10, x + rand(-3, 3), y + 22, x + rand(-2, 2), y + rand(28, 58)); g.stroke();
      }
    }
  });
  rainGlassTex.wrapT = THREE.RepeatWrapping;

  const dotTex = makeTex(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });

  // ------------------------------------------------------------- atmosphere
  scene.background = new THREE.Color(0x0a0806);
  scene.fog = new THREE.FogExp2(0x110d12, 0.03);

  const hemi = new THREE.HemisphereLight(0x4a5a82, 0x6a4a30, 1.7);
  scene.add(hemi);
  // gentle warm ambient so nothing sits in pure black (the references glow softly)
  scene.add(new THREE.AmbientLight(0x54381f, 0.7));
  // Materials carry a low warm emissive fill; only the hearth and window use
  // dynamic lights, keeping the phone scene predictable and inexpensive.

  // ------------------------------------------------------------------ room
  // A touch of emissive keyed to the wood texture lifts the walls/floor out of
  // pure black so the cosy detail reads even in the dim corners.
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.22 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, emissive: 0xffffff, emissiveMap: floorTex, emissiveIntensity: 0.16 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x241407, roughness: 0.9 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 7), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(6, 7),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0d, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.2;
  scene.add(ceil);

  function wall(wd, ht, x, y, z, ry) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry;
    scene.add(m); return m;
  }
  wall(6, 3.2, 0, 1.6, -3.5, 0);            // back (fireplace) wall
  wall(6, 3.2, 0, 1.6, 3.5, Math.PI);       // front wall
  wall(7, 3.2, 3, 1.6, 0, -Math.PI / 2);    // right wall
  // left wall built around the window opening (z -0.8..0.8, y 1.0..2.4)
  wall(2.7, 3.2, -3, 1.6, -2.15, Math.PI / 2);
  wall(2.7, 3.2, -3, 1.6, 2.15, Math.PI / 2);
  wall(1.6, 1.0, -3, 0.5, 0, Math.PI / 2);
  wall(1.6, 0.8, -3, 2.8, 0, Math.PI / 2);

  // ceiling beams
  const beamGeo = new THREE.BoxGeometry(6, 0.2, 0.24);
  for (const bz of [-2.1, 0, 2.1]) {
    const b = new THREE.Mesh(beamGeo, darkWood);
    b.position.set(0, 3.06, bz); scene.add(b);
  }

  // rug in front of hearth
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.15, SEG * 2),
    new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, -1.4);
  scene.add(rug);

  // shadow discs
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false });
  function shadow(r, x, z, sx, sz, y) {
    const s = new THREE.Mesh(new THREE.CircleGeometry(r, SEG), shadowMat);
    s.rotation.x = -Math.PI / 2; s.position.set(x, y || 0.006, z);
    s.scale.set(sx || 1, sz || 1, 1); scene.add(s);
  }

  // ------------------------------------------------------------- fireplace
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 1 });
  const hearthDark = new THREE.MeshStandardMaterial({ color: 0x0a0503, roughness: 1 });

  function stoneBox(w, h, d, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat);
    m.position.set(x, y, z); scene.add(m); return m;
  }
  stoneBox(0.7, 1.7, 0.6, -0.95, 0.85, -3.2);          // left column
  stoneBox(0.7, 1.7, 0.6, 0.95, 0.85, -3.2);           // right column
  stoneBox(2.6, 0.62, 0.6, 0, 1.39, -3.2);             // lintel
  stoneBox(1.8, 1.42, 0.5, 0, 2.49, -3.25);            // chimney breast
  stoneBox(2.4, 0.09, 1.0, 0, 0.045, -3.1);            // hearth slab
  // hearth cavity
  const cavBack = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.0), hearthDark);
  cavBack.position.set(0, 0.58, -3.46); scene.add(cavBack);
  const cavL = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.0), hearthDark);
  cavL.rotation.y = Math.PI / 2; cavL.position.set(-0.6, 0.58, -3.2); scene.add(cavL);
  const cavR = cavL.clone(); cavR.rotation.y = -Math.PI / 2; cavR.position.x = 0.6; scene.add(cavR);
  const cavTop = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), hearthDark);
  cavTop.rotation.x = Math.PI / 2; cavTop.position.set(0, 1.08, -3.2); scene.add(cavTop);
  // mantel
  const mantel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.1, 0.42), darkWood);
  mantel.position.set(0, 1.75, -3.12); scene.add(mantel);

  // burning logs
  const logMat = new THREE.MeshStandardMaterial({
    color: 0x231206, roughness: 1, emissive: 0xff5a1a, emissiveIntensity: 0.55
  });
  const logGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.62, Math.max(6, SEG / 2));
  const logAngles = [[0.5, Math.PI / 2 + 0.4], [0.5, Math.PI / 2 - 0.5], [0.9, Math.PI / 2]];
  logAngles.forEach((a, i) => {
    const lg = new THREE.Mesh(logGeo, logMat);
    lg.rotation.z = a[0]; lg.rotation.y = a[1];
    lg.position.set((i - 1) * 0.1, 0.16 + i * 0.02, -3.2);
    scene.add(lg);
  });

  // THE FIRE — 3 crossed additive planes
  const fireMat = new THREE.MeshBasicMaterial({
    map: flameTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });
  fireMat.color.setRGB(1.7, 1.4, 1.1);
  const fireGeo = new THREE.PlaneGeometry(0.56, 0.88);
  fireGeo.translate(0, 0.44, 0);
  const firePlanes = [];
  for (let i = 0; i < 3; i++) {
    const fp = new THREE.Mesh(fireGeo, fireMat);
    fp.position.set(0, 0.14, -3.2);
    fp.rotation.y = i * (Math.PI / 3);
    scene.add(fp); firePlanes.push(fp);
  }

  // hearth floor glow
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff8a3d, transparent: true, opacity: 0.14,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.0, SEG * 2), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.02, -2.5);
  scene.add(glow);

  const fireLight = new THREE.PointLight(0xff8a3d, 9.5, 15, 1.8);
  fireLight.position.set(0, 0.7, -2.85);
  scene.add(fireLight);

  // embers
  const EMBER_N = mobile ? 60 : 120;
  const emberGeo = new THREE.BufferGeometry();
  const ePos = new Float32Array(EMBER_N * 3);
  const eCol = new Float32Array(EMBER_N * 3);
  const eBX = new Float32Array(EMBER_N), eBZ = new Float32Array(EMBER_N);
  const eSpd = new Float32Array(EMBER_N), ePh = new Float32Array(EMBER_N);
  function resetEmber(i) {
    eBX[i] = rand(-0.26, 0.26); eBZ[i] = -3.2 + rand(-0.14, 0.14);
    eSpd[i] = rand(0.22, 0.5); ePh[i] = rand(0, TAU);
    ePos[i * 3] = eBX[i]; ePos[i * 3 + 1] = rand(0.12, 0.3); ePos[i * 3 + 2] = eBZ[i];
  }
  for (let i = 0; i < EMBER_N; i++) { resetEmber(i); ePos[i * 3 + 1] = rand(0.12, 1.0); }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  emberGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
  const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
    size: 0.035, map: dotTex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, vertexColors: true, fog: false
  }));
  scene.add(embers);

  // candles + wreath on mantel
  const candleMat = new THREE.MeshStandardMaterial({ color: 0xe8d9b8, roughness: 0.7 });
  const flameConeGeo = new THREE.ConeGeometry(0.014, 0.05, 8);
  flameConeGeo.translate(0, 0.025, 0);
  const flameMat = new THREE.MeshBasicMaterial({ fog: false });
  flameMat.color.setRGB(5, 4.3, 3.1); // #ffdca0 pushed hot for bloom
  const candleFlames = [];
  for (const cx of [-0.72, 0.78]) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.13, Math.max(6, SEG / 2)), candleMat);
    stick.position.set(cx, 1.865, -3.1); scene.add(stick);
    const fl = new THREE.Mesh(flameConeGeo, flameMat);
    fl.position.set(cx, 1.93, -3.1); scene.add(fl);
    candleFlames.push(fl);
  }
  const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 8, SEG),
    new THREE.MeshStandardMaterial({ color: 0x234020, roughness: 1 }));
  wreath.position.set(0, 2.42, -2.98); scene.add(wreath);
  const berryGeo = new THREE.SphereGeometry(0.016, 6, 5);
  const berryMat = new THREE.MeshStandardMaterial({ color: 0x8d1f1f, roughness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const b = new THREE.Mesh(berryGeo, berryMat);
    b.position.set(Math.cos(a) * 0.2, 2.42 + Math.sin(a) * 0.2, -2.92);
    scene.add(b);
  }

  // ------------------------------------------------------- window (x = -3)
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d0f06, roughness: 0.9 });
  function rail(w, h, d, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(x, y, z); scene.add(m);
  }
  rail(0.1, 0.1, 1.76, -2.97, 1.0, 0);      // sill
  rail(0.1, 0.1, 1.76, -2.97, 2.4, 0);      // header
  rail(0.1, 1.5, 0.1, -2.97, 1.7, -0.83);   // jambs
  rail(0.1, 1.5, 0.1, -2.97, 1.7, 0.83);
  rail(0.06, 1.4, 0.05, -2.98, 1.7, 0);     // mullions
  rail(0.06, 0.05, 1.6, -2.98, 1.7, 0);

  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4),
    new THREE.MeshBasicMaterial({ color: 0x2a3c5e, transparent: true, opacity: 0.16, depthWrite: false }));
  glass.rotation.y = Math.PI / 2; glass.position.set(-3.02, 1.7, 0);
  scene.add(glass);

  const wetGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 1.38),
    new THREE.MeshBasicMaterial({ map: rainGlassTex, transparent: true, opacity: 0.72, depthWrite: false }));
  wetGlass.rotation.y = Math.PI / 2; wetGlass.position.set(-2.965, 1.7, 0);
  wetGlass.renderOrder = 8;
  scene.add(wetGlass);

  // rain-dark forest backdrop + clouded moon
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(6, 4),
    new THREE.MeshBasicMaterial({ map: nightTex }));
  backdrop.rotation.y = Math.PI / 2; backdrop.position.set(-5.1, 1.9, 0);
  scene.add(backdrop);
  const moonMat = new THREE.MeshBasicMaterial({ fog: false });
  moonMat.color.setRGB(1.9, 2.1, 2.6);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.26, SEG * 2), moonMat);
  moon.rotation.y = Math.PI / 2; moon.position.set(-5.0, 2.7, -0.9);
  scene.add(moon);

  const moonLight = new THREE.PointLight(0x6b86c8, 1.8, 8, 2);
  moonLight.position.set(-2.6, 1.9, 0.2);
  scene.add(moonLight);

  // Instanced-looking line field outside the window. One LineSegments draw call
  // is enough for the full rain curtain.
  const RAIN_N = mobile ? 90 : 170;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainBaseX = new Float32Array(RAIN_N), rainBaseZ = new Float32Array(RAIN_N);
  const rainSpeed = new Float32Array(RAIN_N), rainPhase = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) {
    rainBaseX[i] = rand(-4.85, -3.18); rainBaseZ[i] = rand(-2.3, 1.8);
    rainSpeed[i] = rand(1.5, 2.8); rainPhase[i] = rand(0, TAU);
    const y = rand(0.05, 3.55), p = i * 6;
    rainPos[p] = rainBaseX[i]; rainPos[p + 1] = y; rainPos[p + 2] = rainBaseZ[i];
    rainPos[p + 3] = rainBaseX[i] + 0.025; rainPos[p + 4] = y - 0.16; rainPos[p + 5] = rainBaseZ[i] + 0.01;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
    color: 0x9fc4d0, transparent: true, opacity: 0.4, depthWrite: false,
  }));
  scene.add(rain);

  // window nook bench
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 1.5), darkWood);
  bench.position.set(-2.72, 0.2, 0.4); scene.add(bench);
  const benchCushion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 1.44),
    new THREE.MeshStandardMaterial({ color: 0x51364a, roughness: 1 }));
  benchCushion.position.set(-2.72, 0.445, 0.4); scene.add(benchCushion);
  shadow(0.5, -2.72, 0.4, 1, 1.7, 0.005);

  // ------------------------------------------------------------- furniture
  // Two deep chairs form a conversational nook, but both physically face the
  // fireplace (local forward is -Z). Earlier builds rotated the only chair by
  // PI, leaving its back toward the hearth.
  const fabricLeft = new THREE.MeshStandardMaterial({
    color: 0x66755b, emissive: 0x172016, emissiveIntensity: 0.26, roughness: 1
  });
  const fabricRight = new THREE.MeshStandardMaterial({
    color: 0x7b5147, emissive: 0x24130f, emissiveIntensity: 0.25, roughness: 1
  });
  const sphGeo = new THREE.SphereGeometry(0.5, SEG, Math.max(8, SEG - 4));
  function makeChair(material, x, z, rotation, withThrow) {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.82), material);
    seat.position.y = 0.23; chair.add(seat);
    const back = new THREE.Mesh(sphGeo, material);
    back.scale.set(0.92, 0.82, 0.33); back.position.set(0, 0.7, 0.37); chair.add(back);
    for (const ax of [-0.47, 0.47]) {
      const arm = new THREE.Mesh(sphGeo, material);
      arm.scale.set(0.2, 0.4, 0.76); arm.position.set(ax, 0.48, 0.04); chair.add(arm);
    }
    const cushion = new THREE.Mesh(sphGeo, new THREE.MeshStandardMaterial({
      color: material === fabricLeft ? 0x7d8c70 : 0x925e52,
      emissive: material === fabricLeft ? 0x182217 : 0x291511,
      emissiveIntensity: 0.2,
      roughness: 1,
    }));
    cushion.scale.set(0.77, 0.15, 0.68); cushion.position.set(0, 0.46, -0.03); chair.add(cushion);
    if (withThrow) {
      const throwBlanket = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.045, 0.64),
        new THREE.MeshStandardMaterial({ color: 0xc5a16f, roughness: 1 }));
      throwBlanket.position.set(0.42, 0.7, 0.06); throwBlanket.rotation.z = 0.32; throwBlanket.rotation.y = 0.12;
      chair.add(throwBlanket);
    }
    chair.position.set(x, 0, z); chair.rotation.y = rotation;
    scene.add(chair);
    shadow(0.68, x, z, 1.02, 0.92, 0.007);
    return chair;
  }
  // Leave a genuine sightline through the pair: the board should be readable
  // from the entry and window views, while the slight inward toe keeps both
  // seats unmistakably aimed at the hearth rather than at the camera.
  const chairLeft = makeChair(fabricLeft, -1.24, 0.82, -0.2, true);
  const chairRight = makeChair(fabricRight, 1.24, 0.82, 0.2, false);

  // Tea table, steaming mug and an actual low-draw-call chess set between the
  // chairs. This creates one lived-in story cluster instead of scattered props.
  const TABLE_X = 0.04, TABLE_Z = 0.02;
  const table = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.055, SEG * 2), darkWood);
  top.position.y = 0.52; table.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 0.5, Math.max(6, SEG / 2)), darkWood);
  leg.position.y = 0.26; table.add(leg);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.035, SEG), darkWood);
  foot.position.y = 0.015; table.add(foot);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.09, Math.max(8, SEG / 2)),
    new THREE.MeshStandardMaterial({ color: 0xa33c2f, roughness: 0.6 }));
  mug.position.set(0.39, 0.595, 0.08); table.add(mug);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 10),
    mug.material);
  handle.position.set(0.44, 0.595, 0.08); table.add(handle);

  const chessTex = makeTex(256, 256, (g, w, h) => {
    const cell = w / 8;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      g.fillStyle = (row + col) % 2 ? '#4b2d1b' : '#d0b27d';
      g.fillRect(col * cell, row * cell, cell, cell);
    }
    g.strokeStyle = '#241307'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  });
  const chessBoard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.026, 0.5),
    new THREE.MeshStandardMaterial({ map: chessTex, roughness: 0.82 }));
  chessBoard.position.y = 0.57; table.add(chessBoard);

  const pieceGeo = new THREE.CylinderGeometry(0.018, 0.033, 0.075, 7);
  const lightPieces = new THREE.InstancedMesh(pieceGeo,
    new THREE.MeshStandardMaterial({ color: 0xe1d4b9, roughness: 0.68 }), 16);
  const darkPieces = new THREE.InstancedMesh(pieceGeo,
    new THREE.MeshStandardMaterial({ color: 0x251915, roughness: 0.75 }), 16);
  const pieceMatrix = new THREE.Matrix4();
  for (let side = 0; side < 2; side++) {
    const mesh = side ? darkPieces : lightPieces;
    let index = 0;
    for (let row = 0; row < 2; row++) for (let col = 0; col < 8; col++) {
      const rank = side ? 7 - row : row;
      const heightScale = row === 0 ? (1.18 + (3.5 - Math.abs(3.5 - col)) * 0.08) : 0.86;
      pieceMatrix.compose(
        new THREE.Vector3(-0.21875 + col * 0.0625, 0.622, -0.21875 + rank * 0.0625),
        new THREE.Quaternion(), new THREE.Vector3(1, heightScale, 1),
      );
      mesh.setMatrixAt(index++, pieceMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    table.add(mesh);
  }

  table.position.set(TABLE_X, 0, TABLE_Z);
  scene.add(table);
  shadow(0.56, TABLE_X, TABLE_Z, 1, 1, 0.008);

  // steam wisps
  const STEAM_N = 7;
  const stGeo = new THREE.BufferGeometry();
  const stPos = new Float32Array(STEAM_N * 3);
  const stPh = new Float32Array(STEAM_N);
  for (let i = 0; i < STEAM_N; i++) {
    stPh[i] = rand(0, TAU);
    stPos[i * 3] = TABLE_X + 0.39; stPos[i * 3 + 1] = rand(0.66, 1.02); stPos[i * 3 + 2] = TABLE_Z + 0.08;
  }
  stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
  const steam = new THREE.Points(stGeo, new THREE.PointsMaterial({
    size: 0.07, map: dotTex, color: 0xbfc6cc, transparent: true,
    opacity: 0.3, depthWrite: false
  }));
  scene.add(steam);

  // bookshelf on the right wall
  const shelfFrame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.0, 1.4), darkWood);
  shelfFrame.position.set(2.84, 1.0, -0.6); scene.add(shelfFrame);
  const shelfBoard = new THREE.BoxGeometry(0.26, 0.035, 1.3);
  for (const sy of [0.5, 1.0, 1.5]) {
    const sb = new THREE.Mesh(shelfBoard, new THREE.MeshStandardMaterial({ color: 0x35200e, roughness: 1 }));
    sb.position.set(2.72, sy, -0.6); scene.add(sb);
  }
  shadow(0.45, 2.7, -0.6, 0.7, 1.7, 0.009);
  const bookColors = [0x7a3030, 0x3c5a3a, 0x35486b, 0x8a6a32, 0x5a3a5a, 0x6b4a2e, 0x445c5a, 0x804028];
  const BOOK_N = 42;
  const bookGeo = new THREE.BoxGeometry(0.15, 0.24, 0.045);
  const books = new THREE.InstancedMesh(bookGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.85 }), BOOK_N);
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  let bi = 0;
  for (const sy of [0.5, 1.0, 1.5]) {
    let bz = -1.2;
    for (let k = 0; k < 14 && bi < BOOK_N; k++) {
      const scl = rand(0.75, 1.12);
      dummy.position.set(2.72 + rand(-0.02, 0.02), sy + 0.018 + 0.12 * scl, bz);
      dummy.rotation.set(0, 0, rand(-0.03, 0.03));
      dummy.scale.set(1, scl, 1);
      dummy.updateMatrix();
      books.setMatrixAt(bi, dummy.matrix);
      tmpColor.setHex(bookColors[(Math.random() * bookColors.length) | 0]);
      tmpColor.multiplyScalar(rand(0.7, 1.05));
      books.setColorAt(bi, tmpColor);
      bz += 0.052 + rand(0, 0.02); bi++;
    }
  }
  books.count = bi;
  scene.add(books);

  // potted plant (sways)
  const plant = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.22, SEG),
    new THREE.MeshStandardMaterial({ color: 0x6e4426, roughness: 1 }));
  pot.position.y = 0.11; plant.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e5230, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(sphGeo, leafMat);
    const a = (i / 6) * TAU;
    leaf.scale.set(0.09, 0.34, 0.09);
    leaf.position.set(Math.cos(a) * 0.09, 0.42, Math.sin(a) * 0.09);
    leaf.rotation.z = Math.cos(a) * 0.5; leaf.rotation.x = -Math.sin(a) * 0.5;
    plant.add(leaf);
  }
  plant.position.set(-2.5, 0, 3.0);
  scene.add(plant);
  shadow(0.2, -2.5, 3.0, 1, 1, 0.01);

  // log stack by the hearth
  const stackGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.6, Math.max(7, SEG / 2));
  const stackMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 1 });
  const stackPos = [[-1.7, 0.09], [-1.5, 0.09], [-1.3, 0.09], [-1.6, 0.25], [-1.4, 0.25], [-1.5, 0.41]];
  for (const [lx, ly] of stackPos) {
    const l = new THREE.Mesh(stackGeo, stackMat);
    l.rotation.x = Math.PI / 2; l.position.set(lx, ly, -3.05);
    scene.add(l);
  }
  shadow(0.42, -1.5, -3.05, 1.2, 0.8, 0.011);

  // ---------------------------------------------------------- string lights
  const BULB_N = 28;
  const bulbGeo = new THREE.SphereGeometry(0.022, 8, 6);
  const bulbs = new THREE.InstancedMesh(bulbGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), BULB_N);
  const bulbPh = new Float32Array(BULB_N);
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vP = new THREE.Vector3();
  function strand(ax, ay, az, bx, by, bz, sag, count, startIdx, cordPts) {
    vA.set(ax, ay, az); vB.set(bx, by, bz);
    for (let k = 0; k <= 24; k++) {
      const s = k / 24;
      vP.lerpVectors(vA, vB, s);
      vP.y -= sag * Math.sin(Math.PI * s);
      cordPts.push(vP.clone());
    }
    for (let k = 0; k < count; k++) {
      const s = (k + 0.5) / count;
      vP.lerpVectors(vA, vB, s);
      vP.y -= sag * Math.sin(Math.PI * s) + 0.035;
      dummy.position.copy(vP); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bulbs.setMatrixAt(startIdx + k, dummy.matrix);
      tmpColor.setRGB(2.4, 1.5, 0.65);
      bulbs.setColorAt(startIdx + k, tmpColor);
      bulbPh[startIdx + k] = rand(0, TAU);
    }
  }
  const cordPts1 = [], cordPts2 = [];
  strand(-2.9, 3.08, -3.35, 2.9, 3.08, -3.35, 0.38, 16, 0, cordPts1);
  strand(-2.85, 3.08, -0.9, -2.85, 3.08, 2.6, 0.28, 12, 16, cordPts2);
  scene.add(bulbs);
  const cordMat = new THREE.LineBasicMaterial({ color: 0x120b06 });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cordPts1), cordMat));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cordPts2), cordMat));
  const bulbColArr = bulbs.instanceColor.array;

  // ----------------------------------------------------------------- update
  const posAttr = emberGeo.getAttribute('position');
  const colAttr = emberGeo.getAttribute('color');
  const rainAttr = rainGeo.getAttribute('position');
  const steamAttr = stGeo.getAttribute('position');

  function update(t, dt) {
    if (dt > 0.1) dt = 0.1;

    // fire flicker: layered sin noise
    const f = Math.sin(t * 8.3) * 0.34 + Math.sin(t * 13.7 + 1.7) * 0.22 + Math.sin(t * 3.1 + 0.5) * 0.44;
    fireLight.intensity = 9.5 + 2.6 * f;
    fireLight.position.x = Math.sin(t * 2.7) * 0.06;
    fireLight.position.y = 0.7 + Math.sin(t * 5.3) * 0.045;
    glowMat.opacity = 0.12 + 0.05 * Math.max(0, f);
    for (let i = 0; i < 3; i++) {
      const fp = firePlanes[i];
      fp.scale.y = 1 + 0.16 * Math.sin(t * 9.1 + i * 2.1) + 0.09 * Math.sin(t * 14.3 + i * 4.0);
      fp.scale.x = 1 + 0.07 * Math.sin(t * 11.7 + i * 2.6);
    }

    // candles are emissive-only so the room stays at two dynamic lights
    candleFlames[0].scale.y = 1 + 0.25 * Math.sin(t * 11.0);
    candleFlames[1].scale.y = 1 + 0.25 * Math.sin(t * 12.4 + 3.3);

    // embers rise, wander, fade with height
    for (let i = 0; i < EMBER_N; i++) {
      const i3 = i * 3;
      let y = ePos[i3 + 1] + eSpd[i] * dt;
      const h = (y - 0.12) / 0.9;
      if (h >= 1) { resetEmber(i); y = ePos[i3 + 1]; }
      else {
        ePos[i3 + 1] = y;
        ePos[i3] = eBX[i] + 0.05 * Math.sin(t * 2.2 + ePh[i]);
        ePos[i3 + 2] = eBZ[i] + 0.03 * Math.sin(t * 1.7 + ePh[i] * 2.0);
      }
      const b = Math.max(0, 1 - (ePos[i3 + 1] - 0.12) / 0.9);
      eCol[i3] = 2.4 * b;
      eCol[i3 + 1] = 1.15 * b * b;
      eCol[i3 + 2] = 0.28 * b * b * b;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // rain outside + slower wet-glass drift in the near plane
    for (let i = 0; i < RAIN_N; i++) {
      const p = i * 6;
      let y = rainPos[p + 1] - rainSpeed[i] * dt;
      if (y < 0.05) y += 3.5;
      const x = rainBaseX[i] + Math.sin(t * 0.7 + rainPhase[i]) * 0.025;
      rainPos[p] = x; rainPos[p + 1] = y; rainPos[p + 2] = rainBaseZ[i];
      rainPos[p + 3] = x + 0.025; rainPos[p + 4] = y - 0.16; rainPos[p + 5] = rainBaseZ[i] + 0.01;
    }
    rainAttr.needsUpdate = true;
    rainGlassTex.offset.y = -(t * 0.012) % 1;

    // mug steam
    for (let i = 0; i < STEAM_N; i++) {
      const i3 = i * 3;
      let y = stPos[i3 + 1] + 0.12 * dt;
      if (y > 1.08) y = 0.64;
      stPos[i3 + 1] = y;
      stPos[i3] = TABLE_X + 0.39 + 0.03 * Math.sin(t * 1.3 + stPh[i] + y * 5.0);
      stPos[i3 + 2] = TABLE_Z + 0.08 + 0.03 * Math.cos(t * 1.1 + stPh[i]);
    }
    steamAttr.needsUpdate = true;

    // string light twinkle (out of phase)
    for (let i = 0; i < BULB_N; i++) {
      const k = 2.1 + 1.1 * Math.sin(t * 1.6 + bulbPh[i]) * Math.sin(t * 0.7 + bulbPh[i] * 1.7);
      bulbColArr[i * 3] = k;
      bulbColArr[i * 3 + 1] = k * 0.62;
      bulbColArr[i * 3 + 2] = k * 0.27;
    }
    bulbs.instanceColor.needsUpdate = true;

    // plant sway
    plant.rotation.z = 0.035 * Math.sin(t * 0.7);
    plant.rotation.x = 0.02 * Math.sin(t * 0.53 + 1.2);
  }

  // ------------------------------------------------------------------ seats
  const seats = [
    {
      desktop: { pos: [0.0, 1.84, 4.9], look: [0, 0.86, -2.65], fov: 54 },
      phoneLandscape: { pos: [0.0, 1.74, 5.15], look: [0, 0.88, -2.7], fov: 55 },
      portrait: { pos: [0.05, 1.88, 5.8], look: [0, 0.9, -2.55], fov: 60 },
    },
    {
      // Requested left-side composition: droplets and frame close at left;
      // the two fire-facing chairs, chess table and hearth recede to the right.
      desktop: { pos: [-1.72, 1.86, 2.55], look: [0.08, 0.95, -2.35], fov: 63 },
      phoneLandscape: { pos: [-1.68, 1.82, 2.72], look: [0.04, 0.96, -2.34], fov: 66 },
      portrait: { pos: [-1.58, 1.9, 3.0], look: [0.02, 0.98, -2.18], fov: 78 },
    },
    {
      desktop: { pos: [2.48, 1.42, 3.35], look: [-0.28, 0.9, -2.78], fov: 55 },
      phoneLandscape: { pos: [2.56, 1.38, 3.7], look: [-0.24, 0.92, -2.78], fov: 56 },
      portrait: { pos: [2.42, 1.48, 4.32], look: [-0.2, 0.94, -2.62], fov: 61 },
    },
  ];

  function dispose() { /* no timers or listeners; engine disposes GPU resources */ }

  return {
    seats,
    update,
    dispose,
    exposure: 1.02,
    bloom: { strength: 0.34, radius: 0.34, threshold: 0.9 }
  };
}
