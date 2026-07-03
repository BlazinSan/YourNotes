// ============================================================
// Safe Haven — premium 2.5D illustrated scenes.
// Dense, furnished lofi environments. Each theme has THREE
// hand-composed camera angles (spots) that cut between each other,
// not just zoom. Depth parallax, drifting clouds, animated fire /
// candles / rain / waves / steam, crossfade on spot & theme change.
// Same public interface as the old engine (controller unchanged).
// ============================================================
const DW = 1600, DH = 1000;
let canvas = null, ctx = null, cw = 0, ch = 0, dpr = 1;
let raf = 0, startT = 0, mounted = false;
let theme = 'cabin', spot = 0;
let par = { x: 0, y: 0 }, parT = { x: 0, y: 0 };
let state = {};
// crossfade: snapshot the previous frame, dissolve to the live scene
let snap = null, fade = 1, lastNow = 0;
let bloomC = null, noiseC = null;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const PARAMT = 16;

// ---------- illustration assets (drop-in) ----------
// Any image placed in ./scene-assets named <theme>-<spot>.jpg (e.g. cabin-0.jpg,
// beach-2.png) OR just <theme>.jpg (used for every spot) is used as the scene
// backdrop with animated overlays on top. Missing → procedural fallback.
const SCENE_URLS = (() => {
  const m = {};
  try {
    const g = import.meta.glob('./scene-assets/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' });
    for (const p in g) m[p.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()] = g[p];
  } catch (_) {}
  return m;
})();
const imgCache = {};
function sceneImage(th, sp) {
  const key = SCENE_URLS[`${th}-${sp}`] ? `${th}-${sp}` : (SCENE_URLS[th] ? th : null);
  if (!key) return null;
  if (!imgCache[key]) { const im = new Image(); im.src = SCENE_URLS[key]; imgCache[key] = im; }
  const im = imgCache[key];
  return im.complete && im.naturalWidth ? im : null;
}
// per-theme overlay effects layered on a still illustration
const FX = {
  cabin: { fx: 0.5, fy: 0.55, flicker: true, dust: true },
  beach: { fx: 0.5, fy: 0.52, shimmer: true, dust: false },
  city: { fx: 0.5, fy: 0.42, rain: true, dust: true },
};

