// beach.js — TWILIGHT BEACH
// A warm, readable shoreline rather than a silhouette study: layered water,
// wet + dry sand, rolling foam, living palms and a lantern-lit timber hut.
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
    color: 0x000000, emissive: 0xffe8b8, emissiveIntensity: 3.15, fog: false
  });
  const sun = new THREE.Mesh(new THREE.CircleGeometry(5.8, mobile ? 24 : 40), sunMat);
  sun.position.set(-7, 5.1, -121);
  root.add(sun);

  const glowTex = makeTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0.0, 'rgba(255,224,168,0.95)');
    gr.addColorStop(0.35, 'rgba(255,150,95,0.40)');
    gr.addColorStop(1.0, 'rgba(255,120,80,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  // Layered circles avoid the rectangular alpha fringe some Windows GPUs
  // produced around the old canvas sprite.
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffa66f, transparent: true, opacity: 0.12,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  const halo = new THREE.Mesh(new THREE.CircleGeometry(10.5, mobile ? 24 : 48), haloMat);
  halo.position.set(-7, 5.1, -121.2);
  root.add(halo);

  // ----------------------------------------------------------------- ocean
  const oSegX = mobile ? 40 : 72;
  const oSegY = mobile ? 22 : 42;
  const oceanGeo = new THREE.PlaneGeometry(300, 160, oSegX, oSegY);
  // A small analytic water shader gives the sea actual surface shape,
  // view-dependent Fresnel colour and moon/sunset highlights without loading
  // a large PBR set or recomputing normals on the CPU every frame.
  const waterUniforms = { uTime: { value: 0 } };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      float waveHeight(vec2 p) {
        // Four low-amplitude wave trains crossing at different angles. The
        // unequal wavelengths avoid the regular corrugated-sheet silhouette
        // that a single sine creates, while remaining cheap on mobile GPUs.
        return sin(dot(p, vec2(0.072, 0.042)) + uTime * 0.48) * 0.090
          + sin(dot(p, vec2(-0.038, 0.108)) - uTime * 0.37) * 0.052
          + sin(dot(p, vec2(0.158, -0.046)) + uTime * 0.66) * 0.026
          + sin(dot(p, vec2(-0.095, -0.064)) + uTime * 0.29) * 0.038;
      }
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += waveHeight(p.xy);
        float e = 0.18;
        float dx = (waveHeight(p.xy + vec2(e, 0.0)) - waveHeight(p.xy - vec2(e, 0.0))) / (2.0 * e);
        float dy = (waveHeight(p.xy + vec2(0.0, e)) - waveHeight(p.xy - vec2(0.0, e))) / (2.0 * e);
        vec3 localNormal = normalize(vec3(-dx, -dy, 1.0));
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPosition = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.6);
        float depth = smoothstep(0.0, 0.55, vUv.y);
        float farWater = smoothstep(0.48, 1.0, vUv.y);
        float detail = valueNoise(vWorldPosition.xz * 0.22 + vec2(uTime * 0.025, -uTime * 0.035));
        float fine = valueNoise(vWorldPosition.xz * 0.83 + vec2(-uTime * 0.08, uTime * 0.055));

        // Muted lagoon teal at the waterline, becoming ocean-blue and then
        // picking up the violet dusk sky toward the horizon.
        vec3 shallow = vec3(0.055, 0.275, 0.275);
        vec3 oceanBlue = vec3(0.020, 0.115, 0.205);
        vec3 duskMirror = vec3(0.205, 0.145, 0.285);
        vec3 colour = mix(shallow, oceanBlue, depth);
        colour = mix(colour, duskMirror, farWater * (0.48 + fresnel * 0.25));
        colour = mix(colour, vec3(0.15, 0.32, 0.39), fresnel * 0.56);
        colour += (detail - 0.5) * 0.036 + (fine - 0.5) * 0.018;

        // The low sun makes a softly broken reflection, not a solid ribbon.
        vec3 lightDir = normalize(vec3(-0.10, 0.16, -0.98));
        float specular = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 54.0);
        float sunLane = exp(-pow((vWorldPosition.x + 7.0) / (2.2 + vUv.y * 7.5), 2.0));
        float glintMask = smoothstep(0.53, 0.88, detail * 0.62 + fine * 0.38);
        colour += vec3(1.0, 0.58, 0.30) * specular * sunLane * (0.45 + glintMask) * 1.35;

        // Only the steepest tiny faces catch cool light, creating irregular
        // facets instead of long repeated cyan stripes.
        float facet = smoothstep(0.58, 0.88, fine + normal.y * 0.16) * (0.35 + detail * 0.65);
        colour += vec3(0.10, 0.25, 0.27) * facet * 0.12;
        float shoreSheen = (1.0 - smoothstep(0.0, 0.13, vUv.y)) * (0.06 + detail * 0.055);
        colour += vec3(0.36, 0.57, 0.52) * shoreSheen;
        gl_FragColor = vec4(colour, 1.0);
      }
    `,
    fog: false,
    toneMapped: true,
  });
  const ocean = new THREE.Mesh(
    oceanGeo,
    waterMat,
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.06, -82); // covers z in [-162, -2]
  root.add(ocean);

  // Small horizontal glints suggest the sunset path without placing an
  // obvious translucent rectangle over the water.
  const pathTex = makeTexture(128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 170; i++) {
      const y = rnd() * h;
      const horizonWeight = 0.22 + 0.78 * (1 - y / h);
      const centre = w * (0.5 + (rnd() - 0.5) * 0.22);
      const half = (2 + rnd() * 20) * horizonWeight;
      const gx = g.createLinearGradient(centre - half, 0, centre + half, 0);
      gx.addColorStop(0, 'rgba(255,224,171,0)');
      gx.addColorStop(0.5, `rgba(255,224,171,${(0.12 + rnd() * 0.42).toFixed(3)})`);
      gx.addColorStop(1, 'rgba(255,224,171,0)');
      g.fillStyle = gx;
      g.fillRect(centre - half, y, half * 2, 0.45 + rnd() * 1.25);
    }
  });
  const sunPathMat = new THREE.MeshBasicMaterial({
    map: pathTex, color: 0xffbf78, transparent: true, opacity: 0.62,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });
  const sunPath = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 118), sunPathMat);
  sunPath.rotation.x = -Math.PI / 2;
  sunPath.position.set(-7, 0.16, -62); // z from -2 to -122, under the sun
  root.add(sunPath);

  // ------------------------------------------------------------------ sand
  const sandTex = makeTexture(256, 256, (g, w, h) => {
    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, '#d8bb87');
    base.addColorStop(0.48, '#e4ca98');
    base.addColorStop(1, '#caa874');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // broad soft mineral variation, then fine grains; the result reads as
    // sand at camera distance without needing a large downloaded texture.
    for (let i = 0; i < 75; i++) {
      const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 28;
      const haze = g.createRadialGradient(x, y, 0, x, y, r);
      haze.addColorStop(0, rnd() > 0.5 ? 'rgba(255,239,198,0.13)' : 'rgba(128,91,53,0.08)');
      haze.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = haze; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 1900; i++) {
      const a = 0.025 + rnd() * 0.075;
      g.fillStyle = rnd() > 0.5
        ? 'rgba(92,68,43,' + a.toFixed(3) + ')'
        : 'rgba(255,245,215,' + a.toFixed(3) + ')';
      const s = rnd() > 0.88 ? 1.5 : 0.75;
      g.fillRect(rnd() * w, rnd() * h, s, s);
    }
    g.strokeStyle = 'rgba(119,84,49,0.10)';
    g.lineWidth = 1.2;
    for (let y = 18; y < h; y += 35) {
      g.beginPath();
      for (let x = -4; x <= w + 4; x += 5) {
        const py = y + Math.sin(x * 0.045 + y) * 2.2 + Math.sin(x * 0.12) * 0.8;
        if (x < 0) g.moveTo(x, py); else g.lineTo(x, py);
      }
      g.stroke();
    }
  }, [8, 3.2]);
  const sandBump = makeTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#777'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const shade = 112 + Math.round(Math.sin(y * 0.18 + Math.sin(y * 0.045) * 2.5) * 19);
      g.strokeStyle = `rgb(${shade},${shade},${shade})`;
      g.beginPath();
      for (let x = -4; x <= w + 4; x += 4) {
        const py = y + Math.sin(x * 0.055 + y * 0.022) * 2.2;
        if (x < 0) g.moveTo(x, py); else g.lineTo(x, py);
      }
      g.stroke();
    }
    for (let i = 0; i < 900; i++) {
      const v = 90 + Math.floor(rnd() * 75);
      g.fillStyle = `rgba(${v},${v},${v},0.42)`;
      g.fillRect(rnd() * w, rnd() * h, 1, 1);
    }
  }, [8, 3.2]);
  function shoreZ(x) {
    return -2.82 + Math.sin(x * 0.23 + 0.6) * 0.30 + Math.sin(x * 0.071 + 2.1) * 0.22;
  }
  const sandGeo = new THREE.PlaneGeometry(90, 30, mobile ? 28 : 56, mobile ? 10 : 20);
  const sandPos = sandGeo.attributes.position;
  for (let i = 0; i < sandPos.count; i++) {
    const x = sandPos.getX(i), y = sandPos.getY(i);
    const dune = Math.sin(x * 0.12 + y * 0.16) * 0.035 + Math.sin(x * 0.035 - y * 0.22) * 0.025;
    const worldZ = 12 - y;
    const shoreBlend = Math.max(0, Math.min(1, (1.2 - worldZ) / 4.2));
    const edgeOffset = (shoreZ(x) + 3) * shoreBlend;
    sandPos.setY(i, y - edgeOffset);
    sandPos.setZ(i, dune);
  }
  sandPos.needsUpdate = true;
  sandGeo.computeVertexNormals();
  const sand = new THREE.Mesh(
    sandGeo,
    new THREE.MeshStandardMaterial({
      map: sandTex,
      bumpMap: sandBump,
      bumpScale: 0.032,
      color: 0xffefd0,
      emissive: 0x2b1b0e,
      emissiveIntensity: 0.08,
      roughness: 0.96,
      metalness: 0,
    })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.06, 12); // covers z in [-3, 27]
  root.add(sand);

  // A darker, glossier strip makes the waterline legible and keeps the dry
  // sand from looking like one flat grey plane at sunset.
  function shoreRibbonGeometry(width, depth, segments) {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = (t - 0.5) * width;
      const front = shoreZ(x) + 0.04;
      const back = front + depth + Math.sin(x * 0.12) * 0.16;
      pos.push(x, 0, front, x, 0, back);
      uv.push(t, 0, t, 1);
      if (i < segments) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return geometry;
  }
  const wetSand = new THREE.Mesh(
    shoreRibbonGeometry(90, 4.6, mobile ? 32 : 64),
    new THREE.MeshStandardMaterial({
      map: sandTex,
      color: 0xb9956d,
      emissive: 0x231916,
      emissiveIntensity: 0.09,
      roughness: 0.4,
      metalness: 0.02,
      transparent: true,
      opacity: 0.9,
    })
  );
  wetSand.position.y = 0.071;
  root.add(wetSand);

  // ------------------------------------------------------------- shore foam
  // One transparent procedural sheet replaces three straight white ribbons.
  // The lace mask follows the same curved shoreline as the sand geometry and
  // breaks into pockets and bubbles, so it never reads as a painted stripe.
  const foamUniforms = { uTime: { value: 0 } };
  const foamMat = new THREE.ShaderMaterial({
    uniforms: foamUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vWorldPosition;
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }
      float noise21(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float x = vWorldPosition.x;
        float z = vWorldPosition.z;
        float baseShore = -2.82 + sin(x * 0.23 + 0.6) * 0.30 + sin(x * 0.071 + 2.1) * 0.22;
        float tide = 0.20 * sin(uTime * 0.36);
        float laceWarp = sin(x * 0.52 + uTime * 0.18) * 0.10 + sin(x * 0.14 - uTime * 0.11) * 0.16;
        float edge = baseShore + 0.64 + tide + laceWarp;
        float d0 = abs(z - edge);
        float n0 = noise21(vec2(x * 0.38 + uTime * 0.025, z * 1.25));
        float mainLace = (1.0 - smoothstep(0.025, 0.18, d0)) * smoothstep(0.16, 0.54, n0 + 0.18);

        float trailEdge = edge + 0.48 + sin(x * 0.31 - uTime * 0.14) * 0.15;
        float d1 = abs(z - trailEdge);
        float n1 = noise21(vec2(x * 0.72 - 9.0, z * 1.9 + uTime * 0.04));
        float trailing = (1.0 - smoothstep(0.018, 0.12, d1)) * smoothstep(0.46, 0.78, n1);

        float pocketZone = 1.0 - smoothstep(0.1, 0.9, abs(z - edge));
        float cells = hash21(floor(vec2(x * 2.25, z * 5.4)));
        float bubbles = smoothstep(0.87, 0.99, cells) * pocketZone * smoothstep(0.34, 0.7, n0);
        float alpha = clamp(mainLace * 0.82 + trailing * 0.52 + bubbles * 0.34, 0.0, 0.86);
        if (alpha < 0.018) discard;
        vec3 foamColour = mix(vec3(0.74, 0.91, 0.88), vec3(0.98, 0.95, 0.84), n0 * 0.55);
        gl_FragColor = vec4(foamColour, alpha);
      }
    `,
    toneMapped: false,
  });
  const foamSheet = new THREE.Mesh(new THREE.PlaneGeometry(92, 7), foamMat);
  foamSheet.rotation.x = -Math.PI / 2;
  foamSheet.position.set(0, 0.095, -0.1);
  root.add(foamSheet);

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
  const leafTex = makeTexture(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const leafGradient = g.createLinearGradient(0, 28, w, 100);
    leafGradient.addColorStop(0, '#8dbb69');
    leafGradient.addColorStop(0.42, '#3f7c4c');
    leafGradient.addColorStop(1, '#163f31');
    g.fillStyle = leafGradient;

    // Overlapping tapered leaflets build one broad, airy palm frond. They
    // retain natural gaps at the tips without the old comb/fern silhouette.
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 1; i <= 16; i++) {
        const t = i / 17;
        const x = 4 + t * 246;
        const spineY = 67 - Math.sin(t * Math.PI) * 15 + t * 11;
        const fullness = Math.pow(Math.sin(t * Math.PI), 0.6);
        const len = (14 + fullness * 34) * (1 - t * 0.12);
        const sweep = side < 0 ? -7 - t * 12 : 5 + t * 15;
        const tipX = x + sweep;
        const tipY = spineY + side * len;
        const baseHalf = 2.4 + fullness * 2.8;
        g.beginPath();
        g.moveTo(x - baseHalf, spineY + side * 1.2);
        g.quadraticCurveTo(x + sweep * 0.28, spineY + side * len * 0.47, tipX, tipY);
        g.quadraticCurveTo(x + sweep * 0.58, spineY + side * len * 0.68, x + baseHalf, spineY - side * 0.2);
        g.closePath();
        g.fill();
      }
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(204,218,139,0.72)';
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(2, 68);
    g.bezierCurveTo(70, 44, 178, 47, 254, 79);
    g.stroke();
    g.strokeStyle = 'rgba(225,231,165,0.20)';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(5, 65);
    g.bezierCurveTo(80, 45, 179, 49, 250, 77);
    g.stroke();
  });
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTex, transparent: true, alphaTest: 0.22,
    side: THREE.DoubleSide, color: 0xf2ffd8, roughness: 0.9,
    emissive: 0x123c2b, emissiveIntensity: 0.34,
  });
  const trunkTex = makeTexture(96, 256, (g, w, h) => {
    const bark = g.createLinearGradient(0, 0, w, 0);
    bark.addColorStop(0, '#2e2018'); bark.addColorStop(0.45, '#5a3d27'); bark.addColorStop(1, '#251a18');
    g.fillStyle = bark; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 12) {
      g.strokeStyle = y % 24 ? 'rgba(18,11,10,0.42)' : 'rgba(190,135,80,0.18)';
      g.lineWidth = 2; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 4, w * 0.7, y - 3, w, y + 1); g.stroke();
    }
  }, [1, 2]);
  const trunkMat = new THREE.MeshStandardMaterial({
    map: trunkTex, color: 0xc58e5d, emissive: 0x29170d, emissiveIntensity: 0.18, roughness: 1
  });
  const coconutMat = new THREE.MeshStandardMaterial({
    color: 0x60442a, emissive: 0x160e08, emissiveIntensity: 0.12, roughness: 0.96,
  });
  const frondGeo = new THREE.PlaneGeometry(3.7, 1.32);
  frondGeo.translate(1.85, 0, 0); // pivot at frond base

  const fronds = [];   // { mesh, droop, ph }
  const crowns = [];   // { grp, ph }
  const palmGroups = [];

  function palmTrunkGeometry(height, lean) {
    const rings = mobile ? 6 : 8;
    const sides = mobile ? 7 : 9;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const centreX = lean * height * 1.8 * t * t;
      const centreY = height * t;
      const slope = lean * 3.6 * t;
      const invLen = 1 / Math.sqrt(1 + slope * slope);
      const nx = invLen;
      const ny = -slope * invLen;
      const radius = 0.215 - t * 0.088;
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ringOffset = Math.cos(a) * radius;
        positions.push(
          centreX + nx * ringOffset,
          centreY + ny * ringOffset,
          Math.sin(a) * radius
        );
        uvs.push(s / sides, t * 2.2);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < sides; s++) {
        const a = r * (sides + 1) + s;
        const b = a + sides + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function buildPalm(x, z, height, lean, ry) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(palmTrunkGeometry(height, lean), trunkMat);
    palm.add(trunk);
    const px = lean * height * 1.8;
    const py = height;
    const crown = new THREE.Group();
    crown.position.set(px, py, 0);
    const nF = mobile ? 8 : 10;
    for (let i = 0; i < nF; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / nF) * Math.PI * 2 + rnd() * 0.28;
      pivot.rotation.x = (rnd() - 0.5) * 0.16;
      const mesh = new THREE.Mesh(frondGeo, leafMat);
      const droop = -(0.12 + rnd() * 0.38);
      mesh.rotation.z = droop;
      const scale = 0.78 + rnd() * 0.25;
      mesh.scale.set(scale, scale * (0.88 + rnd() * 0.18), scale);
      pivot.add(mesh);
      crown.add(pivot);
      fronds.push({ mesh: mesh, droop: droop, ph: rnd() * Math.PI * 2 });
    }
    palm.add(crown);
    for (let i = 0; i < 3; i++) {
      const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.125, 7, 5), coconutMat);
      coconut.position.set(Math.cos(i * 2.1) * 0.14, -0.16 - i * 0.035, Math.sin(i * 2.1) * 0.13);
      crown.add(coconut);
    }
    palm.position.set(x, 0.06, z);
    palm.rotation.y = ry;
    root.add(palm);
    crowns.push({ grp: crown, ph: rnd() * Math.PI * 2 });
    palmGroups.push({ grp: palm, ph: rnd() * Math.PI * 2 });
    shadowDisc(0.9, x + 0.3, z, 0.28);
  }
  buildPalm(-6.5, 2.4, 4.8, 0.082, 0.3);
  buildPalm(-9.1, 0.8, 5.8, -0.064, 2.4);
  buildPalm(-11.2, 3.0, 4.25, 0.095, 4.2);

  // -------------------------------------------------------------- stilt hut
  const hutWoodTex = makeTexture(256, 256, (g, w, h) => {
    const wood = g.createLinearGradient(0, 0, w, 0);
    wood.addColorStop(0, '#3c251b'); wood.addColorStop(0.5, '#765036'); wood.addColorStop(1, '#34211b');
    g.fillStyle = wood; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 28) {
      g.fillStyle = 'rgba(20,10,7,0.34)'; g.fillRect(x, 0, 2, h);
      g.fillStyle = 'rgba(255,210,145,0.08)'; g.fillRect(x + 3, 0, 1, h);
    }
  }, [2.5, 1.4]);
  const thatchTex = makeTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#6b4a2c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 360; i++) {
      const x = rnd() * w, y = rnd() * h, len = 8 + rnd() * 28;
      g.strokeStyle = rnd() > 0.5 ? 'rgba(218,166,91,0.34)' : 'rgba(35,20,12,0.4)';
      g.lineWidth = 0.7 + rnd(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd() * 3 - 1.5, y + len); g.stroke();
    }
  }, [2, 1]);
  const hutMat = new THREE.MeshStandardMaterial({
    map: hutWoodTex, color: 0xd3a073, emissive: 0x321b0f, emissiveIntensity: 0.22, roughness: 0.94
  });
  const roofMat = new THREE.MeshStandardMaterial({
    map: thatchTex, color: 0xc89b63, emissive: 0x2d1a0d, emissiveIntensity: 0.18, roughness: 1
  });
  const hut = new THREE.Group();
  hut.position.set(-10.9, 0, -6.5);
  hut.rotation.y = -0.18;
  hut.scale.setScalar(1.12);
  // legs (standing in the shallows)
  const legGeo = new THREE.CylinderGeometry(0.075, 0.105, 1.45, 7);
  const legOff = [[-1.55, -1.05], [1.55, -1.05], [-1.55, 1.05], [1.55, 1.05]];
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(legGeo, hutMat);
    leg.position.set(legOff[i][0], 0.61, legOff[i][1]);
    hut.add(leg);
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.16, 2.8), hutMat);
  platform.position.y = 1.28;
  hut.add(platform);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.65, 1.52, 2.05), hutMat);
  cabin.position.set(-0.28, 2.1, 0);
  hut.add(cabin);

  // A proper pitched, overhanging thatch roof reads more naturally than the
  // previous pyramid primitive and gives the hut a welcoming porch profile.
  const roofAngle = Math.atan2(0.9, 1.7);
  const roofPanelGeo = new THREE.BoxGeometry(1.98, 0.12, 3.18);
  const roofLeft = new THREE.Mesh(roofPanelGeo, roofMat);
  roofLeft.position.set(-1.13, 3.28, 0);
  roofLeft.rotation.z = roofAngle;
  hut.add(roofLeft);
  const roofRight = new THREE.Mesh(roofPanelGeo, roofMat);
  roofRight.position.set(0.57, 3.28, 0);
  roofRight.rotation.z = -roofAngle;
  hut.add(roofRight);
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.22, 7), roofMat);
  ridge.rotation.x = Math.PI / 2;
  ridge.position.set(-0.28, 3.74, 0);
  hut.add(ridge);

  // Dark structural timber on the corners and sill makes the wall construction
  // legible even when the camera is looking from across the shoreline.
  const frameMat = new THREE.MeshStandardMaterial({
    map: hutWoodTex, color: 0x69452d, emissive: 0x1e1009, emissiveIntensity: 0.16, roughness: 1
  });
  const uprightGeo = new THREE.BoxGeometry(0.105, 1.58, 0.105);
  for (const x of [-1.63, 1.08]) {
    for (const z of [-1.07, 1.07]) {
      const upright = new THREE.Mesh(uprightGeo, frameMat);
      upright.position.set(x, 2.1, z);
      hut.add(upright);
    }
  }
  for (const y of [1.37, 2.8]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 2.18), frameMat);
    sill.position.set(1.09, y, 0);
    hut.add(sill);
  }

  // Warm window and an inset door on the camera-facing (+x) wall.
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff9a50, emissiveIntensity: 3
  });
  const windowGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), winMat);
  windowGlow.position.set(1.087, 2.19, -0.56);
  windowGlow.rotation.y = Math.PI / 2;
  hut.add(windowGlow);
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 1.08),
    new THREE.MeshStandardMaterial({ color: 0x38231b, emissive: 0x120906, emissiveIntensity: 0.2, roughness: 1 })
  );
  door.position.set(1.089, 1.91, 0.48);
  door.rotation.y = Math.PI / 2;
  hut.add(door);
  const windowBarGeo = new THREE.BoxGeometry(0.025, 0.54, 0.035);
  for (let i = 0; i < 2; i++) {
    const bar = new THREE.Mesh(windowBarGeo, frameMat);
    bar.position.set(1.103, 2.19, -0.56);
    bar.rotation.x = i === 0 ? 0 : Math.PI / 2;
    hut.add(bar);
  }
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 7, 5),
    new THREE.MeshStandardMaterial({ color: 0xc98f52, metalness: 0.25, roughness: 0.55 })
  );
  knob.position.set(1.122, 1.92, 0.3);
  hut.add(knob);

  // porch lantern
  const porchLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb36b, emissiveIntensity: 3.2 })
  );
  porchLamp.position.set(1.25, 2.65, 0.78);
  hut.add(porchLamp);

  // Porch rails, deck boards and centered steps complete the stilt-house
  // silhouette without expensive imported geometry.
  const railMat = new THREE.MeshStandardMaterial({
    map: hutWoodTex, color: 0xaa744c, emissive: 0x2d180e, emissiveIntensity: 0.22, roughness: 1
  });
  for (const z of [-1.1, 1.1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.78, 6), railMat);
    post.position.set(1.58, 1.61, z); hut.add(post);
  }
  for (const z of [-0.86, 0.86]) {
    const porchRail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.48, 6), railMat);
    porchRail.rotation.z = Math.PI / 2;
    porchRail.position.set(1.34, 1.92, z);
    hut.add(porchRail);
  }
  for (let i = 0; i < 4; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.82 + i * 0.1), railMat);
    step.position.set(1.92 + i * 0.30, 1.19 - i * 0.21, 0.42);
    hut.add(step);
  }
  for (let i = 0; i < 7; i++) {
    const deckBoard = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.025, 0.28), railMat);
    deckBoard.position.set(1.36, 1.38, -0.86 + i * 0.29);
    hut.add(deckBoard);
  }
  root.add(hut);
  // faint window-light shimmer on the water in front of the hut
  const hutGleamMat = new THREE.MeshBasicMaterial({
    color: 0xff9a50, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const hutGleam = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 2.8), hutGleamMat);
  hutGleam.rotation.x = -Math.PI / 2;
  hutGleam.position.set(-8.95, 0.12, -3.9);
  root.add(hutGleam);

  // ------------------------------------------------------------------ rocks
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x514252, emissive: 0x17101d, emissiveIntensity: 0.2, roughness: 0.95
  });
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
  const hemi = new THREE.HemisphereLight(0x9c91ce, 0x75604c, 1.08);
  root.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffcfaa, 1.15);
  sunLight.position.set(10, 14, 8);
  sunLight.castShadow = !mobile;
  if (!mobile) {
    sunLight.shadow.mapSize.set(1536, 1536);
    sunLight.shadow.camera.left = -18; sunLight.shadow.camera.right = 18;
    sunLight.shadow.camera.top = 16; sunLight.shadow.camera.bottom = -10;
    sunLight.shadow.bias = -0.00025;
  }
  root.add(sunLight);
  root.add(sunLight.target);
  const lanternLight = new THREE.PointLight(0xffb36b, 1.6, 9, 2);
  lanternLight.position.set(-0.05, 0.55, 3.7);
  root.add(lanternLight);

  // ----------------------------------------------------------------- update
  function update(t) {
    waterUniforms.uTime.value = t;
    foamUniforms.uTime.value = t;

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
    hutGleamMat.opacity = 0.18 + 0.07 * Math.max(0, wn);
  }

  function dispose() {
    // no timers or listeners; engine disposes geometries/materials/textures
  }

  return {
    seats: [
      {
        desktop: { pos: [0.4, 1.72, 8.4], look: [-2.2, 0.9, -23], fov: 51 },
        phoneLandscape: { pos: [0.5, 1.62, 8.8], look: [-2.2, 0.95, -25], fov: 52 },
        portrait: { pos: [0.5, 1.82, 10.2], look: [-1.8, 1.0, -24], fov: 57 },
      },
      {
        desktop: { pos: [4.8, 1.55, 1.0], look: [-9.3, 1.5, -7.2], fov: 56 },
        phoneLandscape: { pos: [4.4, 1.48, 1.7], look: [-9.0, 1.5, -7], fov: 57 },
        portrait: { pos: [4.5, 1.72, 3.4], look: [-8.8, 1.6, -7], fov: 61 },
      },
      {
        desktop: { pos: [2.2, 1.35, 6.4], look: [0.8, 13, -42], fov: 52 },
        phoneLandscape: { pos: [1.6, 1.28, 7.0], look: [0.6, 12, -44], fov: 51 },
        portrait: { pos: [1.5, 1.42, 8.4], look: [0.4, 11, -44], fov: 56 },
      },
    ],
    update: update,
    dispose: dispose,
    exposure: 1.08,
    bloom: { strength: 0.26, radius: 0.3, threshold: 0.93 }
  };
}
