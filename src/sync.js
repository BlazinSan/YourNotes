// ============================================================
// YourNotes Cloud Sync (Convex) — email/password login, per-key
// store sync, and file sync so notes + PDFs follow you across
// desktop and Android. Free tier, no card: convex.dev
// ============================================================
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

// Public deployment URL (not a secret — the browser connects to it; auth is by
// token). Pinned to the shared deployment that holds the functions + R2 config
// (a local `convex dev` can put a different personal URL in .env.local).
const CONVEX_URL = "https://quiet-jaguar-986.convex.cloud";
const api = anyApi;

function guessType(name) {
  const e = (String(name).split(".").pop() || "").toLowerCase();
  return e === "pdf" ? "application/pdf" : e === "png" ? "image/png"
    : (e === "jpg" || e === "jpeg") ? "image/jpeg" : e === "webp" ? "image/webp"
    : e === "gif" ? "image/gif" : "application/octet-stream";
}

// Content keys that sync. Device-local keys (session token, sync metadata,
// haven prefs are fine to sync — they're preferences) — token/meta excluded.
const SYNC_KEYS = [
  "opennotes_data", "opennotes_college_folders", "opennotes_tasks", "opennotes_calendar_tasks",
  "opennotes_calendar_day_colors", "opennotes_expanded_project_groups", "opennotes_sidebar_expanded_groups",
  "opennotes_expenses", "opennotes_journal_text", "opennotes_journal_mood", "opennotes_mood_history",
  "opennotes_books", "opennotes_goals", "opennotes_habits", "opennotes_quicklinks",
  "opennotes_favourites", "opennotes_pinned_groups", "opennotes_home_sort", "opennotes_nav_order",
  "opennotes_board", "opennotes_theme", "opennotes_language", "opennotes_currency",
  "opennotes_currency_code", "opennotes_temp_unit", "opennotes_banner_text_color",
  "opennotes_haven_theme", "opennotes_haven_spot", "opennotes_haven_vol",
  "userName", "userRole", "opennotes_profile_name", "opennotes_profile_type",
  "dashboardTitle", "dashboardBanner", "opennotes_profile_pic", "opennotes_initialized"
];

