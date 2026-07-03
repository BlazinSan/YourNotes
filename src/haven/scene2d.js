// ============================================================
// Safe Haven — premium 2.5D illustrated scenes.
// Hand-crafted animated canvas art (lofi / vector aesthetic) with
// depth parallax, per-seat framing and rich ambient animation.
// Same interface as the old WebGL engine so the controller is unchanged.
// ============================================================
const DW = 1600, DH = 1000;
let canvas = null, ctx = null, cw = 0, ch = 0, dpr = 1;
let raf = 0, startT = 0, mounted = false;
let theme = 'cabin', seat = 0;
let cam = { x: 0, y: 0, z: 1 }, camT = { x: 0, y: 0, z: 1 };
let par = { x: 0, y: 0 }, parT = { x: 0, y: 0 };
let state = {};

const rnd = (a, b) => a + Math.random() * (b - a);
const PARAMT = 26;

// Per-seat camera framings (pan in design px + zoom).
const SEATS = {
  beach: [{ x: 0, y: 30, z: 1.02 }, { x: -330, y: 70, z: 1.5 }, { x: 340, y: -20, z: 1.32 }],
  city:  [{ x: 0, y: 0, z: 1.0 }, { x: 250, y: 150, z: 1.55 }, { x: -280, y: -30, z: 1.34 }],
  cabin: [{ x: 0, y: 20, z: 1.04 }, { x: -320, y: 40, z: 1.55 }, { x: 330, y: 60, z: 1.42 }],
};

// ---------- helpers ----------
function lg(x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const s of stops) g.addColorStop(s[0], s[1]); return g; }
function rg(x, y, r0, r1, stops) { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); for (const s of stops) g.addColorStop(s[0], s[1]); return g; }
function fillR(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function glow(x, y, r, inner, outer, a) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = rg(x, y, 0, r, [[0, inner], [1, outer]]); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore(); }
function disc(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function L(depth, fn) { ctx.save(); ctx.translate(par.x * depth, par.y * depth); fn(); ctx.restore(); }
function blob(x, y, w, h) { ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w, y - h * 1.3, x + w, y - h * 1.3, x + w, y); ctx.closePath(); ctx.fill(); }