// ---------- low-level helpers ----------
function lg(x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s[0])), s[1]); return g; }
function rg(x, y, r0, r1, stops) { const g = ctx.createRadialGradient(x, y, r0, x, y, Math.max(r0 + 0.1, r1)); for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s[0])), s[1]); return g; }
function glow(x, y, r, inner, outer, a) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = rg(x, y, 0, r, [[0, inner], [1, outer]]); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore(); }
function disc(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function L(depth, fn) { ctx.save(); ctx.translate(par.x * depth, par.y * depth); fn(); ctx.restore(); }
// blurred filter helper (Chromium supports ctx.filter)
function blurred(px, fn) { ctx.save(); ctx.filter = `blur(${px}px)`; fn(); ctx.restore(); }
// soft contact / drop shadow under an object
function softShadow(x, y, rx, ry, a) { blurred(Math.max(6, rx * 0.14), () => { ctx.fillStyle = `rgba(0,0,0,${a == null ? 0.4 : a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); }); }
// volumetric light shaft from a source point spreading downward
function godray(sx, sy, ex0, ex1, len, col, a) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.filter = 'blur(24px)'; ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(sx, sy, sx, sy + len); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx - 10, sy); ctx.lineTo(sx + 10, sy); ctx.lineTo(ex1, sy + len); ctx.lineTo(ex0, sy + len); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// drifting dust motes / glints inside warm light
function dust(t, list, cx, cy, rad, col) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const d of list) {
    const px = cx + Math.sin(t * d.sx + d.ph) * rad * d.ox;
    const py = cy + Math.cos(t * d.sy + d.ph) * rad * d.oy - (t * d.rise % (rad * 2)) + rad;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + d.ph));
    ctx.globalAlpha = d.a * tw; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, d.r, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function makeDust(n) { const a = []; for (let i = 0; i < n; i++) a.push({ ox: rnd(-1, 1), oy: rnd(-1, 1), sx: rnd(0.2, 0.6), sy: rnd(0.2, 0.6), rise: rnd(20, 60), ph: rnd(0, 7), r: rnd(0.8, 2.4), a: rnd(0.15, 0.5) }); return a; }

// ---------- shared building-block props ----------
function starField(t, stars, depth) {
  L(depth, () => {
    for (const s of stars) { const tw = 0.5 + 0.5 * Math.sin(t * 1.8 + s.ph); ctx.globalAlpha = (0.25 + 0.7 * tw) * s.a; ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  });
}
function makeStars(n, y0, y1, warm) {
  const a = [];
  for (let i = 0; i < n; i++) a.push({ x: rnd(-200, DW + 200), y: rnd(y0, y1), r: rnd(0.6, 2.1), ph: rnd(0, 7), a: rnd(0.4, 1), c: warm && Math.random() < 0.25 ? '#ffe6b0' : '#ffffff' });
  return a;
}
// puffy drifting cloud band
function clouds(t, list, color, alpha) {
  ctx.save(); ctx.globalAlpha = alpha;
  for (const c of list) {
    const cx = ((c.x + t * c.sp) % (DW + 900)) - 450;
    ctx.fillStyle = color;
    for (const p of c.puffs) { ctx.beginPath(); ctx.ellipse(cx + p[0], c.y + p[1], p[2], p[2] * 0.62, 0, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}
function makeClouds(n, y0, y1, wmin, wmax) {
  const a = [];
  for (let i = 0; i < n; i++) {
    const w = rnd(wmin, wmax), puffs = [];
    const k = 3 + (Math.random() * 3 | 0);
    for (let j = 0; j < k; j++) puffs.push([rnd(-w, w), rnd(-w * 0.12, w * 0.12), rnd(w * 0.4, w * 0.75)]);
    a.push({ x: rnd(0, DW), y: rnd(y0, y1), sp: rnd(3, 9) * (Math.random() < 0.5 ? 1 : -1), puffs });
  }
  return a;
}
function moon(x, y, r, crescent, col) {
  glow(x, y, r * 3.0, (col || 'rgba(225,235,255,0.5)'), 'rgba(225,235,255,0)', 0.8);
  disc(x, y, r, col ? '#fff3d8' : '#eef2ff');
  if (crescent) { ctx.fillStyle = 'rgba(10,20,60,0.9)'; ctx.beginPath(); ctx.arc(x + r * 0.42, y - r * 0.2, r * 0.96, 0, 7); ctx.fill(); }
}
// detailed skyline: back-to-front building rows with window grids
function skyline(t, x0, x1, baseY, rows) {
  for (const row of rows) {
    let x = x0 - 40;
    ctx.save();
    for (const b of row.b) {
      ctx.fillStyle = row.c; ctx.fillRect(x, baseY - b.h, b.w, b.h + 400);
      // windows
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const w of b.win) { const on = w.tw ? (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2 + w.ph))) : w.on; if (on < 0.06) continue; ctx.globalAlpha = on * row.wa; ctx.fillStyle = w.warm ? '#ffd487' : '#bfe6ff'; ctx.fillRect(x + w.x, baseY - b.h + w.y, row.ws, row.ws * 1.3); }
      ctx.restore();
      x += b.w + row.gap;
    }
    ctx.restore();
  }
}
function makeSkyline(x0, x1, palette) {
  // 3 depth rows (far dim -> near bright)
  const rows = [];
  const specs = [
    { c: palette[0], wa: 0.5, ws: 3, gap: 8, hmin: 120, hmax: 260, wmin: 50, wmax: 90 },
    { c: palette[1], wa: 0.8, ws: 4, gap: 10, hmin: 200, hmax: 420, wmin: 70, wmax: 130 },
    { c: palette[2], wa: 1.0, ws: 5, gap: 14, hmin: 120, hmax: 300, wmin: 90, wmax: 170 },
  ];
  for (const s of specs) {
    const b = [];
    let x = x0 - 40;
    while (x < x1 + 80) {
      const w = rnd(s.wmin, s.wmax), h = rnd(s.hmin, s.hmax), win = [];
      for (let wy = 14; wy < h - 10; wy += s.ws * 3) for (let wx = 8; wx < w - 8; wx += s.ws * 3) {
        const lit = Math.random(); win.push({ x: wx, y: wy, warm: Math.random() < 0.72, tw: lit < 0.14, ph: rnd(0, 7), on: lit < 0.5 ? rnd(0.4, 0.95) : 0.04 });
      }
      b.push({ w, h, win }); x += w + s.gap;
    }
    rows.push({ ...s, b });
  }
  return rows;
}

// warm animated flame (reused by fireplace + candles)
function flame(cx, cy, w, h, t, ph, col) {
  const sway = Math.sin(t * 6 + ph) * 0.12 + Math.sin(t * 11 + ph) * 0.06;
  const flick = 1 + 0.16 * Math.sin(t * 9 + ph) + 0.1 * Math.sin(t * 15 + ph * 2);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(cx - w / 2, cy);
  ctx.bezierCurveTo(cx - w / 2, cy - h * 0.5, cx - w * 0.2 + sway * w, cy - h * flick, cx + sway * w * 1.5, cy - h * flick);
  ctx.bezierCurveTo(cx + w * 0.2 + sway * w, cy - h * flick, cx + w / 2, cy - h * 0.5, cx + w / 2, cy);
  ctx.quadraticCurveTo(cx, cy + h * 0.14, cx - w / 2, cy); ctx.fill(); ctx.restore();
}
function candle(x, y, s, t, ph) {
  ctx.fillStyle = '#e8ddc4'; ctx.fillRect(x - 4 * s, y, 8 * s, 20 * s);
  glow(x, y - 6 * s, 30 * s, 'rgba(255,180,90,0.9)', 'rgba(255,140,60,0)', 0.8);
  flame(x, y - 2 * s, 9 * s, 26 * s, t, ph || x, 'rgba(255,180,80,0.85)');
  flame(x, y - 2 * s, 4 * s, 16 * s, t, (ph || x) + 1, 'rgba(255,240,190,0.9)');
}
// burning fire bed (logs + layered flames + embers) centered at (cx, baseY)
function fireBed(cx, baseY, scale, t, embers) {
  ctx.save(); ctx.translate(cx, baseY); ctx.scale(scale, scale);
  glow(0, -70, 360, 'rgba(255,150,60,0.45)', 'rgba(255,110,40,0)', 0.5 + 0.08 * Math.sin(t * 8));
  // logs
  ctx.fillStyle = '#341a0a'; ctx.save(); ctx.rotate(-0.1); ctx.fillRect(-140, -6, 280, 26); ctx.rotate(0.2); ctx.fillRect(-140, -22, 280, 26); ctx.restore();
  ctx.strokeStyle = '#0a0604'; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(-150, 8); ctx.lineTo(-150, -60); ctx.moveTo(150, 8); ctx.lineTo(150, -60); ctx.stroke();
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const lx of [-84, -28, 36, 92]) { ctx.fillStyle = rg(lx, -6, 0, 56, [[0, 'rgba(255,175,80,0.7)'], [1, 'rgba(255,90,20,0)']]); ctx.beginPath(); ctx.ellipse(lx, -6, 56, 20, 0, 0, 7); ctx.fill(); }
  ctx.restore();
  flame(0, -18, 300, 270, t, 0, 'rgba(185,55,14,0.5)');
  flame(-74, -18, 158, 210, t, 1.3, 'rgba(255,110,30,0.55)');
  flame(66, -18, 176, 235, t, 2.6, 'rgba(255,120,30,0.55)');
  flame(-18, -18, 120, 275, t, 0.7, 'rgba(255,160,55,0.6)');
  flame(28, -18, 104, 235, t, 1.9, 'rgba(255,190,90,0.6)');
  flame(6, -48, 58, 160, t, 3.1, 'rgba(255,232,165,0.7)');
  if (embers) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (const e of embers) { const life = ((t * e.sp + e.ph) % 1); const y = -18 - life * 320; const x = e.x + Math.sin(life * 6 + e.ph) * 22; ctx.globalAlpha = (1 - life) * 0.9; ctx.fillStyle = life < 0.5 ? '#ffcf7a' : '#ff7a2a'; ctx.beginPath(); ctx.arc(x, y, e.r, 0, 7); ctx.fill(); } ctx.restore(); }
  ctx.restore();
}
// stone fireplace surround with opening; draws fire inside
function stoneFireplace(x, y, w, h, t, embers) {
  ctx.save(); ctx.translate(x, y);
  // stone body (warm, cozy — lit by the fire)
  ctx.fillStyle = lg(0, 0, 0, h, [[0, '#5f4632'], [1, '#33241a']]); ctx.fillRect(-w * 0.12, -h * 0.14, w * 1.24, h * 1.2);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg(w / 2, h * 0.7, 0, w * 0.9, [[0, 'rgba(255,150,80,0.28)'], [1, 'rgba(255,120,60,0)']]); ctx.fillRect(-w * 0.12, -h * 0.14, w * 1.24, h * 1.2); ctx.restore();
  // individual bevelled stones (mortar + highlight + shadow = depth)
  const sw = 92, sh = 44;
  for (let ry = -h * 0.1, r = 0; ry < h * 1.05; ry += sh, r++) {
    for (let rx = -w * 0.12 + (r % 2) * (sw / 2) - sw; rx < w * 1.12; rx += sw) {
      const jx = ((r * 7 + rx) % 11) - 5;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(rx + 2, ry + 2, sw - 4, sh - 4, 8); ctx.fill();       // mortar/shadow
      const tone = 0.5 + ((r + (rx | 0)) % 3) * 0.12;
      ctx.fillStyle = `rgba(${112 * tone | 0},${84 * tone | 0},${60 * tone | 0},1)`; rrect(rx + 4 + jx, ry + 4, sw - 10, sh - 9, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,180,0.14)'; rrect(rx + 4 + jx, ry + 4, sw - 10, 4, 3); ctx.fill();  // top light
    }
  }
  // opening
  ctx.fillStyle = '#0b0705'; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * 0.28); ctx.quadraticCurveTo(w / 2, -h * 0.02, w, h * 0.28); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  // inner opening ambient
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg(w / 2, h * 0.85, 0, w * 0.6, [[0, 'rgba(255,140,70,0.3)'], [1, 'rgba(255,110,50,0)']]); ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * 0.28); ctx.quadraticCurveTo(w / 2, -h * 0.02, w, h * 0.28); ctx.lineTo(w, h); ctx.closePath(); ctx.fill(); ctx.restore();
  // mantel (bevelled wood beam)
  ctx.fillStyle = lg(0, -h * 0.2, 0, -h * 0.2 + 30, [[0, '#5a3a20'], [1, '#2e1c0e']]); rrect(-w * 0.22, -h * 0.2, w * 1.44, 30, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,220,160,0.16)'; ctx.fillRect(-w * 0.22, -h * 0.2, w * 1.44, 3);
  ctx.restore();
  fireBed(x + w / 2, y + h * 0.9, (w / 420), t, embers);
}
function pottedPlant(x, y, s, kind) {
  softShadow(x, y + 46 * s, 40 * s, 12 * s, 0.4);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  // pot
  ctx.fillStyle = '#b5643c'; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.lineTo(20, 44); ctx.lineTo(-20, 44); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c9754a'; ctx.fillRect(-30, -6, 60, 10);
  // foliage
  const leaf = kind === 'palm' ? '#2f6a3a' : '#356b3e';
  ctx.strokeStyle = leaf; ctx.lineWidth = 7; ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.32; const len = 60 + (i % 2) * 26; ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(Math.cos(a) * len * 0.6, -Math.abs(Math.sin(a)) * len * 0.7 - 20, Math.cos(a) * len, -Math.abs(Math.sin(a)) * len); ctx.stroke(); }
  ctx.fillStyle = leaf; for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.32; const len = 60 + (i % 2) * 26; ctx.beginPath(); ctx.ellipse(Math.cos(a) * len, -Math.abs(Math.sin(a)) * len, 14, 8, a, 0, 7); ctx.fill(); }
  ctx.restore();
}
function rug(x, y, w, h, palette) {
  softShadow(x, y + 6, w * 0.52, h * 0.55, 0.35);
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, 7); ctx.clip();
  ctx.fillStyle = palette[0]; ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, 7); ctx.fill();
  // border band
  ctx.lineWidth = w * 0.05; ctx.strokeStyle = palette[2] || palette[1]; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.44, h * 0.44, 0, 0, 7); ctx.stroke();
  // inner field
  ctx.fillStyle = palette[1]; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.38, h * 0.38, 0, 0, 7); ctx.fill();
  // diamond motifs
  ctx.fillStyle = palette[2] || palette[0];
  for (let a = 0; a < 7; a++) { const ang = a / 7 * Math.PI * 2; const rx = Math.cos(ang) * w * 0.26, ry = Math.sin(ang) * h * 0.26; ctx.save(); ctx.translate(rx, ry); ctx.rotate(Math.PI / 4); ctx.fillRect(-w * 0.022, -w * 0.022, w * 0.044, w * 0.044); ctx.restore(); }
  ctx.fillStyle = palette[0]; ctx.save(); ctx.rotate(Math.PI / 4); ctx.fillRect(-w * 0.04, -w * 0.04, w * 0.08, w * 0.08); ctx.restore();
  // soft sheen
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg(0, -h * 0.1, 0, w * 0.5, [[0, 'rgba(255,220,170,0.12)'], [1, 'rgba(255,200,150,0)']]); ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function floorLamp(x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -190); ctx.stroke();
  ctx.fillStyle = '#e8c98a'; ctx.beginPath(); ctx.moveTo(-40, -230); ctx.lineTo(40, -230); ctx.lineTo(28, -186); ctx.lineTo(-28, -186); ctx.closePath(); ctx.fill();
  glow(0, -210, 150, 'rgba(255,210,130,0.6)', 'rgba(255,180,90,0)', 0.8);
  ctx.restore();
}
function bookshelf(x, y, w, h, books) {
  softShadow(x + w / 2, y + 8, w * 0.6, 22, 0.5);
  ctx.save(); ctx.translate(x, y);
  // frame with wood shading
  ctx.fillStyle = lg(0, -h, 0, 0, [[0, '#4a3320'], [1, '#2e2013']]); ctx.fillRect(-12, -h - 6, w + 24, h + 12);
  ctx.fillStyle = '#160e07'; ctx.fillRect(0, -h, w, h);   // dark interior
  const shelfH = h / books.length;
  for (let r = 0; r < books.length; r++) {
    const sy = -h + r * shelfH;
    // back shadow of shelf
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, sy, w, 8);
    let bx = 5;
    for (const bk of books[r]) {
      if (bx + bk.w > w - 4) break;
      const bh = bk.h * (shelfH - 12), by = sy + shelfH - 8 - bh;
      const lean = bk.lean || 0;
      ctx.save(); ctx.translate(bx + bk.w / 2, sy + shelfH - 8); ctx.rotate(lean);
      ctx.fillStyle = bk.c; ctx.fillRect(-bk.w / 2, -bh, bk.w, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(-bk.w / 2, -bh, bk.w * 0.28, bh);   // spine highlight
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(bk.w * 0.32, -bh, bk.w * 0.18, bh);        // spine shadow
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(-bk.w / 2, -bh, bk.w, 3);              // top edge
      if (bk.band) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-bk.w / 2, -bh * 0.5, bk.w, 4); }
      ctx.restore();
      bx += bk.w + 2;
    }
    // shelf plank + lip shadow
    ctx.fillStyle = '#3a2818'; ctx.fillRect(0, sy + shelfH - 8, w, 8);
    ctx.fillStyle = 'rgba(255,220,160,0.12)'; ctx.fillRect(0, sy + shelfH - 8, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, sy + shelfH, w, 5);
  }
  ctx.restore();
}
function makeBooks(rows) {
  const cols = ['#8a3b34', '#c98a3a', '#3a6a5a', '#6a4a8a', '#3a5a8a', '#a0654a', '#4a7a4a', '#7a3a4a', '#d0a860'];
  const b = [];
  for (let r = 0; r < rows; r++) { const row = []; for (let i = 0; i < 26; i++) row.push({ w: rnd(10, 22), h: rnd(0.68, 0.98), c: pick(cols), lean: Math.random() < 0.12 ? rnd(-0.14, 0.14) : 0, band: Math.random() < 0.3 }); b.push(row); }
  return b;
}
function windowView(x, y, w, h, drawInside, frameCol) {
  ctx.save();
  // glass region clip
  ctx.save(); rrect(x, y, w, h, 10); ctx.clip(); drawInside(x, y, w, h); ctx.restore();
  // frame
  ctx.strokeStyle = frameCol || '#2b3350'; ctx.lineWidth = 16; rrect(x, y, w, h, 10); ctx.stroke();
  ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h * 0.5); ctx.lineTo(x + w, y + h * 0.5); ctx.stroke();
  ctx.restore();
}
function curtain(x, yTop, h, w, col, flip) {
  ctx.save(); ctx.translate(x, yTop); if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = lg(0, 0, w, 0, [[0, col], [1, 'rgba(0,0,0,0.05)']]);
  ctx.beginPath(); ctx.moveTo(0, 0);
  for (let yy = 0; yy <= h; yy += 30) ctx.lineTo(w * (0.5 + 0.5 * Math.abs(Math.sin(yy * 0.03))), yy);
  ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function shade(dark) { return `rgba(0,0,0,${dark})`; }
function sofa(x, y, s, flip, body, pillows, cat) {
  softShadow(x, y + 10 * s, 240 * s, 46 * s, 0.5);
  ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -s : s, s);
  // back cushion (tall, behind)
  ctx.fillStyle = body; rrect(-150, -185, 300, 135, 26); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.1)'; rrect(-150, -185, 300, 34, 26); ctx.fill();  // top light
  ctx.strokeStyle = shade(0.16); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -175); ctx.lineTo(0, -70); ctx.stroke(); // cushion seam
  // seat
  ctx.fillStyle = body; rrect(-160, -80, 320, 80, 20); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; rrect(-160, -80, 320, 20, 20); ctx.fill();
  ctx.fillStyle = shade(0.2); rrect(-160, -20, 320, 24, 12); ctx.fill();
  // arms (in front)
  for (const ax of [-176, 116]) { ctx.fillStyle = body; rrect(ax, -150, 62, 156, 22); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; rrect(ax, -150, 62, 26, 22); ctx.fill(); }
  // pillows
  let px = -78;
  for (const pc of pillows) { ctx.save(); ctx.translate(px, -96); ctx.rotate(-0.15); ctx.fillStyle = pc; rrect(-34, -34, 68, 68, 14); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; rrect(-34, -34, 68, 20, 14); ctx.fill(); ctx.restore(); px += 84; }
  ctx.restore();
  if (cat) { ctx.save(); ctx.translate(x + (flip ? -60 : 60) * s, y - 88 * s); ctx.scale(s, s); ctx.fillStyle = '#161616'; ctx.beginPath(); ctx.ellipse(0, 0, 24, 20, 0, 0, 7); ctx.fill(); disc(8, -22, 16, '#161616'); ctx.beginPath(); ctx.moveTo(-2, -36); ctx.lineTo(4, -22); ctx.lineTo(-10, -26); ctx.closePath(); ctx.moveTo(20, -36); ctx.lineTo(16, -22); ctx.lineTo(28, -26); ctx.closePath(); ctx.fill(); disc(4, -24, 2.6, '#8fe36b'); disc(14, -24, 2.6, '#8fe36b'); ctx.restore(); }
}
function armchair(x, y, s, flip, body) {
  softShadow(x, y + 10 * s, 150 * s, 40 * s, 0.5);
  ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -s : s, s);
  // back
  ctx.fillStyle = body; rrect(-84, -190, 168, 150, 28); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; rrect(-84, -190, 168, 34, 28); ctx.fill();
  // seat
  ctx.fillStyle = body; rrect(-96, -78, 192, 78, 20); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; rrect(-96, -78, 192, 18, 20); ctx.fill();
  ctx.fillStyle = shade(0.2); rrect(-96, -22, 192, 22, 12); ctx.fill();
  // arms
  for (const ax of [-112, 72]) { ctx.fillStyle = body; rrect(ax, -150, 44, 150, 18); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; rrect(ax, -150, 44, 22, 18); ctx.fill(); }
  ctx.restore();
}
function personReading(x, y, s, warmFromRight) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#241a2a';
  rrect(-46, -150, 92, 150, 22); ctx.fill();            // torso
  disc(0, -172, 30, '#2a2030');                          // head
  ctx.fillStyle = '#b83a2e'; rrect(-52, -120, 104, 80, 20); ctx.fill(); // hoodie
  disc(0, -172, 30, '#2a2030');
  // glowing page
  ctx.save(); ctx.translate(28, -96); ctx.rotate(-0.2); ctx.fillStyle = '#f3ead2'; rrect(-30, -22, 60, 44, 4); ctx.fill(); glow(0, 0, 60, 'rgba(255,235,190,0.5)', 'rgba(255,220,150,0)', 0.6); ctx.restore();
  // warm rim light
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = warmFromRight ? 'rgba(255,170,90,0.5)' : 'rgba(255,170,90,0.4)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(38, -190); ctx.lineTo(46, -40); ctx.stroke(); ctx.restore();
  ctx.restore();
}
function mug(x, y, s, t, col) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = col || '#c94f3a'; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.lineTo(17, 34); ctx.lineTo(-17, 34); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = col || '#c94f3a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(26, 14, 12, -1.2, 1.2); ctx.stroke();
  ctx.strokeStyle = 'rgba(220,220,220,0.35)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) { const ph = t * 1.3 + i * 2; ctx.beginPath(); ctx.moveTo(-6 + i * 7, -4); for (let k = 0; k < 5; k++) ctx.lineTo(-6 + i * 7 + 10 * Math.sin(ph + k * 0.9), -4 - k * 14); ctx.globalAlpha = 0.5 - i * 0.12; ctx.stroke(); } ctx.globalAlpha = 1;
  ctx.restore();
}
function openBook(x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.04);
  ctx.fillStyle = '#ece4d2'; ctx.beginPath(); ctx.moveTo(-90, 0); ctx.quadraticCurveTo(0, -20, 90, 0); ctx.quadraticCurveTo(0, 12, -90, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(90,80,70,0.45)'; ctx.lineWidth = 1.4; for (let i = -70; i <= 70; i += 16) { ctx.beginPath(); ctx.moveTo(i * 0.7, -4 + Math.abs(i) * 0.02); ctx.lineTo(i * 0.7 + 32, -4 + Math.abs(i) * 0.02); ctx.stroke(); }
  ctx.fillStyle = '#6a4a2a'; ctx.fillRect(-5, -12, 10, 16);
  ctx.restore();
}
function coffeeTable(x, y, s, t) {
  softShadow(x, y + 70 * s, 150 * s, 28 * s, 0.45);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#4a3120'; rrect(-140, -12, 280, 22, 6); ctx.fill();
  ctx.fillStyle = '#3a2616'; ctx.fillRect(-120, 10, 12, 60); ctx.fillRect(108, 10, 12, 60);
  ctx.restore();
  openBook(x - 46 * s, y - 14 * s, s * 0.9);
  mug(x + 60 * s, y - 40 * s, s * 0.8, t);
}
function bed(x, y, s, quilt) {
  softShadow(x, y + 104 * s, 300 * s, 40 * s, 0.5);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#3a2c22'; rrect(-260, -20, 520, 120, 12); ctx.fill();     // frame/mattress base
  // quilt patches
  const pw = 60, ph = 34; let qx = -250;
  for (let c = 0; c < 8; c++) { let qy = -14; for (let r = 0; r < 2; r++) { ctx.fillStyle = quilt[(c + r) % quilt.length]; rrect(qx, qy, pw - 4, ph - 4, 5); ctx.fill(); qy += ph; } qx += pw; }
  // pillow
  ctx.fillStyle = '#e8e0d0'; rrect(150, -54, 120, 60, 16); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; rrect(-260, 86, 520, 14, 6); ctx.fill();
  ctx.restore();
}
function desk(x, y, s, t) {
  softShadow(x, y + 112 * s, 340 * s, 30 * s, 0.5);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#3a2a1c'; rrect(-320, 0, 640, 22, 4); ctx.fill();
  ctx.fillStyle = '#2c1f14'; ctx.fillRect(-300, 22, 16, 90); ctx.fillRect(284, 22, 16, 90);
  ctx.restore();
  // laptop with glowing screen
  ctx.save(); ctx.translate(x + 40 * s, y); ctx.scale(s, s);
  ctx.fillStyle = '#1a1a20'; rrect(-70, -96, 140, 96, 6); ctx.fill();
  ctx.fillStyle = '#7fd8ff'; rrect(-62, -90, 124, 82, 4); ctx.fill(); glow(0, -50, 120, 'rgba(120,200,255,0.4)', 'rgba(120,200,255,0)', 0.7);
  ctx.fillStyle = '#2a2a30'; ctx.beginPath(); ctx.moveTo(-82, 0); ctx.lineTo(82, 0); ctx.lineTo(70, -4); ctx.lineTo(-70, -4); ctx.closePath(); ctx.fill();
  ctx.restore();
  // desk lamp warm cone
  ctx.save(); ctx.translate(x - 190 * s, y); ctx.scale(s, s);
  ctx.strokeStyle = '#c96a3a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, -110); ctx.lineTo(46, -150); ctx.stroke();
  ctx.fillStyle = '#e07a42'; ctx.beginPath(); ctx.moveTo(30, -160); ctx.lineTo(70, -140); ctx.lineTo(50, -120); ctx.lineTo(24, -138); ctx.closePath(); ctx.fill();
  glow(48, -138, 150, 'rgba(255,190,110,0.55)', 'rgba(255,150,80,0)', 0.8);
  ctx.restore();
  pottedPlant(x + 250 * s, y, 0.7 * s);
  mug(x + 150 * s, y - 34 * s, 0.7 * s, t);
}
function parkBench(x, y, s, flip) {
  softShadow(x, y + 6 * s, 110 * s, 20 * s, 0.4);
  ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -s : s, s);
  ctx.fillStyle = '#1a1526';
  // legs / frame
  ctx.fillRect(-92, -66, 8, 66); ctx.fillRect(84, -66, 8, 66);
  // seat slats (horizontal)
  for (let i = 0; i < 3; i++) ctx.fillRect(-98, -66 + i * 9, 196, 6);
  // backrest verticals rising behind the seat
  ctx.fillRect(-92, -150, 8, 90); ctx.fillRect(84, -150, 8, 90);
  // back slats (horizontal, upper)
  for (let i = 0; i < 3; i++) ctx.fillRect(-98, -148 + i * 16, 196, 6);
  ctx.restore();
}
function palm(x, y, s, lean) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = '#160e2a'; ctx.lineWidth = 16; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(lean * 40, -220, lean * 90, -400); ctx.stroke();
  const tx = lean * 90, ty = -400;
  ctx.lineWidth = 10;
  for (const f of [[-1.1, -0.2], [-0.7, -0.9], [-0.1, -1.2], [0.5, -0.95], [1.0, -0.3], [1.15, 0.35], [-1.15, 0.3]]) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + f[0] * 120, ty + f[1] * 70 - 40, tx + f[0] * 230, ty + f[1] * 110 + 30); ctx.stroke(); }
  disc(tx, ty, 12, '#160e2a');
  ctx.restore();
}
function stiltHut(x, y, s, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#140c26';
  for (const sx of [-70, -20, 30, 80]) ctx.fillRect(sx, 60, 12, 150);
  ctx.fillRect(-92, -40, 184, 112);
  ctx.beginPath(); ctx.moveTo(-118, -40); ctx.lineTo(0, -124); ctx.lineTo(118, -40); ctx.closePath(); ctx.fill();
  const fl = 0.85 + 0.15 * Math.sin(t * 3.1);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,150,70,${0.9 * fl})`; ctx.fillRect(-64, -8, 46, 56); ctx.fillRect(20, -8, 46, 56); ctx.restore();
  glow(-42, 18, 90, 'rgba(255,150,70,0.6)', 'rgba(255,120,40,0)', 0.7 * fl); glow(42, 18, 90, 'rgba(255,150,70,0.6)', 'rgba(255,120,40,0)', 0.7 * fl);
  glow(122, -18, 44, 'rgba(255,180,90,0.9)', 'rgba(255,140,60,0)', 0.9 * fl); disc(122, -18, 7, '#ffd98a');
  ctx.restore();
}
function woodWall(x0, y0, x1, y1, warm) {
  ctx.fillStyle = lg(0, y0, 0, y1, warm ? [[0, '#4a3421'], [1, '#2e2013']] : [[0, '#3a2c22'], [1, '#241a14']]);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // planks with bevel highlight + shadow
  for (let x = x0; x < x1; x += 120) {
    ctx.fillStyle = 'rgba(255,220,170,0.05)'; ctx.fillRect(x, y0, 2, y1 - y0);
    ctx.fillStyle = 'rgba(15,9,5,0.4)'; ctx.fillRect(x - 2, y0, 2, y1 - y0);
  }
  // ambient occlusion — darker toward ceiling + corners
  ctx.fillStyle = lg(0, y0, 0, y0 + (y1 - y0) * 0.4, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]); ctx.fillRect(x0, y0, x1 - x0, (y1 - y0) * 0.4);
}
function framedArt(x, y, w, h, scene) {
  softShadow(x + w / 2, y + h + 4, w * 0.55, 8, 0.4);
  ctx.fillStyle = '#2a1c10'; rrect(x - 8, y - 8, w + 16, h + 16, 4); ctx.fill();          // frame
  ctx.fillStyle = 'rgba(255,220,160,0.18)'; ctx.fillRect(x - 8, y - 8, w + 16, 3);
  ctx.save(); rrect(x, y, w, h, 2); ctx.clip();
  if (scene === 'sunset') { ctx.fillStyle = lg(0, y, 0, y + h, [[0, '#3a3a6a'], [0.6, '#c86a5a'], [1, '#f0a060']]); ctx.fillRect(x, y, w, h); disc(x + w * 0.5, y + h * 0.62, w * 0.14, '#ffe0a0'); }
  else if (scene === 'car') { ctx.fillStyle = lg(0, y, 0, y + h, [[0, '#2a1a3a'], [1, '#7a3a5a']]); ctx.fillRect(x, y, w, h); ctx.fillStyle = '#1a1024'; ctx.fillRect(x + w * 0.14, y + h * 0.5, w * 0.72, h * 0.3); ctx.fillStyle = '#ff8a5a'; ctx.fillRect(x + w * 0.2, y + h * 0.58, w * 0.6, 3); }
  else { ctx.fillStyle = lg(0, y, 0, y + h, [[0, '#26402e'], [1, '#16281c']]); ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(120,170,120,0.5)'; ctx.lineWidth = 6; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + w * (0.2 + i * 0.2), y + h); ctx.lineTo(x + w * (0.2 + i * 0.2), y + h * 0.3); ctx.stroke(); } }
  ctx.restore();
}
function bookStack(x, y, s) {
  softShadow(x, y + 6 * s, 46 * s, 10 * s, 0.4);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const cols = ['#8a3b34', '#3a6a5a', '#c98a3a', '#3a5a8a'];
  let yy = 0; for (let i = 0; i < 4; i++) { const w = 80 - i * 6, off = ((i * 13) % 9) - 4; ctx.fillStyle = cols[i]; rrect(-w / 2 + off, yy - 16, w, 16, 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(-w / 2 + off, yy - 16, w, 3); yy -= 17; }
  ctx.restore();
}
function woodFloor(yTop, warmX, t) {
  ctx.fillStyle = lg(0, yTop, 0, DH + 200, [[0, '#3a281a'], [1, '#20140c']]);
  ctx.fillRect(-400, yTop, DW + 800, DH - yTop + 300);
  ctx.strokeStyle = 'rgba(15,9,5,0.5)'; ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) { const y = yTop + 20 + i * ((DH - yTop) / 7); ctx.beginPath(); ctx.moveTo(-400, y); ctx.lineTo(DW + 400, y); ctx.stroke(); }
  if (warmX != null) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg(warmX, yTop + 40, 0, 620, [[0, 'rgba(255,150,70,0.28)'], [1, 'rgba(255,120,50,0)']]); ctx.fillRect(-400, yTop, DW + 800, DH - yTop + 200); ctx.restore(); }
}

// ==================================================================
// CABIN — cozy lofi room; 3 angles of the same fireplace room
// ==================================================================
// Painterly relight: knock the whole frame down into warm shadow, then paint
// back the light pools (warm fire, cool window). This is what gives the refs
// their chiaroscuro — bright hotspot, deep falloff, warm-brown shadows.
function relight(warm, cool, floor) {
  const full = () => ctx.fillRect(-500, -500, DW + 1000, DH + 1000);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(96,74,56)'; full();   // ambient down + warm shadows
  ctx.globalCompositeOperation = 'lighter';
  if (cool) { ctx.fillStyle = rg(cool.x, cool.y, 0, cool.r, [[0, 'rgba(120,158,255,0.42)'], [0.55, 'rgba(90,120,210,0.14)'], [1, 'rgba(90,120,210,0)']]); full(); }
  ctx.fillStyle = rg(warm.x, warm.y, 0, warm.r, [[0, 'rgba(255,175,95,0.58)'], [0.45, 'rgba(255,135,60,0.2)'], [1, 'rgba(255,110,50,0)']]); full();
  if (floor) { ctx.fillStyle = rg(warm.x, floor, warm.r * 0.2, warm.r * 1.1, [[0, 'rgba(255,150,70,0.3)'], [1, 'rgba(255,120,50,0)']]); full(); }
  ctx.restore();
}
function cabin0(t) { // fireplace centered, seats foreground, bookshelves flanking
  L(0.06, () => { woodWall(-400, -300, DW + 400, DH * 0.78, true); });
  // background bookshelves + framed art, slightly defocused (depth of field)
  L(0.12, () => blurred(3, () => {
    bookshelf(90, DH * 0.74, 300, DH * 0.66, state.books); bookshelf(DW - 390, DH * 0.74, 300, DH * 0.66, state.books2);
    framedArt(DW * 0.5 - 250, DH * 0.14, 130, 96, 'car'); framedArt(DW * 0.5 + 120, DH * 0.14, 130, 96, 'sunset');
  }));
  L(0.18, () => {
    stoneFireplace(DW * 0.5 - 170, DH * 0.30, 340, DH * 0.44, t, state.embers);
    // mantel dressing
    candle(DW * 0.5 - 130, DH * 0.30 - 30, 1, t, 1); candle(DW * 0.5 + 130, DH * 0.30 - 30, 1, t, 2);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i <= 10; i++) { const x = DW * 0.5 - 150 + i * 30; const y = DH * 0.30 - 40 + 8 * Math.sin(i); const tw = 0.5 + 0.5 * Math.sin(t * 2 + i); ctx.globalAlpha = 0.5 + 0.5 * tw; disc(x, y, 4, i % 3 ? '#ffcf6b' : '#ff8a4a'); } ctx.restore(); ctx.globalAlpha = 1;
  });
  L(0.3, () => { woodFloor(DH * 0.72, DW * 0.5, t); rug(DW * 0.5, DH * 0.92, 620, 200, ['#6a2f2f', '#8a3a2a', '#b5673a', '#8a3a2a']); });
  L(0.5, () => {
    personReading(DW * 0.24, DH * 0.92, 1.0, true);
    bookStack(DW * 0.38, DH * 0.96, 1.0);
    armchair(DW * 0.8, DH * 0.98, 0.98, false, '#9a5a34');
  });
  relight({ x: DW * 0.5, y: DH * 0.5, r: 660 }, null, DH * 0.86);
  dust(t, state.dust, DW * 0.5, DH * 0.55, 360, 'rgba(255,200,130,0.85)');
}
function cabin1(t) { // from right chair: fireplace RIGHT (big), window+skyline LEFT, sofa left w/ cat
  L(0.05, () => { woodWall(-400, -300, DW + 400, DH * 0.78, true); });
  L(0.12, () => {
    windowView(70, DH * 0.14, 420, DH * 0.5, (x, y, w, h) => {
      ctx.fillStyle = lg(0, y, 0, y + h, [[0, '#0a1230'], [1, '#22305a']]); ctx.fillRect(x, y, w, h);
      starField(t, state.wstars, 0);
      moon(x + w * 0.7, y + h * 0.22, 26, true);
      skyline(t, x, x + w, y + h * 0.86, state.wskyline);
    }, '#2b3350');
    curtain(60, DH * 0.12, DH * 0.56, 90, '#2a3a66', false);
    bookshelf(DW * 0.44, DH * 0.72, 210, DH * 0.6, state.books);
    pottedPlant(DW * 0.44 + 105, DH * 0.72 - DH * 0.6 - 6, 0.7);
  });
  L(0.2, () => {
    stoneFireplace(DW * 0.66, DH * 0.28, 360, DH * 0.46, t, state.embers);
    candle(DW * 0.66 + 40, DH * 0.28 - 30, 1, t, 1); candle(DW * 0.66 + 320, DH * 0.28 - 30, 1, t, 3);
    pottedPlant(DW * 0.98, DH * 0.7, 1.0);
  });
  L(0.32, () => { woodFloor(DH * 0.72, DW * 0.72, t); rug(DW * 0.44, DH * 0.94, 560, 180, ['#6a2f2f', '#9a3a2a', '#c07a3a']); });
  L(0.5, () => { sofa(DW * 0.22, DH * 0.96, 1.15, false, '#3a5a86', ['#b5433a', '#c98a3a'], true); });
  relight({ x: DW * 0.74, y: DH * 0.5, r: 620 }, { x: DW * 0.15, y: DH * 0.34, r: 480 }, DH * 0.86);
  dust(t, state.dust, DW * 0.72, DH * 0.55, 320, 'rgba(255,200,130,0.8)');
}
function cabin2(t) { // window+green chair LEFT (big), fireplace RIGHT background, sleeping cat
  L(0.05, () => { woodWall(-400, -300, DW + 400, DH * 0.78, true); });
  L(0.1, () => {
    windowView(120, DH * 0.12, 460, DH * 0.56, (x, y, w, h) => {
      ctx.fillStyle = lg(0, y, 0, y + h, [[0, '#122a20'], [1, '#1e3a2a']]); ctx.fillRect(x, y, w, h);
      // misty forest trunks
      ctx.strokeStyle = 'rgba(10,26,18,0.8)'; ctx.lineWidth = 22; for (let i = 0; i < 7; i++) { const tx = x + 30 + i * (w / 6.5); ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(tx + rnd(-8, 8), y + h); ctx.stroke(); }
      ctx.fillStyle = 'rgba(60,110,70,0.5)'; for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.ellipse(x + rnd(0, w), y + rnd(0, h), rnd(14, 30), rnd(8, 16), 0, 0, 7); ctx.fill(); }
      // rain
      ctx.strokeStyle = 'rgba(200,220,210,0.3)'; ctx.lineWidth = 2; for (const d of state.rain2) { const yy = (d.y + t * d.sp * 1000) % (h + 40) - 20; ctx.beginPath(); ctx.moveTo(x + d.x, y + yy); ctx.lineTo(x + d.x + 3, y + yy + d.len); ctx.stroke(); }
    }, '#3a4a2a');
    curtain(108, DH * 0.1, DH * 0.6, 100, '#4a6a3a', false);
  });
  L(0.2, () => {
    stoneFireplace(DW * 0.72, DH * 0.34, 300, DH * 0.4, t, state.embers);
    candle(DW * 0.72 + 30, DH * 0.34 - 26, 0.9, t, 1); candle(DW * 0.72 + 270, DH * 0.34 - 26, 0.9, t, 2);
    pottedPlant(DW * 0.62, DH * 0.72, 0.9); pottedPlant(DW * 0.98, DH * 0.74, 1.1);
  });
  L(0.32, () => { woodFloor(DH * 0.72, DW * 0.78, t); rug(DW * 0.42, DH * 0.92, 600, 190, ['#3a5a3a', '#5a7a3a', '#8a9a4a']); });
  L(0.5, () => {
    armchair(DW * 0.2, DH * 0.95, 1.2, false, '#5a7a3a');
    floorLamp(DW * 0.06, DH * 0.86, 1.05);
    // sleeping cat curled on rug
    ctx.save(); ctx.translate(DW * 0.42, DH * 0.9); ctx.fillStyle = '#c8bfa8'; ctx.beginPath(); ctx.ellipse(0, 0, 60, 30, 0, 0, 7); ctx.fill(); disc(-48, -6, 22, '#c8bfa8'); ctx.restore();
  });
  relight({ x: DW * 0.82, y: DH * 0.55, r: 540 }, { x: DW * 0.28, y: DH * 0.36, r: 520 }, DH * 0.86);
  dust(t, state.dust, DW * 0.8, DH * 0.6, 300, 'rgba(255,200,130,0.75)');
}

