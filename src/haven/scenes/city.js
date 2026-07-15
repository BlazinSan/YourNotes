// city.js — authored blue-hour high-rise loft.
//
// The room and every visible furnishing come from the user's Blender scene.
// Runtime code is intentionally limited to loading, lighting, cameras and
// ambient motion (glass rain, flames and emissive flicker).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


const fromBlender = (x, y, z) => new THREE.Vector3(x, z, -y);

function createSky(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#0b1538');
  gradient.addColorStop(0.34, '#202b59');
  gradient.addColorStop(0.58, '#614061');
  gradient.addColorStop(0.72, '#bd655f');
  gradient.addColorStop(0.86, '#e39a78');
  gradient.addColorStop(1, '#111223');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, mobile ? 18 : 28, mobile ? 12 : 18),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.name = 'Loft_Sunset_Sky';
  return sky;
}

function createWindowRain(mobile) {
  const count = mobile ? 78 : 168;
  const positions = new Float32Array(count * 6);
  const speed = new Float32Array(count);
  const length = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 6;
    const x = THREE.MathUtils.lerp(-7.05, 7.05, Math.random());
    const y = THREE.MathUtils.lerp(0.25, 5.72, Math.random());
    const streakLength = THREE.MathUtils.lerp(0.055, 0.23, Math.random());
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = -6.192;
    positions[offset + 3] = x + THREE.MathUtils.lerp(-0.012, 0.012, Math.random());
    positions[offset + 4] = y + streakLength;
    positions[offset + 5] = -6.192;
    speed[index] = THREE.MathUtils.lerp(0.14, 0.48, Math.random());
    length[index] = streakLength;
  }

  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const material = new THREE.LineBasicMaterial({
    color: 0xb8d9ef,
    transparent: true,
    opacity: mobile ? 0.24 : 0.34,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const rain = new THREE.LineSegments(geometry, material);
  rain.name = 'Rain_On_Window_Glass_Only';
  rain.renderOrder = 12;

  return {
    object: rain,
    update(delta) {
      const step = Math.min(delta, 0.05);
      for (let index = 0; index < count; index += 1) {
        const offset = index * 6;
        let y = positions[offset + 1] - speed[index] * step;
        if (y < 0.18) y = 5.72 + Math.random() * 0.24;
        positions[offset + 1] = y;
        positions[offset + 4] = y + length[index];
      }
      attribute.needsUpdate = true;
    },
  };
}

function createFire(mobile) {
  const uniforms = { time: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float time;
      varying vec2 vUv;
      varying float vPulse;
      void main() {
        vec3 p = position;
        float h = clamp(uv.y, 0.0, 1.0);
        float taper = smoothstep(0.12, 0.78, h);
        p.x += sin(time * 4.6 + p.y * 6.4) * 0.052 * taper;
        p.y *= 0.96 + 0.055 * sin(time * 5.1 + position.x * 9.0);
        vUv = uv;
        vPulse = 0.82 + 0.18 * sin(time * 6.0 + p.y * 5.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying float vPulse;
      void main() {
        float h = clamp(vUv.y, 0.0, 1.0);
        float x = abs(vUv.x - 0.5) * 2.0;
        float width = mix(0.78, 0.06, pow(h, 0.72));
        float waviness = sin(h * 16.0 + vPulse * 3.1) * 0.055 * h;
        float body = 1.0 - smoothstep(width - 0.12, width + 0.09, x + waviness);
        float base = smoothstep(0.0, 0.08, h);
        float tip = 1.0 - smoothstep(0.82, 1.0, h);
        float alpha = body * base * tip * (0.72 + 0.18 * vPulse);
        vec3 goldenCore = vec3(1.0, 0.61, 0.12);
        vec3 emberEdge = vec3(1.0, 0.075, 0.008);
        vec3 color = mix(goldenCore, emberEdge, smoothstep(0.2, 0.95, h));
        color *= mix(1.05, 0.68, x) * (0.78 + 0.12 * vPulse);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const group = new THREE.Group();
  group.name = 'Dimensional_Fire';
  const lobes = mobile ? 3 : 5;
  for (let index = 0; index < lobes; index += 1) {
    // Crossed, deforming flame cards have a soft organic silhouette from
    // every camera, without the hard faceted cone edges of the old fire.
    const geometry = new THREE.PlaneGeometry(
      0.34 + (index % 2) * 0.08,
      0.72 + (index % 3) * 0.13,
      mobile ? 2 : 4,
      mobile ? 4 : 7,
    );
    const flame = new THREE.Mesh(geometry, material);
    const column = index - (lobes - 1) / 2;
    flame.position.set(column * 0.17, 0.37 + (index % 2) * 0.055, (index % 2) * 0.05);
    flame.rotation.y = index * 1.14;
    flame.scale.set(0.84 + (index % 3) * 0.08, 0.86 + (index % 2) * 0.15, 1);
    group.add(flame);
  }
  group.position.copy(fromBlender(5.2357, 4.99, 0.62));
  group.rotation.y = Math.PI;
  return { object: group, uniforms };
}

function createLaptopScreenTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 384 : 512;
  canvas.height = mobile ? 240 : 320;
  const context = canvas.getContext('2d');
  const { width, height } = canvas;

  const roundedRect = (x, y, w, h, radius) => {
    const r = Math.min(radius, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + w - r, y);
    context.quadraticCurveTo(x + w, y, x + w, y + r);
    context.lineTo(x + w, y + h - r);
    context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    context.lineTo(x + r, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  };

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#07111e');
  background.addColorStop(0.52, '#10283b');
  background.addColorStop(1, '#173447');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  // A restrained, warm lofi player/dashboard UI makes the screen read as a
  // real workstation without becoming a bright cyan rectangle in the room.
  context.fillStyle = 'rgba(237, 191, 142, 0.92)';
  roundedRect(width * 0.065, height * 0.08, width * 0.16, height * 0.045, 6);
  context.fill();
  context.fillStyle = 'rgba(214, 232, 236, 0.38)';
  roundedRect(width * 0.75, height * 0.08, width * 0.18, height * 0.045, 6);
  context.fill();

  context.fillStyle = 'rgba(5, 13, 25, 0.68)';
  roundedRect(width * 0.06, height * 0.2, width * 0.56, height * 0.62, 18);
  context.fill();
  context.fillStyle = 'rgba(232, 175, 126, 0.92)';
  roundedRect(width * 0.1, height * 0.26, width * 0.3, height * 0.055, 7);
  context.fill();
  context.fillStyle = 'rgba(189, 219, 224, 0.34)';
  for (let row = 0; row < 3; row += 1) {
    roundedRect(width * 0.1, height * (0.39 + row * 0.11), width * (0.39 - row * 0.045), height * 0.035, 5);
    context.fill();
  }

  const album = context.createLinearGradient(width * 0.66, height * 0.2, width * 0.94, height * 0.78);
  album.addColorStop(0, '#b36055');
  album.addColorStop(0.5, '#563b62');
  album.addColorStop(1, '#172a40');
  context.fillStyle = album;
  roundedRect(width * 0.67, height * 0.2, width * 0.27, height * 0.4, 16);
  context.fill();
  context.fillStyle = 'rgba(255, 216, 167, 0.85)';
  context.beginPath();
  context.arc(width * 0.805, height * 0.4, height * 0.085, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(218, 234, 236, 0.68)';
  for (let bar = 0; bar < 7; bar += 1) {
    const barHeight = height * (0.035 + ((bar * 7) % 5) * 0.012);
    roundedRect(width * (0.68 + bar * 0.038), height * 0.7 - barHeight / 2, width * 0.014, barHeight, 4);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createMaterialDetailTexture(kind, mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = mobile ? 64 : 128;
  const context = canvas.getContext('2d');
  const size = canvas.width;
  context.fillStyle = '#7f7f7f';
  context.fillRect(0, 0, size, size);

  if (kind === 'fabric') {
    for (let index = 0; index < size; index += 2) {
      context.fillStyle = index % 4 === 0 ? '#929292' : '#707070';
      context.fillRect(index, 0, 1, size);
      context.fillRect(0, index, size, 1);
    }
  } else if (kind === 'leather') {
    // Deterministic low-frequency grain: enough to catch practical light,
    // without shimmering or adding a photographic texture dependency.
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        const value = 112 + ((x * 17 + y * 29) % 36);
        context.fillStyle = `rgb(${value}, ${value}, ${value})`;
        context.fillRect(x, y, 3, 3);
      }
    }
  } else {
    for (let y = 0; y < size; y += 3) {
      context.fillStyle = y % 6 === 0 ? '#8c8c8c' : '#747474';
      context.fillRect(0, y, size, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'fabric' ? 18 : 10, kind === 'fabric' ? 18 : 10);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function createRugColorTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 128 : 256;
  canvas.height = mobile ? 128 : 256;
  const context = canvas.getContext('2d');
  const size = canvas.width;

  context.fillStyle = '#4a1725';
  context.fillRect(0, 0, size, size);
  context.strokeStyle = '#9c593b';
  context.lineWidth = size * 0.035;
  context.strokeRect(size * 0.055, size * 0.055, size * 0.89, size * 0.89);
  context.strokeStyle = '#d1a064';
  context.lineWidth = size * 0.012;
  context.strokeRect(size * 0.105, size * 0.105, size * 0.79, size * 0.79);
  context.strokeStyle = '#31545a';
  context.lineWidth = size * 0.022;
  context.strokeRect(size * 0.145, size * 0.145, size * 0.71, size * 0.71);

  context.save();
  context.translate(size / 2, size / 2);
  context.rotate(Math.PI / 4);
  context.fillStyle = '#7e332d';
  context.fillRect(-size * 0.19, -size * 0.19, size * 0.38, size * 0.38);
  context.strokeStyle = '#c58a50';
  context.lineWidth = size * 0.026;
  context.strokeRect(-size * 0.145, -size * 0.145, size * 0.29, size * 0.29);
  context.fillStyle = '#24484e';
  context.fillRect(-size * 0.075, -size * 0.075, size * 0.15, size * 0.15);
  context.restore();

  context.fillStyle = 'rgba(213, 161, 98, 0.72)';
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if ((row === 1 || row === 2) && (column === 1 || column === 2)) continue;
      const x = size * (0.23 + column * 0.18);
      const y = size * (0.23 + row * 0.18);
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4);
      context.fillRect(-size * 0.018, -size * 0.018, size * 0.036, size * 0.036);
      context.restore();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = mobile ? 2 : 6;
  return texture;
}

function createWoodColorTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = mobile ? 64 : 128;
  const context = canvas.getContext('2d');
  const size = canvas.width;
  const gradient = context.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, '#4a2419');
  gradient.addColorStop(0.45, '#70402a');
  gradient.addColorStop(1, '#3a1c16');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.lineWidth = 1;
  for (let line = 0; line < 18; line += 1) {
    context.beginPath();
    for (let x = 0; x <= size; x += 4) {
      const y = ((line + 0.5) / 18) * size + Math.sin(x * 0.09 + line * 1.7) * 1.8;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = line % 3 === 0 ? 'rgba(32, 12, 8, 0.35)' : 'rgba(219, 132, 80, 0.16)';
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.anisotropy = mobile ? 2 : 6;
  return texture;
}

function tuneMaterials(root, mobile) {
  const animated = {
    candle: [],
    bulb: [],
    windows: [],
    laptop: [],
  };
  const laptopScreenTexture = createLaptopScreenTexture(mobile);
  const fabricDetail = createMaterialDetailTexture('fabric', mobile);
  const leatherDetail = createMaterialDetailTexture('leather', mobile);
  const rugDetail = createMaterialDetailTexture('rug', mobile);
  const rugColor = createRugColorTexture(mobile);
  const woodColor = createWoodColorTexture(mobile);

  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      const name = (material.name || '').toLowerCase();
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = mobile ? 2 : 6;
      }
      if (name.includes('window glass')) {
        material.transparent = true;
        material.opacity = 0.12;
        material.transmission = 0;
        material.thickness = 0;
        material.depthWrite = false;
        material.roughness = 0.12;
        material.metalness = 0.05;
        object.renderOrder = 8;
        object.castShadow = false;
      } else if (name.includes('candle flame')) {
        material.emissive = new THREE.Color(0xff7a24);
        material.emissiveIntensity = 2.4;
        animated.candle.push(material);
      } else if (name.includes('warm bulb')) {
        material.emissive = new THREE.Color(0xff9b49);
        material.emissiveIntensity = mobile ? 2.85 : 3.35;
        animated.bulb.push(material);
      } else if (name.includes('city window glow')) {
        material.emissive = new THREE.Color(0xffc277);
        material.emissiveIntensity = 1.45;
        animated.windows.push(material);
      } else if (name.includes('laptop screen')) {
        material.color = new THREE.Color(0xffffff);
        material.map = laptopScreenTexture;
        material.emissiveMap = laptopScreenTexture;
        material.emissive = new THREE.Color(0x91bad1);
        material.emissiveIntensity = mobile ? 0.66 : 0.78;
        material.roughness = 0.32;
        material.metalness = 0.02;
        animated.laptop.push(material);
      } else if (name.includes('loft dark wall')) {
        // The supplied room deliberately uses plum-black walls. In Blender
        // they are revealed by bounced practical light; without that bake a
        // realtime PBR renderer crushes them to a featureless black slab.
        // Preserve the colour while giving the wall its physically plausible
        // warm bounce so the workstation corner stays readable.
        material.color = new THREE.Color(0x49323f);
        material.emissive = new THREE.Color(0x211019);
        material.emissiveIntensity = mobile ? 0.58 : 0.46;
        material.roughness = 0.92;
        material.bumpMap = leatherDetail;
        material.bumpScale = mobile ? 0.003 : 0.006;
      } else if (name.includes('loft wood floor')) {
        material.color.multiplyScalar(1.14);
        material.emissive = new THREE.Color(0x170b08);
        material.emissiveIntensity = mobile ? 0.38 : 0.28;
        material.roughness = 0.78;
      } else if (name.includes('persian rug')) {
        material.color = new THREE.Color(0xffffff);
        material.emissive = new THREE.Color(0x16080f);
        material.emissiveIntensity = mobile ? 0.3 : 0.22;
        material.map = rugColor;
        material.bumpMap = rugDetail;
        material.bumpScale = mobile ? 0.008 : 0.015;
      } else if (name.includes('deep teal fabric')) {
        material.color = new THREE.Color(0x315754);
        material.emissive = new THREE.Color(0x0b1c1a);
        material.emissiveIntensity = mobile ? 0.3 : 0.18;
        material.roughness = 0.84;
        material.roughnessMap = fabricDetail;
        material.bumpMap = fabricDetail;
        material.bumpScale = mobile ? 0.009 : 0.018;
      } else if (name.includes('rust woven throw')) {
        material.color = new THREE.Color(0x7a2f23);
        material.roughness = 0.96;
        material.roughnessMap = fabricDetail;
        material.bumpMap = fabricDetail;
        material.bumpScale = mobile ? 0.012 : 0.022;
      } else if (name.includes('leather')) {
        material.color = new THREE.Color(0x642b1f);
        material.emissive = new THREE.Color(0x160805);
        material.emissiveIntensity = mobile ? 0.25 : 0.14;
        material.roughness = 0.44;
        material.metalness = 0.02;
        material.bumpMap = leatherDetail;
        material.bumpScale = mobile ? 0.006 : 0.012;
      } else if (name.includes('wood') || name.includes('walnut')) {
        if (!material.map) material.map = woodColor;
        material.color = new THREE.Color(0xffffff);
        material.roughness = Math.min(material.roughness ?? 0.72, 0.76);
      }
      material.needsUpdate = true;
    }
  });
  return animated;
}

function setShadowPolicy(root, mobile) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (mobile) {
      object.castShadow = false;
      object.receiveShadow = false;
      return;
    }
    const name = (object.name || '').toLowerCase();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const transparent = materials.some((material) => material?.transparent);
    object.castShadow = !transparent && !name.includes('city_') && !name.includes('window');
    object.receiveShadow = !transparent && !name.includes('city_');
  });
}

