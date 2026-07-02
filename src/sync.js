// ============================================================
// YourNotes Cloud Sync (Convex) — email/password login, per-key
// store sync, and file sync so notes + PDFs follow you across
// desktop and Android. Free tier, no card: convex.dev
// ============================================================
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || "";
const api = anyApi;

// Content keys that sync. Device-local keys (session token, sync metadata,
// haven prefs are fine to sync — they're preferences) — token/meta excluded.
const SYNC_KEYS = [
  "opennotes_data", "opennotes_college_folders", "opennotes_tasks", "opennotes_calendar_tasks",
  "opennotes_expenses", "opennotes_journal_text", "opennotes_journal_mood", "opennotes_mood_history",
  "opennotes_books", "opennotes_goals", "opennotes_habits", "opennotes_quicklinks",
  "opennotes_favourites", "opennotes_pinned_groups", "opennotes_home_sort", "opennotes_nav_order",
  "opennotes_board", "opennotes_theme", "opennotes_language", "opennotes_currency",
  "opennotes_currency_code", "opennotes_temp_unit", "opennotes_banner_text_color",
  "opennotes_haven_theme", "opennotes_haven_spot", "opennotes_haven_vol",
  "userName", "userRole", "opennotes_profile_name", "opennotes_profile_type",
  "dashboardTitle", "dashboardBanner", "opennotes_profile_pic", "opennotes_initialized"
];

const FILE_REF_RE = /file:\/\/\/[^"'\\\s]*\/(college_pdfs|banner_files|board_files)\/([A-Za-z0-9._-]+)/g;

let client = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
let pushTimer = null;
let pushing = false;

const getToken = () => { try { return localStorage.getItem("yn_sync_token") || ""; } catch (_) { return ""; } };
const getMeta = () => { try { return JSON.parse(localStorage.getItem("yn_sync_meta") || "{}"); } catch (_) { return {}; } };
const setMeta = (m) => { try { localStorage.setItem("yn_sync_meta", JSON.stringify(m)); } catch (_) {} };
const getFileMap = () => { try { return JSON.parse(localStorage.getItem("yn_file_map") || "{}"); } catch (_) { return {}; } };

function strHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

function setStatus(msg, isErr) {
  const el = document.getElementById("sync-status");
  if (el) { el.textContent = msg || ""; el.style.color = isErr ? "#ef4444" : "var(--text-secondary)"; }
}

// ---------- File resolution (cross-device) ----------
// Desktop stores app files as file:/// paths. Other devices resolve the same
// filename through the cloud file map instead.
window.resolveFileUrl = function (path) {
  if (!path || !String(path).startsWith("file:")) return path;
  if (window.electronAPI) return path; // this desktop owns the file
  const m = String(path).match(/\/([A-Za-z0-9._-]+)$/);
  const url = m && getFileMap()[m[1]];
  return url || path;
};

// ---------- Auth ----------
async function afterAuth(res) {
  localStorage.setItem("yn_sync_token", res.token);
  localStorage.setItem("yn_sync_email", res.email);
  updateSyncUi();
  setStatus("Signed in. Syncing…");
  await window.syncNow();
}

window.syncSignUp = async function () {
  if (!client) return setStatus("Sync isn't configured in this build.", true);
  const email = (document.getElementById("sync-email") || {}).value || "";
  const pw = (document.getElementById("sync-password") || {}).value || "";
  try { setStatus("Creating your account…"); await afterAuth(await client.action(api.auth.signUp, { email, password: pw })); }
  catch (e) { setStatus(cleanErr(e), true); }
};

window.syncSignIn = async function () {
  if (!client) return setStatus("Sync isn't configured in this build.", true);
  const email = (document.getElementById("sync-email") || {}).value || "";
  const pw = (document.getElementById("sync-password") || {}).value || "";
  try { setStatus("Signing in…"); await afterAuth(await client.action(api.auth.signIn, { email, password: pw })); }
  catch (e) { setStatus(cleanErr(e), true); }
};

window.syncSignOut = async function () {
  const token = getToken();
  if (client && token) { try { await client.mutation(api.sync.signOut, { token }); } catch (_) {} }
  localStorage.removeItem("yn_sync_token");
  localStorage.removeItem("yn_sync_email");
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
      if (!seen.has(m[2])) { seen.add(m[2]); refs.push({ full: m[0], name: m[2] }); }
    }
  }
  const uploaded = new Set(JSON.parse(localStorage.getItem("yn_synced_files") || "[]"));
  const todo = refs.filter((r) => !uploaded.has(r.name));
  let done = 0;
  for (const r of todo) {
    try {
      const bytes = await window.electronAPI.readFileBytes(r.full);
      if (!bytes) continue;
      const uploadUrl = await client.mutation(api.sync.genUploadUrl, { token });
      const resp = await fetch(uploadUrl, { method: "POST", body: new Blob([bytes]) });
      const { storageId } = await resp.json();
      await client.mutation(api.sync.registerFile, { token, localKey: r.name, storageId, name: r.name, size: bytes.length || bytes.byteLength || 0 });
      uploaded.add(r.name);
      localStorage.setItem("yn_synced_files", JSON.stringify([...uploaded]));
      done++;
      setStatus(`Uploading files… ${done}/${todo.length}`);
    } catch (e) { console.warn("file upload failed", r.name, e); }
  }
}