// ==================================================================
// BEACH — sunset sea; 3 angles
// ==================================================================
function beachSky(t, sunX, sunY) {
  ctx.fillStyle = lg(0, -200, 0, DH * 0.6, [[0, '#3a2a6a'], [0.4, '#7a4a8a'], [0.7, '#c86a8a'], [0.9, '#f0a06a'], [1, '#ffd0a0']]);
  ctx.fillRect(-400, -400, DW + 800, DH);
  starField(t, state.stars, 0.14);
  clouds(t, state.cloudsFar, '#a86a9a', 0.5);
  glow(sunX, sunY, 420, 'rgba(255,235,190,0.6)', 'rgba(255,180,120,0)', 1);
  ctx.fillStyle = rg(sunX, sunY, 0, 96, [[0, '#fff6e0'], [0.6, '#ffe4a0'], [1, 'rgba(255,190,120,0.5)']]); ctx.beginPath(); ctx.arc(sunX, sunY, 92, 0, 7); ctx.fill();
  clouds(t, state.cloudsNear, '#e88a7a', 0.6);
}
function beachSea(t, seaY, sunX) {
  ctx.fillStyle = lg(0, seaY, 0, DH, [[0, '#4a7aa0'], [0.4, '#3a5a86'], [1, '#26305a']]);
  ctx.fillRect(-400, seaY, DW + 800, DH - seaY + 400);
  ctx.fillStyle = '#2a2a5c'; ctx.beginPath(); ctx.moveTo(DW * 0.7, seaY); ctx.quadraticCurveTo(DW * 0.85, seaY - 26, DW * 1.0, seaY); ctx.fill();
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 50; i++) { const f = i / 50; const yy = seaY + f * (DH - seaY); const w = 26 + f * 150 + 26 * Math.sin(t * 2.4 + i * 0.7); const jit = 16 * Math.sin(t * 1.6 + i * 1.3); ctx.globalAlpha = 0.12 * (1 - f * 0.6); ctx.fillStyle = '#ffe6b0'; ctx.beginPath(); ctx.ellipse(sunX + jit, yy, w / 2, 4, 0, 0, 7); ctx.fill(); }
  ctx.restore(); ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) { const yy = seaY + 40 + i * 66; ctx.beginPath(); for (let xx = -200; xx <= DW + 200; xx += 40) ctx.lineTo(xx, yy + 5 * Math.sin(xx * 0.02 + t * 1.5 + i)); ctx.stroke(); }
}
function beach0(t) { // pier + bench looking at centered sun (images.jpg)
  const sunX = DW * 0.5, seaY = DH * 0.52;
  L(0.1, () => beachSky(t, sunX, DH * 0.4));
  L(0.14, () => beachSea(t, seaY, sunX));
  L(0.4, () => { // boardwalk
    ctx.fillStyle = lg(0, DH * 0.82, 0, DH, [[0, '#2a2440'], [1, '#181430']]); ctx.fillRect(-400, DH * 0.82, DW + 800, DH * 0.3);
    ctx.strokeStyle = 'rgba(10,8,20,0.6)'; ctx.lineWidth = 4; for (let i = 0; i < 6; i++) { const y = DH * 0.84 + i * 30; ctx.beginPath(); ctx.moveTo(-200, y); ctx.lineTo(DW + 200, y); ctx.stroke(); }
    // railing posts along water edge
    ctx.fillStyle = '#181430'; for (let x = 120; x < DW; x += 150) { ctx.fillRect(x, seaY - 6, 12, DH * 0.82 - seaY + 6); }
  });
  L(0.55, () => parkBench(DW * 0.28, DH * 0.9, 1.15, false));
}
function beach1(t) { // hut RIGHT, palms + sun LEFT
  const sunX = DW * 0.28, seaY = DH * 0.56;
  L(0.1, () => beachSky(t, sunX, DH * 0.44));
  L(0.14, () => beachSea(t, seaY, sunX));
  L(0.45, () => {
    ctx.fillStyle = lg(0, DH * 0.82, 0, DH, [[0, '#2a1c40'], [1, '#181030']]); ctx.beginPath(); ctx.moveTo(-400, DH * 0.9); ctx.quadraticCurveTo(DW * 0.5, DH * 0.82, DW + 400, DH * 0.92); ctx.lineTo(DW + 400, DH + 60); ctx.lineTo(-400, DH + 60); ctx.closePath(); ctx.fill();
    stiltHut(DW * 0.8, DH * 0.5, 1.15, t);
    palm(DW * 0.1, DH * 0.62, 1.1, 0.5); palm(DW * 0.2, DH * 0.58, 0.9, 0.3);
  });
}
function beach2(t) { // hut LEFT, palms + sun RIGHT
  const sunX = DW * 0.72, seaY = DH * 0.56;
  L(0.1, () => beachSky(t, sunX, DH * 0.44));
  L(0.14, () => beachSea(t, seaY, sunX));
  L(0.45, () => {
    ctx.fillStyle = lg(0, DH * 0.82, 0, DH, [[0, '#2a1c40'], [1, '#181030']]); ctx.beginPath(); ctx.moveTo(-400, DH * 0.92); ctx.quadraticCurveTo(DW * 0.5, DH * 0.82, DW + 400, DH * 0.9); ctx.lineTo(DW + 400, DH + 60); ctx.lineTo(-400, DH + 60); ctx.closePath(); ctx.fill();
    stiltHut(DW * 0.2, DH * 0.5, 1.15, t);
    palm(DW * 0.9, DH * 0.62, 1.1, -0.5); palm(DW * 0.8, DH * 0.58, 0.9, -0.3);
  });
}