const FILE_REF_RE = /(?:file:\/\/\/[^"'\s]*|[^"'\s]*?)(college_pdfs|banner_files|board_files)(?:\\\\|\/)+([A-Za-z0-9._\-]+)/g;

// Convex caps a single stored value at 1 MiB. Split larger values across chunk
// rows so any size (big note sets, inline base64 banners, etc.) syncs reliably.
const KV_CHUNK = 700000;
const KV_CHUNK_SEP = "c";           // separator that can't occur in a real key
const KV_CHUNK_MARK = "YNCHUNKS";    // main-row sentinel: "reassemble from N chunks"
const KV_BATCH_BYTES = 3000000;                  // keep each setKVBatch call well under arg limits

const isChunkKey = (k) => k.indexOf(KV_CHUNK_SEP) !== -1;

let client = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
let pushTimer = null;
let pushing = false;

// Keys written since the last successful push (fed by __syncNotifyChange,
// which the Storage.setItem override in main.js calls on every localStorage
// write — so this covers every write path in the app). pushChanges only
// re-hashes dirty keys (plus anything missing from meta) instead of hashing
// every SYNC_KEYS value — the expensive part when opennotes_data holds
// megabytes of inline base64 images. dirtyKeys lives in memory only, so a
// reload loses it; `everPushedThisSession` forces one full hash scan on the
// first push after each load to re-catch any edit whose push never
// completed before the reload (meta would still show the pre-edit hash).
let dirtyKeys = new Set();
let everPushedThisSession = false;

// Convex calls have no built-in timeout — a stalled fetch (bad wifi, dead
// deployment) would otherwise leave "Pulling…/Pushing…" up forever with no
// way out. Race every call against a timer so the existing catch/finally
// paths (status + pushing-flag release) always run.
function withTimeout(promise, ms, label) {
  ms = ms || 30000;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Sync timed out — check connection" + (label ? " (" + label + ")" : ""))), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const getToken = () => { try { return localStorage.getItem("yn_sync_token") || ""; } catch (_) { return ""; } };
const getMeta = () => { try { return JSON.parse(localStorage.getItem("yn_sync_meta") || "{}"); } catch (_) { return {}; } };
const setMeta = (m) => { try { localStorage.setItem("yn_sync_meta", JSON.stringify(m)); } catch (_) {} };
const getFileMap = () => { try { return JSON.parse(localStorage.getItem("yn_file_map") || "{}"); } catch (_) { return {}; } };

function strHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

let statusElId = "sync-status";
function setStatus(msg, isErr) {
  const el = document.getElementById(statusElId);
  if (el) { el.textContent = msg || ""; el.style.color = isErr ? "#ef4444" : "var(--text-secondary)"; }
}
const fieldVal = (id) => ((document.getElementById(id) || {}).value || "").trim();

// ---------- File resolution (cross-device) ----------
// Desktop stores app files as file:/// paths. Other devices resolve the same
// filename through the cloud file map instead.
// Memoized per pull: fileExists is a synchronous IPC round-trip to the main
// process, and resolveFileUrl gets called once per rendered file reference —
// caching avoids re-asking main about the same path over and over.
const fileExistsCache = new Map();
window.resolveFileUrl = function (path) {
  if (!path || !String(path).startsWith("file:")) return path;
  const m = String(path).match(/\/([A-Za-z0-9._-]+)$/);
  if (window.electronAPI) {
    // This desktop only "owns" the file if it's actually on disk here — a
    // path pinned on another machine won't exist locally, so fall through
    // to the cloud file map instead of returning a dead file:// URL.
    if (window.electronAPI.fileExists) {
      let exists = fileExistsCache.get(path);
      if (exists === undefined) {
        exists = window.electronAPI.fileExists(path);
        fileExistsCache.set(path, exists);
      }
      if (exists) return path;
    } else {
      return path; // older preload without the check
    }
  }
  const url = m && getFileMap()[m[1]];
  return url || path;
};

// ---------- Auth ----------
async function afterAuth(res, pw) {
  localStorage.setItem("yn_sync_token", res.token);
  localStorage.setItem("yn_sync_email", res.email);
  // Electron has no built-in password manager — remember the credentials
  // ourselves via OS-encrypted storage (safeStorage) in the main process.
  if (window.electronAPI && window.electronAPI.saveCred && pw) {
    try { window.electronAPI.saveCred(res.email, pw); } catch (_) {}
  }
  updateSyncUi();
  setStatus("Signed in. Syncing…");
  // Fire-and-forget: don't block the caller (onboarding overlay dismissal) on
  // the network round-trip. syncNow() updates its own status label as it goes.
  window.syncNow().catch((e) => setStatus(cleanErr(e), true));
}

async function doAuth(kind, email, pw, elId) {
  statusElId = elId || "sync-status";
  if (!client) { setStatus("Sync isn't configured in this build.", true); return false; }
  try {
    setStatus(kind === "up" ? "Creating your account…" : "Signing in…");
    const res = await withTimeout(client.action(kind === "up" ? api.auth.signUp : api.auth.signIn, { email, password: pw }), 30000, "auth");
    await afterAuth(res, pw);
    return true;
  } catch (e) { setStatus(cleanErr(e), true); return false; }
}
window.syncSignUp = () => doAuth("up", fieldVal("sync-email"), fieldVal("sync-password"), "sync-status");
window.syncSignIn = () => doAuth("in", fieldVal("sync-email"), fieldVal("sync-password"), "sync-status");
// Used by the onboarding overlay (optional sign-in). Returns true on success.
window.onboardingAuth = (kind) => doAuth(kind, fieldVal("onboarding-sync-email"), fieldVal("onboarding-sync-pass"), "onboarding-sync-status");

window.syncSignOut = async function () {
  const token = getToken();
  if (client && token) { try { await withTimeout(client.mutation(api.sync.signOut, { token }), 30000, "signOut"); } catch (_) {} }
  localStorage.removeItem("yn_sync_token");
  localStorage.removeItem("yn_sync_email");
  if (window.electronAPI && window.electronAPI.clearCred) { try { window.electronAPI.clearCred(); } catch (_) {} }
  updateSyncUi();
  setStatus("Signed out. Your data stays on this device.");
};

function cleanErr(e) {
  const m = String((e && e.message) || e);
  const i = m.indexOf("Uncaught Error: ");
  return (i >= 0 ? m.slice(i + 16) : m).split("\n")[0].slice(0, 140);
}

// ---------- Push ----------
async function uploadReferencedFiles(token, values) {
  if (!(window.electronAPI && window.electronAPI.readFileBytes)) return; // files originate on desktop
  const seen = new Set();
  const refs = [];
  for (const v of values) {
    let m;
    FILE_REF_RE.lastIndex = 0;
    while ((m = FILE_REF_RE.exec(v)) !== null) {
      if (!seen.has(m[2])) {
        // Normalize the full matched path by stripping file:/// and converting double backslashes
        const cleanPath = m[0].replace(/^file:\/\/\//, '').replace(/\\\\/g, '/');
        seen.add(m[2]);
        refs.push({ full: cleanPath, name: m[2] });
      }
    }
  }
  const uploaded = new Set(JSON.parse(localStorage.getItem("yn_synced_files") || "[]"));
  const todo = refs.filter((r) => !uploaded.has(r.name));
  let done = 0;
  for (const r of todo) {
    try {
      const bytes = await window.electronAPI.readFileBytes(r.full);
      if (!bytes) continue;
      const ct = guessType(r.name);
      // Presigned PUT straight to Cloudflare R2 (secret stays in Convex).
      const { url: uploadUrl, r2Key } = await withTimeout(client.action(api.r2.presignUpload, { token, key: r.name }), 30000, "presignUpload");
      const resp = await fetch(uploadUrl, { method: "PUT", body: new Blob([bytes]), headers: { "content-type": ct } });
      if (!resp.ok) throw new Error("R2 upload " + resp.status);
      await withTimeout(client.mutation(api.sync.registerFile, { token, localKey: r.name, r2Key, name: r.name, size: bytes.length || bytes.byteLength || 0 }), 30000, "registerFile");
      uploaded.add(r.name);
      localStorage.setItem("yn_synced_files", JSON.stringify([...uploaded]));
      done++;
      setStatus(`Uploading files… ${done}/${todo.length}`);
    } catch (e) { console.warn("file upload failed", r.name, e); }
  }
}

// ---------- Board item blobs (IndexedDB, no OS path) ----------
// Board items dropped as generic files (not images) on a device without
// window.electronAPI.saveBoardFile are stored as a Blob in the browser's
// IndexedDB (see boardDb/saveBoardBlob in main.js) and only carry a fileId —
// no path, no dataUrl. That blob otherwise never leaves the originating
// device. Mirrors uploadReferencedFiles above but reads from IndexedDB and
// runs on every platform (Electron and mobile/web alike).
function boardFilesDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (boardFilesDb._promise) return boardFilesDb._promise;
  boardFilesDb._promise = new Promise((resolve) => {
    const req = indexedDB.open('yn-board-files', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return boardFilesDb._promise;
}
function getBoardBlob(fileId) {
  return boardFilesDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(fileId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  });
}
async function uploadBoardBlobs(token) {
  let items;
  try { items = JSON.parse(localStorage.getItem('opennotes_board') || '[]'); } catch (_) { items = []; }
  const withBlobs = (items || []).filter((it) => it && it.fileId);
  if (!withBlobs.length) return;
  const uploaded = new Set(JSON.parse(localStorage.getItem('yn_synced_files') || '[]'));
  const todo = withBlobs.filter((it) => !uploaded.has('blob_' + it.fileId));
  let done = 0;
  for (const it of todo) {
    try {
      const blob = await getBoardBlob(it.fileId);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = 'blob_' + it.fileId;
      const ct = blob.type || guessType(it.name || '');
      const { url: uploadUrl, r2Key } = await withTimeout(client.action(api.r2.presignUpload, { token, key: name }), 30000, "presignUpload");
      const resp = await fetch(uploadUrl, { method: "PUT", body: new Blob([bytes]), headers: { "content-type": ct } });
      if (!resp.ok) throw new Error("R2 upload " + resp.status);
      await withTimeout(client.mutation(api.sync.registerFile, { token, localKey: name, r2Key, name, size: bytes.length }), 30000, "registerFile");
      uploaded.add(name);
      localStorage.setItem("yn_synced_files", JSON.stringify([...uploaded]));
      done++;
      setStatus(`Uploading pinned files… ${done}/${todo.length}`);
    } catch (e) { console.warn("board blob upload failed", it.fileId, e); }
  }
}

// ---------- Pull ----------
// Downloads cloud rows newer than our meta timestamp and writes them into
// localStorage, then refreshes the file map so this device can resolve
// cloud-only files. Guards against clobbering a key that changed locally
// since the last successful push (i.e. it's dirty/pending) — those are
// skipped and counted so the caller can surface it instead of losing data.
// opts.reload=false suppresses the auto-reload (used by syncNow, which
// reloads itself only after the following push has also completed).
window.pullChanges = async function (opts) {
  const reloadOnChange = !opts || opts.reload !== false;
  const token = getToken();
  if (!client || !token || pushing) return { pulled: 0, skipped: 0 };
  pushing = true;
  try {
    setStatus("Pulling…");
    fileExistsCache.clear();
    const meta = getMeta();
    const rows = await withTimeout(client.query(api.sync.getAll, { token }), 30000, "getAll");
    const chunkMap = {};
    const mainRows = [];
    for (const r of rows) { if (isChunkKey(r.key)) chunkMap[r.key] = r.value; else mainRows.push(r); }
    let pulled = 0, skipped = 0;
    for (const row of mainRows) {
      let value = row.value;
      if (typeof value === "string" && value.startsWith(KV_CHUNK_MARK)) {
        const n = parseInt(value.slice(KV_CHUNK_MARK.length), 10) || 0;
        let acc = "";
        for (let i = 0; i < n; i++) acc += (chunkMap[row.key + KV_CHUNK_SEP + i] || "");
        value = acc;
      }
      const known = meta[row.key];
      if (!known || row.updatedAt > known.t) {
        const localVal = localStorage.getItem(row.key) || "";
        if (known && strHash(localVal) !== known.h) {
          // Locally changed since the last synced hash but not yet pushed —
          // pulling now would silently discard the local edit. Skip it; the
          // next push will send it up and reconcile.
          skipped++;
          continue;
        }
        if (!known || strHash(localVal) !== strHash(value)) {
          localStorage.setItem(row.key, value);
          pulled++;
        }
        meta[row.key] = { h: strHash(value), t: row.updatedAt };
      }
    }
    setMeta(meta);
    // refresh the filename→URL map (presigned R2 GET urls) so this device renders cloud files
    try { localStorage.setItem("yn_file_map", JSON.stringify(await withTimeout(client.action(api.r2.presignDownloads, { token }), 30000, "presignDownloads"))); } catch (_) {}
    localStorage.setItem("yn_last_sync", String(Date.now()));
    updateSyncUi();
    const parts = [];
    if (pulled) parts.push(`Pulled ${pulled} item${pulled > 1 ? "s" : ""}`);
    if (skipped) parts.push(`skipped ${skipped} local edit${skipped > 1 ? "s" : ""}`);
    setStatus(parts.length ? parts.join(", ") + "." : "Nothing new to pull.");
    if (pulled > 0 && reloadOnChange) setTimeout(() => location.reload(), 900);
    return { pulled, skipped };
  } catch (e) {
    setStatus(cleanErr(e), true);
    return { pulled: 0, skipped: 0 };
  } finally {
    pushing = false;
  }
};

// ---------- Push ----------
// Uploads any referenced files/board blobs not yet in the cloud, then writes
// locally-changed keys (chunking values over the 1 MiB cap) up to Convex.
window.pushChanges = async function () {
  const token = getToken();
  if (!client || !token || pushing) return { pushed: 0 };
  pushing = true;
  try {
    setStatus("Pushing…");
    const meta = getMeta();
    const allSyncValues = SYNC_KEYS.map(k => localStorage.getItem(k)).filter(Boolean);
    await uploadReferencedFiles(token, allSyncValues);
    await uploadBoardBlobs(token);

    // Snapshot + force-full flag captured up front: a key can be marked dirty
    // again (by a live edit) while the awaits above/below are in flight, and
    // that dirty mark must survive past this push, not get wiped by the
    // success handler below.
    const dirtyAtStart = new Set(dirtyKeys);
    const forceFullScan = !everPushedThisSession;

    const now = Date.now();
    const rowsToWrite = [];        // flat KV rows (incl. chunk rows)
    const changedMeta = {};        // main-key -> hash, applied after success
    for (const k of SYNC_KEYS) {
      const v = localStorage.getItem(k);
      if (v === null || v === undefined) continue;
      const known = meta[k];
      // Skip the (potentially expensive, e.g. multi-MB opennotes_data) hash
      // entirely when we already have a meta hash for this key AND nothing
      // has told us it changed: not dirty, and not the first push of the
      // session (which does one full scan to re-catch any edit whose push
      // never completed before a reload wiped the in-memory dirty set).
      if (known && !forceFullScan && !dirtyAtStart.has(k)) continue;
      const h = strHash(v);
      if (known && known.h === h) continue;
      changedMeta[k] = h;
      if (v.length <= KV_CHUNK) {
        rowsToWrite.push({ key: k, value: v, updatedAt: now });
      } else {
        const n = Math.ceil(v.length / KV_CHUNK);
        rowsToWrite.push({ key: k, value: KV_CHUNK_MARK + n, updatedAt: now });
        for (let i = 0; i < n; i++) rowsToWrite.push({ key: k + KV_CHUNK_SEP + i, value: v.slice(i * KV_CHUNK, (i + 1) * KV_CHUNK), updatedAt: now });
      }
    }
    const pushedCount = Object.keys(changedMeta).length;
    if (rowsToWrite.length) {
      // send in size-bounded batches so a single mutation call never exceeds arg limits
      let batch = [], size = 0;
      for (const r of rowsToWrite) {
        if (size + r.value.length > KV_BATCH_BYTES && batch.length) { await withTimeout(client.mutation(api.sync.setKVBatch, { token, entries: batch }), 30000, "setKVBatch"); batch = []; size = 0; }
        batch.push(r); size += r.value.length;
      }
      if (batch.length) await withTimeout(client.mutation(api.sync.setKVBatch, { token, entries: batch }), 30000, "setKVBatch");
      for (const k in changedMeta) meta[k] = { h: changedMeta[k], t: now };
    }
    setMeta(meta);
    // Push succeeded: the keys we accounted for above are no longer dirty.
    // Only remove what we snapshotted at the start — a key re-dirtied by a
    // live edit during this push (added to `dirtyKeys` but not in
    // `dirtyAtStart`) must stay dirty for the next push.
    for (const k of dirtyAtStart) dirtyKeys.delete(k);
    everPushedThisSession = true;
    // refresh the filename→URL map (presigned R2 GET urls) so this device renders cloud files
    try { localStorage.setItem("yn_file_map", JSON.stringify(await withTimeout(client.action(api.r2.presignDownloads, { token }), 30000, "presignDownloads"))); } catch (_) {}
    localStorage.setItem("yn_last_sync", String(Date.now()));
    updateSyncUi();
    setStatus(pushedCount ? `Pushed ${pushedCount} item${pushedCount > 1 ? "s" : ""}.` : "Nothing to push.");
    return { pushed: pushedCount };
  } catch (e) {
    setStatus(cleanErr(e), true);
    return { pushed: 0 };
  } finally {
    pushing = false;
  }
};

// Full sync: pull then push (used at startup / after sign-in). Kept as the
// single entry point those callers rely on.
window.syncNow = async function () {
  if (!client || !getToken() || pushing) return;
  setStatus("Syncing…");
  const pullRes = (await window.pullChanges({ reload: false })) || { pulled: 0, skipped: 0 };
  const pushRes = (await window.pushChanges()) || { pushed: 0 };
  const parts = [];
  if (pullRes.pulled) parts.push(`pulled ${pullRes.pulled}`);
  if (pullRes.skipped) parts.push(`skipped ${pullRes.skipped} local edit${pullRes.skipped > 1 ? "s" : ""}`);
  if (pushRes.pushed) parts.push(`pushed ${pushRes.pushed}`);
  setStatus(parts.length ? "Synced — " + parts.join(", ") + "." : "Synced ✓");
  if (pullRes.pulled > 0) setTimeout(() => location.reload(), 900);
};

// Called from the Storage override on every setItem — debounced auto-push
// (a full sync isn't needed for a local edit; pushing keeps it lightweight)
window.__syncNotifyChange = function (key) {
  if (!SYNC_KEYS.includes(key)) return;
  // Track dirtiness regardless of sign-in state — cheap, and means a push
  // right after a later sign-in already knows what changed.
  dirtyKeys.add(key);
  if (!client || !getToken()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => window.pushChanges(), 6000);
};

// ---------- UI ----------
window.updateSyncUi = function () {
  const token = getToken();
  const email = localStorage.getItem("yn_sync_email") || "";
  const out = document.getElementById("sync-signed-out");
  const inn = document.getElementById("sync-signed-in");
  if (out) out.style.display = token ? "none" : "";
  if (inn) inn.style.display = token ? "" : "none";
  const who = document.getElementById("sync-account-email");
  if (who) who.textContent = email;
  const last = document.getElementById("sync-last");
  if (last) {
    const t = parseInt(localStorage.getItem("yn_last_sync") || "0", 10);
    last.textContent = t ? "Last synced " + new Date(t).toLocaleString() : "Not synced yet";
  }
  const badge = document.getElementById("sync-not-configured");
  if (badge) badge.style.display = client ? "none" : "";
  // Prefill the email field on both the settings and onboarding sign-in UIs
  // from the last successful auth, so returning users don't retype it.
  if (email) {
    const emailEl = document.getElementById("sync-email");
    if (emailEl && !emailEl.value) emailEl.value = email;
    const onbEmailEl = document.getElementById("onboarding-sync-email");
    if (onbEmailEl && !onbEmailEl.value) onbEmailEl.value = email;
  }
};

// Electron has no password-manager autofill, so pull the remembered
// credentials (OS-encrypted via safeStorage in the main process) and fill
// both email+password fields ourselves. Async — runs once at startup.
async function prefillElectronCreds() {
  if (!(window.electronAPI && window.electronAPI.loadCred)) return;
  let creds;
  try { creds = await window.electronAPI.loadCred(); } catch (_) { creds = null; }
  if (!creds) return;
  const fields = [
    ["sync-email", "sync-password"],
    ["onboarding-sync-email", "onboarding-sync-pass"]
  ];
  for (const [emailId, passId] of fields) {
    const emailEl = document.getElementById(emailId);
    const passEl = document.getElementById(passId);
    if (emailEl && !emailEl.value && creds.email) emailEl.value = creds.email;
    if (passEl && !passEl.value && creds.password) passEl.value = creds.password;
  }
}

function initSync() {
  updateSyncUi();
  prefillElectronCreds();
  // signed in → sync shortly after startup (pull newer data from other devices)
  if (client && getToken()) setTimeout(() => window.syncNow(), 2500);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSync);
else initSync();
