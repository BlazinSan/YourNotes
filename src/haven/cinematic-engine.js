import cabinUrl from './scene-assets/cabin-cinematic-v2.webp?url';
import beachUrl from './scene-assets/beach-cinematic-v2.webp?url';
import cityUrl from './scene-assets/city-cinematic-v2.webp?url';
import cabinView2 from './scene-assets/cabin-view-2.webp?url';
import cabinView3 from './scene-assets/cabin-view-3.webp?url';
import beachView2 from './scene-assets/beach-view-2.webp?url';
import beachView3 from './scene-assets/beach-view-3.webp?url';
import cityView2 from './scene-assets/city-view-2.webp?url';
import cityView3 from './scene-assets/city-view-3.webp?url';

const PLATES = {
  cabin: [cabinUrl, cabinView2, cabinView3],
  beach: [beachUrl, beachView2, beachView3],
  city: [cityUrl, cityView2, cityView3],
};

// Normalized effect anchors for each authored camera view. Keeping these per
// plate prevents weather/fire from drifting across furniture when an angle
// changes or a portrait phone crops the scene differently.
const FX = {
  cabin: [
    { rain: [[0.01, 0.02, 0.39, 0.94]], fire: [0.77, 0.59, 1.05], lamps: [[0.34, 0.72, .28], [0.72, 0.24, .18], [0.84, 0.24, .15]], mugs: [[0.61, .64], [.75, .65]] },
    { rain: [[0.01, 0.01, 0.32, 0.97]], fire: [0.65, 0.54, .9], lamps: [[.31, .78, .3], [.45, .28, .16], [.66, .2, .16]], mugs: [[.60, .63], [.76, .63]] },
    { rain: [[0.01, 0.01, 0.63, 0.56]], fire: [0.91, 0.61, 1], lamps: [[.24, .51, .22], [.67, .13, .16]], mugs: [[.49, .62], [.68, .64]] },
  ],
  city: [
    { rain: [[0.01, 0.01, 0.61, 0.61]], fire: [.91, .58, .85], lamps: [[.09, .51, .28], [.66, .44, .15]], mugs: [[.20, .70], [.72, .73]] },
    { rain: [[0.01, 0.01, 0.48, 0.59]], fire: [.70, .50, .78], lamps: [[.18, .33, .3], [.73, .25, .14]], mugs: [[.22, .67]] },
    { rain: [[0.26, 0.01, 0.54, 0.48]], fire: [.81, .48, .74], lamps: [[.13, .31, .24], [.65, .35, .13]], mugs: [[.36, .66]] },
  ],
  beach: [
    { waves: [.28, .43, .63, .28], lamps: [[.30, .69, .24], [.15, .28, .16]], mugs: [[.36, .73]] },
    { waves: [.01, .44, .56, .42], lamps: [[.77, .35, .17], [.62, .42, .13]], mugs: [[.72, .44]] },
    { waves: [.41, .40, .55, .29], lamps: [[.12, .30, .31], [.36, .52, .16]], mugs: [[.39, .54]] },
  ],
};

let host = null;
let shell = null;
let plate = null;
let canvas = null;
let ctx = null;
let theme = 'cabin';
let seat = 0;
let raf = 0;
let lastFrame = 0;
let elapsed = 0;
let reduced = false;
let mobile = false;
let pointerX = 0;
let pointerY = 0;
let currentX = 0;
let currentY = 0;
let particles = [];
let resizeObserver = null;
let viewRevision = 0;

function report(state, message = '') {
  window.dispatchEvent(new CustomEvent('haven-render-status', { detail: { state, message } }));
}

function preload(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(url);
    image.onerror = () => reject(new Error('The cinematic scenery could not be loaded.'));
    image.src = url;
  });
}

function resetParticles() {
  const count = mobile ? 45 : 90;
  particles = Array.from({ length: count }, (_, index) => ({
    x: Math.random(), y: Math.random(), speed: 0.18 + Math.random() * 0.42,
    size: 0.5 + Math.random() * 1.5, phase: index * 0.73 + Math.random() * 4,
  }));
}

function resize() {
  if (!host || !canvas) return;
  const rect = host.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, mobile ? 1.15 : 1.5);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function applyPose(instant = false) {
  if (!plate) return;
  plate.style.transition = instant || reduced ? 'none' : 'transform 900ms cubic-bezier(.2,.75,.2,1), object-position 900ms cubic-bezier(.2,.75,.2,1)';
  plate.style.objectPosition = '50% 50%';
  plate.dataset.zoom = '1.02';
}