// ==================================================================
// CITY — highrise room at dusk/night; 3 angles
// ==================================================================
function citySkyWindow(t, x, y, w, h, palette, moonOn) {
  ctx.fillStyle = lg(0, y, 0, y + h, palette.sky); ctx.fillRect(x, y, w, h);
  starField(t, state.stars, 0);
  if (moonOn) moon(x + w * 0.62, y + h * 0.2, 34, false, palette.warmMoon ? 'rgba(255,240,210,0.5)' : null);
  clouds(t, state.cclouds, palette.cloud, 0.4);
  skyline(t, x, x + w, y + h * 0.72, state.cskyline);
  // city glow at base
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = lg(0, y + h * 0.6, 0, y + h, [[0, 'rgba(255,160,90,0)'], [1, 'rgba(255,150,90,0.25)']]); ctx.fillRect(x, y + h * 0.6, w, h * 0.4); ctx.restore();
}
function city0(t) { // bedroom: wide window + bed with book & mug (dusk)
  const pal = { sky: [[0, '#241a4a'], [0.5, '#5a3a7a'], [1, '#c86a8a']], cloud: '#7a4a7a' };
  L(0.08, () => {
    ctx.fillStyle = '#140f22'; ctx.fillRect(-400, -300, DW + 800, DH + 400);
    windowView(DW * 0.12, DH * 0.06, DW * 0.76, DH * 0.64, (x, y, w, h) => citySkyWindow(t, x, y, w, h, pal, true), '#20233a');
  });
  L(0.16, () => { curtain(DW * 0.1, DH * 0.04, DH * 0.66, 110, '#242a44', false); curtain(DW * 0.9, DH * 0.04, DH * 0.66, 110, '#242a44', true); });
  L(0.28, () => { // interior floor + warm lamp
    ctx.fillStyle = lg(0, DH * 0.7, 0, DH, [[0, '#241a2a'], [1, '#140e18']]); ctx.fillRect(-400, DH * 0.7, DW + 800, DH * 0.4);
    glow(DW * 0.86, DH * 0.78, 420, 'rgba(255,160,90,0.35)', 'rgba(255,120,60,0)', 0.9);
    rug(DW * 0.4, DH * 0.94, 620, 180, ['#3a2a4a', '#5a3a5a', '#7a4a5a']);
  });
  L(0.34, () => { pottedPlant(DW * 0.08, DH * 0.82, 1.05); });
  L(0.5, () => { bed(DW * 0.62, DH * 0.82, 1.15, ['#c05a4a', '#4a7a8a', '#d0a04a', '#5a6a9a', '#8a5a7a']); openBook(DW * 0.5, DH * 0.79, 1.0); mug(DW * 0.4, DH * 0.77, 0.9, t); });
}
function city1(t) { // desk by the window, laptop + lamp (sunset — a-0005)
  const pal = { sky: [[0, '#20305a'], [0.45, '#8a5a5a'], [0.75, '#e08a4a'], [1, '#ffc46a']], cloud: '#c07a5a', warmMoon: true };
  L(0.08, () => {
    ctx.fillStyle = '#161018'; ctx.fillRect(-400, -300, DW + 800, DH + 400);
    windowView(DW * 0.08, DH * 0.04, DW * 0.84, DH * 0.66, (x, y, w, h) => citySkyWindow(t, x, y, w, h, pal, false), '#242038');
  });
  L(0.28, () => { ctx.fillStyle = lg(0, DH * 0.66, 0, DH, [[0, '#2a1e22'], [1, '#160f12']]); ctx.fillRect(-400, DH * 0.66, DW + 800, DH * 0.4); glow(DW * 0.34, DH * 0.62, 360, 'rgba(255,180,110,0.4)', 'rgba(255,150,80,0)', 0.9); });
  L(0.5, () => { desk(DW * 0.5, DH * 0.82, 1.15, t); });
}
function city2(t) { // living room: sofa + coffee table, floor-to-ceiling sunset windows
  const pal = { sky: [[0, '#2a2a5a'], [0.4, '#8a4a6a'], [0.7, '#e07a4a'], [1, '#ffb85a']], cloud: '#d07a5a', warmMoon: true };
  L(0.08, () => {
    ctx.fillStyle = '#171019'; ctx.fillRect(-400, -300, DW + 800, DH + 400);
    // triptych of tall windows
    const gap = DW * 0.04, x0 = DW * 0.06, tw = (DW * 0.88 - gap * 2) / 3;
    for (let i = 0; i < 3; i++) windowView(x0 + i * (tw + gap), DH * 0.04, tw, DH * 0.72, (x, y, w, h) => citySkyWindow(t, x - i * (tw + gap) + x0, y, DW * 0.88, h, pal, i === 1), '#20233a');
  });
  L(0.28, () => { ctx.fillStyle = lg(0, DH * 0.76, 0, DH, [[0, '#241a22'], [1, '#140d12']]); ctx.fillRect(-400, DH * 0.76, DW + 800, DH * 0.3); rug(DW * 0.42, DH * 0.95, 640, 180, ['#5a3a4a', '#7a4a4a', '#a05a4a']); });
  L(0.34, () => pottedPlant(DW * 0.9, DH * 0.82, 1.1));
  L(0.5, () => { sofa(DW * 0.26, DH * 0.94, 1.25, false, '#8a5a4a', ['#d0a04a', '#c05a4a']); coffeeTable(DW * 0.56, DH * 0.9, 1.1, t); });
}

