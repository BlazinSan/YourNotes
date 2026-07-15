// beach.js — AUTHORED MOONLIT BEACH RETREAT
//
// Furniture, pavilion, palms, decor and sculpted sand come from the user's
// authored Blender room. Only elements that benefit from continuous motion —
// ocean, foam, stars and practical-light flicker — are generated at runtime.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = import.meta.env.BASE_URL || './';

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function seededRandom(seed = 7319) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

function repeatTexture(texture, x, y) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(x, y);
  texture.needsUpdate = true;
  return texture;
}

async function loadPbrTextureSet() {
  const loader = new THREE.TextureLoader();
  const definitions = [
    ['sand', 'sand_01_diff_1k.jpg', THREE.SRGBColorSpace, 1, 1],
    ['sandNormal', 'sand_01_nor_gl_1k.jpg', THREE.NoColorSpace, 1, 1],
    ['sandRoughness', 'sand_01_rough_1k.jpg', THREE.NoColorSpace, 1, 1],
    ['wood', 'wood_floor_deck_diff_1k.jpg', THREE.SRGBColorSpace, 1.5, 1.5],
    ['woodNormal', 'wood_floor_deck_nor_gl_1k.jpg', THREE.NoColorSpace, 1.5, 1.5],
    ['woodRoughness', 'wood_floor_deck_rough_1k.jpg', THREE.NoColorSpace, 1.5, 1.5],
  ];
  const loaded = await Promise.allSettled(definitions.map(async ([key, file, colorSpace, repeatX, repeatY]) => {
    const texture = await loader.loadAsync(`${BASE}haven-assets/beach_retreat/textures/${file}`);
    texture.name = `BeachPBR_${key}`;
    texture.colorSpace = colorSpace;
    texture.flipY = false;
    repeatTexture(texture, repeatX, repeatY);
    return [key, texture];
  }));
  if (loaded.some((result) => result.status === 'rejected')) {
    for (const result of loaded) {
      if (result.status === 'fulfilled') result.value[1].dispose();
    }
    return null;
  }
  return Object.fromEntries(loaded.map((result) => result.value));
}