window.syncNow = async function () {
  const token = getToken();
  if (!client || !token || pushing) return;
  pushing = true;
  try {
    setStatus("Syncing…");
    // 1) pull newer keys from the cloud
    const meta = getMeta();
    const rows = await client.query(api.sync.getAll, { token });
    let pulled = 0;
    for (const row of rows) {
      const known = meta[row.key];
      if (!known || row.updatedAt > known.t) {
        if (!known || strHash(localStorage.getItem(row.key) || "") !== strHash(row.value)) {
          localStorage.setItem(row.key, row.value);
          pulled++;
        }
        meta[row.key] = { h: strHash(row.value), t: row.updatedAt };
      }
    }
    // 2) push keys that changed locally
    const entries = [];
    const now = Date.now();
    for (const k of SYNC_KEYS) {
      const v = localStorage.getItem(k);
      if (v === null || v === undefined) continue;
      const h = strHash(v);
      if (meta[k] && meta[k].h === h) continue;
      entries.push({ key: k, value: v, updatedAt: now });
    }
    if (entries.length) {
      await uploadReferencedFiles(token, entries.map((e) => e.value));
      await client.mutation(api.sync.setKVBatch, { token, entries });
      for (const e of entries) meta[e.key] = { h: strHash(e.value), t: e.updatedAt };
    }
    setMeta(meta);
    // 3) refresh the filename→URL map so this device can render cloud files
    try { localStorage.setItem("yn_file_map", JSON.stringify(await client.query(api.sync.fileUrls, { token }))); } catch (_) {}
    localStorage.setItem("yn_last_sync", String(Date.now()));
    updateSyncUi();
    setStatus(pulled ? `Synced — ${pulled} item${pulled > 1 ? "s" : ""} updated from the cloud.` : "Synced ✓");
    if (pulled > 0) setTimeout(() => location.reload(), 900);
  } catch (e) {
    setStatus(cleanErr(e), true);
  } finally {
    pushing = false;
  }
};

// Called from the Storage override on every setItem — debounced auto-push
window.__syncNotifyChange = function (key) {
  if (!client || !getToken()) return;
  if (!SYNC_KEYS.includes(key)) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => window.syncNow(), 6000);
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
};

function initSync() {
  updateSyncUi();
  // signed in → sync shortly after startup (pull newer data from other devices)
  if (client && getToken()) setTimeout(() => window.syncNow(), 2500);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSync);
else initSync();