const COMPS = {
  cabin: [cabin0, cabin1, cabin2],
  beach: [beach0, beach1, beach2],
  city: [city0, city1, city2],
};

// ---------- per-theme particle/prop state ----------
function buildScene() {
  state = {};
  state.dust = makeDust(70);
  state.rainScreen = []; for (let i = 0; i < 90; i++) state.rainScreen.push({ x: Math.random(), y: Math.random() * 1.2, len: rnd(10, 22), sp: rnd(0.5, 0.9) });
  if (theme === 'cabin') {
    state.embers = []; for (let i = 0; i < 40; i++) state.embers.push({ x: rnd(-130, 130), r: rnd(1.5, 3.5), sp: rnd(0.25, 0.55), ph: rnd(0, 1) });
    state.books = makeBooks(6); state.books2 = makeBooks(6);
    state.wstars = makeStars(80, DH * 0.1, DH * 0.4, false);
    state.wskyline = makeSkyline(0, 500, ['#0e1838', '#122045', '#182a55']);
    state.rain2 = []; for (let i = 0; i < 70; i++) state.rain2.push({ x: rnd(0, 460), y: rnd(0, DH), len: rnd(12, 24), sp: rnd(0.6, 1.0) });
  } else if (theme === 'beach') {
    state.stars = makeStars(160, -DH * 0.4, DH * 0.4, false);
    state.cloudsFar = makeClouds(4, DH * 0.1, DH * 0.32, 120, 200);
    state.cloudsNear = makeClouds(5, DH * 0.24, DH * 0.46, 150, 260);
  } else {
    state.stars = makeStars(150, 0, DH * 0.5, false);
    state.cclouds = makeClouds(5, DH * 0.06, DH * 0.34, 120, 240);
    state.cskyline = makeSkyline(0, DW, ['#20244a', '#2a2e58', '#343a6a']);
  }
}