function makeStars(n, yMax, warm) {
  const a = [];
  for (let i = 0; i < n; i++) a.push({ x: rnd(-100, DW + 100), y: rnd(0, yMax), r: rnd(0.6, 2.0), ph: rnd(0, 7), a: rnd(0.4, 1), c: warm && Math.random() < 0.2 ? '#ffe6b0' : '#ffffff' });
  return a;
}
function starField(t, stars, depth) {
  L(depth, () => {
    for (const s of stars) { const tw = 0.5 + 0.5 * Math.sin(t * 1.8 + s.ph); ctx.globalAlpha = (0.25 + 0.7 * tw) * s.a; ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  });
}

// ---------------------------------------------------------------- BEACH
function drawPalm(x, y, s, lean) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#160e2a'; ctx.strokeStyle = '#160e2a';
  // trunk
  ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(lean * 40, -220, lean * 90, -400); ctx.stroke();
  // fronds
  const tx = lean * 90, ty = -400;
  const fronds = [[-1.1, -0.2], [-0.7, -0.9], [-0.1, -1.2], [0.5, -0.95], [1.0, -0.3], [1.15, 0.35], [-1.15, 0.3]];
  ctx.lineWidth = 10;
  for (const f of fronds) {
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + f[0] * 120, ty + f[1] * 70 - 40, tx + f[0] * 230, ty + f[1] * 110 + 30);
    ctx.stroke();
  }
  disc(tx, ty, 12, '#160e2a');
  ctx.restore();
}
function drawHut(x, y, t) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#140c26';
  // stilts
  for (const sx of [-70, -20, 30, 80]) { ctx.fillRect(sx, 60, 12, 130); }
  // body
  ctx.fillRect(-90, -40, 180, 110);
  // roof
  ctx.beginPath(); ctx.moveTo(-115, -40); ctx.lineTo(0, -120); ctx.lineTo(115, -40); ctx.closePath(); ctx.fill();
  // warm windows
  const flick = 0.85 + 0.15 * Math.sin(t * 3.1);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(255,150,70,${0.9 * flick})`;
  ctx.fillRect(-64, -10, 44, 56); ctx.fillRect(20, -10, 44, 56);
  ctx.restore();
  glow(-42, 16, 90, 'rgba(255,150,70,0.6)', 'rgba(255,120,40,0)', 0.7 * flick);
  glow(42, 16, 90, 'rgba(255,150,70,0.6)', 'rgba(255,120,40,0)', 0.7 * flick);
  // hanging lantern
  glow(120, -20, 46, 'rgba(255,180,90,0.9)', 'rgba(255,140,60,0)', 0.9 * flick);
  disc(120, -20, 7, '#ffd98a');
  ctx.restore();
}
function beach(t) {
  const sunX = DW * 0.63, sunY = DH * 0.5, seaY = DH * 0.575;
  // sky
  L(0.12, () => {
    ctx.fillStyle = lg(0, -100, 0, seaY, [[0, '#241a52'], [0.26, '#4a2870'], [0.48, '#8a3a74'], [0.68, '#c85a7a'], [0.85, '#f0925a'], [1, '#ffc179']]);
    ctx.fillRect(-300, -300, DW + 600, seaY + 300);
  });
  starField(t, state.stars, 0.16);
  // sun + glow + clouds
  L(0.22, () => {
    glow(sunX, sunY, 560, 'rgba(255,220,150,0.55)', 'rgba(255,150,90,0)', 1);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rg(sunX, seaY, 0, 760, [[0, 'rgba(255,200,130,0.4)'], [1, 'rgba(255,150,90,0)']]);
    ctx.fillRect(-300, seaY - 260, DW + 600, 340); ctx.restore();
    ctx.fillStyle = rg(sunX, sunY, 0, 118, [[0, '#fff6d8'], [0.5, '#ffd96b'], [0.9, '#ff9a44'], [1, 'rgba(255,150,70,0.6)']]);
    ctx.beginPath(); ctx.arc(sunX, sunY, 116, 0, 7); ctx.fill();
    for (const c of state.clouds) { const cx = ((c.x + t * c.sp) % (DW + 500)) - 250; ctx.globalAlpha = 0.55; ctx.fillStyle = '#e8895a'; ctx.beginPath(); ctx.ellipse(cx, c.y, c.w, c.w * 0.22, 0, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
  });
  // sea
  L(0.08, () => {
    ctx.fillStyle = lg(0, seaY, 0, DH, [[0, '#ec8f5e'], [0.12, '#c25e86'], [0.42, '#6a3f8e'], [1, '#28285c']]);
    ctx.fillRect(-300, seaY, DW + 600, DH - seaY + 300);
    // distant island
    ctx.fillStyle = '#3a2a5c'; ctx.beginPath(); ctx.moveTo(DW * 0.78, seaY); ctx.quadraticCurveTo(DW * 0.9, seaY - 34, DW * 1.02, seaY); ctx.closePath(); ctx.fill();
    // shimmering sun path (soft organic reflection, not a ladder)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const rows = 60;
    for (let i = 0; i < rows; i++) { const f = i / rows; const yy = seaY + f * (DH - seaY); const w = 30 + f * 190 + 30 * Math.sin(t * 2.4 + i * 0.7); const jit = 18 * Math.sin(t * 1.6 + i * 1.3); ctx.globalAlpha = 0.13 * (1 - f * 0.65); ctx.fillStyle = '#ffe0a0'; ctx.beginPath(); ctx.ellipse(sunX + jit, yy, w / 2, 4.2, 0, 0, 7); ctx.fill(); }
    ctx.restore(); ctx.globalAlpha = 1;
    // gentle wave lines
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) { const yy = seaY + 60 + i * 70; ctx.beginPath(); for (let xx = -100; xx <= DW + 100; xx += 40) ctx.lineTo(xx, yy + 5 * Math.sin(xx * 0.02 + t * 1.5 + i)); ctx.stroke(); }
  });
  // foreground: sand, rocks, hut, palms
  L(0.55, () => {
    ctx.fillStyle = lg(0, DH * 0.82, 0, DH, [[0, '#2c1c44'], [1, '#1a1030']]);
    ctx.beginPath(); ctx.moveTo(-300, DH * 0.9); ctx.quadraticCurveTo(DW * 0.28, DH * 0.8, DW * 0.52, DH * 0.94); ctx.lineTo(DW * 0.52, DH + 60); ctx.lineTo(-300, DH + 60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#150d28';
    for (const r of state.rocks) blob(r.x, r.y, r.w, r.h);
    drawHut(DW * 0.24, DH * 0.5, t);
    drawPalm(DW * 0.05, DH * 0.6, 1.05, 0.55);
    drawPalm(DW * 0.15, DH * 0.56, 0.85, 0.35);
  });
}

// ---------------------------------------------------------------- CITY (lofi window)
function drawSkyline(t) {
  // far mountains
  ctx.fillStyle = '#101a3e'; ctx.beginPath(); ctx.moveTo(-100, DH * 0.5);
  for (let x = -100; x <= DW + 100; x += 120) ctx.lineTo(x, DH * 0.46 + 30 * Math.sin(x * 0.01));
  ctx.lineTo(DW + 100, DH); ctx.lineTo(-100, DH); ctx.closePath(); ctx.fill();
  // building silhouettes with window lights
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const b of state.buildings) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.w, DH - b.y);
    ctx.globalCompositeOperation = 'lighter';
    for (const w of b.wins) { const on = w.tw ? (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + w.ph))) : w.on; if (on < 0.08) continue; ctx.globalAlpha = on; ctx.fillStyle = w.warm ? '#ffd487' : '#bfe0f2'; ctx.fillRect(b.x + w.x, b.y + w.y, 5, 7); }
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function city(t) {
  // night sky
  L(0.1, () => {
    ctx.fillStyle = lg(0, -100, 0, DH * 0.72, [[0, '#070f30'], [0.5, '#0e1c48'], [1, '#26346a']]);
    ctx.fillRect(-300, -300, DW + 600, DH + 300);
  });
  starField(t, state.stars, 0.14);
  // moon
  L(0.18, () => {
    const mx = DW * 0.3, my = DH * 0.2;
    glow(mx, my, 130, 'rgba(220,230,255,0.5)', 'rgba(220,230,255,0)', 0.8);
    disc(mx, my, 46, '#eef2ff'); ctx.fillStyle = '#0e1c48'; ctx.beginPath(); ctx.arc(mx + 18, my - 8, 44, 0, 7); ctx.fill();
  });
  // skyline (mid)
  L(0.24, () => drawSkyline(t));
  // warm lamp wash from the right (off-screen lamp)
  L(0.3, () => { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg(DW * 0.92, DH * 0.72, 0, 720, [[0, 'rgba(255,150,80,0.35)'], [1, 'rgba(255,120,50,0)']]); ctx.fillRect(DW * 0.4, DH * 0.3, DW * 0.7, DH * 0.7); ctx.restore(); });
  // window frame + curtains + sill (near)
  L(0.5, () => {
    // mullions (cream frame)
    ctx.fillStyle = '#e9e2d2';
    const fx = DW * 0.1, fy = -40, fw = DW * 0.8, fh = DH * 0.82;
    ctx.fillRect(fx - 26, fy, 26, fh); ctx.fillRect(fx + fw, fy, 26, fh);
    ctx.fillRect(fx - 26, fy + fh, fw + 52, 30);
    for (const px of [0.333, 0.666]) ctx.fillRect(fx + fw * px - 9, fy, 18, fh);
    ctx.fillRect(fx - 26, fy + fh * 0.5 - 8, fw + 52, 16);
    // curtains
    ctx.fillStyle = lg(0, 0, 240, 0, [[0, '#2a3560'], [1, 'rgba(42,53,96,0)']]);
    ctx.beginPath(); ctx.moveTo(-40, -60); ctx.quadraticCurveTo(150, DH * 0.4, 60, DH * 0.9); ctx.lineTo(-60, DH); ctx.lineTo(-60, -60); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(DW, 0); ctx.scale(-1, 1); ctx.fillStyle = lg(0, 0, 260, 0, [[0, '#3a2a3e'], [1, 'rgba(58,42,62,0)']]); ctx.beginPath(); ctx.moveTo(-40, -60); ctx.quadraticCurveTo(160, DH * 0.4, 70, DH * 0.9); ctx.lineTo(-60, DH); ctx.lineTo(-60, -60); ctx.closePath(); ctx.fill(); ctx.restore();
    // rain on glass
    ctx.strokeStyle = 'rgba(190,205,235,0.28)'; ctx.lineWidth = 2;
    for (const d of state.rain) { const y = (d.y + t * d.sp * 1000) % (DH + 120) - 60; ctx.beginPath(); ctx.moveTo(d.x, y); ctx.lineTo(d.x + 3, y + d.len); ctx.stroke(); }
    // windowsill
    ctx.fillStyle = lg(0, DH * 0.86, 0, DH, [[0, '#2a2338'], [1, '#171021']]);
    ctx.fillRect(-60, DH * 0.86, DW + 120, DH * 0.2);
    // warm glow pooling on the sill from the right
    glow(DW * 0.74, DH * 0.9, 360, 'rgba(255,160,90,0.4)', 'rgba(255,120,50,0)', 0.9);
    // open book
    ctx.save(); ctx.translate(DW * 0.34, DH * 0.9); ctx.rotate(-0.05);
    ctx.fillStyle = '#e8e2d2'; ctx.beginPath(); ctx.moveTo(-120, 0); ctx.quadraticCurveTo(0, -24, 120, 0); ctx.quadraticCurveTo(0, 14, -120, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(90,80,70,0.5)'; ctx.lineWidth = 1.5; for (let i = -90; i <= 90; i += 18) { ctx.beginPath(); ctx.moveTo(i * 0.7, -6 + Math.abs(i) * 0.03); ctx.lineTo(i * 0.7 + 40, -6 + Math.abs(i) * 0.03); ctx.stroke(); }
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(-6, -14, 12, 20); ctx.restore();
    // steaming cup (warm)
    ctx.save(); ctx.translate(DW * 0.6, DH * 0.885);
    ctx.fillStyle = '#c94f3a'; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.lineTo(20, 40); ctx.lineTo(-20, 40); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c94f3a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(30, 16, 14, -1.2, 1.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,220,220,0.35)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) { const ph = t * 1.3 + i * 2; ctx.beginPath(); ctx.moveTo(-8 + i * 8, -4); for (let k = 0; k < 5; k++) ctx.lineTo(-8 + i * 8 + 12 * Math.sin(ph + k * 0.9), -4 - k * 16); ctx.globalAlpha = 0.5 - i * 0.12; ctx.stroke(); } ctx.globalAlpha = 1; ctx.restore();
  });
}

// ---------------------------------------------------------------- CABIN (fireplace)
function brickWall() {
  ctx.fillStyle = lg(0, 0, 0, DH, [[0, '#4a2c16'], [0.5, '#6a3c1c'], [1, '#3a2010']]);
  ctx.fillRect(-300, -300, DW + 600, DH + 300);
  // bricks
  ctx.strokeStyle = 'rgba(20,10,4,0.5)'; ctx.lineWidth = 6;
  const bw = 150, bh = 78;
  for (let row = 0, y = -40; y < DH + 80; y += bh, row++) {
    const off = (row % 2) * (bw / 2);
    ctx.beginPath(); ctx.moveTo(-100, y); ctx.lineTo(DW + 100, y); ctx.stroke();
    for (let x = -100 + off; x < DW + 100; x += bw) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bh); ctx.stroke(); }
  }
}
function flame(cx, cy, w, h, t, ph, col) {
  const sway = Math.sin(t * 6 + ph) * 0.12 + Math.sin(t * 11 + ph) * 0.06;
  const flick = 1 + 0.16 * Math.sin(t * 9 + ph) + 0.1 * Math.sin(t * 15 + ph * 2);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(cx - w / 2, cy);
  ctx.bezierCurveTo(cx - w / 2, cy - h * 0.5, cx - w * 0.2 + sway * w, cy - h * flick, cx + sway * w * 1.5, cy - h * flick);
  ctx.bezierCurveTo(cx + w * 0.2 + sway * w, cy - h * flick, cx + w / 2, cy - h * 0.5, cx + w / 2, cy);
  ctx.quadraticCurveTo(cx, cy + h * 0.14, cx - w / 2, cy); ctx.fill(); ctx.restore();
}
function cabin(t) {
  const fx = DW * 0.5, hearthY = DH * 0.86, openY = DH * 0.36, openW = DW * 0.42, openH = DH * 0.5;
  // warm room fill behind
  L(0.05, () => { ctx.fillStyle = lg(0, 0, 0, DH, [[0, '#1c0f08'], [1, '#0c0704']]); ctx.fillRect(-300, -300, DW + 600, DH + 300); });
  // brick surround
  L(0.12, () => brickWall());
  // firebox opening (dark)
  L(0.18, () => {
    ctx.fillStyle = '#0a0604'; ctx.beginPath();
    const l = fx - openW / 2, r = fx + openW / 2;
    ctx.moveTo(l, hearthY); ctx.lineTo(l, openY + 60); ctx.quadraticCurveTo(fx, openY - 30, r, openY + 60); ctx.lineTo(r, hearthY); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rg(fx, hearthY - 40, 0, openW * 0.7, [[0, 'rgba(120,40,10,0.6)'], [1, 'rgba(60,20,6,0)']]); ctx.fill();
  });
  // fire
  L(0.2, () => {
    glow(fx, hearthY - 90, 520, 'rgba(255,150,60,0.6)', 'rgba(255,110,40,0)', 0.85 + 0.1 * Math.sin(t * 8));
    // logs
    ctx.fillStyle = '#2a1608'; ctx.save(); ctx.translate(fx, hearthY - 30);
    ctx.rotate(-0.12); ctx.fillRect(-150, 0, 300, 30); ctx.rotate(0.24); ctx.fillRect(-150, -18, 300, 30); ctx.restore();
    // andiron bars
    ctx.strokeStyle = '#0a0604'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(fx - 170, hearthY - 20); ctx.lineTo(fx - 170, hearthY - 90); ctx.moveTo(fx + 170, hearthY - 20); ctx.lineTo(fx + 170, hearthY - 90); ctx.stroke();
    // glowing burning-log cores at the base (so it reads as embers, not a candle)
    const base = hearthY - 24;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const lx of [-95, -32, 40, 100]) { ctx.fillStyle = rg(fx + lx, base - 4, 0, 62, [[0, 'rgba(255,175,80,0.7)'], [1, 'rgba(255,90,20,0)']]); ctx.beginPath(); ctx.ellipse(fx + lx, base - 4, 62, 22, 0, 0, 7); ctx.fill(); }
    ctx.restore();
    // flames (layered, asymmetric)
    flame(fx, base, 340, 300, t, 0.0, 'rgba(185,55,14,0.5)');
    flame(fx - 82, base, 175, 235, t, 1.3, 'rgba(255,110,30,0.55)');
    flame(fx + 72, base, 195, 265, t, 2.6, 'rgba(255,120,30,0.55)');
    flame(fx - 22, base, 135, 305, t, 0.7, 'rgba(255,160,55,0.6)');
    flame(fx + 30, base, 115, 260, t, 1.9, 'rgba(255,190,90,0.6)');
    flame(fx + 6, base - 34, 64, 175, t, 3.1, 'rgba(255,232,165,0.7)');
    // embers
    for (const e of state.embers) {
      const life = ((t * e.sp + e.ph) % 1);
      const y = base - life * 360; const x = fx + e.x + Math.sin(life * 6 + e.ph) * 24; const a = (1 - life) * 0.9;
      ctx.globalAlpha = a; ctx.fillStyle = life < 0.5 ? '#ffcf7a' : '#ff7a2a'; ctx.beginPath(); ctx.arc(x, y, e.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
  // hearth slab + mantel (foreground)
  L(0.34, () => {
    ctx.fillStyle = lg(0, hearthY, 0, DH, [[0, '#4a4038'], [1, '#2a221c']]); ctx.fillRect(-300, hearthY, DW + 600, DH - hearthY + 300);
    ctx.fillStyle = '#3a2414'; ctx.fillRect(fx - openW / 2 - 70, openY - 30, openW + 140, 34);
    // subtle warm garland on the mantel
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i <= 10; i++) { const x = fx - openW / 2 - 40 + i * ((openW + 80) / 10); const y = openY - 44 + 10 * Math.sin(i); const tw = 0.5 + 0.5 * Math.sin(t * 2 + i); ctx.globalAlpha = 0.5 + 0.5 * tw; disc(x, y, 5, i % 3 ? '#ffcf6b' : '#ff8a4a'); }
    ctx.restore(); ctx.globalAlpha = 1;
  });
}

const SCENES = { beach, city, cabin };

function buildScene() {
  state = {};
  if (theme === 'beach') {
    state.stars = makeStars(160, DH * 0.5, false);
    state.clouds = [{ x: 300, y: DH * 0.4, w: 120, sp: 6 }, { x: 900, y: DH * 0.33, w: 170, sp: 9 }, { x: 1300, y: DH * 0.46, w: 100, sp: 5 }];
    state.rocks = [{ x: DW * 0.1, y: DH * 0.95, w: 70, h: 46 }, { x: DW * 0.3, y: DH * 0.98, w: 110, h: 60 }, { x: DW * 0.02, y: DH * 0.88, w: 50, h: 34 }];
  } else if (theme === 'city') {
    state.stars = makeStars(150, DH * 0.44, false);
    state.rain = []; for (let i = 0; i < 130; i++) state.rain.push({ x: rnd(DW * 0.08, DW * 0.92), y: rnd(0, DH), len: rnd(14, 30), sp: rnd(0.6, 1.1) });
    state.buildings = [];
    let x = -60;
    while (x < DW + 60) {
      const w = rnd(70, 150), h = rnd(DH * 0.18, DH * 0.46), y = DH * 0.62 - h + rnd(-20, 20);
      const shade = ['#0c1430', '#0e1838', '#111c40'][(Math.random() * 3) | 0];
      const wins = [];
      for (let wy = 12; wy < (DH - y) - 10; wy += 20) for (let wx = 10; wx < w - 8; wx += 16) {
        const lit = Math.random(); wins.push({ x: wx, y: wy, warm: Math.random() < 0.7, tw: lit < 0.12, ph: rnd(0, 7), on: lit < 0.5 ? rnd(0.5, 0.95) : 0.05 });
      }
      state.buildings.push({ x, y, w, c: shade, wins }); x += w + rnd(2, 16);
    }
  } else {
    state.embers = []; for (let i = 0; i < 40; i++) state.embers.push({ x: rnd(-140, 140), r: rnd(1.5, 3.5), sp: rnd(0.25, 0.55), ph: rnd(0, 1) });
  }
}

function applySeat(instant) {
  const s = (SEATS[theme] || SEATS.cabin)[seat] || SEATS[theme][0];
  camT = { x: s.x, y: s.y, z: s.z };
  if (instant) cam = { ...camT };
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.parentElement.getBoundingClientRect();
  cw = r.width || window.innerWidth; ch = r.height || window.innerHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
}
function render(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.scale(dpr, dpr);
  const s = Math.max(cw / DW, ch / DH) * cam.z;
  ctx.translate(cw / 2, ch / 2); ctx.scale(s, s); ctx.translate(-DW / 2 - cam.x, -DH / 2 - cam.y);
  (SCENES[theme] || cabin)(t);
  ctx.restore();
  // vignette
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = rg(cw / 2, ch / 2, ch * 0.3, ch * 0.85, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.55)']]);
  ctx.fillRect(0, 0, cw, ch);
}
function loop(now) {
  raf = requestAnimationFrame(loop);
  const t = (now - startT) / 1000;
  cam.x += (camT.x - cam.x) * 0.05; cam.y += (camT.y - cam.y) * 0.05; cam.z += (camT.z - cam.z) * 0.05;
  par.x += (parT.x - par.x) * 0.05; par.y += (parT.y - par.y) * 0.05;
  render(t);
}

function onMove(e) { const nx = (e.clientX / window.innerWidth) * 2 - 1, ny = (e.clientY / window.innerHeight) * 2 - 1; parT.x = -nx * PARAMT; parT.y = -ny * PARAMT * 0.55; }
function onResize() { if (mounted) resize(); }

// ---------- public interface (matches the old engine) ----------
export async function openHaven3D(container, t, s) {
  theme = t || 'cabin'; seat = s || 0;
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  container.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize(); buildScene(); applySeat(true);
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMove);
  mounted = true; startT = performance.now(); loop(startT);
  window.__hv2 = { get theme() { return theme; }, get seat() { return seat; } };
}
export function closeHaven3D() {
  mounted = false; cancelAnimationFrame(raf); raf = 0;
  window.removeEventListener('resize', onResize); window.removeEventListener('mousemove', onMove);
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  canvas = null; ctx = null;
}
export async function setHavenTheme3D(t) { theme = t; buildScene(); applySeat(true); }
export function setHavenSeat3D(s) { seat = s; applySeat(false); }