async function setView(instant = false) {
  const revision = ++viewRevision;
  const url = (PLATES[theme] || PLATES.cabin)[seat] || PLATES[theme][0];
  await preload(url);
  // A newer theme/view owns the renderer now. This request was superseded, not
  // failed, so callers must not surface an error overlay for rapid user taps.
  if (!plate || revision !== viewRevision) return true;
  if (!instant) {
    shell.classList.add('is-travelling');
    await new Promise(resolve => setTimeout(resolve, reduced ? 0 : 240));
    if (!plate || revision !== viewRevision) return true;
  }
  plate.src = url;
  shell.dataset.theme = theme;
  applyPose(instant);
  requestAnimationFrame(() => shell?.classList.remove('is-travelling'));
  return true;
}

function drawRainRegion(w, h, dt, region) {
  const [rx, ry, rw, rh] = region;
  const left = rx * w, top = ry * h, width = rw * w, height = rh * h;
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
  ctx.lineCap = 'round';
  for (const p of particles) {
    p.y += p.speed * dt;
    if (p.y > 1.08) { p.y = -0.08; p.x = Math.random(); }
    const x = left + p.x * width, y = top + p.y * height;
    ctx.strokeStyle = `rgba(176,216,235,${0.075 + p.size * 0.038})`;
    ctx.lineWidth = Math.max(.55, p.size * .75);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 1.6, y + 7 + p.size * 4); ctx.stroke();
  }
  ctx.restore();
}