// ---------- crossfade ----------
function beginTransition() {
  if (!canvas) return;
  if (!snap) { snap = document.createElement('canvas'); }
  snap.width = canvas.width; snap.height = canvas.height;
  snap.getContext('2d').drawImage(canvas, 0, 0);
  fade = 0;
}

// ---------- engine plumbing ----------
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.parentElement.getBoundingClientRect();
  cw = r.width || window.innerWidth; ch = r.height || window.innerHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
}
// draw a still illustration cover-fit with a gentle parallax overscan
function drawSceneImage(img) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const over = 1.07;
  const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight) * over;
  const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
  const px = (par.x / DW) * cw * 1.6, py = (par.y / DH) * ch * 1.6;
  ctx.drawImage(img, (cw - iw) / 2 + px, (ch - ih) / 2 + py, iw, ih);
}
// subtle animated overlays layered over the illustration (screen space)
function overlayFX(cfg, t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const fx = cfg.fx * cw, fy = cfg.fy * ch;
  if (cfg.flicker) { const a = 0.15 + 0.06 * Math.sin(t * 7) + 0.04 * Math.sin(t * 13.3); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg(fx, fy, 0, ch * 0.62, [[0, `rgba(255,150,70,${a})`], [0.5, `rgba(255,120,55,${a * 0.4})`], [1, 'rgba(255,110,50,0)']]); ctx.fillRect(0, 0, cw, ch); ctx.restore(); }
  if (cfg.shimmer) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < 44; i++) { const f = i / 44; const yy = fy + f * (ch - fy); const w = 18 + f * 130 + 20 * Math.sin(t * 2.2 + i * 0.7); ctx.globalAlpha = 0.05 * (1 - f * 0.55); ctx.fillStyle = '#ffe6b0'; ctx.beginPath(); ctx.ellipse(fx + 16 * Math.sin(t * 1.5 + i), yy, w / 2, 3, 0, 0, 7); ctx.fill(); } ctx.restore(); ctx.globalAlpha = 1; }
  if (cfg.rain && state.rainScreen) { ctx.save(); ctx.strokeStyle = 'rgba(205,222,255,0.16)'; ctx.lineWidth = 1.6; for (const d of state.rainScreen) { const yy = ((d.y + t * d.sp) % 1.2 - 0.1) * ch; const xx = ((d.x + yy * 0.0003) % 1) * cw; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 3, yy + d.len); ctx.stroke(); } ctx.restore(); }
  if (cfg.dust) dust(t, state.dust, fx, fy + ch * 0.06, ch * 0.42, 'rgba(255,215,150,0.7)');
}

