// ============================================================
// Safe Haven WebGL engine — a small cinematic renderer.
// Real lighting, ACES tone mapping and bloom are what make the
// fire / sunset / city lights actually glow like the references.
// Loaded on demand (dynamic import) so app startup stays fast.
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Static imports: Electron's file://…app.asar cannot fetch dynamically
// imported chunks, so everything ships in one bundle.
import * as cabinScene from './scenes/cabin.js';
import * as beachScene from './scenes/beach.js';
import * as cityScene from './scenes/city.js';

const SCENES = {
  cabin: () => Promise.resolve(cabinScene),
  beach: () => Promise.resolve(beachScene),
  city: () => Promise.resolve(cityScene),
};

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

class HavenEngine {
  constructor() {
    this.mounted = false;
    this.renderer = null;
    this.composer = null;
    this.scene = null;
    this.camera = null;
    this.active = null;      // { seats, update, dispose }
    this.raf = 0;
    this.clock = new THREE.Clock();
    this.seat = 0;
    // camera pose interpolation
    this.pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.fromPose = null;
    this.toPose = null;
    this.transT = 1;         // 0..1 progress, 1 = done
    this.transDur = 2.0;
    // cursor parallax (radians offsets, smoothed)
    this.parYaw = 0; this.parPitch = 0; this.tYaw = 0; this.tPitch = 0;
    this._onMove = (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      this.tYaw = -nx * 0.055;
      this.tPitch = -ny * 0.035;
    };
    this._onResize = () => this.resize();
  }

  mount(container) {
    if (this.mounted) return;
    this.mobile = window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.mobile,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.35 : 2));
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    container.appendChild(this.renderer.domElement);
    this.container = container;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 0.78);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this._onResize);
    window.addEventListener('mousemove', this._onMove);
    this.mounted = true;
  }

  resize() {
    if (!this.mounted) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async setTheme(name) {
    this.disposeScene();
    const mod = await SCENES[name in SCENES ? name : 'cabin']();
    this.scene = new THREE.Scene();
    this.renderPass.scene = this.scene;
    this.active = mod.build({
      THREE,
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
      quality: { mobile: this.mobile },
    });
    if (this.active.bloom) {
      // scenes may tune bloom for their light level
      this.bloom.strength = this.active.bloom.strength ?? this.bloom.strength;
      this.bloom.radius = this.active.bloom.radius ?? this.bloom.radius;
      this.bloom.threshold = this.active.bloom.threshold ?? this.bloom.threshold;
    }
    this.clock.getDelta();
    this.setSeat(this.seat, true);
  }

  seatPose(i) {
    const s = this.active.seats[Math.min(i, this.active.seats.length - 1)] || this.active.seats[0];
    return {
      pos: new THREE.Vector3(...s.pos),
      look: new THREE.Vector3(...s.look),
    };
  }

  setSeat(i, instant) {
    if (!this.active) { this.seat = i; return; }
    this.seat = i;
    const target = this.seatPose(i);
    if (instant) {
      this.pose.pos.copy(target.pos);
      this.pose.look.copy(target.look);
      this.fromPose = null; this.toPose = null; this.transT = 1;
    } else {
      this.fromPose = { pos: this.pose.pos.clone(), look: this.pose.look.clone() };
      this.toPose = target;
      this.transT = 0;
    }
  }

  start() {
    if (this.raf) return;
    this.clock.getDelta();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;

      // seat transition
      if (this.transT < 1 && this.toPose) {
        this.transT = Math.min(1, this.transT + dt / this.transDur);
        const k = easeInOut(this.transT);
        this.pose.pos.lerpVectors(this.fromPose.pos, this.toPose.pos, k);
        this.pose.look.lerpVectors(this.fromPose.look, this.toPose.look, k);
      }

      // smooth cursor parallax + idle breathing
      this.parYaw += (this.tYaw - this.parYaw) * 0.045;
      this.parPitch += (this.tPitch - this.parPitch) * 0.045;
      const breatheY = Math.sin(t * 0.55) * 0.018;
      const breatheX = Math.sin(t * 0.37 + 1.7) * 0.01;

      this.camera.position.copy(this.pose.pos);
      this.camera.position.y += breatheY;
      this.camera.position.x += breatheX;
      this.camera.lookAt(this.pose.look);
      this.camera.rotateY(this.parYaw);
      this.camera.rotateX(this.parPitch);

      if (this.active && this.active.update) this.active.update(t, dt);
      this.composer.render();
    };
    tick();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  disposeScene() {
    if (this.active && this.active.dispose) { try { this.active.dispose(); } catch (_) {} }
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) {
          for (const k in m) { if (m[k] && m[k].isTexture) m[k].dispose(); }
          m.dispose && m.dispose();
        }
      });
    }
    this.active = null;
    this.scene = null;
  }

  destroy() {
    this.stop();
    this.disposeScene();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('mousemove', this._onMove);
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.composer = null; this.renderer = null; this.mounted = false;
  }
}

let engine = null;

export async function openHaven3D(container, theme, seat) {
  if (!engine) engine = new HavenEngine();
  engine.mount(container);
  engine.seat = seat || 0;
  await engine.setTheme(theme);
  engine.resize();
  engine.start();
  window.__hv = engine; // live-tuning/debug handle
  return engine;
}

export function closeHaven3D() {
  if (!engine) return;
  engine.destroy();
  engine = null;
}

export async function setHavenTheme3D(theme) {
  if (engine) await engine.setTheme(theme);
}

export function setHavenSeat3D(seat) {
  if (engine) engine.setSeat(seat, false);
}