function buildSurfaceTextures(mobile) {
  const sandSize = mobile ? 256 : 512;
  const sand = canvasTexture(sandSize, sandSize, (ctx, width, height) => {
    const image = ctx.createImageData(width, height);
    const random = seededRandom(9931);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const grain = (random() - 0.5) * 18;
        const ripple = Math.sin(y * 0.085 + Math.sin(x * 0.018) * 2.4) * 5.5;
        image.data[index] = 173 + grain + ripple;
        image.data[index + 1] = 126 + grain * 0.7 + ripple * 0.65;
        image.data[index + 2] = 86 + grain * 0.48 + ripple * 0.45;
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  repeatTexture(sand, 1, 1);

  const sandNormal = canvasTexture(mobile ? 128 : 256, mobile ? 128 : 256, (ctx, width, height) => {
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const nx = Math.sin(y * 0.17 + Math.sin(x * 0.05)) * 0.17 + Math.sin(x * 0.41) * 0.025;
        const ny = Math.cos(y * 0.17 + Math.sin(x * 0.05)) * 0.09;
        image.data[index] = 128 + nx * 127;
        image.data[index + 1] = 128 + ny * 127;
        image.data[index + 2] = 247;
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  sandNormal.colorSpace = THREE.NoColorSpace;
  repeatTexture(sandNormal, 1, 1);

  const wood = canvasTexture(mobile ? 256 : 512, mobile ? 128 : 256, (ctx, width, height) => {
    const image = ctx.createImageData(width, height);
    const random = seededRandom(2217);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const rings = Math.sin(x * 0.12 + Math.sin(y * 0.045) * 4.5) * 16;
        const pores = (random() - 0.5) * 9;
        const value = 196 + rings + pores;
        image.data[index] = value;
        image.data[index + 1] = value * 0.94;
        image.data[index + 2] = value * 0.88;
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  repeatTexture(wood, 2, 1);

  const bark = canvasTexture(mobile ? 128 : 256, mobile ? 256 : 512, (ctx, width, height) => {
    const image = ctx.createImageData(width, height);
    const random = seededRandom(6671);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const grooves = Math.abs(Math.sin(x * 0.17 + Math.sin(y * 0.024) * 2.8));
        const rings = Math.sin(y * 0.19) * 6;
        const grain = (random() - 0.5) * 14;
        image.data[index] = 103 + grooves * 42 + rings + grain;
        image.data[index + 1] = 61 + grooves * 24 + grain * 0.45;
        image.data[index + 2] = 37 + grooves * 11 + grain * 0.25;
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  repeatTexture(bark, 2, 3);

  const leaf = canvasTexture(mobile ? 128 : 256, mobile ? 128 : 256, (ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#173f2f');
    gradient.addColorStop(0.48, '#2f6b49');
    gradient.addColorStop(1, '#102e26');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(182, 207, 137, .32)';
    ctx.lineWidth = Math.max(1, width / 96);
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5);
    ctx.lineTo(width, height * 0.5);
    ctx.stroke();
    for (let index = 1; index < 12; index++) {
      const x = width * index / 12;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x, height * 0.5);
      ctx.lineTo(x - width * 0.055, height * 0.15);
      ctx.moveTo(x, height * 0.5);
      ctx.lineTo(x - width * 0.055, height * 0.85);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  const woven = canvasTexture(mobile ? 128 : 256, mobile ? 128 : 256, (ctx, width, height) => {
    ctx.fillStyle = '#73506f';
    ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < height; y += 4) {
      ctx.strokeStyle = y % 8 ? 'rgba(255,184,145,.15)' : 'rgba(44,21,57,.22)';
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    for (let x = 0; x < width; x += 6) {
      ctx.strokeStyle = 'rgba(239,204,182,.10)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
  });
  repeatTexture(woven, 7, 4);

  const rattan = canvasTexture(mobile ? 128 : 256, mobile ? 128 : 256, (ctx, width, height) => {
    ctx.fillStyle = '#98613d';
    ctx.fillRect(0, 0, width, height);
    const spacing = mobile ? 8 : 10;
    ctx.lineWidth = Math.max(1, width / 220);
    for (let offset = -height; offset < width + height; offset += spacing) {
      ctx.strokeStyle = 'rgba(55, 24, 13, .38)';
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + height, height);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(238, 184, 116, .24)';
      ctx.beginPath();
      ctx.moveTo(offset + spacing * 0.48, 0);
      ctx.lineTo(offset + height + spacing * 0.48, height);
      ctx.stroke();
    }
    for (let offset = 0; offset < width + height; offset += spacing) {
      ctx.strokeStyle = 'rgba(74, 34, 18, .30)';
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset - height, height);
      ctx.stroke();
    }
  });
  repeatTexture(rattan, 5, 5);

  const thatch = canvasTexture(mobile ? 256 : 512, mobile ? 128 : 256, (ctx, width, height) => {
    const image = ctx.createImageData(width, height);
    const random = seededRandom(5147);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const strand = Math.abs(Math.sin(x * 0.45 + Math.sin(y * 0.035) * 2.5));
        const dry = (random() - 0.5) * 22;
        image.data[index] = 154 + strand * 34 + dry;
        image.data[index + 1] = 98 + strand * 24 + dry * 0.55;
        image.data[index + 2] = 45 + strand * 13 + dry * 0.28;
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  repeatTexture(thatch, 4, 2);

  return { sand, sandNormal, wood, bark, leaf, woven, rattan, thatch };
}

async function tuneImportedMaterials(root, renderer, mobile) {
  const visited = new Set();
  const anisotropy = Math.min(mobile ? 2 : 6, renderer.capabilities.getMaxAnisotropy?.() || 1);
  const surfaces = buildSurfaceTextures(mobile);
  const pbr = await loadPbrTextureSet();
  if (pbr) {
    surfaces.sand.dispose();
    surfaces.sandNormal.dispose();
    surfaces.wood.dispose();
    surfaces.sand = pbr.sand;
    surfaces.sandNormal = pbr.sandNormal;
    surfaces.sandRoughness = pbr.sandRoughness;
    surfaces.wood = pbr.wood;
    surfaces.woodNormal = pbr.woodNormal;
    surfaces.woodRoughness = pbr.woodRoughness;
  }
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = !mobile;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || visited.has(material)) continue;
      visited.add(material);
      material.envMapIntensity = mobile ? 0.48 : 0.72;
      const name = (material.name || '').toLowerCase();
      if ('transmission' in material) material.transmission = 0;
      if (name.includes('wet moonlit sand')) {
        material.color?.set(pbr ? 0x697775 : 0x4e5f59);
        material.map = surfaces.sand;
        material.normalMap = surfaces.sandNormal;
        material.normalScale?.set(0.28, 0.28);
        material.roughness = 0.58;
        material.metalness = 0;
      } else if (name.includes('moonlit sand')) {
        material.color?.set(pbr ? 0xf0d5b5 : 0xd9b58e);
        material.map = surfaces.sand;
        material.normalMap = surfaces.sandNormal;
        material.roughnessMap = surfaces.sandRoughness || null;
        material.normalScale?.set(pbr ? 0.68 : 0.42, pbr ? 0.68 : 0.42);
        material.roughness = 0.96;
        material.metalness = 0;
      } else if (name.includes('palm leaves')) {
        material.color?.set(0x7ca97b);
        material.emissive?.set(0x102b18);
        material.emissiveIntensity = mobile ? 0.22 : 0.18;
        // Generated fronds intentionally have no UV seam; a sampled (0,0)
        // canvas texel made the whole crown almost black on Windows GPUs.
        material.map = null;
        material.metalness = 0;
        material.roughness = 0.78;
        material.side = THREE.DoubleSide;
      } else if (name.includes('palm trunk')) {
        material.color?.set(0xc08359);
        material.emissive?.set(0x170905);
        material.emissiveIntensity = 0.09;
        material.map = null;
        material.roughness = 0.9;
      } else if (name.includes('tropical ground leaves')) {
        material.color?.set(0x3f7450);
        material.emissive?.set(0x0b2514);
        material.emissiveIntensity = mobile ? 0.16 : 0.11;
        material.map = null;
        material.metalness = 0;
        material.side = THREE.DoubleSide;
        material.roughness = 0.86;
      } else if (name.includes('thatched')) {
        material.color?.set(0xc88b53);
        material.emissive?.set(0x1c0903);
        material.emissiveIntensity = 0.04;
        material.map = surfaces.thatch;
        material.roughness = 1;
      } else if (name.includes('woven rattan')) {
        material.color?.set(0xc18455);
        material.map = surfaces.rattan;
        material.roughness = 0.88;
      } else if (name.includes('deep teal')) {
        material.color?.set(0x71877b);
        material.roughness = Math.max(0.68, material.roughness || 0);
      } else if (name.includes('sunset coral')) {
        material.color?.set(0xa75242);
        material.map = surfaces.woven;
        material.roughness = 0.9;
      } else if (name.includes('natural linen')) {
        material.color?.set(0xd8c4a7);
        material.map = surfaces.woven;
        material.roughness = 0.96;
      } else if (name.includes('tropical hut wood') || name.includes('sunwashed deck wood')) {
        material.color?.set(pbr ? 0xcaa17e : 0xb16f48);
        material.map = surfaces.wood;
        material.normalMap = surfaces.woodNormal || null;
        material.roughnessMap = surfaces.woodRoughness || null;
        material.normalScale?.set(0.34, 0.34);
        material.roughness = Math.max(0.62, material.roughness || 0);
      } else if (name.includes('beach textile rug')) {
        material.color?.set(0x8a517c);
        material.map = surfaces.woven;
        material.roughness = 0.94;
      } else if (name.includes('aged brass') || name.includes('frame gold')) {
        material.color?.set(0xb77a3a);
        material.metalness = 0.62;
        material.roughness = 0.34;
      } else if (name.includes('smoky glass')) {
        material.color?.set(0x526778);
        material.transparent = true;
        material.opacity = 0.42;
        material.depthWrite = false;
        material.roughness = 0.2;
      } else if (name.includes('dark iron') || name.includes('charcoal') || name.includes('table bolts')) {
        material.color?.set(0x35333a);
        material.roughness = 0.48;
      } else if (name.includes('warm bulb')) {
        material.emissive?.set(0xff9a55);
        material.emissiveIntensity = 2.2;
      } else if (name.includes('glazed ceramic')) {
        material.color?.set(0x3c8381);
        material.roughness = 0.24;
      } else if (name.includes('tide-worn stone')) {
        material.color?.set(0x404a52);
        material.roughness = 0.94;
      }
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (material[key]) material[key].anisotropy = anisotropy;
      }
      material.needsUpdate = true;
    }
  });
}

function buildSky(root, mobile) {
  const skyTexture = canvasTexture(32, 1024, (ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#080b25');
    gradient.addColorStop(0.26, '#171b49');
    gradient.addColorStop(0.46, '#3e2f69');
    gradient.addColorStop(0.61, '#7d456b');
    gradient.addColorStop(0.72, '#d07b72');
    gradient.addColorStop(0.83, '#5b3b54');
    gradient.addColorStop(1, '#101426');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, mobile ? 24 : 48, mobile ? 14 : 28),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  root.add(sky);

  const random = seededRandom();
  const layers = [];
  const count = mobile ? 180 : 420;
  for (let layer = 0; layer < 2; layer++) {
    const positions = new Float32Array(Math.floor(count / 2) * 3);
    for (let index = 0; index < positions.length / 3; index++) {
      const azimuth = random() * Math.PI * 2;
      const elevation = 0.16 + random() * 1.2;
      const radius = 185 + random() * 20;
      positions[index * 3] = Math.cos(elevation) * Math.cos(azimuth) * radius;
      positions[index * 3 + 1] = Math.sin(elevation) * radius;
      positions[index * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: layer ? 0xd7dbff : 0xffefd5,
      size: layer ? 1.65 : 2.15,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      fog: false,
    });
    root.add(new THREE.Points(geometry, material));
    layers.push(material);
  }
  return layers;
}

function buildWater(root, mobile) {
  const segmentsX = mobile ? 56 : 112;
  const segmentsY = mobile ? 36 : 72;
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float waveHeight(vec2 p) {
        return sin(dot(p, normalize(vec2(1.0, 0.28))) * 0.22 + uTime * 0.69) * 0.30
          + sin(dot(p, normalize(vec2(-0.36, 1.0))) * 0.16 - uTime * 0.47) * 0.17
          + sin(dot(p, normalize(vec2(0.65, 0.76))) * 0.52 + uTime * 0.96) * 0.075;
      }

      void main() {
        vUv = uv;
        vec3 point = position;
        float shorelineMask = 1.0 - smoothstep(-50.0, -44.0, point.y);
        point.y += shorelineMask * (
          sin(point.x * 0.18 + uTime * 0.34) * 0.34
          + sin(point.x * 0.047 - uTime * 0.21 + 1.7) * 0.22
        );
        point.z += waveHeight(point.xy);
        float epsilon = 0.16;
        float dx = (waveHeight(point.xy + vec2(epsilon, 0.0)) - waveHeight(point.xy - vec2(epsilon, 0.0))) / (2.0 * epsilon);
        float dy = (waveHeight(point.xy + vec2(0.0, epsilon)) - waveHeight(point.xy - vec2(0.0, epsilon))) / (2.0 * epsilon);
        vec3 normal = normalize(vec3(-dx, -dy, 1.0));
        vec4 world = modelMatrix * vec4(point, 1.0);
        vWorldPosition = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2);
        float distanceTint = 1.0 - smoothstep(-85.0, -18.0, vWorldPosition.z);
        float broad = noise(vWorldPosition.xz * 0.15 + vec2(uTime * 0.025, -uTime * 0.035));
        float detail = noise(vWorldPosition.xz * 0.72 + vec2(-uTime * 0.08, uTime * 0.055));

        vec3 shallow = vec3(0.008, 0.055, 0.075);
        vec3 deep = vec3(0.003, 0.014, 0.038);
        vec3 dusk = vec3(0.065, 0.028, 0.088);
        vec3 colour = mix(shallow, deep, distanceTint);
        colour = mix(colour, dusk, smoothstep(0.48, 1.0, vUv.y) * 0.48);
        colour = mix(colour, vec3(0.045, 0.125, 0.16), fresnel * 0.48);
        colour += (broad - 0.5) * 0.045 + (detail - 0.5) * 0.025;

        // Shore foam belongs to the moving water itself. Wide, noisy breaker
        // regions avoid the flat horizontal strips created by overlay planes.
        float shore = -8.72 + sin(vWorldPosition.x * 0.17 + 0.8) * 0.28 + sin(vWorldPosition.x * 0.051) * 0.18;
        float shoreDepth = shore - vWorldPosition.z;
        float foamNoise = noise(vWorldPosition.xz * vec2(0.72, 1.45) + vec2(uTime * 0.09, -uTime * 0.13));
        float wash = 1.0 - smoothstep(0.08, 1.25, abs(shoreDepth - (0.42 + sin(uTime * 0.55 + vWorldPosition.x * 0.035) * 0.34)));
        float breaker = 1.0 - smoothstep(0.18, 1.05, abs(shoreDepth - (2.35 + sin(uTime * 0.43 - vWorldPosition.x * 0.048) * 0.48)));
        float farBreaker = 1.0 - smoothstep(0.18, 1.18, abs(shoreDepth - (4.75 + sin(uTime * 0.34 + vWorldPosition.x * 0.027) * 0.38)));
        float brokenFoam = max(wash * 0.72, max(breaker * 0.46, farBreaker * 0.18));
        brokenFoam *= smoothstep(0.20, 0.83, foamNoise + brokenFoam * 0.52);
        colour = mix(colour, vec3(0.64, 0.75, 0.79), brokenFoam * 0.38);

        vec3 moonDirection = normalize(vec3(0.02, 0.22, -0.98));
        float sparkle = pow(max(dot(reflect(-moonDirection, normal), viewDirection), 0.0), 72.0);
        float lane = exp(-pow(vWorldPosition.x / (2.5 + vUv.y * 8.0), 2.0));
        colour += vec3(0.54, 0.48, 0.72) * sparkle * lane * (0.65 + detail) * 1.25;
        gl_FragColor = vec4(colour, 1.0);
      }
    `,
    // Custom shaders do not include Three's fog chunks/uniforms. Advertising
    // fog support makes the transmission pre-pass call refreshFogUniforms on
    // an absent `fogColor` uniform, which aborts every rendered frame.
    fog: false,
    toneMapped: true,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(100, 100, segmentsX, segmentsY), material);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.02, -58.5);
  water.receiveShadow = false;
  root.add(water);
  return { waterUniforms: uniforms };
}

function buildMoonHalo(root) {
  const moonTexture = canvasTexture(512, 256, (ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#fff9ed');
    gradient.addColorStop(0.46, '#e9e0f8');
    gradient.addColorStop(1, '#b7abd5');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const random = seededRandom(1843);
    for (let index = 0; index < 72; index++) {
      const x = random() * width;
      const y = random() * height;
      const radius = 2 + random() * 17;
      const crater = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.2, 0, x, y, radius);
      crater.addColorStop(0, `rgba(255,255,255,${0.035 + random() * 0.07})`);
      crater.addColorStop(0.56, `rgba(108,96,137,${0.045 + random() * 0.08})`);
      crater.addColorStop(1, 'rgba(90,80,120,0)');
      ctx.fillStyle = crater;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 40, 24),
    new THREE.MeshBasicMaterial({ map: moonTexture, color: 0xb4a8ca, fog: false, toneMapped: true }),
  );
  moon.position.set(0, 8.5, -18.25);
  root.add(moon);

  // Bloom creates the halo from the bright sphere itself. A large transparent
  // sprite looks attractive in some browsers but produced a visible rectangular
  // quad on a subset of Windows/Android GPUs, so the moon intentionally has no
  // full-screen alpha card around it.
  return moon.material;
}

function groupPalms(retreat) {
  retreat.updateMatrixWorld(true);
  const definitions = ['Left', 'Right', 'Back'];
  const groups = [];
  for (const id of definitions) {
    const objects = [];
    retreat.traverse((object) => {
      if (object.name.startsWith(`Palm_${id}_`)) objects.push(object);
    });
    if (!objects.length) continue;
    const trunk = objects.find((object) => object.name.includes('Trunk')) || objects[0];
    const bounds = new THREE.Box3().setFromObject(trunk);
    const centre = bounds.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = `Palm_${id}_SwayRoot`;
    // Deriving the base from the exported trunk keeps sway anchored after the
    // build step moves water-planted draft palms back onto dry sand.
    pivot.position.set(centre.x, bounds.min.y, centre.z);
    retreat.add(pivot);
    pivot.updateMatrixWorld(true);
    for (const object of objects) pivot.attach(object);
    groups.push({ pivot, phase: groups.length * 1.9 });
  }
  return groups;
}

function buildPracticalLights(root, mobile) {
  const definitions = [
    { position: [3.38, 1.22, 0.2], intensity: mobile ? 2.0 : 3.2, distance: 6.0 },
    { position: [-3.05, 3.34, 1.1], intensity: mobile ? 1.5 : 2.6, distance: 7.5 },
    { position: [-5.65, 0.56, 5.15], intensity: mobile ? 1.1 : 1.8, distance: 5.5 },
    { position: [-6.1, 2.6, -1.25], intensity: mobile ? 0.72 : 1.15, distance: 5.8 },
  ];
  const lights = definitions.map((definition) => {
    const light = new THREE.PointLight(0xff8b42, definition.intensity, definition.distance, 2);
    light.position.fromArray(definition.position);
    light.castShadow = false;
    light.userData.baseIntensity = definition.intensity;
    root.add(light);
    return light;
  });
  return lights;
}

function buildPavilionDetails(root, mobile) {
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd9a2,
    emissive: 0xff7a32,
    emissiveIntensity: 3.4,
    roughness: 0.28,
  });
  const bulbGeometry = new THREE.SphereGeometry(0.065, 10, 7);
  const bulbs = new THREE.InstancedMesh(bulbGeometry, bulbMaterial, mobile ? 7 : 11);
  const count = bulbs.count;
  const matrix = new THREE.Matrix4();
  const positions = [];
  for (let index = 0; index < count; index++) {
    const amount = count === 1 ? 0 : index / (count - 1);
    const x = THREE.MathUtils.lerp(-8.9, -2.25, amount);
    const y = 4.05 - Math.sin(amount * Math.PI) * 0.18;
    const z = 1.58;
    matrix.makeTranslation(x, y, z);
    bulbs.setMatrixAt(index, matrix);
    positions.push(x, y + 0.04, z, x, y, z);
  }
  bulbs.instanceMatrix.needsUpdate = true;
  root.add(bulbs);
  const cable = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)),
    new THREE.LineBasicMaterial({ color: 0x251b1a, transparent: true, opacity: 0.85 }),
  );
  root.add(cable);
  const grassGeometry = new THREE.BufferGeometry();
  grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.09, 0, 0, -0.055, 0.46, 0, 0, 0.82, 0, 0.055, 0.46, 0, 0.09, 0, 0,
  ], 3));
  grassGeometry.setIndex([0, 1, 4, 1, 3, 4, 1, 2, 3]);
  grassGeometry.computeVertexNormals();
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x32694f, roughness: 0.9, side: THREE.DoubleSide });
  const clusterCentres = [[-11.25, -3.8], [-9.7, -4.45], [9.2, -4.7], [4.0, -6.0]];
  const bladesPerCluster = mobile ? 5 : 9;
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, clusterCentres.length * bladesPerCluster);
  const random = seededRandom(8312);
  const dummy = new THREE.Object3D();
  let blade = 0;
  for (const [centreX, centreZ] of clusterCentres) {
    for (let index = 0; index < bladesPerCluster; index++) {
      dummy.position.set(centreX + (random() - 0.5) * 1.35, 0.02, centreZ + (random() - 0.5) * 1.15);
      dummy.rotation.set((random() - 0.5) * 0.32, random() * Math.PI * 2, (random() - 0.5) * 0.32);
      const scale = 0.8 + random() * 1.15;
      dummy.scale.set(0.7 + random() * 0.65, scale, 0.7 + random() * 0.65);
      dummy.updateMatrix();
      grass.setMatrixAt(blade++, dummy.matrix);
    }
  }
  grass.instanceMatrix.needsUpdate = true;
  grass.castShadow = !mobile;
  root.add(grass);

  return { bulbMaterial };
}

export async function build(ctx) {
  const { scene, renderer, quality } = ctx;
  const mobile = !!quality?.mobile;
  const root = new THREE.Group();
  root.name = 'BeachRetreatRoot';
  scene.add(root);

  scene.background = new THREE.Color(0x090d23);
  scene.fog = new THREE.FogExp2(0x1b2141, mobile ? 0.0075 : 0.0062);

  const starMaterials = buildSky(root, mobile);
  const { waterUniforms } = buildWater(root, mobile);
  buildMoonHalo(root);

  const filename = mobile ? 'beach_retreat_mobile.glb' : 'beach_retreat.glb';
  const url = `${BASE}haven-assets/beach_retreat/${filename}`;
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(url);
  } catch (error) {
    throw new Error(`The authored beach retreat could not be loaded (${url})`, { cause: error });
  }
  const retreat = gltf.scene;
  retreat.name = 'AuthoredBeachRetreat';
  root.add(retreat);
  // The Blender draft used a solid rectangular moon card. Keep its authored
  // placement, but replace the card with the round textured moon above so no
  // opaque square interrupts the night sky.
  const authoredMoon = retreat.getObjectByName('Full_Moon');
  if (authoredMoon) authoredMoon.visible = false;
  await tuneImportedMaterials(retreat, renderer, mobile);
  const palmGroups = groupPalms(retreat);
  const practicalLights = buildPracticalLights(root, mobile);
  const pavilionDetails = buildPavilionDetails(root, mobile);

  const hemisphere = new THREE.HemisphereLight(0x94a8dd, 0x704531, mobile ? 1.55 : 1.72);
  root.add(hemisphere);
  const moonLight = new THREE.DirectionalLight(0xb8c9ff, mobile ? 1.45 : 2.05);
  moonLight.position.set(12, 20, -18);
  moonLight.target.position.set(0, 0, -8);
  moonLight.castShadow = !mobile;
  if (!mobile) {
    moonLight.shadow.mapSize.set(1024, 1024);
    moonLight.shadow.camera.left = -22;
    moonLight.shadow.camera.right = 22;
    moonLight.shadow.camera.top = 18;
    moonLight.shadow.camera.bottom = -8;
    moonLight.shadow.bias = -0.00025;
    moonLight.shadow.normalBias = 0.035;
  }
  root.add(moonLight, moonLight.target);

  // A broad ocean-side fill reveals the real furniture silhouettes while the
  // warm practicals retain the intimate night-pavilion mood.
  const oceanFill = new THREE.DirectionalLight(0x7894c9, mobile ? 0.48 : 0.66);
  oceanFill.position.set(0, 5, -14);
  oceanFill.target.position.set(0, 1.2, 1.5);
  root.add(oceanFill, oceanFill.target);

  const bulbMaterials = [];
  retreat.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if ((material?.name || '').toLowerCase().includes('warm bulb') && !bulbMaterials.includes(material)) {
        bulbMaterials.push(material);
      }
    }
  });

  function update(time, delta, state) {
    waterUniforms.uTime.value = time;
    const reduced = state?.reducedMotion;
    if (!reduced) {
      for (let index = 0; index < palmGroups.length; index++) {
        const palm = palmGroups[index];
        palm.pivot.rotation.z = Math.sin(time * 0.32 + palm.phase) * 0.012;
        palm.pivot.rotation.x = Math.sin(time * 0.24 + palm.phase * 1.3) * 0.006;
      }
    }
    const flicker = Math.sin(time * 7.1) * 0.45 + Math.sin(time * 11.8 + 1.2) * 0.3 + Math.sin(time * 3.4) * 0.25;
    for (const light of practicalLights) light.intensity = light.userData.baseIntensity * (1 + flicker * 0.045);
    pavilionDetails.bulbMaterial.emissiveIntensity = 3.35 + flicker * 0.16;
    for (const material of bulbMaterials) material.emissiveIntensity = 2.65 + flicker * 0.18;
    starMaterials[0].opacity = 0.64 + Math.sin(time * 0.52) * 0.12;
    starMaterials[1].opacity = 0.68 + Math.sin(time * 0.71 + 1.8) * 0.13;
  }

  return {
    seats: [
      {
        desktop: { pos: [0.1, 1.78, 8.45], look: [-0.5, 1.03, -2.15], fov: 51 },
        phoneLandscape: { pos: [0.15, 1.86, 9.05], look: [-0.55, 1.08, -2.3], fov: 54 },
        portrait: { pos: [0.1, 2.5, 12.0], look: [-0.6, 1.6, -2.8], fov: 62 },
      },
      {
        desktop: { pos: [-13.1, 1.82, 8.3], look: [-4.35, 1.12, -1.15], fov: 50 },
        phoneLandscape: { pos: [-13.45, 1.92, 8.95], look: [-4.2, 1.15, -1.35], fov: 53 },
        portrait: { pos: [-13.8, 2.6, 11.4], look: [-3.9, 1.62, -1.8], fov: 60 },
      },
      {
        desktop: { pos: [9.0, 1.18, 4.55], look: [1.45, 0.82, -1.05], fov: 50 },
        phoneLandscape: { pos: [9.65, 1.3, 5.15], look: [1.2, 0.86, -1.25], fov: 53 },
        portrait: { pos: [10.7, 2.1, 8.2], look: [0.9, 1.16, -1.9], fov: 61 },
      },
    ],
    update,
    dispose() {},
    exposure: 1.24,
    bloom: { strength: 0.2, radius: 0.3, threshold: 0.94 },
  };
}