function drawLightPool(w, h, x, y, radiusScale, t, strength = 1) {
  const radius = Math.min(w, h) * radiusScale;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const pulse = (0.055 + Math.sin(t * 2.8) * 0.012 + Math.sin(t * 6.7) * .006) * strength;
  glow.addColorStop(0, `rgba(255,157,66,${pulse})`);
  glow.addColorStop(1, 'rgba(255,130,40,0)');
  ctx.fillStyle = glow; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function flamePath(x, y, size, phase, alpha, colour) {
  const sway = Math.sin(phase) * size * .12;
  const height = size * (.75 + .15 * Math.sin(phase * 1.7));
  ctx.beginPath();
  ctx.moveTo(x - size * .24, y);
  ctx.bezierCurveTo(x - size * .38, y - height * .3, x + sway - size * .08, y - height * .68, x + sway, y - height);
  ctx.bezierCurveTo(x + size * .11, y - height * .62, x + size * .35, y - height * .3, x + size * .24, y);
  ctx.closePath(); ctx.fillStyle = colour.replace('ALPHA', alpha.toFixed(3)); ctx.fill();
}

function drawFire(w, h, spec, t) {
  if (!spec) return;
  const [nx, ny, scale] = spec; const x = nx * w, y = ny * h;
  const s = Math.min(w, h) * .085 * scale;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  drawLightPool(w, h, x, y - s * .25, .18 * scale, t, 1.15);
  for (let i = 0; i < 7; i++) {
    const px = x + (i - 3) * s * .16;
    flamePath(px, y, s * (.52 + (i % 3) * .1), t * (3.5 + i * .17) + i,
      .13 + (i % 2) * .035, i % 3 === 0 ? 'rgba(255,238,135,ALPHA)' : 'rgba(255,106,24,ALPHA)');
  }
  for (let i = 0; i < 9; i++) {
    const life = (t * (.28 + i * .017) + i * .13) % 1;
    const sx = x + Math.sin(i * 8.1) * s * .55 + Math.sin(t * 2 + i) * 2;
    const sy = y - s * (.3 + life * 1.8);
    ctx.fillStyle = `rgba(255,178,65,${(1 - life) * .24})`;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(.6, s * .018), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawLamp(w, h, lamp, t, index) {
  const [nx, ny, scale] = lamp; const x = nx * w, y = ny * h;
  const s = Math.min(w, h) * .035 * scale;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  drawLightPool(w, h, x, y, .07 * scale, t + index, .7);
  flamePath(x, y + s * .35, s, t * 4.2 + index * 1.7, .22, 'rgba(255,216,116,ALPHA)');
  flamePath(x, y + s * .35, s * .55, t * 5.1 + index, .28, 'rgba(255,249,192,ALPHA)');
  ctx.restore();
}

function drawSteam(w, h, mug, t, index) {
  const [nx, ny] = mug; const x = nx * w, y = ny * h;
  const s = Math.min(w, h) * .032;
  ctx.save(); ctx.lineWidth = Math.max(.65, s * .035); ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const phase = t * .65 + i * .8 + index;
    const rise = (phase % 1) * s * 1.8;
    ctx.strokeStyle = `rgba(235,224,207,${.1 * (1 - (phase % 1))})`;
    ctx.beginPath(); ctx.moveTo(x + (i - 1) * s * .15, y - rise);
    ctx.bezierCurveTo(x + Math.sin(phase * 4) * s * .28, y - rise - s * .35,
      x - Math.cos(phase * 3) * s * .25, y - rise - s * .7, x + Math.sin(phase * 2) * s * .18, y - rise - s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaves(w, h, region, t) {
  if (!region) return;
  const [rx, ry, rw, rh] = region; const left = rx * w, top = ry * h;
  const width = rw * w, height = rh * h;
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
  for (let i = 0; i < 7; i++) {
    const progress = (i / 7 + t * .025) % 1;
    const y = top + progress * height;
    ctx.lineWidth = 1 + progress * 1.4;
    ctx.strokeStyle = `rgba(224,225,255,${.055 + progress * .075})`;
    ctx.beginPath();
    for (let px = 0; px <= width + 10; px += 10) {
      const yy = y + Math.sin(px * .025 + t * 1.45 + i) * (1.5 + progress * 2.8);
      if (px === 0) ctx.moveTo(left + px, yy); else ctx.lineTo(left + px, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (document.hidden || !host) return;
  const interval = mobile ? 33 : 22;
  if (now - lastFrame < interval) return;
  const dt = Math.min(0.05, (now - lastFrame || interval) / 1000);
  lastFrame = now; elapsed += dt;
  currentX += (pointerX - currentX) * 0.045;
  currentY += (pointerY - currentY) * 0.045;
  const zoom = Number(plate.dataset.zoom || 1.02);
  plate.style.transform = `translate3d(${currentX * -8}px,${currentY * -5}px,0) scale(${zoom + 0.018})`;
  const rect = host.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!reduced) {
    const fx = (FX[theme] || FX.cabin)[seat] || FX[theme][0];
    (fx.rain || []).forEach(region => drawRainRegion(rect.width, rect.height, dt, region));
    drawFire(rect.width, rect.height, fx.fire, elapsed);
    (fx.lamps || []).forEach((lamp, index) => drawLamp(rect.width, rect.height, lamp, elapsed, index));
    (fx.mugs || []).forEach((mug, index) => drawSteam(rect.width, rect.height, mug, elapsed, index));
    drawWaves(rect.width, rect.height, fx.waves, elapsed);
  }
}

function onPointer(event) {
  if (mobile || !host) return;
  const rect = host.getBoundingClientRect();
  pointerX = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
  pointerY = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
}

async function setTheme(next, instant = false) {
  theme = PLATES[next] ? next : 'cabin';
  resetParticles();
  return setView(instant);
}

export async function openHaven3D(container, initialTheme = 'cabin', initialSeat = 0) {
  closeHaven3D();
  host = container;
  theme = PLATES[initialTheme] ? initialTheme : 'cabin';
  seat = Math.max(0, Math.min(2, Number(initialSeat) || 0));
  mobile = matchMedia('(pointer: coarse)').matches;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  shell = document.createElement('div'); shell.className = 'haven-cinematic';
  plate = document.createElement('img'); plate.className = 'haven-cinematic-plate'; plate.alt = '';
  plate.draggable = false;
  canvas = document.createElement('canvas'); canvas.className = 'haven-cinematic-fx';
  shell.append(plate, canvas); host.replaceChildren(shell);
  ctx = canvas.getContext('2d', { alpha: true });
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host);
  host.addEventListener('pointermove', onPointer, { passive: true });
  resize(); resetParticles();
  await setTheme(theme, true);
  lastFrame = performance.now(); raf = requestAnimationFrame(tick);
  report('ready');
  return true;
}

export function closeHaven3D() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0; resizeObserver?.disconnect(); resizeObserver = null;
  host?.removeEventListener('pointermove', onPointer);
  if (host) host.replaceChildren();
  host = shell = plate = canvas = ctx = null; particles = [];
}

export async function setHavenTheme3D(next) { return setTheme(next, false); }
export function setHavenSeat3D(next) { seat = Math.max(0, Math.min(2, Number(next) || 0)); setView(false); }
export async function retryHaven3D() { return host ? setTheme(theme, true) : false; }