function render(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = sceneImage(theme, spot);
  if (img) {
    drawSceneImage(img);
    overlayFX(FX[theme] || {}, t);
  } else {
    ctx.save(); ctx.scale(dpr, dpr);
    // cover-fit; portrait (optional orientation) zooms out so wide rooms aren't cropped
    let s = Math.max(cw / DW, ch / DH);
    if (ch > cw) s = Math.max(cw / DW, ch / DH * 0.5);
    ctx.translate(cw / 2, ch / 2); ctx.scale(s, s); ctx.translate(-DW / 2, -DH / 2);
    (COMPS[theme][spot] || COMPS.cabin[0])(t);
    ctx.restore();
  }

  // ---------- cinematic post ----------
  // soft bloom: blur a bright copy of the frame and screen it back
  if (bloomC) {
    if (bloomC.width !== canvas.width) { bloomC.width = canvas.width; bloomC.height = canvas.height; }
    const bx = bloomC.getContext('2d');
    bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, bloomC.width, bloomC.height);
    bx.drawImage(canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22; ctx.filter = 'blur(22px)'; ctx.drawImage(bloomC, 0, 0); ctx.restore();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // color grade: warm the highlights, deepen the corners
  ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.3;
  ctx.fillStyle = lg(0, 0, cw, ch, [[0, '#ff9a4a'], [1, '#1a2a55']]); ctx.fillRect(0, 0, cw, ch); ctx.restore();
  // cinematic vignette
  ctx.fillStyle = rg(cw / 2, ch * 0.44, ch * 0.3, ch * 0.95, [[0, 'rgba(0,0,0,0)'], [0.7, 'rgba(0,0,0,0.16)'], [1, 'rgba(0,0,0,0.62)']]);
  ctx.fillRect(0, 0, cw, ch);
  // film grain (tiled, jittered each frame)
  if (noiseC) { ctx.save(); ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'overlay'; const pat = ctx.createPattern(noiseC, 'repeat'); ctx.fillStyle = pat; const jx = (t * 53) % 220, jy = (t * 71) % 220; ctx.translate(-jx, -jy); ctx.fillRect(jx, jy, cw + 220, ch + 220); ctx.restore(); }
  // crossfade the frozen previous frame on top of the graded result
  if (fade < 1 && snap) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - fade; ctx.drawImage(snap, 0, 0); ctx.globalAlpha = 1; }
}
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastNow) / 1000 || 0); lastNow = now;
  const t = (now - startT) / 1000;
  par.x += (parT.x - par.x) * 0.06; par.y += (parT.y - par.y) * 0.06;
  if (fade < 1) fade = Math.min(1, fade + dt / 0.45);
  render(t);
}
function onMove(e) { const nx = (e.clientX / window.innerWidth) * 2 - 1, ny = (e.clientY / window.innerHeight) * 2 - 1; parT.x = -nx * PARAMT; parT.y = -ny * PARAMT * 0.55; }
function onResize() { if (mounted) resize(); }

