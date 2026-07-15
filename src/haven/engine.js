// ============================================================
// Safe Haven renderer.
//
// The scene modules combine authored assets with lightweight realtime effects.
// Built scenes are retained while the overlay is open so switching themes does
// not repeatedly parse and upload the same GLBs.
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Keep scene imports in this chunk. Electron loads the app from app.asar and
// must not depend on scene chunks being fetched after the engine has opened.
import * as cabinScene from './scenes/cabin.js';
import * as beachScene from './scenes/beach.js';
import * as cityScene from './scenes/city.js';

const SCENES = {
  cabin: () => Promise.resolve(cabinScene),
  beach: () => Promise.resolve(beachScene),
  city: () => Promise.resolve(cityScene),
};

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function disposeObjectTree(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const shadows = new Set();

  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    // LightShadow owns one or more renderer-backed targets after its first
    // shadow render. Forced retry/context recovery rebuilds a scene in-place,
    // so release those targets here instead of retaining them until the whole
    // WebGL renderer is destroyed.
    if (object.shadow?.dispose) shadows.add(object.shadow);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : (object.material ? [object.material] : []);
    for (const material of objectMaterials) {
      materials.add(material);
      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && value.isTexture) textures.add(value);
      }
      if (material.uniforms) {
        for (const uniform of Object.values(material.uniforms)) {
          const value = uniform && uniform.value;
          if (value && value.isTexture) textures.add(value);
        }
      }
    }
  });

  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  shadows.forEach((shadow) => shadow.dispose());
}

class HavenEngine {
  constructor() {
    this.mounted = false;
    this.renderer = null;
    this.composer = null;
    this.renderPass = null;
    this.bloom = null;
    this.outputPass = null;
    this.scene = null;
    this.camera = null;
    this.active = null;
    this.sceneCache = new Map();
    this.container = null;
    this.theme = 'cabin';
    this.seat = 0;
    this.layoutMode = 'desktop';
    this.mobile = false;
    this.contextLost = false;
    this.sceneRevision = 0;
    this.raf = 0;
    this.lastFrameMs = 0;
    this.lastTickMs = 0;
    this.elapsedSeconds = 0;
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.reducedMotionQuery.matches;

    this.pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 52 };
    this.fromPose = null;
    this.toPose = null;
    this.transT = 1;
    this.transDur = 1.05;

    this.parYaw = 0;
    this.parPitch = 0;
    this.tYaw = 0;
    this.tPitch = 0;

