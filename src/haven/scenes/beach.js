// beach.js — TWILIGHT BEACH
// Flat-vector sunset vibe: huge glowing sun over calm water, stilt hut and palm
// silhouettes, foam rolling up warm sand, a lantern-lit picnic mat in the foreground.
import * as THREE from 'three';

export function build(ctx) {
  const scene = ctx.scene;
  const mobile = !!(ctx.quality && ctx.quality.mobile);

  const root = new THREE.Group();
  scene.add(root);

  // ---------------------------------------------------------------- helpers
  function makeTexture(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    return t;
  }

  // deterministic rand
  let _s = 1337;
  function rnd() { _s = (_s * 16807) % 2147483647; return _s / 2147483647; }

  // -------------------------------------------------------------- sky dome
  scene.background = new THREE.Color(0x241a52);
  scene.fog = new THREE.Fog(0x83415f, 45, 210);

  const skyTex = makeTexture(16, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0.00, '#241a52'); // zenith indigo
    gr.addColorStop(0.24, '#5a2a72'); // violet
    gr.addColorStop(0.37, '#b34573'); // magenta
    gr.addColorStop(0.45, '#e8695a'); // hot coral
    gr.addColorStop(0.50, '#ffb060'); // amber at horizon (sphere equator)
    gr.addColorStop(0.56, '#c97a54');
    gr.addColorStop(1.00, '#2a1840'); // below-horizon dusk
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, mobile ? 24 : 48, mobile ? 12 : 24),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  root.add(sky);

  // ----------------------------------------------------------------- stars
  // two alternating Points groups in the upper half of the dome for twinkle
  const starCount = mobile ? 240 : 500;
  const starMats = [];
  for (let gI = 0; gI < 2; gI++) {
    const n = Math.floor(starCount / 2);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = rnd() * Math.PI * 2;
      const y = 140 * (0.18 + 0.78 * rnd()); // upper half only
      const rr = Math.sqrt(140 * 140 - y * y);
      pos[i * 3] = Math.cos(th) * rr;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(th) * rr;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: gI ? 0xd8d8f2 : 0xf2ecda,
      size: gI ? 1.7 : 2.3,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false
    });
    starMats.push(mat);
    root.add(new THREE.Points(geo, mat));
  }

  // ---------------------------------------------------------------- clouds
  const cloudTex = makeTexture(256, 64, (g) => {
    for (let i = 0; i < 26; i++) {
      const bx = 14 + (228 * i) / 25;
      const by = 30 + Math.sin(i * 1.3) * 7 + (rnd() - 0.5) * 6;
      const r = 12 + rnd() * 16;
      const grad = g.createRadialGradient(bx, by, 0, bx, by, r);
      grad.addColorStop(0, 'rgba(255,190,150,0.55)');
      grad.addColorStop(1, 'rgba(255,190,150,0)');
      g.fillStyle = grad;
      g.fillRect(bx - r, by - r, r * 2, r * 2);
    }
  });
  const clouds = [];
  const cloudDefs = [
    { x: -34, y: 7.5, w: 62, h: 5.5, sp: 0.013 },
    { x: 12, y: 11.5, w: 46, h: 4.5, sp: 0.019 },
    { x: 32, y: 15.0, w: 68, h: 6.5, sp: 0.010 }
  ];
  for (let i = 0; i < cloudDefs.length; i++) {
    const d = cloudDefs[i];
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(d.w, d.h),
      new THREE.MeshBasicMaterial({
        map: cloudTex, transparent: true, opacity: 0.55,
        depthWrite: false, fog: false
      })
    );
    m.position.set(d.x, d.y, -128);
    root.add(m);
    clouds.push({ mesh: m, x0: d.x, sp: d.sp, ph: i * 2.1 });
  }

  // ------------------------------------------------------------------- sun
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xfff0c0, emissiveIntensity: 4, fog: false
  });
  const sun = new THREE.Mesh(new THREE.CircleGeometry(7, mobile ? 24 : 40), sunMat);
  sun.position.set(-6, 4.2, -121);
  root.add(sun);

  const glowTex = makeTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0.0, 'rgba(255,224,168,0.95)');
    gr.addColorStop(0.35, 'rgba(255,150,95,0.40)');
    gr.addColorStop(1.0, 'rgba(255,120,80,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: 0.85, fog: false
  });
  const glow = new THREE.Sprite(glowMat);
  glow.position.set(-6, 4.8, -120.5);
  glow.scale.set(52, 38, 1);
  root.add(glow);

  // ----------------------------------------------------------------- ocean
  const oSegX = mobile ? 48 : 96;
  const oSegY = mobile ? 24 : 48;
  const oceanGeo = new THREE.PlaneGeometry(300, 160, oSegX, oSegY);
  // Unlit sunset-mirror sea via VERTEX COLORS keyed to distance (metal/rough
  // water reads black without an env map; UV orientation is flip-ambiguous —
  // vertex y IS the distance, so the warm band always lands at the horizon).
  {
    const cNear = new THREE.Color(0x3a3468);
    const cMidA = new THREE.Color(0x554a92);
    const cMidB = new THREE.Color(0x9a5f96);
    const cWarm = new THREE.Color(0xd97a7e);
    const cHorz = new THREE.Color(0xff9e66);
    const pos = oceanGeo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + 80) / 160; // 0 = shore edge, 1 = horizon edge
      // Perspective squeezes far water into a few screen pixels, so the warm
      // sunset band must start CLOSE in world space to read wide on screen.
      if (t < 0.05) tmp.lerpColors(cNear, cMidA, t / 0.05);
      else if (t < 0.15) tmp.lerpColors(cMidA, cMidB, (t - 0.05) / 0.1);
      else if (t < 0.35) tmp.lerpColors(cMidB, cWarm, (t - 0.15) / 0.2);
      else tmp.lerpColors(cWarm, cHorz, (t - 0.35) / 0.65);
      cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
    }
    oceanGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  // subtle ripple streaks multiply over the vertex gradient
  const oceanTex = makeTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y = rnd() * h;
      g.fillStyle = rnd() > 0.45 ? `rgba(255,235,210,${0.05 + rnd() * 0.08})` : `rgba(30,26,60,${0.05 + rnd() * 0.09})`;
      const sw = 30 + rnd() * 150;
      g.fillRect(rnd() * (w - sw), y, sw, 1 + rnd() * 1.6);
    }
  });
  oceanTex.wrapS = oceanTex.wrapT = THREE.RepeatWrapping;
  oceanTex.repeat.set(3, 4);
  const ocean = new THREE.Mesh(
    oceanGeo,
    new THREE.MeshBasicMaterial({ map: oceanTex, vertexColors: true, fog: false })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.06, -82); // covers z in [-162, -2]
  root.add(ocean);
  const oceanPos = oceanGeo.attributes.position;
  const oceanBase = new Float32Array(oceanPos.array); // preallocated copy
  const oceanVerts = oceanPos.count;

  // sun path: elongated golden reflection strip on the water
  const pathTex = makeTexture(64, 256, (g, w, h) => {
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)');
    gx.addColorStop(0.5, 'rgba(255,255,255,1)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gx;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const gy = g.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0.0, 'rgba(255,255,255,1)');   // sun end
    gy.addColorStop(0.8, 'rgba(255,255,255,0.45)');
    gy.addColorStop(1.0, 'rgba(255,255,255,0)');   // shore end
    g.fillStyle = gy;
    g.fillRect(0, 0, w, h);
  });
  const sunPathMat = new THREE.MeshBasicMaterial({
    map: pathTex, color: 0xffc27a, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  const sunPath = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 120), sunPathMat);
  sunPath.rotation.x = -Math.PI / 2;
  sunPath.position.set(-6, 0.16, -62); // z from -2 to -122, under the sun
  root.add(sunPath);

  // ------------------------------------------------------------------ sand
  const sandTex = makeTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#c9a06b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      const a = 0.04 + rnd() * 0.09;
      g.fillStyle = rnd() > 0.5
        ? 'rgba(90,60,40,' + a.toFixed(3) + ')'
        : 'rgba(255,235,200,' + a.toFixed(3) + ')';
      g.fillRect(rnd() * w, rnd() * h, 1.6, 1.6);
    }
  }, [7, 3]);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 30, 1, 1),
    new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.06, 12); // covers z in [-3, 27]
  root.add(sand);

  // ------------------------------------------------------------- foam bands
  function foamCanvas(g, w, h) {
    for (let i = 0; i < 46; i++) {
      const bx = 8 + (240 * i) / 45;
      const by = h / 2 + Math.sin(i * 0.9) * 9 + (rnd() - 0.5) * 8;
      const r = 6 + rnd() * 10;
      const grad = g.createRadialGradient(bx, by, 0, bx, by, r);
      grad.addColorStop(0, 'rgba(255,250,240,0.85)');
      grad.addColorStop(1, 'rgba(255,250,240,0)');
      g.fillStyle = grad;
      g.fillRect(bx - r, by - r, r * 2, r * 2);
    }
  }
  const foamTexA = makeTexture(256, 64, foamCanvas);
  const foamTexB = makeTexture(256, 64, foamCanvas);
  const foamDefs = [
    { w: 32, d: 2.2, z: -1.9, sp: 0.31, ph: 0.0, tex: foamTexA },
    { w: 26, d: 1.7, z: -1.0, sp: 0.26, ph: 2.4, tex: foamTexB },
    { w: 36, d: 2.6, z: -0.2, sp: 0.22, ph: 4.4, tex: foamTexA }
  ];
  const foamBands = [];
  for (let i = 0; i < foamDefs.length; i++) {
    const d = foamDefs[i];
    const mat = new THREE.MeshBasicMaterial({
      map: d.tex, transparent: true, opacity: 0.5, depthWrite: false
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((i - 1) * 3, 0.075 + i * 0.004, d.z);
    root.add(m);
    foamBands.push({ mesh: m, mat: mat, z0: d.z, sp: d.sp, ph: d.ph });
  }

  // ------------------------------------------------------------ shadow discs
  const discGeo = new THREE.CircleGeometry(1, 20);
  function shadowDisc(r, x, z, opacity, y) {
    const m = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
      color: 0x140b22, transparent: true, opacity: opacity, depthWrite: false
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y === undefined ? 0.068 : y, z);
    m.scale.set(r, r, 1);
    root.add(m);
    return m;
  }

  // ------------------------------------------------------------------ palms
  const leafTex = makeTexture(128, 64, (g) => {
    g.fillStyle = '#1c1430';
    g.beginPath();
    g.moveTo(2, 32);
    g.quadraticCurveTo(58, 4, 126, 24);
    for (let i = 0; i < 9; i++) {
      const px = 126 - i * 13.5;
      g.lineTo(px - 6, 42 + (i % 2) * 9);
      g.lineTo(px - 12, 33);
    }
    g.closePath();
    g.fill();
  });
  const leafMat = new THREE.MeshBasicMaterial({
    map: leafTex, transparent: true, alphaTest: 0.35,
    side: THREE.DoubleSide, color: 0xffffff
  });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x241736, roughness: 1 });
  const frondGeo = new THREE.PlaneGeometry(2.4, 0.8);
  frondGeo.translate(1.2, 0, 0); // pivot at frond base

  const fronds = [];   // { mesh, droop, ph }
  const crowns = [];   // { grp, ph }
  const palmGroups = [];

  function buildPalm(x, z, height, lean, ry) {
    const palm = new THREE.Group();
    const segs = 6;
    const segLen = height / segs;
    let px = 0, py = 0, ang = 0;
    for (let i = 0; i < segs; i++) {
      ang += lean * (0.55 + i * 0.2);
      const r0 = 0.15 - i * 0.013;
      const r1 = 0.15 - (i + 1) * 0.013;
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(r1, r0, segLen * 1.08, mobile ? 5 : 7, 1),
        trunkMat
      );
      const dx = Math.sin(ang) * segLen;
      const dy = Math.cos(ang) * segLen;
      cyl.position.set(px + dx / 2, py + dy / 2, 0);
      cyl.rotation.z = -ang;
      palm.add(cyl);
      px += dx; py += dy;
    }
    const crown = new THREE.Group();
    crown.position.set(px, py, 0);
    const nF = 7;
    for (let i = 0; i < nF; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / nF) * Math.PI * 2 + rnd() * 0.5;
      const mesh = new THREE.Mesh(frondGeo, leafMat);
      const droop = -(0.3 + rnd() * 0.45);
      mesh.rotation.z = droop;
      mesh.scale.setScalar(0.85 + rnd() * 0.35);
      pivot.add(mesh);
      crown.add(pivot);
      fronds.push({ mesh: mesh, droop: droop, ph: rnd() * Math.PI * 2 });
    }
    palm.add(crown);
    palm.position.set(x, 0.06, z);
    palm.rotation.y = ry;
    root.add(palm);
    crowns.push({ grp: crown, ph: rnd() * Math.PI * 2 });
    palmGroups.push({ grp: palm, ph: rnd() * Math.PI * 2 });
    shadowDisc(0.9, x + 0.3, z, 0.28);
  }
  buildPalm(-7.0, 1.6, 4.6, 0.09, 0.3);
  buildPalm(-9.6, 0.2, 5.6, -0.075, 2.4);
  buildPalm(-11.6, 2.4, 4.0, 0.11, 4.2);

  // -------------------------------------------------------------- stilt hut
  const hutMat = new THREE.MeshStandardMaterial({ color: 0x221733, roughness: 0.95 });
  const hut = new THREE.Group();
  hut.position.set(-20, 0, -6.5);
  // legs (standing in the shallows)
  const legGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.3, 6);
  const legOff = [[-1.2, -0.85], [1.2, -0.85], [-1.2, 0.85], [1.2, 0.85]];
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(legGeo, hutMat);
    leg.position.set(legOff[i][0], 0.5, legOff[i][1]);
    hut.add(leg);
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 2.3), hutMat);
  platform.position.y = 1.15;
  hut.add(platform);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.35, 1.8), hutMat);
  cabin.position.y = 1.9;
  hut.add(cabin);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.0, 4), hutMat);
  roof.position.y = 3.05;
  roof.rotation.y = Math.PI / 4;
  hut.add(roof);
  // warm windows on the camera-facing (+x) wall
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff9a50, emissiveIntensity: 3
  });
  const winGeo = new THREE.PlaneGeometry(0.32, 0.38);
  for (let i = 0; i < 2; i++) {
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.set(1.21, 1.95, i === 0 ? -0.45 : 0.45);
    win.rotation.y = Math.PI / 2;
    hut.add(win);
  }
  // porch lantern
  const porchLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb36b, emissiveIntensity: 3.2 })
  );
  porchLamp.position.set(1.5, 1.55, 0.95);
  hut.add(porchLamp);
  root.add(hut);
  // faint window-light shimmer on the water in front of the hut
  const hutGleamMat = new THREE.MeshBasicMaterial({
    color: 0xff9a50, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const hutGleam = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 2.8), hutGleamMat);
  hutGleam.rotation.x = -Math.PI / 2;
  hutGleam.position.set(-18.4, 0.12, -4.4);
  root.add(hutGleam);

  // ------------------------------------------------------------------ rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x261a30, roughness: 0.95 });
  const rockDefs = [[-3.6, -2.2, 0.45], [-1.2, -2.5, 0.3], [2.6, -2.0, 0.55], [6.2, -2.4, 0.35], [8.4, -1.9, 0.5]];
  for (let i = 0; i < rockDefs.length; i++) {
    const d = rockDefs[i];
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(d[2], 0), rockMat);
    rock.position.set(d[0], 0.06 + d[2] * 0.25, d[1]);
    rock.scale.set(1, 0.55, 0.8);
    rock.rotation.y = rnd() * Math.PI;
    root.add(rock);
    shadowDisc(d[2] * 1.3, d[0], d[1], 0.25);
  }

  // ----------------------------------------------------------- picnic corner
  const matTex = makeTexture(128, 128, (g, w, h) => {
    const cols = ['#b3543f', '#e0c9a0', '#5e6e8f', '#e0c9a0'];
    const bh = h / 8;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = cols[i % 4];
      g.fillRect(0, i * bh, w, bh);
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(40,25,20,' + (0.03 + rnd() * 0.06).toFixed(3) + ')';
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
  });
  const picnicMat = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.35),
    new THREE.MeshStandardMaterial({ map: matTex, roughness: 1 })
  );
  picnicMat.rotation.x = -Math.PI / 2;
  picnicMat.rotation.z = 0.18;
  picnicMat.position.set(0.9, 0.075, 4.4);
  root.add(picnicMat);
  shadowDisc(1.25, 0.9, 4.4, 0.16, 0.066);

  // book
  const book = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.035, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x7a3b34, roughness: 0.8 })
  );
  book.position.set(1.35, 0.1, 4.7);
  book.rotation.y = 0.45;
  root.add(book);
  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.012, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.9 })
  );
  pages.position.set(1.35, 0.124, 4.7);
  pages.rotation.y = 0.45;
  root.add(pages);

  // lantern
  const lantern = new THREE.Group();
  lantern.position.set(-0.05, 0.06, 3.7);
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2030, roughness: 0.6, metalness: 0.4 });
  const lBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.05, 10), metalMat);
  lBase.position.y = 0.025;
  lantern.add(lBase);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1a0d05, emissive: 0xffc07a, emissiveIntensity: 2.8
  });
  const lGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.18, 10), glassMat);
  lGlass.position.y = 0.16;
  lantern.add(lGlass);
  const lTop = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.08, 10), metalMat);
  lTop.position.y = 0.3;
  lantern.add(lTop);
  root.add(lantern);
  shadowDisc(0.28, -0.05, 3.7, 0.32, 0.067);

  // ----------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0x4a3a7a, 0x7a5a3e, 0.4);
  root.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xff9a5e, 0.7);
  sunLight.position.set(-6, 12, -110);
  root.add(sunLight);
  root.add(sunLight.target);
  const lanternLight = new THREE.PointLight(0xffb36b, 1.6, 9, 2);
  lanternLight.position.set(-0.05, 0.55, 3.7);
  root.add(lanternLight);
  const hutLight = new THREE.PointLight(0xff9a50, 1.1, 11, 2);
  hutLight.position.set(-18.4, 2.0, -5.6);
  root.add(hutLight);

  // ----------------------------------------------------------------- update
  let frame = 0;
  function update(t, dt) {
    // ocean swells: 3 overlapping slow sine fields (local x/y, displace local z)
    const arr = oceanPos.array;
    for (let i = 0; i < oceanVerts; i++) {
      const ix = i * 3;
      const x = oceanBase[ix];
      const y = oceanBase[ix + 1];
      arr[ix + 2] =
        0.05 * Math.sin(x * 0.08 + t * 0.55) +
        0.04 * Math.sin(y * 0.13 - t * 0.38) +
        0.03 * Math.sin((x + y) * 0.055 + t * 0.24);
    }
    oceanPos.needsUpdate = true;
    if ((frame & 1) === 0) oceanGeo.computeVertexNormals();
    frame++;

    // sun path shimmer
    sunPathMat.opacity = 0.42 + 0.1 * Math.sin(t * 1.4) + 0.06 * Math.sin(t * 2.63 + 1.7);
    sunPath.scale.x = 1 + 0.06 * Math.sin(t * 0.77);
    glowMat.opacity = 0.8 + 0.06 * Math.sin(t * 0.9);

    // star twinkle (alternating groups)
    starMats[0].opacity = 0.72 + 0.2 * Math.sin(t * 0.6);
    starMats[1].opacity = 0.72 + 0.2 * Math.sin(t * 0.83 + 2.1);

    // clouds drift extremely slowly
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      c.mesh.position.x = c.x0 + Math.sin(t * c.sp + c.ph) * 8;
    }

    // foam rolls up the sand and back, breathing opacity
    for (let i = 0; i < foamBands.length; i++) {
      const f = foamBands[i];
      const s = Math.sin(t * f.sp * 2 + f.ph);
      f.mesh.position.z = f.z0 + s * 0.42;
      f.mat.opacity = 0.18 + 0.42 * Math.max(0, Math.sin(t * f.sp * 2 + f.ph + 0.7));
    }

    // palms sway softly, fronds with independent phases
    for (let i = 0; i < palmGroups.length; i++) {
      const p = palmGroups[i];
      p.grp.rotation.z = Math.sin(t * 0.3 + p.ph) * 0.012;
    }
    for (let i = 0; i < crowns.length; i++) {
      const c = crowns[i];
      c.grp.rotation.z = Math.sin(t * 0.45 + c.ph) * 0.045;
      c.grp.rotation.x = Math.sin(t * 0.37 + c.ph * 1.3) * 0.03;
    }
    for (let i = 0; i < fronds.length; i++) {
      const f = fronds[i];
      f.mesh.rotation.z = f.droop + Math.sin(t * 0.9 + f.ph) * 0.06;
    }

    // lantern flame flicker
    const n = Math.sin(t * 7.3) * 0.5 + Math.sin(t * 11.7 + 1.3) * 0.3 + Math.sin(t * 3.1 + 0.7) * 0.2;
    lanternLight.intensity = 1.5 + 0.3 * n;
    glassMat.emissiveIntensity = 2.7 + 0.5 * n;

    // hut windows breathe warmly
    const wn = (Math.sin(t * 5.3) + Math.sin(t * 8.7 + 1.2)) * 0.5;
    winMat.emissiveIntensity = 3 + 0.35 * wn;
    hutLight.intensity = 1.05 + 0.15 * wn;
    hutGleamMat.opacity = 0.18 + 0.07 * Math.max(0, wn);
  }

  function dispose() {
    // no timers or listeners; engine disposes geometries/materials/textures
  }

  return {
    seats: [
      // 1) seated on the picnic mat, horizon centered, sun just left of center,
      //    foam bands rolling through the lower frame
      { pos: [0.9, 1.3, 4.8], look: [-2.5, 2.4, -120] },
      // 2) standing at the waterline, looking along the shore past the palms
      //    to the stilt hut, the golden sun path crossing the frame
      { pos: [5.5, 1.2, -1.0], look: [-14, 1.5, -13] },
      // 3) reclined on the sand — pitched up so the star-field violet sky
      //    dominates and the amber horizon sits low in frame
      { pos: [2.2, 1.12, 5.4], look: [1.2, 26, -38] }
    ],
    update: update,
    dispose: dispose,
    bloom: { strength: 0.95, radius: 0.55, threshold: 0.76 }
  };
}