// ---------- public interface ----------
export async function openHaven3D(container, th, sp) {
  theme = th || 'cabin'; spot = sp || 0;
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  container.appendChild(canvas);
  ctx = canvas.getContext('2d');
  bloomC = document.createElement('canvas');
  // static film-grain tile
  noiseC = document.createElement('canvas'); noiseC.width = noiseC.height = 220;
  const nx = noiseC.getContext('2d'), img = nx.createImageData(220, 220);
  for (let i = 0; i < img.data.length; i += 4) { const v = 120 + Math.random() * 135 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  nx.putImageData(img, 0, 0);
  resize(); buildScene(); fade = 1;
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMove);
  mounted = true; startT = performance.now(); lastNow = startT; loop(startT);
  window.__hv2 = { get theme() { return theme; }, get spot() { return spot; } };
}
export function closeHaven3D() {
  mounted = false; cancelAnimationFrame(raf); raf = 0;
  window.removeEventListener('resize', onResize); window.removeEventListener('mousemove', onMove);
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  canvas = null; ctx = null; snap = null; bloomC = null; noiseC = null;
}
export async function setHavenTheme3D(th) { if (th === theme) return; beginTransition(); theme = th; buildScene(); }
export function setHavenSeat3D(sp) { if (sp === spot) return; beginTransition(); spot = sp; }