    this._onMove = (event) => {
      if (this.mobile || this.reducedMotion) return;
      const rect = this.container?.getBoundingClientRect();
      const width = rect?.width || window.innerWidth;
      const height = rect?.height || window.innerHeight;
      const nx = ((event.clientX - (rect?.left || 0)) / width) * 2 - 1;
      const ny = ((event.clientY - (rect?.top || 0)) / height) * 2 - 1;
      this.tYaw = -nx * 0.045;
      this.tPitch = -ny * 0.027;
    };
    this._onResize = () => this.resize();
    this._onVisibility = () => {
      if (document.hidden) this.stop();
      else if (this.mounted && !this.contextLost) this.start();
    };
    this._onMotionChange = (event) => {
      this.reducedMotion = event.matches;
      if (this.reducedMotion) {
        this.tYaw = 0;
        this.tPitch = 0;
      }
    };
    this._onContextLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.stop();
      this.container?.classList.add('haven-context-lost');
      window.dispatchEvent(new CustomEvent('haven-render-status', {
        detail: { state: 'context-lost', message: 'The calm scene paused. Tap retry to restore it.' },
      }));
    };
    this._onContextRestored = async () => {
      this.contextLost = false;
      this.container?.classList.remove('haven-context-lost');
      try {
        await this.setTheme(this.theme, true);
        this.resize();
        if (!document.hidden) this.start();
        window.dispatchEvent(new CustomEvent('haven-render-status', { detail: { state: 'ready' } }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent('haven-render-status', {
          detail: { state: 'error', message: 'The scene could not be restored.' },
        }));
      }
    };
  }

  detectMobile() {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const compact = Math.min(window.innerWidth, window.innerHeight) <= 600;
    return coarse || compact;
  }

  modeForSize(width, height) {
    if (height > width * 1.08) return 'portrait';
    return this.mobile ? 'phoneLandscape' : 'desktop';
  }

  pixelRatioForSize(width, height) {
    const longestSide = Math.max(width, height, 1);
    const maxBufferSide = this.mobile ? 1152 : 2560;
    const hardCap = this.mobile ? 1.25 : 1.75;
    const floor = this.mobile ? 0.85 : 1;
    return clamp(Math.min(window.devicePixelRatio || 1, hardCap, maxBufferSide / longestSide), floor, hardCap);
  }

  mount(container) {
    if (this.mounted) return;
    this.container = container;
    this.mobile = this.detectMobile();
    this.reducedMotion = this.reducedMotionQuery.matches;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.mobile,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    this.renderer.domElement.setAttribute('aria-label', 'Safe Haven scenery');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 450);

    // Mobile renders directly. Avoiding full-screen post-processing removes
    // several render targets and is the largest predictable phone GPU saving.
    if (!this.mobile) {
      this.composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(new THREE.Scene(), this.camera);
      this.gtao = new GTAOPass(this.renderPass.scene, this.camera, 1, 1);
      this.gtao.blendIntensity = 0.72;
      this.gtao.updateGtaoMaterial({ radius: 0.18, thickness: 1.25, distanceFallOff: 0.86, samples: 16 });
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.38, 0.9);
      this.outputPass = new OutputPass();
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.gtao);
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.outputPass);
    }

    this.renderer.domElement.addEventListener('webglcontextlost', this._onContextLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored, false);
    window.addEventListener('resize', this._onResize);
    if (!this.mobile) window.addEventListener('pointermove', this._onMove, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    this.reducedMotionQuery.addEventListener?.('change', this._onMotionChange);

    this.mounted = true;
    this.resize(false);
  }

  resize(reapplyPose = true) {
    if (!this.mounted || !this.renderer || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    const nextMode = this.modeForSize(width, height);
    const modeChanged = nextMode !== this.layoutMode;
    this.layoutMode = nextMode;

    const pixelRatio = this.pixelRatioForSize(width, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    if (this.active && reapplyPose && modeChanged) this.setSeat(this.seat, true);
  }

  async setTheme(name, force = false) {
    const nextTheme = Object.prototype.hasOwnProperty.call(SCENES, name) ? name : 'cabin';
    if (!force && this.active && nextTheme === this.theme) return true;
    this.theme = nextTheme;
    const revision = ++this.sceneRevision;

    if (force) this.disposeCachedTheme(nextTheme);
    const cached = this.sceneCache.get(nextTheme);
    if (cached) {
      if (!this.mounted || revision !== this.sceneRevision) return false;
      this.activateScene(nextTheme, cached);
      return true;
    }

    const mod = await SCENES[nextTheme]();
    if (!this.mounted || revision !== this.sceneRevision) return false;

    const nextScene = new THREE.Scene();
    const nextActive = await mod.build({
      THREE,
      scene: nextScene,
      renderer: this.renderer,
      camera: this.camera,
      quality: {
        mobile: this.mobile,
        reducedMotion: this.reducedMotion,
        layoutMode: this.layoutMode,
      },
    });
    if (!this.mounted || revision !== this.sceneRevision) {
      try { nextActive?.dispose?.(); } catch (_) {}
      disposeObjectTree(nextScene);
      return false;
    }

    const entry = { scene: nextScene, active: nextActive };
    this.sceneCache.set(nextTheme, entry);
    this.activateScene(nextTheme, entry);
    return true;
  }

  activateScene(theme, entry) {
    this.theme = theme;
    this.scene = entry.scene;
    this.active = entry.active;
    // Each authored scene owns its measured shadow policy. A blanket traversal
    // here used to turn sky domes, water, glass, and every high-poly prop into
    // shadow casters after the scene had deliberately disabled them.
    if (this.renderPass) this.renderPass.scene = entry.scene;
    if (this.gtao) this.gtao.scene = entry.scene;

    const sceneBloom = this.active?.bloom || {};
    if (this.bloom) {
      this.bloom.strength = clamp(sceneBloom.strength ?? 0.28, 0, 0.42);
      this.bloom.radius = clamp(sceneBloom.radius ?? 0.35, 0, 0.5);
      this.bloom.threshold = clamp(sceneBloom.threshold ?? 0.9, 0.82, 1);
    }
    this.renderer.toneMappingExposure = clamp(this.active?.exposure ?? 1.04, 0.82, 1.18);
    this.setSeat(this.seat, true);
  }

  seatPose(index) {
    const seats = this.active?.seats || [];
    const seat = seats[Math.min(index, Math.max(0, seats.length - 1))] || seats[0];
    if (!seat) return { pos: new THREE.Vector3(0, 1.4, 4), look: new THREE.Vector3(0, 1, -2), fov: 52 };
    const preset = seat[this.layoutMode] || seat.desktop || seat;
    return {
      pos: new THREE.Vector3(...preset.pos),
      look: new THREE.Vector3(...preset.look),
      fov: preset.fov ?? seat.fov ?? 52,
    };
  }

  setSeat(index, instant = false) {
    if (!this.active) {
      this.seat = index;
      return;
    }
    this.seat = clamp(index, 0, Math.max(0, this.active.seats.length - 1));
    const target = this.seatPose(this.seat);
    this.active.setSeat?.(this.seat, { instant, layoutMode: this.layoutMode });
    if (instant) {
      this.pose.pos.copy(target.pos);
      this.pose.look.copy(target.look);
      this.pose.fov = target.fov;
      this.camera.fov = target.fov;
      this.camera.updateProjectionMatrix();
      this.fromPose = null;
      this.toPose = null;
      this.transT = 1;
    } else {
      this.fromPose = {
        pos: this.pose.pos.clone(),
        look: this.pose.look.clone(),
        fov: this.pose.fov,
      };
      this.toPose = target;
      this.transT = 0;
    }
  }

  start() {
    if (this.raf || !this.mounted || this.contextLost || document.hidden) return;
    this.lastFrameMs = 0;
    this.lastTickMs = 0;
    const tick = (now) => {
      if (!this.mounted || this.contextLost || document.hidden) {
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(tick);
      // 120/144 Hz displays otherwise make the same calm animation cost twice
      // as much. Keep a stable upper bound of 60 rendered frames per second.
      if (this.lastFrameMs && now - this.lastFrameMs < 15.8) return;
      this.lastFrameMs = now;

      const dt = this.lastTickMs ? Math.min((now - this.lastTickMs) / 1000, 0.05) : 0;
      this.lastTickMs = now;
      this.elapsedSeconds += dt;
      const elapsed = this.elapsedSeconds;

      if (this.transT < 1 && this.toPose) {
        this.transT = Math.min(1, this.transT + dt / this.transDur);
        const amount = easeInOut(this.transT);
        this.pose.pos.lerpVectors(this.fromPose.pos, this.toPose.pos, amount);
        this.pose.look.lerpVectors(this.fromPose.look, this.toPose.look, amount);
        this.pose.fov = THREE.MathUtils.lerp(this.fromPose.fov, this.toPose.fov, amount);
        this.camera.fov = this.pose.fov;
        this.camera.updateProjectionMatrix();
      }

      this.parYaw += (this.tYaw - this.parYaw) * 0.055;
      this.parPitch += (this.tPitch - this.parPitch) * 0.055;
      const motion = this.reducedMotion ? 0 : 1;
      const breatheY = Math.sin(elapsed * 0.48) * 0.012 * motion;
      const breatheX = Math.sin(elapsed * 0.31 + 1.7) * 0.007 * motion;

      this.camera.position.copy(this.pose.pos);
      this.camera.position.y += breatheY;
      this.camera.position.x += breatheX;
      this.camera.lookAt(this.pose.look);
      if (motion) {
        this.camera.rotateY(this.parYaw);
        this.camera.rotateX(this.parPitch);
      }

      this.active?.update?.(elapsed, dt, { reducedMotion: this.reducedMotion });
      if (this.composer) this.composer.render();
      else if (this.scene) this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastFrameMs = 0;
    this.lastTickMs = 0;
  }

  disposeCachedTheme(theme) {
    const entry = this.sceneCache.get(theme);
    if (!entry) return;
    if (entry.active?.dispose) {
      try { entry.active.dispose(); } catch (_) {}
    }
    disposeObjectTree(entry.scene);
    this.sceneCache.delete(theme);
    if (this.scene === entry.scene) {
      this.active = null;
      this.scene = null;
    }
  }

  disposeAllScenes() {
    for (const theme of [...this.sceneCache.keys()]) this.disposeCachedTheme(theme);
    this.active = null;
    this.scene = null;
    if (this.renderPass) this.renderPass.scene = new THREE.Scene();
    if (this.gtao) this.gtao.scene = this.renderPass?.scene || new THREE.Scene();
  }

  async retry() {
    if (!this.mounted) return false;
    this.contextLost = false;
    this.container?.classList.remove('haven-context-lost');
    try {
      const ready = await this.setTheme(this.theme, true);
      if (ready) {
        this.resize();
        this.start();
      }
      return ready;
    } catch (_) {
      return false;
    }
  }

  destroy() {
    this.sceneRevision++;
    this.stop();
    this.disposeAllScenes();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onMove);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.reducedMotionQuery.removeEventListener?.('change', this._onMotionChange);

    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this._onContextLost, false);
      this.renderer.domElement.removeEventListener('webglcontextrestored', this._onContextRestored, false);
    }
    this.bloom?.dispose?.();
    this.outputPass?.dispose?.();
    this.composer?.dispose?.();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss?.();
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }

    this.container?.classList.remove('haven-context-lost');
    this.composer = null;
    this.renderPass = null;
    this.bloom = null;
    this.outputPass = null;
    this.renderer = null;
    this.camera = null;
    this.container = null;
    this.mounted = false;
  }
}

let engine = null;

export async function openHaven3D(container, theme, seat) {
  if (!engine) engine = new HavenEngine();
  // Capture the instance across the asynchronous scene import. closeHaven3D
  // can null the module singleton while that import is pending; using the
  // mutable global afterward could otherwise start a newer/hidden instance.
  const instance = engine;
  instance.mount(container);
  instance.seat = Number.isFinite(seat) ? seat : 0;
  const ready = await instance.setTheme(theme, true);
  if (!ready || engine !== instance || !instance.mounted) return false;
  instance.resize();
  instance.start();
  window.__hv = instance;
  return instance;
}

export function closeHaven3D() {
  if (!engine) return;
  engine.destroy();
  engine = null;
  delete window.__hv;
}

export async function setHavenTheme3D(theme) {
  if (!engine) return false;
  return engine.setTheme(theme);
}

export function setHavenSeat3D(seat) {
  engine?.setSeat(seat, false);
}

export async function retryHaven3D() {
  return engine?.retry() || false;
}
