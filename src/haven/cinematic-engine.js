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

let host = null;
let shell = null;
let plate = null;
let depthPlate = null;
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
  if (depthPlate) depthPlate.style.transition = plate.style.transition;
}

async function setView(instant = false) {
  const revision = ++viewRevision;
  const url = (PLATES[theme] || PLATES.cabin)[seat] || PLATES[theme][0];
  await preload(url);
  if (!plate || revision !== viewRevision) return false;
  if (!instant) {
    shell.classList.add('is-travelling');
    await new Promise(resolve => setTimeout(resolve, reduced ? 0 : 240));
    if (!plate || revision !== viewRevision) return false;
  }
  plate.src = url;
  depthPlate.src = url;
  shell.dataset.theme = theme;
  applyPose(instant);
  requestAnimationFrame(() => shell?.classList.remove('is-travelling'));
  return true;
}

function drawRain(w, h, dt) {
  ctx.lineCap = 'round';
  for (const p of particles) {
    p.y += p.speed * dt;
    if (p.y > 1.08) { p.y = -0.08; p.x = Math.random(); }
    const x = p.x * w, y = p.y * h;
    ctx.strokeStyle = `rgba(170,210,230,${0.1 + p.size * 0.055})`;
    ctx.lineWidth = p.size;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2.5, y + 10 + p.size * 5); ctx.stroke();
  }
}

function drawGlow(w, h, t, beach = false) {
  const x = beach ? w * 0.57 : w * 0.76;
  const y = beach ? h * 0.58 : h * 0.63;
  const radius = Math.min(w, h) * (beach ? 0.23 : 0.18);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const pulse = 0.08 + Math.sin(t * 2.8) * 0.018;
  glow.addColorStop(0, `rgba(255,157,66,${pulse})`);
  glow.addColorStop(1, 'rgba(255,130,40,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
}

function drawBeach(w, h, t) {
  drawGlow(w, h, t, true);
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 5; i++) {
    const y = h * (0.5 + i * 0.027) + Math.sin(t * 0.8 + i) * 2;
    ctx.strokeStyle = `rgba(214,221,255,${0.07 - i * 0.008})`;
    ctx.beginPath();
    for (let x = w * 0.28; x < w * 0.9; x += 12) {
      const yy = y + Math.sin(x * 0.025 + t * 1.15 + i) * 2;
      if (x === Math.round(w * 0.28)) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
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
  if (depthPlate) depthPlate.style.transform = `translate3d(${currentX * -18}px,${currentY * -11}px,0) scale(${zoom + 0.034})`;
  const rect = host.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!reduced) {
    if (theme === 'cabin' || theme === 'city') drawRain(rect.width, rect.height, dt);
    if (theme === 'beach') drawBeach(rect.width, rect.height, elapsed);
    else drawGlow(rect.width, rect.height, elapsed, false);
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
  depthPlate = document.createElement('img'); depthPlate.className = 'haven-cinematic-depth'; depthPlate.alt = ''; depthPlate.draggable = false;
  canvas = document.createElement('canvas'); canvas.className = 'haven-cinematic-fx';
  shell.append(plate, depthPlate, canvas); host.replaceChildren(shell);
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
  host = shell = plate = depthPlate = canvas = ctx = null; particles = [];
}

export async function setHavenTheme3D(next) { return setTheme(next, false); }
export function setHavenSeat3D(next) { seat = Math.max(0, Math.min(2, Number(next) || 0)); setView(false); }
export async function retryHaven3D() { return host ? setTheme(theme, true) : false; }
