// city.js — HIGH-RISE BEDROOM AT NIGHT
// Warm lamp-lit bedroom facing a floor-to-ceiling glass wall over a vast night city.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function build(ctx) {
  const { scene, quality } = ctx;
  const mobile = !!(quality && quality.mobile);
  const SEG = mobile ? 8 : 16;

  const root = new THREE.Group();
  scene.add(root);

  const assetLoader = new GLTFLoader();
  const loadAsset = (id) => new Promise((resolve) => {
    assetLoader.load(`${import.meta.env.BASE_URL || './'}haven-assets/${id}/${id}.gltf`,
      gltf => resolve(gltf.scene), undefined, () => resolve(null));
  });
  const fitAsset = (object, targetWidth, position, rotationY = 0) => {
    if (!object) return null;
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const scale = targetWidth / Math.max(0.001, size.x);
    object.scale.setScalar(scale);
    object.rotation.y = rotationY;
    box.setFromObject(object);
    object.position.set(position[0], position[1] - box.min.y, position[2]);
    object.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = !mobile;
      child.receiveShadow = !mobile;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        material.envMapIntensity = 0.72;
        material.roughness = Math.max(0.38, material.roughness ?? 0.7);
      }
    });
    root.add(object);
    return object;
  };

  // ---------------------------------------------------------------- helpers
  function makeTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- sky + fog
  scene.fog = new THREE.FogExp2(0x151b36, 0.0065);

  const skyTex = makeTex(4, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0.0, '#101b49');   // rich blue-hour zenith
    gr.addColorStop(0.34, '#27346c');
    gr.addColorStop(0.50, '#5a3f86');
    gr.addColorStop(0.60, '#b95482');  // pink-violet band at the skyline
    gr.addColorStop(0.68, '#e77b75');
    gr.addColorStop(1.0, '#0a0c18');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, mobile ? 16 : 24, mobile ? 12 : 18),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  root.add(sky);
  scene.background = new THREE.Color(0x05070f);

  // One continuous loft, composed as three lived-in zones instead of a prop
  // showroom: sofa at left, window desk in the middle, bed at right.
  const W = 12, H = 3.2, D = 8;
  // Keep the large furniture outside the central sightline. Both pieces used
  // to sit close enough to the camera that their backs became opaque blocks
  // in the desk view, especially on portrait screens.
  const BED_X = 3.62;
  const SOFA_X = -3.62;

  // ---------------------------------------------------------------- lights
  root.add(new THREE.HemisphereLight(0x91a7d8, 0x5b3a43, 1.42));
  // A broad, low-cost fill gives every material a readable base value. The
  // two point lights can then provide warmth without blowing out their lamps.
  root.add(new THREE.AmbientLight(0x9b7180, 1.02));

  // Keep only two dynamic lights on phone: one broad lived-in room pool and
  // one bedside pool. Earlier both lights sat at the bed, leaving the desk
  // and sofa as black silhouettes against the glass.
  const lampLightL = new THREE.PointLight(0xffb87a, 4.05, 8, 2);
  // This pool belongs to the task lamp/desk zone. Bringing it forward from
  // the bed reveals the walnut, plant and rug while leaving the BasicMaterial
  // skyline untouched.
  lampLightL.position.set(-0.55, 1.7, -1.35);
  const lampLightR = new THREE.PointLight(0xffaa68, 4.65, 7, 2);
  lampLightR.position.set(BED_X + 0.75, 1.05, 1.75);
  lampLightL.castShadow = !mobile;
  lampLightR.castShadow = !mobile;
  if (!mobile) {
    for (const light of [lampLightL, lampLightR]) {
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.00035;
      light.shadow.normalBias = 0.035;
    }
  }
  root.add(lampLightL, lampLightR);

  // ---------------------------------------------------------------- room shell
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x5e4655,
    emissive: 0x1e1018,
    emissiveIntensity: 0.2,
    roughness: 0.9,
  });

  const floorTex = makeTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3b281f'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      g.fillStyle = row % 2 ? '#432d23' : '#37241d';
      g.fillRect(0, y, w, 32);
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      const seam = ((row * 97) % 256);
      g.beginPath(); g.moveTo(seam, y); g.lineTo(seam, y + 32); g.stroke();
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = 'rgba(60,40,25,0.25)'; g.lineWidth = 1;
        const gy = y + 4 + Math.random() * 24;
        g.beginPath(); g.moveTo(0, gy); g.bezierCurveTo(w * 0.3, gy + 3, w * 0.7, gy - 3, w, gy); g.stroke();
      }
    }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(5, 3.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
    new THREE.MeshLambertMaterial({
      map: floorTex,
      color: 0xe0c2ad,
      emissive: 0x160b07,
      emissiveIntensity: 0.2,
    }));
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({
    color: 0x6c505c, emissive: 0x24131a, emissiveIntensity: 0.3, roughness: 0.96
  }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = H;
  root.add(ceiling);

  const wallL = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
  wallL.rotation.y = Math.PI / 2; wallL.position.set(-W / 2, H / 2, 0);
  const wallR = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
  wallR.rotation.y = -Math.PI / 2; wallR.position.set(W / 2, H / 2, 0);
  const wallF = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
  wallF.rotation.y = Math.PI; wallF.position.set(0, H / 2, D / 2);
  root.add(wallL, wallR, wallF);

  // ceiling cove — warm emissive perimeter strips
  const coveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffad68).multiplyScalar(0.82) });
  const coveGeoX = new THREE.BoxGeometry(W - 0.5, 0.03, 0.06);
  const coveGeoZ = new THREE.BoxGeometry(0.06, 0.03, D - 0.5);
  const cove1 = new THREE.Mesh(coveGeoX, coveMat); cove1.position.set(0, H - 0.07, D / 2 - 0.22);
  const cove2 = new THREE.Mesh(coveGeoX, coveMat); cove2.position.set(0, H - 0.07, -D / 2 + 0.22);
  const cove3 = new THREE.Mesh(coveGeoZ, coveMat); cove3.position.set(-W / 2 + 0.22, H - 0.07, 0);
  const cove4 = new THREE.Mesh(coveGeoZ, coveMat); cove4.position.set(W / 2 - 0.22, H - 0.07, 0);
  root.add(cove1, cove2, cove3, cove4);
  const ceilingFill = new THREE.PointLight(0xffc39b, mobile ? 1.1 : 2.1, 13, 1.7);
  ceilingFill.position.set(0, H - 0.25, 0.2);
  root.add(ceilingFill);

  // rug
  const rugTex = makeTex(192, 192, (g, w, h) => {
    g.fillStyle = '#8c5f72'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(239,188,147,0.48)'; g.lineWidth = 5;
    for (let y = -w; y < h + w; y += 32) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + w); g.stroke();
    }
    g.strokeStyle = 'rgba(52,45,77,0.38)'; g.lineWidth = 2;
    for (let y = -w; y < h + w; y += 32) {
      g.beginPath(); g.moveTo(0, y + 14); g.lineTo(w, y + w + 14); g.stroke();
    }
  });
  const rugMat = new THREE.MeshLambertMaterial({
    map: rugTex, color: 0xc4a1aa, emissive: 0x160b13, emissiveIntensity: 0.22
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.9, SEG * 2), rugMat);
  rug.rotation.x = -Math.PI / 2; rug.scale.set(1.45, 1, 1); rug.position.set(SOFA_X + 0.55, 0.012, -0.35);
  root.add(rug);
  const deskRug = new THREE.Mesh(new THREE.PlaneGeometry(3.65, 1.35), rugMat);
  deskRug.rotation.x = -Math.PI / 2; deskRug.position.set(0, 0.013, -1.92);
  root.add(deskRug);

  // soft shadow discs
  const shadowTex = makeTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.34)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  function shadowDisc(x, z, sx, sz) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); m.scale.set(sx, sz, 1);
    root.add(m);
  }
  shadowDisc(BED_X, 1.15, 3.0, 3.0);
  shadowDisc(BED_X - 1.35, 1.9, 1.1, 1.1);
  shadowDisc(BED_X + 1.35, 1.9, 1.1, 1.1);
  shadowDisc(SOFA_X, 0.7, 3.4, 1.8);
  shadowDisc(0, -2.65, 3.4, 1.1);

  // ---------------------------------------------------------------- bed
  const bed = new THREE.Group(); bed.position.set(BED_X, 0, 1.15); root.add(bed);

  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.3, 2.35),
    new THREE.MeshLambertMaterial({ color: 0x514052, emissive: 0x120b13, emissiveIntensity: 0.24 }));
  platform.position.y = 0.15; bed.add(platform);

  const headboard = new THREE.Mesh(new THREE.BoxGeometry(2.35, 1.0, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x665166, emissive: 0x170d17, emissiveIntensity: 0.25 }));
  headboard.position.set(0, 0.65, 1.18); bed.add(headboard);

  const duvetTex = makeTex(256, 256, (g, w, h) => {
    g.fillStyle = '#cfc7e0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) { // low-contrast creases
      g.strokeStyle = `rgba(90,80,120,${rand(0.05, 0.12)})`;
      g.lineWidth = rand(1.5, 4);
      g.beginPath();
      const x0 = rand(0, w), y0 = rand(0, h);
      g.moveTo(x0, y0);
      g.bezierCurveTo(x0 + rand(-70, 70), y0 + rand(-40, 40), x0 + rand(-70, 70), y0 + rand(-40, 40), x0 + rand(-110, 110), y0 + rand(-70, 70));
      g.stroke();
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(255,255,255,${rand(0.03, 0.08)})`;
      g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(15, 45), rand(8, 22), rand(0, 3), 0, 6.3); g.fill();
    }
  });
  const duvet = new THREE.Mesh(new THREE.SphereGeometry(1, SEG * 2, SEG),
    new THREE.MeshStandardMaterial({ map: duvetTex, color: 0xffffff, roughness: 1 }));
  duvet.scale.set(1.12, 0.22, 1.02);
  duvet.position.set(0, 0.36, -0.1);
  bed.add(duvet);

  const pillowMat = new THREE.MeshStandardMaterial({
    color: 0xf2e7ec, emissive: 0x180f16, emissiveIntensity: 0.16, roughness: 1
  });
  const pillowGeo = new THREE.SphereGeometry(1, SEG, SEG);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(pillowGeo, pillowMat);
    p.scale.set(0.34, 0.12, 0.22);
    p.position.set(-0.72 + (i % 2) * 1.44 + (i > 1 ? 0.12 : 0), 0.42 + (i > 1 ? 0.13 : 0), 0.82 - (i > 1 ? 0.1 : 0));
    p.rotation.x = i > 1 ? -0.35 : -0.15;
    bed.add(p);
  }

  const throwB = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.55),
    new THREE.MeshLambertMaterial({ color: 0xb56c62, emissive: 0x210d0c, emissiveIntensity: 0.18 }));
  throwB.position.set(0, 0.51, -0.72); throwB.rotation.x = 0.04;
  bed.add(throwB);

  // ---------------------------------------------------------------- nightstands + lamps
  const standMat = new THREE.MeshLambertMaterial({
    color: 0x6f493c, emissive: 0x160a08, emissiveIntensity: 0.2
  });
  const shadeMatL = new THREE.MeshStandardMaterial({
    color: 0xffd0a0, emissive: 0xff8b49, emissiveIntensity: 0.72,
    roughness: 0.68, side: THREE.DoubleSide,
  });
  const shadeMatR = shadeMatL.clone();
  function nightstand(x, shadeMat) {
    const g = new THREE.Group(); g.position.set(x, 0, 1.9);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.45), standMat);
    box.position.y = 0.25; g.add(box);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.35, 8),
      new THREE.MeshLambertMaterial({ color: 0x6a5558 }));
    stem.position.y = 0.68; g.add(stem);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.2, SEG, 1, true), shadeMat);
    shade.position.y = 0.93; g.add(shade);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.1, SEG), shadeMat);
    cap.rotation.x = -Math.PI / 2; cap.position.y = 1.03; g.add(cap);
    root.add(g);
  }
  nightstand(BED_X - 1.35, shadeMatL);
  nightstand(BED_X + 1.35, shadeMatR);

  // wall art on front wall above headboard
  const art = new THREE.Group(); art.position.set(BED_X, 1.95, D / 2 - 0.04); art.rotation.y = Math.PI;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.65, 0.03),
    new THREE.MeshLambertMaterial({ color: 0x765243, emissive: 0x150907, emissiveIntensity: 0.16 }));
  const artTex = makeTex(96, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#3a2f55'); gr.addColorStop(0.55, '#6b4a6e'); gr.addColorStop(1, '#c98a5e');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,210,150,0.5)'; g.beginPath(); g.arc(w * 0.7, h * 0.35, 7, 0, 6.3); g.fill();
  });
  const canvasArt = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.55),
    new THREE.MeshLambertMaterial({ map: artTex }));
  canvasArt.position.z = 0.02;
  art.add(frame, canvasArt); root.add(art);

  // plant silhouette, corner
  const plant = new THREE.Group(); plant.position.set(-5.2, 0, 2.8);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.3, SEG),
    new THREE.MeshLambertMaterial({ color: 0x9b5f4b, emissive: 0x160806, emissiveIntensity: 0.18 }));
  pot.position.y = 0.15; plant.add(pot);
  const leafMat = new THREE.MeshLambertMaterial({
    color: 0x4d745d, emissive: 0x0b1a10, emissiveIntensity: 0.28
  });
  const leaves = new THREE.Group(); leaves.position.y = 0.3;
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, rand(0.7, 1.2), 6), leafMat);
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.1, 0.45, Math.sin(a) * 0.1);
    leaf.rotation.z = Math.cos(a) * 0.45; leaf.rotation.x = -Math.sin(a) * 0.45;
    leaves.add(leaf);
  }
  plant.add(leaves); root.add(plant);

  // ---------------------------------------------------------------- window desk
  const desk = new THREE.Group(); desk.position.set(0, 0, -2.65);
  const walnut = new THREE.MeshStandardMaterial({
    color: 0xa96f4d, emissive: 0x29150d, emissiveIntensity: 0.18, roughness: 0.82
  });
  const blackMetal = new THREE.MeshStandardMaterial({
    color: 0x373642, emissive: 0x090913, emissiveIntensity: 0.18, roughness: 0.58, metalness: 0.38
  });
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.72), walnut);
  deskTop.position.y = 0.77; desk.add(deskTop);
  for (const x of [-1.42, 1.42]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), blackMetal);
    leg.position.set(x, 0.375, 0); desk.add(leg);
  }
  const laptopBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.035, 0.46), blackMetal);
  laptopBase.position.set(0.35, 0.84, -0.02); desk.add(laptopBase);
  const laptopScreenMat = new THREE.MeshBasicMaterial({ color: 0x264864 });
  const laptopScreen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.44, 0.025), laptopScreenMat);
  laptopScreen.position.set(0.35, 1.05, -0.24); laptopScreen.rotation.x = -0.18; desk.add(laptopScreen);
  const screenGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.35),
    new THREE.MeshBasicMaterial({ color: 0x80b7cc, transparent: true, opacity: 0.42 }));
  screenGlow.position.set(0.35, 1.055, -0.253); screenGlow.rotation.x = -0.18; desk.add(screenGlow);
  const taskLampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.62, 8), blackMetal);
  taskLampStem.position.set(-1.08, 1.06, -0.02); taskLampStem.rotation.z = -0.16; desk.add(taskLampStem);
  const taskLampShade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.24, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x5a4540, emissive: 0xffa45d, emissiveIntensity: 0.48,
      roughness: 0.72, side: THREE.DoubleSide,
    }));
  taskLampShade.position.set(-1.14, 1.37, -0.02); taskLampShade.rotation.z = Math.PI; desk.add(taskLampShade);
  for (let i = 0; i < 3; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.34 + i * 0.02, 0.045, 0.22),
      new THREE.MeshStandardMaterial({ color: [0x875746, 0x435a68, 0xb08a58][i], roughness: 0.9 }));
    book.position.set(-0.54, 0.84 + i * 0.047, 0.08); book.rotation.y = -0.08 + i * 0.04; desk.add(book);
  }
  const deskPot = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.15, 10),
    new THREE.MeshStandardMaterial({ color: 0x9b765f, roughness: 0.95 }));
  deskPot.position.set(1.12, 0.88, 0.02); desk.add(deskPot);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.3 + i * 0.025, 6), leafMat);
    leaf.position.set(1.12 + Math.cos(i * 1.25) * 0.06, 1.08, 0.02 + Math.sin(i * 1.25) * 0.05);
    leaf.rotation.z = Math.cos(i * 1.25) * 0.38; desk.add(leaf);
  }
  root.add(desk);

  // ---------------------------------------------------------------- sofa + coffee table
  const sofa = new THREE.Group(); sofa.position.set(SOFA_X, 0, 0.58);
  const sofaMat = new THREE.MeshStandardMaterial({
    color: 0x78849b, emissive: 0x171c2a, emissiveIntensity: 0.18, roughness: 1
  });
  const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.38, 1.0), sofaMat);
  sofaBase.position.y = 0.3; sofa.add(sofaBase);
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.92, 0.26), sofaMat);
  sofaBack.position.set(0, 0.76, 0.44); sofa.add(sofaBack);
  for (const x of [-1.42, 1.42]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 1.02), sofaMat);
    arm.position.set(x, 0.52, 0); sofa.add(arm);
  }
  const cushionGeo = new THREE.SphereGeometry(0.5, SEG, Math.max(8, SEG - 2));
  for (let i = 0; i < 3; i++) {
    const cushion = new THREE.Mesh(cushionGeo, new THREE.MeshStandardMaterial({
      color: [0xa96f5c, 0x6d7790, 0xc19a64][i],
      emissive: [0x1d0c08, 0x101422, 0x231407][i], emissiveIntensity: 0.14,
      roughness: 1,
    }));
    cushion.scale.set(0.86, 0.22, 0.72); cushion.position.set(-0.92 + i * 0.92, 0.58, -0.14); sofa.add(cushion);
  }
  // A single draped throw gives the sofa a lived-in silhouette without adding
  // a costly cloth simulation or a stack of decorative meshes.
  const sofaThrow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.055, 1.04),
    new THREE.MeshStandardMaterial({
      color: 0xbd765f, emissive: 0x210d08, emissiveIntensity: 0.16, roughness: 1
    }));
  sofaThrow.position.set(-0.72, 0.62, -0.03); sofaThrow.rotation.z = -0.06;
  sofa.add(sofaThrow);
  root.add(sofa);

  const coffee = new THREE.Group(); coffee.position.set(SOFA_X + 0.68, 0, -1.02);
  const coffeeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.07, SEG * 2), walnut);
  coffeeTop.position.y = 0.42; coffee.add(coffeeTop);
  const coffeeLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.1, 0.4, 10), blackMetal);
  coffeeLeg.position.y = 0.2; coffee.add(coffeeLeg);
  const openBook = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.025, 0.32),
    new THREE.MeshStandardMaterial({
      color: 0xeadcc4, emissive: 0x160f08, emissiveIntensity: 0.12, roughness: 0.92
    }));
  openBook.position.set(-0.14, 0.48, 0.02); openBook.rotation.y = 0.24; coffee.add(openBook);
  const coffeeMug = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.11, 10),
    new THREE.MeshStandardMaterial({ color: 0xb17656, roughness: 0.72 }));
  coffeeMug.position.set(0.35, 0.51, -0.05); coffee.add(coffeeMug);
  root.add(coffee);

  // Reference-led living zone: real-scale textured furniture overlaps in a
  // conversational arrangement, rather than reading as isolated primitives.
  const [realSofa, loungeChair, marbleTable, realPlant] = await Promise.all([
    loadAsset('sofa_02'), loadAsset('mid_century_lounge_chair'),
    loadAsset('coffee_table_round_01'), loadAsset('potted_plant_02')
  ]);
  sofa.visible = false;
  coffee.visible = false;
  fitAsset(realSofa, 3.15, [-3.18, 0, 0.72], 0.08);
  fitAsset(loungeChair, 1.18, [0.62, 0, 0.18], -0.62);
  fitAsset(marbleTable, 1.42, [-1.05, 0, -0.48], 0.12);
  fitAsset(realPlant, 1.05, [4.78, 0, -2.72], -0.35);

  const livingPool = new THREE.PointLight(0xffa96a, mobile ? 1.25 : 3.2, 7.5, 2);
  livingPool.position.set(-1.25, 1.6, 0.15);
  livingPool.castShadow = !mobile;
  if (!mobile) {
    livingPool.shadow.mapSize.set(1024, 1024);
    livingPool.shadow.bias = -0.0003;
  }
  root.add(livingPool);

  // ---------------------------------------------------------------- glass wall + mullions
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color: 0xd8e4ff, transparent: true, opacity: 0.035, depthWrite: false }));
  glass.position.set(0, H / 2, -D / 2 + 0.02);
  glass.renderOrder = 10;
  root.add(glass);

  const mullionMat = new THREE.MeshLambertMaterial({
    color: 0x252130, emissive: 0x090713, emissiveIntensity: 0.16
  });
  const mullionGeo = new THREE.BoxGeometry(0.06, H, 0.09);
  [-4.5, -3, -1.5, 0, 1.5, 3, 4.5].forEach(x => {
    const m = new THREE.Mesh(mullionGeo, mullionMat);
    m.position.set(x, H / 2, -D / 2 + 0.02); root.add(m);
  });
  const sillGeo = new THREE.BoxGeometry(W, 0.08, 0.14);
  const sillB = new THREE.Mesh(sillGeo, mullionMat); sillB.position.set(0, 0.04, -D / 2 + 0.02);
  const sillT = new THREE.Mesh(sillGeo, mullionMat); sillT.position.set(0, H - 0.04, -D / 2 + 0.02);
  root.add(sillB, sillT);

  // faint warm lamp reflections in the glass
  const streakTex = makeTex(32, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,180,110,0)');
    gr.addColorStop(0.5, 'rgba(255,190,120,1)');
    gr.addColorStop(1, 'rgba(255,180,110,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const streakMat = new THREE.MeshBasicMaterial({
    map: streakTex, transparent: true, opacity: 0.05,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  [BED_X - 1.35, BED_X + 1.35].forEach(x => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.4), streakMat);
    s.position.set(x, 1.4, -D / 2 + 0.04); s.renderOrder = 11;
    root.add(s);
  });

  // ---------------------------------------------------------------- CITY: near towers + instanced windows
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x141a28 });
  const nearTowers = [];
  // Kept LOW and pushed back so a wide band of deep-blue sky + moon reads above
  // the skyline (like the references) instead of towers filling the glass.
  const nearDefs = [
    [-24, -24, 6, 6, 4], [-14, -30, 5, 5, 8], [-6, -36, 7, 6, 0],
    [3, -26, 4.5, 5, 5.5], [10, -33, 6, 6, 9.5], [20, -23, 5, 5, 2],
    [30, -32, 7, 6, 6.5], [-34, -34, 6, 6, 3], [42, -27, 5, 5, -1], [-45, -28, 6, 6, 7]
  ];
  for (const [x, z, w, d, top] of nearDefs) {
    const h = top + 60;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), towerMat);
    m.position.set(x, top - h / 2, z);
    root.add(m);
    nearTowers.push({ x, z, w, d, top });
  }

  const MAXW = mobile ? 1200 : 2400;
  const winGeo = new THREE.PlaneGeometry(0.55, 0.7);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const windows = new THREE.InstancedMesh(winGeo, winMat, MAXW);
  const C_DARK = new THREE.Color(0x0d1120);
  const C_AMBER = new THREE.Color(0xffd98a).multiplyScalar(1.35);
  const C_TEAL = new THREE.Color(0x9fd0e0).multiplyScalar(0.8);
  const winStates = new Uint8Array(MAXW); // 0 dark, 1 amber, 2 teal
  {
    const mtx = new THREE.Matrix4();
    let n = 0;
    outer:
    for (const t of nearTowers) {
      const zf = t.z + t.d / 2 + 0.03;
      const cols = Math.floor(t.w / 0.9);
      const yLo = Math.max(-30, t.top - 30);
      for (let y = yLo; y < t.top - 0.8; y += 1.15) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() < 0.25) continue;
          if (n >= MAXW) break outer;
          const x = t.x - t.w / 2 + 0.55 + c * 0.9;
          mtx.makeTranslation(x, y, zf);
          windows.setMatrixAt(n, mtx);
          const r = Math.random();
          const st = r < 0.6 ? 0 : (r < 0.9 ? 1 : 2);
          winStates[n] = st;
          windows.setColorAt(n, st === 0 ? C_DARK : st === 1 ? C_AMBER : C_TEAL);
          n++;
        }
      }
    }
    windows.count = n;
  }
  windows.instanceMatrix.needsUpdate = true;
  if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
  root.add(windows);

  // ---------------------------------------------------------------- MID towers (canvas window grids)
  function midTowerTex(warmth) {
    return makeTex(128, 256, (g, w, h) => {
      g.fillStyle = '#0a0e1a'; g.fillRect(0, 0, w, h);
      for (let y = 6; y < h - 6; y += 12) {
        for (let x = 6; x < w - 6; x += 11) {
          if (Math.random() < 0.58) continue;
          const cool = Math.random() > warmth;
          const a = rand(0.2, 0.65);
          g.fillStyle = cool ? `rgba(140,190,210,${a * 0.7})` : `rgba(255,200,130,${a})`;
          g.fillRect(x, y, 6, 8);
        }
      }
    });
  }
  const midTexA = midTowerTex(0.8), midTexB = midTowerTex(0.65);
  const midMatA = new THREE.MeshBasicMaterial({ map: midTexA });
  const midMatB = new THREE.MeshBasicMaterial({ map: midTexB });
  const midDefs = [
    [-70, -48, 9, 11], [-52, -62, 11, 17], [-30, -55, 8, 6], [-12, -68, 10, 14],
    [4, -52, 8, 4], [22, -64, 12, 13], [40, -50, 9, 8], [60, -70, 11, 16],
    [78, -58, 9, 5], [-90, -66, 10, 12], [96, -66, 10, 11], [-8, -78, 9, 20]
  ];
  midDefs.forEach(([x, z, w, top], i) => {
    const h = top + 60;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), i % 2 ? midMatA : midMatB);
    m.position.set(x, top - h / 2, z);
    root.add(m);
  });

  // ---------------------------------------------------------------- FAR skyline silhouette + landmark spire
  const skylineTex = makeTex(1024, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let x = 0;
    while (x < w) {
      const bw = rand(18, 60), bh = rand(22, 88);
      g.fillStyle = '#0b0e1a';
      g.fillRect(x, h - bh, bw, bh);
      for (let i = 0; i < bw * bh / 260; i++) {
        g.fillStyle = Math.random() < 0.8 ? 'rgba(255,217,138,0.85)' : 'rgba(159,208,224,0.7)';
        g.fillRect(x + rand(2, bw - 3), h - bh + rand(3, bh - 4), 1.4, 1.4);
      }
      x += bw + rand(0, 8);
    }
  });
  const skyline = new THREE.Mesh(new THREE.PlaneGeometry(420, 55),
    new THREE.MeshBasicMaterial({ map: skylineTex, transparent: true, depthWrite: false }));
  skyline.position.set(0, -22, -135);
  root.add(skyline);

  // Empire-style spire, slightly off-center
  const spire = new THREE.Group(); spire.position.set(14, 0, -118);
  const spireMat = new THREE.MeshBasicMaterial({ map: midTexA, color: 0x8a90a8 });
  const tier1 = new THREE.Mesh(new THREE.BoxGeometry(8, 55, 8), spireMat); tier1.position.y = -60 + 27.5;
  const tier2 = new THREE.Mesh(new THREE.BoxGeometry(5.2, 16, 5.2), spireMat); tier2.position.y = -5 + 8;
  const tier3 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 10, 3.2), spireMat); tier3.position.y = 11 + 5;
  const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(3.5) });
  const crown = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3, 2.1), tipMat); crown.position.y = 21 + 1.5;
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.4, 8, 8), tipMat); needle.position.y = 24 + 4;
  spire.add(tier1, tier2, tier3, crown, needle);
  root.add(spire);

  // red aircraft beacons on two tall near towers
  const beaconGeo = new THREE.SphereGeometry(0.28, 8, 8);
  const beaconMatA = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const beaconMatB = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const beaconA = new THREE.Mesh(beaconGeo, beaconMatA); beaconA.position.set(10, 10.1, -33);
  const beaconB = new THREE.Mesh(beaconGeo, beaconMatB); beaconB.position.set(-14, 8.6, -30);
  root.add(beaconA, beaconB);
  const RED = new THREE.Color(0xff2a2a);

  // ---------------------------------------------------------------- moon + stars
  const moonTex = makeTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#fff3d8';
    g.beginPath(); g.arc(64, 64, 40, 0, 6.3); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(46, 56, 38, 0, 6.3); g.fill();
    g.globalCompositeOperation = 'source-over';
  });
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonTex, color: new THREE.Color(1, 0.95, 0.82).multiplyScalar(2.5),
    fog: false, depthWrite: false, transparent: true
  }));
  moon.position.set(38, 64, -220); moon.scale.set(19, 19, 1);
  root.add(moon);

  const starTex = makeTex(32, 32, (g) => {
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(220,230,255,0.5)');
    gr.addColorStop(1, 'rgba(200,210,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  });
  const N_STARS = mobile ? 175 : 350;
  const starMats = [];
  for (let grp = 0; grp < 2; grp++) {
    const n = Math.floor(N_STARS / 2);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const az = rand(-1.5, 1.5) - Math.PI / 2; // mostly ahead
      const el = rand(0.12, 1.25);
      const r = rand(280, 360);
      pos[i * 3] = Math.cos(el) * Math.cos(az) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: starTex, color: 0xdde6ff, size: grp ? 2.6 : 1.7, sizeAttenuation: false,
      transparent: true, opacity: 0.8, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending
    });
    starMats.push(mat);
    root.add(new THREE.Points(geo, mat));
  }

  // ---------------------------------------------------------------- drizzle outside the glass
  const N_RAIN = mobile ? 125 : 250;
  const rainTex = makeTex(8, 32, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 32);
    gr.addColorStop(0, 'rgba(200,215,235,0)');
    gr.addColorStop(0.5, 'rgba(200,215,235,0.9)');
    gr.addColorStop(1, 'rgba(200,215,235,0)');
    g.fillStyle = gr; g.fillRect(2.5, 0, 3, 32);
  });
  const rainPos = new Float32Array(N_RAIN * 3);
  const rainSpeed = new Float32Array(N_RAIN);
  for (let i = 0; i < N_RAIN; i++) {
    rainPos[i * 3] = rand(-8, 8);
    rainPos[i * 3 + 1] = rand(-7, 9);
    rainPos[i * 3 + 2] = rand(-10, -3.6);
    rainSpeed[i] = rand(2.2, 4.2);
  }
  const rainGeo = new THREE.BufferGeometry();
  const rainAttr = new THREE.BufferAttribute(rainPos, 3);
  rainGeo.setAttribute('position', rainAttr);
  const rainMat = new THREE.PointsMaterial({
    map: rainTex, color: 0x9fb0c8, size: 0.4, sizeAttenuation: true,
    transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  root.add(rain);

  // ---------------------------------------------------------------- update (no per-frame allocations)
  let nextSwap = 0;
  const swapCount = () => 2 + (Math.random() < 0.5 ? 1 : 0);

  function update(t, dt) {
    const step = Math.min(dt, 0.1);

    // lamp flicker — subtle warm breathing
    const n1 = Math.sin(t * 13.7) * 0.5 + Math.sin(t * 7.3 + 1.7) * 0.35 + Math.sin(t * 2.1) * 0.15;
    lampLightL.intensity = 4.05 * (1 + 0.035 * n1);
    lampLightR.intensity = 4.65 * (1 + 0.035 * Math.sin(t * 11.3 + 2.4));
    shadeMatL.emissiveIntensity = 0.72 * (1 + 0.045 * n1);
    shadeMatR.emissiveIntensity = 0.72 * (1 + 0.045 * Math.sin(t * 11.3 + 2.4));

    // near-tower window twinkle: every 0.5-1s swap 2-3 instances lit<->unlit
    if (t > nextSwap) {
      nextSwap = t + 0.5 + Math.random() * 0.5;
      const k = swapCount();
      for (let s = 0; s < k; s++) {
        for (let tries = 0; tries < 12; tries++) {
          const i = (Math.random() * windows.count) | 0;
          if (winStates[i] === 2) continue; // leave teal alone
          winStates[i] = winStates[i] === 0 ? 1 : 0;
          windows.setColorAt(i, winStates[i] === 0 ? C_DARK : C_AMBER);
          break;
        }
      }
      windows.instanceColor.needsUpdate = true;
    }

    // aircraft beacons — slow 2s blink
    const bA = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 3);
    const bB = Math.pow(Math.max(0, Math.sin(t * Math.PI + 2.2)), 3);
    beaconMatA.color.copy(RED).multiplyScalar(0.15 + 3.2 * bA);
    beaconMatB.color.copy(RED).multiplyScalar(0.15 + 3.2 * bB);

    // stars twinkle (two layers, phased opacity)
    starMats[0].opacity = 0.65 + 0.2 * Math.sin(t * 1.3);
    starMats[1].opacity = 0.7 + 0.22 * Math.sin(t * 0.9 + 2.1);

    // drizzle drifting down
    for (let i = 0; i < N_RAIN; i++) {
      let y = rainPos[i * 3 + 1] - rainSpeed[i] * step;
      if (y < -8) y += 17;
      rainPos[i * 3 + 1] = y;
    }
    rainAttr.needsUpdate = true;

    // plant sways gently
    leaves.rotation.z = Math.sin(t * 0.6) * 0.025;
    leaves.rotation.x = Math.cos(t * 0.45) * 0.018;
  }

  function dispose() { /* no timers or listeners */ }

  // ---------------------------------------------------------------- seats
  const seats = [
    {
      // Window desk: a clean centre aisle frames the laptop and skyline while
      // the bed and sofa remain small, readable edge vignettes.
      desktop: { pos: [0, 1.52, 2.32], look: [0, 0.92, -5.1], fov: 58 },
      phoneLandscape: { pos: [0, 1.5, 2.72], look: [0, 0.91, -5.2], fov: 60 },
      portrait: { pos: [0, 1.56, 3.2], look: [0, 0.9, -5.05], fov: 64 },
    },
    {
      // Bed-at-the-glass: viewed diagonally from its open side so the duvet is
      // a cosy lower-right foreground detail, never a wall across the image.
      desktop: { pos: [-0.9, 2.0, 4.55], look: [3.35, 0.66, 0.0], fov: 54 },
      phoneLandscape: { pos: [-0.55, 1.92, 4.8], look: [3.3, 0.7, 0.0], fov: 57 },
      portrait: { pos: [-0.15, 2.08, 5.55], look: [3.15, 0.72, 0.05], fov: 62 },
    },
    {
      // Sofa viewpoint: the camera now sits at the cushion rather than behind
      // the opaque backrest. The book, mug and blue-hour city lead the frame.
      desktop: { pos: [-3.62, 1.03, 0.08], look: [-1.35, 1.15, -6.6], fov: 55 },
      phoneLandscape: { pos: [-3.5, 1.08, 0.3], look: [-1.3, 1.14, -6.7], fov: 57 },
      portrait: { pos: [-3.34, 1.15, 0.62], look: [-1.18, 1.12, -6.3], fov: 62 },
    },
  ];

  return {
    seats,
    update,
    dispose,
    exposure: 1.08,
    bloom: { strength: 0.15, radius: 0.24, threshold: 1.0 }
  };
}