function loadLoft(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}


export async function build(ctx) {
  const { scene, quality } = ctx;
  const mobile = Boolean(quality?.mobile);
  const root = new THREE.Group();
  root.name = 'Authored_Cozy_City_Loft';
  scene.add(root);
  scene.background = new THREE.Color(0x070914);
  scene.fog = new THREE.FogExp2(0x11162c, mobile ? 0.008 : 0.006);

  root.add(createSky(mobile));
  const sunset = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, mobile ? 14 : 24, mobile ? 10 : 16),
    new THREE.MeshBasicMaterial({ color: 0xffc18f, fog: false }),
  );
  sunset.name = 'Blue_Hour_Sunset';
  sunset.position.set(2.2, 3.9, -19.5);
  root.add(sunset);

  const assetName = mobile ? 'cozy_city_loft_mobile.glb' : 'cozy_city_loft.glb';
  const assetUrl = `${import.meta.env.BASE_URL || './'}haven-assets/cozy_city_loft/${assetName}`;
  let loft;
  try {
    loft = await loadLoft(assetUrl);
  } catch (error) {
    window.dispatchEvent(new CustomEvent('haven-render-status', {
      detail: { state: 'error', message: 'The high-rise room could not be loaded. Tap retry.' },
    }));
    throw new Error(`High-rise GLB failed to load: ${assetUrl}`, { cause: error });
  }
  loft.name = mobile ? 'Cozy_City_Loft_Mobile' : 'Cozy_City_Loft_Desktop';
  root.add(loft);

  const animatedMaterials = tuneMaterials(loft, mobile);
  setShadowPolicy(loft, mobile);

  // The authored Blender lights are deliberately not exported. Rebuilding a
  // restrained realtime rig keeps the same composition while meeting the
  // phone budget and allowing the fire/lamp pools to breathe.
  scene.add(new THREE.HemisphereLight(0x91a8db, 0x4a2527, mobile ? 1.85 : 2.2));
  scene.add(new THREE.AmbientLight(0x9b7180, mobile ? 1.04 : 0.92));

  // A cool, non-shadow-casting window fill supplies the broad blue-hour
  // bounce that the source Blender render receives from its world/sky. It is
  // intentionally cheap: one directional evaluation, no shadow texture.
  const windowFill = new THREE.DirectionalLight(0x7899d4, mobile ? 0.72 : 0.92);
  windowFill.name = 'Blue_Hour_Window_Fill';
  windowFill.position.set(0, 4.8, -5.2);
  windowFill.target.position.set(0, 1.05, 2.2);
  windowFill.castShadow = false;
  scene.add(windowFill, windowFill.target);

  // Practical-light bounce along the desk wall. This prevents the authentic
  // plum wall and walnut desk from collapsing into a black void while the
  // focused task light below retains the modeled shadows and highlights.
  if (!mobile) {
    const workstationBounce = new THREE.PointLight(0xffb07a, 2.55, 6.6, 1.85);
    workstationBounce.name = 'Workstation_Wall_Bounce';
    workstationBounce.position.set(-6.25, 2.35, 0.75);
    workstationBounce.castShadow = false;
    scene.add(workstationBounce);
  }

  const fireLight = new THREE.PointLight(0xff6f2c, mobile ? 3.2 : 5.1, 8.2, 1.85);
  fireLight.name = 'Fireplace_Light';
  fireLight.position.copy(fromBlender(5.2357, 4.2139, 1.3028));
  fireLight.castShadow = !mobile;
  if (!mobile) {
    fireLight.shadow.mapSize.set(768, 768);
    fireLight.shadow.bias = -0.00035;
    fireLight.shadow.normalBias = 0.035;
  }
  scene.add(fireLight);

  const deskLight = new THREE.SpotLight(0xffa761, mobile ? 3.4 : 5.0, 7, Math.PI / 3.1, 0.78, 1.4);
  deskLight.name = 'Workstation_Lamp_Light';
  deskLight.position.copy(fromBlender(-5.6214, -0.4672, 1.8272));
  deskLight.target.position.copy(fromBlender(-5.25, 0.78, 0.88));
  // GTAO plus the room's single fireplace shadow map gives the task area
  // contact depth without a second full-scene shadow render on every frame.
  deskLight.castShadow = false;
  scene.add(deskLight, deskLight.target);

  // The visible modeled bulb also gets a tight, shadow-free practical pool.
  // This is small enough to be inexpensive on phone, but it makes the lamp
  // itself feel like the source of the warm workstation light.
  let deskBulbGlow = null;
  if (!mobile) {
    deskBulbGlow = new THREE.PointLight(0xffa45f, 1.75, 3.8, 2.05);
    deskBulbGlow.name = 'Workstation_Visible_Bulb_Glow';
    deskBulbGlow.position.copy(fromBlender(-5.6214, -0.4672, 1.8272));
    deskBulbGlow.castShadow = false;
    scene.add(deskBulbGlow);
  }

  if (!mobile) {
    const candlePool = new THREE.PointLight(0xffad6a, 1.55, 5.2, 2);
    candlePool.name = 'Candle_Lounge_Pool';
    candlePool.position.copy(fromBlender(-2.0, 4.9, 1.55));
    scene.add(candlePool);

    const floorLampPool = new THREE.PointLight(0xff9d61, 1.45, 4.6, 2.0);
    floorLampPool.name = 'Lounge_Floor_Lamp_Pool';
    floorLampPool.position.copy(fromBlender(2.45, 2.35, 1.50));
    scene.add(floorLampPool);
  }

  const rain = createWindowRain(mobile);
  root.add(rain.object);
  const fire = createFire(mobile);
  root.add(fire.object);

  let shadowPolicyApplied = false;
  const seats = [
    {
      // Workstation: the leather chair reads as part of the desk, while the
      // physical laptop, pipe lamp and rain-lit skyline remain unobstructed.
      desktop: { pos: [-1.8, 2.65, 3.05], look: [-5.05, 1.2, -0.55], fov: 50 },
      phoneLandscape: { pos: [-1.45, 2.5, 3.0], look: [-5.0, 1.2, -0.6], fov: 58 },
      portrait: { pos: [-0.4, 2.45, 3.1], look: [-5.0, 1.25, -0.65], fov: 64 },
    },
    {
      // Fireside lounge: the camera lives by the rain glass, putting the
      // modeled tea table, sofa cushions and hearth into one intimate layer.
      desktop: { pos: [-3.45, 1.7, -3.3], look: [2.35, 1.08, -4.25], fov: 50 },
      phoneLandscape: { pos: [-3.35, 1.65, -3.15], look: [2.2, 1.05, -4.2], fov: 58 },
      portrait: { pos: [-2.8, 1.75, -3.0], look: [2.1, 1.1, -4.15], fov: 64 },
    },
    {
      // Wide loft: the sofa anchors the center while guitar, rain-lit skyline
      // and fireplace form a complete lived-in composition around it.
      desktop: { pos: [4.8, 2.2, 3.0], look: [0.15, 1.18, -3.35], fov: 58 },
      phoneLandscape: { pos: [4.4, 2.0, 2.7], look: [0.2, 1.2, -3.3], fov: 64 },
      portrait: { pos: [4.0, 2.3, 3.0], look: [0.25, 1.3, -3.3], fov: 68 },
    },
  ];

  function setSeat() {
    if (!shadowPolicyApplied) {
      // Engine-level defaults run after build(); re-assert the measured scene
      // policy here, on the engine's first seat application.
      setShadowPolicy(loft, mobile);
      shadowPolicyApplied = true;
    }
  }

  function update(elapsed, delta, state = {}) {
    if (!state.reducedMotion) rain.update(delta);
    const motion = state.reducedMotion ? 0 : 1;
    const slow = Math.sin(elapsed * 2.35) * motion;
    const quick = Math.sin(elapsed * 6.1 + 0.8) * motion;
    const flicker = 0.91 + slow * 0.045 + quick * 0.028;
    fire.uniforms.time.value = elapsed;
    fireLight.intensity = (mobile ? 3.2 : 5.1) * flicker;
    deskLight.intensity = (mobile ? 3.4 : 5.0) * (0.98 + Math.sin(elapsed * 0.72) * 0.015 * motion);
    if (deskBulbGlow) {
      deskBulbGlow.intensity = 1.75 * (0.985 + Math.sin(elapsed * 0.65) * 0.018 * motion);
    }
    animatedMaterials.candle.forEach((material, index) => {
      material.emissiveIntensity = 2.15 + Math.sin(elapsed * 5.4 + index * 1.7) * 0.28 * motion;
    });
    animatedMaterials.bulb.forEach((material) => {
      material.emissiveIntensity = (mobile ? 2.85 : 3.35) + Math.sin(elapsed * 0.65) * 0.1 * motion;
    });
    animatedMaterials.windows.forEach((material) => {
      material.emissiveIntensity = 1.38 + Math.sin(elapsed * 0.24) * 0.05 * motion;
    });
    animatedMaterials.laptop.forEach((material) => {
      material.emissiveIntensity = (mobile ? 0.66 : 0.78) + Math.sin(elapsed * 0.38) * 0.018 * motion;
    });
  }

  function dispose() {
    // The engine owns geometry/material/texture disposal for the whole scene.
  }

  return {
    seats,
    setSeat,
    update,
    dispose,
    exposure: mobile ? 1.14 : 1.16,
    bloom: { strength: 0.18, radius: 0.25, threshold: 0.94 },
  };
}
