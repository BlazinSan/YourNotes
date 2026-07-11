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

// File paths are embedded in several JSON/HTML values.  The previous scanner
// stopped at whitespace and only accepted ASCII basenames, so e.g.
// `Project notes 课件.pdf` was truncated before upload.  It also keyed every
// remote object by basename, allowing equally named files in different app
// directories to overwrite one another.  Parse JSON values into their string
// leaves where possible, then scan complete file URLs/Windows paths and use a
// directory-qualified key (`board_files/<name>`, etc.).  Download resolution
// retains the old basename lookup as a migration fallback.
const FILE_REF_RE = /(?:file:\/\/\/|[A-Za-z]:[\\/])[^"'<>\r\n]*?(college_pdfs|banner_files|board_files)[\\/]+([^"'<>\r\n\\/]+)/giu;

function decodeFilePart(value) {
  try { return decodeURIComponent(String(value)); }
  catch (_) { return String(value); }
}

function fileLocalKey(kind, name) {
  return `${String(kind || '').toLowerCase()}/${String(name || '').normalize('NFC')}`;
}

function localFileUrl(value) {
  const normalized = String(value || '').replace(/^file:\/+/i, '').replace(/\\/g, '/').replace(/^\/+/, '');
  return 'file:///' + normalized.split('/').map((part, index) => {
    if (index === 0 && /^[A-Za-z]:$/.test(part)) return part;
    try { return encodeURIComponent(decodeURIComponent(part)); }
    catch (_) { return encodeURIComponent(part); }
  }).join('/');
}

// read-file-bytes accepts an OS path but its legacy main-process bridge still
// performs one decodeURIComponent pass. Protect literal percent characters so
// a valid filename such as `100% complete.pdf` survives that single decode.
function fileReadIpcPath(value) {
  return String(value || '').replace(/%/g, '%25');
}

function fileRefsInString(value) {
  const source = String(value || '');
  if (!/(?:college_pdfs|banner_files|board_files)/i.test(source)) return [];
  const refs = [];
  FILE_REF_RE.lastIndex = 0;
  let match;
  while ((match = FILE_REF_RE.exec(source)) !== null) {
    const encodedUrl = /^file:/i.test(match[0]);
    const kind = String(match[1] || '').toLowerCase();
    const name = encodedUrl ? decodeFilePart(match[2]) : String(match[2]);
    let full = (encodedUrl ? decodeFilePart(match[0]) : String(match[0])).replace(/^file:\/\//i, '');
    if (/^\/[A-Za-z]:[\\/]/.test(full)) full = full.slice(1);
    full = full.replace(/\\\\/g, '\\');
    refs.push({ full, kind, name, localKey: fileLocalKey(kind, name) });
  }
  return refs;
}

function extractFileRefs(value) {
  const strings = [];
  try {
    const root = JSON.parse(String(value));
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      if (typeof current === 'string') strings.push(current);
      else if (Array.isArray(current)) stack.push(...current);
      else if (current && typeof current === 'object') stack.push(...Object.values(current));
    }
  } catch (_) {
    strings.push(String(value || ''));
  }
  return strings.flatMap(fileRefsInString);
}

// Convex caps a single stored value at 1 MiB. Split larger values across chunk
// rows so any size (big note sets, inline base64 banners, etc.) syncs reliably.
const KV_CHUNK = 700000;
const KV_CHUNK_SEP = "c";           // separator that can't occur in a real key
const KV_CHUNK_MARK = "YNCHUNKS";    // main-row sentinel: "reassemble from N chunks"
const KV_DELETE_MARK = "YNDELETED";  // durable tombstone so removals reach every device
const KV_DELETE_HASH = "deleted";               // deliberately outside strHash's numeric range
const KV_BATCH_BYTES = 12000000;                 // below Convex's request cap; keeps one logical key atomic
const INLINE_R2_MIGRATION_KEY = "yn_r2_inline_migration_v1";
const SYNC_CURSOR_KEY = "yn_sync_cursor_v2";
const UNVERSIONED_OWNER_KEY = "yn_sync_unversioned_owner";
const ACCOUNT_BOOTSTRAP_KEY = "yn_sync_bootstrap_account";
const ACCOUNT_SYNC_STATE_KEYS = [
  "yn_sync_meta", SYNC_CURSOR_KEY, "yn_file_map", "yn_file_map_refresh_at",
  "yn_synced_files", "yn_last_sync", INLINE_R2_MIGRATION_KEY, UNVERSIONED_OWNER_KEY,
];

// FileReader/canvas data URLs used to be hidden inside otherwise-normal KV
// values (notes, mobile PDFs, board images, profile photos and banners). That
// still charged their bytes to Convex database storage/I/O even though regular
// path-based files already used R2. Outgoing values now replace these bytes
// with a short content-addressed marker; only R2 receives the body.
const INLINE_DATA_URL_RE = /data:([A-Za-z][A-Za-z0-9.+-]*\/[A-Za-z0-9][A-Za-z0-9.+-]*)(?:;[^,;"'\s]+)*,[^"'<>()\s\\]+/gi;
const INLINE_R2_MARKER_RE = /yn-r2:\/\/(inline\/[a-f0-9]{64})\?type=([A-Za-z0-9%._~-]+)/gi;

function containsInlineDataUrl(value) {
  const source = String(value || "");
  if (!source.includes("data:")) return false;
  INLINE_DATA_URL_RE.lastIndex = 0;
  const found = INLINE_DATA_URL_RE.test(source);
  INLINE_DATA_URL_RE.lastIndex = 0;
  return found;
}

const isChunkKey = (k) => k.indexOf(KV_CHUNK_SEP) !== -1;

let client = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
let pushTimer = null;
let pushing = false;
let syncEpoch = 0;
let syncTransitioning = false;
let applyingRemoteValue = false;

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
let dirtyVersions = new Map();
let dirtyClock = 0;
let everPushedThisSession = false;

function currentSyncAccount() {
  return String(localStorage.getItem("yn_sync_account") || localStorage.getItem("yn_sync_email") || "").trim().toLowerCase();
}

function markDirtyKey(key) {
  dirtyKeys.add(key);
  dirtyVersions.set(key, ++dirtyClock);
}

function captureSyncSession(token) {
  return { epoch: syncEpoch, token: token || getToken(), account: currentSyncAccount() };
}

function assertSyncSession(session) {
  if (!session || session.epoch !== syncEpoch || session.token !== getToken() || session.account !== currentSyncAccount()) {
    throw new Error("The sync account changed before this operation finished; stale results were discarded");
  }
}

async function waitForSyncIdle() {
  const deadline = Date.now() + 35000;
  while (pushing) {
    if (Date.now() >= deadline) throw new Error("Could not safely change accounts while sync is still running");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function scheduleAutoPush(delay) {
  if (!client || !getToken()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (pushing || syncTransitioning) {
      scheduleAutoPush(1500);
      return;
    }
    const result = await window.pushChanges();
    if (result && result.ok === true && dirtyKeys.size && client && getToken()) {
      scheduleAutoPush(1500);
    }
  }, delay || 6000);
}

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

async function fetchWithTimeout(input, init, ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 30000);
  try {
    return await fetch(input, { ...(init || {}), signal: controller.signal });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("Sync timed out — check connection" + (label ? " (" + label + ")" : ""));
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Electron: token lives in an OS-keychain-backed safeStorage file (main process),
// never plaintext on disk. Other platforms (browser/Capacitor) fall back to localStorage.
const getToken = () => {
  try {
    if (window.electronAPI && window.electronAPI.tokenGet) {
      let t = window.electronAPI.tokenGet() || "";
      // One-time migration: an existing plaintext localStorage token gets moved
      // into safeStorage the first time we run, then wiped from localStorage.
      if (!t) {
        const legacy = localStorage.getItem("yn_sync_token") || "";
        if (legacy) { try { window.electronAPI.tokenSet(legacy); } catch (_) {} localStorage.removeItem("yn_sync_token"); t = legacy; }
      }
      return t;
    }
    return localStorage.getItem("yn_sync_token") || "";
  } catch (_) { return ""; }
};
const setToken = (t) => {
  const next = String(t || "");
  if (window.electronAPI && window.electronAPI.tokenSet) {
    if (window.electronAPI.tokenSet(next) !== true) {
      throw new Error("Could not securely store the sync session on this device");
    }
    localStorage.removeItem("yn_sync_token");
  } else if (next) {
    localStorage.setItem("yn_sync_token", next);
  } else {
    localStorage.removeItem("yn_sync_token");
  }
  if (getToken() !== next) throw new Error("Could not verify the stored sync session");
};
const getMeta = () => { try { return JSON.parse(localStorage.getItem("yn_sync_meta") || "{}"); } catch (_) { return {}; } };
const setMeta = (m) => localStorage.setItem("yn_sync_meta", JSON.stringify(m));
const getFileMap = () => { try { return JSON.parse(localStorage.getItem("yn_file_map") || "{}"); } catch (_) { return {}; } };

function getUploadedFileKeys() {
  try { return new Set(JSON.parse(localStorage.getItem("yn_synced_files") || "[]")); }
  catch (_) { return new Set(); }
}

function saveUploadedFileKeys(keys) {
  localStorage.setItem("yn_synced_files", JSON.stringify([...keys]));
}

function strHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

function utf8Size(value) {
  const source = String(value || "");
  let bytes = 0;
  for (let index = 0; index < source.length;) {
    const codePoint = source.codePointAt(index);
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

function splitUtf8(value, maxBytes) {
  const source = String(value || "");
  if (utf8Size(source) <= maxBytes) return [source];
  const chunks = [];
  let start = 0;
  let index = 0;
  let bytes = 0;
  while (index < source.length) {
    const codePoint = source.codePointAt(index);
    const width = codePoint > 0xffff ? 2 : 1;
    const nextBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + nextBytes > maxBytes && index > start) {
      chunks.push(source.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += nextBytes;
    index += width;
  }
  if (start < source.length) chunks.push(source.slice(start));
  return chunks;
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
  if (!path || !/^file:/i.test(String(path))) return path;
  const ref = fileRefsInString(path)[0];
  if (window.electronAPI) {
    // This desktop only "owns" the file if it's actually on disk here — a
    // path pinned on another machine won't exist locally, so fall through
    // to the cloud file map instead of returning a dead file:// URL.
    if (window.electronAPI.fileExists) {
      // Probe the decoded OS path. Passing an encoded file URL directly made
      // spaces, #, %, and non-ASCII names look missing even when the file was
      // present on this desktop.
      const localPath = ref ? ref.full : path;
      let exists = fileExistsCache.get(localPath);
      if (exists === undefined) {
        exists = window.electronAPI.fileExists(localPath);
        fileExistsCache.set(localPath, exists);
      }
      if (exists) return ref ? localFileUrl(ref.full) : path;
    } else {
      return path; // older preload without the check
    }
  }
  const map = getFileMap();
  const url = ref && (map[ref.localKey] || map[ref.name]);
  return url || path;
};

// ---------- Auth ----------
function captureSyncWorkspace() {
  const snapshot = {};
  for (const key of SYNC_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null && value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

function hasMeaningfulGuestWorkspace() {
  try {
    const notes = JSON.parse(localStorage.getItem("opennotes_data") || "[]");
    if (Array.isArray(notes)) {
      const nonWelcome = notes.filter((note) => {
        const title = String(note && note.title || "").trim();
        const body = String(note && note.body || "").trim();
        return title !== "Welcome to YourNotes" || body !== "This is your first note. Start typing...";
      });
      if (nonWelcome.length || notes.length > 1) return true;
    }
  } catch (_) {
    if (localStorage.getItem("opennotes_data")) return true;
  }
  for (const key of [
    "opennotes_college_folders", "opennotes_tasks", "opennotes_calendar_tasks",
    "opennotes_expenses", "opennotes_mood_history", "opennotes_books",
    "opennotes_goals", "opennotes_habits", "opennotes_board", "opennotes_quicklinks",
  ]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (Array.isArray(value) ? value.length > 0 : value && typeof value === "object" ? Object.keys(value).length > 0 : Boolean(value)) return true;
    } catch (_) { return true; }
  }
  return Boolean(
    String(localStorage.getItem("opennotes_journal_text") || "").trim()
    || localStorage.getItem("dashboardTitle")
    || localStorage.getItem("dashboardBanner")
    || localStorage.getItem("opennotes_profile_pic")
  );
}

function captureAccountWorkspace() {
  const syncState = {};
  for (const key of ACCOUNT_SYNC_STATE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null && value !== undefined) syncState[key] = value;
  }
  return { version: 2, values: captureSyncWorkspace(), syncState };
}

function accountWorkspacesEqual(left, right) {
  const recordsEqual = (a, b) => {
    const safeA = a && typeof a === "object" ? a : {};
    const safeB = b && typeof b === "object" ? b : {};
    const keysA = Object.keys(safeA);
    const keysB = Object.keys(safeB);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.prototype.hasOwnProperty.call(safeB, key)
      && String(safeA[key]) === String(safeB[key]));
  };
  return recordsEqual(left && left.values, right && right.values)
    && recordsEqual(left && left.syncState, right && right.syncState);
}

function applyAccountWorkspace(snapshot) {
  const modern = snapshot && snapshot.version === 2 && snapshot.values && typeof snapshot.values === "object";
  replaceSyncWorkspace(modern ? snapshot.values : (snapshot || {}));
  for (const key of ACCOUNT_SYNC_STATE_KEYS) localStorage.removeItem(key);
  if (modern && snapshot.syncState && typeof snapshot.syncState === "object") {
    for (const key of ACCOUNT_SYNC_STATE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(snapshot.syncState, key)) {
        localStorage.setItem(key, String(snapshot.syncState[key]));
      }
    }
  }
  return { found: Boolean(snapshot), hasSyncState: Boolean(modern) };
}

function replaceSyncWorkspace(snapshot) {
  const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  for (const key of SYNC_KEYS) localStorage.removeItem(key);
  for (const key of SYNC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(safeSnapshot, key)) {
      localStorage.setItem(key, String(safeSnapshot[key]));
    }
  }
}

function accountWorkspaceDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (accountWorkspaceDb._promise) return accountWorkspaceDb._promise;
  accountWorkspaceDb._promise = new Promise((resolve) => {
    const req = indexedDB.open("yn-account-workspaces", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("workspaces")) req.result.createObjectStore("workspaces");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return accountWorkspaceDb._promise;
}

async function writeAccountWorkspace(account, snapshot) {
  const db = await accountWorkspaceDb();
  if (!db || !account) return false;
  return new Promise((resolve) => {
    const tx = db.transaction("workspaces", "readwrite");
    tx.objectStore("workspaces").put(snapshot, account);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

async function readAccountWorkspace(account) {
  const db = await accountWorkspaceDb();
  if (!db || !account) throw new Error("Account workspaces are unavailable on this device");
  return new Promise((resolve, reject) => {
    const req = db.transaction("workspaces", "readonly").objectStore("workspaces").get(account);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not load account workspace"));
  });
}

function prepareLoadedAccountSyncState() {
  fileExistsCache.clear();
  dirtyKeys = new Set();
  dirtyVersions = new Map();
  for (const key of SYNC_KEYS) markDirtyKey(key);
  everPushedThisSession = false;
}

function clearAccountSyncState() {
  for (const key of ACCOUNT_SYNC_STATE_KEYS) localStorage.removeItem(key);
  prepareLoadedAccountSyncState();
}

function restoreAuthSnapshot(snapshot, account, email, token, restoreWorkspace = true) {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (restoreWorkspace) applyAccountWorkspace(snapshot);
  if (account) localStorage.setItem("yn_sync_account", account);
  else localStorage.removeItem("yn_sync_account");
  if (email) localStorage.setItem("yn_sync_email", email);
  else localStorage.removeItem("yn_sync_email");
  setToken(token || "");
  prepareLoadedAccountSyncState();
}

async function afterAuth(res, pw, authKind) {
  const account = String(res.email || "").trim().toLowerCase();
  const previousAccount = String(localStorage.getItem("yn_sync_account") || localStorage.getItem("yn_sync_email") || "").trim().toLowerCase();
  const previousEmail = localStorage.getItem("yn_sync_email") || "";
  const previousToken = getToken();
  let previousWorkspace = null;
  let switchedAccounts = false;
  let workspaceReplaced = false;
  let loadedAccountFound = false;
  let meaningfulGuestWorkspace = false;
  syncTransitioning = true;
  try {
    clearTimeout(pushTimer);
    pushTimer = null;
    await waitForSyncIdle();
    // Capture rollback state only after the previous account's active sync is
    // fully idle; an edit made while we were waiting must be part of A's
    // recoverable snapshot.
    previousWorkspace = captureAccountWorkspace();
    meaningfulGuestWorkspace = !previousAccount && hasMeaningfulGuestWorkspace();
    syncEpoch++;
    if (previousAccount && account && previousAccount !== account) {
      // Preserve A locally, replace the active workspace with B's isolated
      // snapshot (or empty state), then force B's first operation to be a full
      // pull. This prevents an A-only key from being displayed or pushed to B.
      // Read B before the final A snapshot. The stable-write loop then captures
      // every A edit that landed while IndexedDB was busy. Once its revision is
      // unchanged, install B immediately in this same JS turn (with no await in
      // between), so a late autosave cannot fall through the handoff gap.
      const nextWorkspace = await readAccountWorkspace(account);
      const preserveDeadline = Date.now() + 35000;
      while (true) {
        const revision = dirtyClock;
        const stablePreviousWorkspace = captureAccountWorkspace();
        if (!await writeAccountWorkspace(previousAccount, stablePreviousWorkspace)) {
          throw new Error("Could not safely preserve the current account before switching");
        }
        const workspaceAfterWrite = captureAccountWorkspace();
        if (dirtyClock !== revision || !accountWorkspacesEqual(stablePreviousWorkspace, workspaceAfterWrite)) {
          if (Date.now() >= preserveDeadline) {
            throw new Error("Could not safely change accounts while local edits are still being saved");
          }
          continue;
        }
        previousWorkspace = stablePreviousWorkspace;
        workspaceReplaced = true;
        const loadedAccount = applyAccountWorkspace(nextWorkspace);
        loadedAccountFound = loadedAccount.found;
        if (loadedAccount.hasSyncState) prepareLoadedAccountSyncState();
        else clearAccountSyncState();
        switchedAccounts = true;
        break;
      }
    }
    if (account) localStorage.setItem("yn_sync_account", account);
    setToken(res.token);
    localStorage.setItem("yn_sync_email", res.email);
    const ownsUnversionedLocal = authKind === "up"
      || Boolean(previousAccount && previousAccount === account)
      || Boolean(switchedAccounts && loadedAccountFound)
      || meaningfulGuestWorkspace;
    if (ownsUnversionedLocal && account) localStorage.setItem(UNVERSIONED_OWNER_KEY, account);
    else localStorage.removeItem(UNVERSIONED_OWNER_KEY);
  } catch (error) {
    syncEpoch++;
    if (previousWorkspace) {
      // Before B has replaced A, preserve any edit that arrived during an
      // IndexedDB read/write failure instead of rolling back to the older
      // pre-await snapshot. After replacement, the stable A snapshot is the
      // authoritative rollback source.
      if (!workspaceReplaced) previousWorkspace = captureAccountWorkspace();
      try {
        restoreAuthSnapshot(previousWorkspace, previousAccount, previousEmail, previousToken, workspaceReplaced);
      } catch (_) {
        try { setToken(""); } catch (_) {}
        throw new Error("Account switching failed and the previous workspace could not be safely restored");
      }
    }
    throw error;
  } finally {
    syncTransitioning = false;
  }
  // Electron has no built-in password manager — remember the credentials
  // ourselves via OS-encrypted storage (safeStorage) in the main process.
  if (window.electronAPI && window.electronAPI.saveCred && pw) {
    try { window.electronAPI.saveCred(res.email, pw); } catch (_) {}
  }
  updateSyncUi();
  setStatus("Signed in. Syncing…");
  if (!previousAccount || switchedAccounts) {
    // main.js still holds the previous/guest account's aggregate arrays in
    // memory. Reload immediately into the installed account before any cloud
    // call so a late autosave cannot write A data under B's token. initSync()
    // performs the first sync behind a small blocking account-loading panel.
    localStorage.setItem(ACCOUNT_BOOTSTRAP_KEY, account);
    location.reload();
    return { reloading: true };
  }
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
    const outcome = await afterAuth(res, pw, kind);
    if (outcome && outcome.reloading) return false;
    return true;
  } catch (e) { setStatus(cleanErr(e), true); return false; }
}
window.syncSignUp = () => doAuth("up", fieldVal("sync-email"), fieldVal("sync-password"), "sync-status");
window.syncSignIn = () => doAuth("in", fieldVal("sync-email"), fieldVal("sync-password"), "sync-status");
// Used by the onboarding overlay (optional sign-in). Returns true on success.
window.onboardingAuth = (kind) => doAuth(kind, fieldVal("onboarding-sync-email"), fieldVal("onboarding-sync-pass"), "onboarding-sync-status");

window.syncSignOut = async function () {
  syncTransitioning = true;
  try {
    clearTimeout(pushTimer);
    pushTimer = null;
    await waitForSyncIdle();
    const token = getToken();
    if (client && token) { try { await withTimeout(client.mutation(api.sync.signOut, { token }), 30000, "signOut"); } catch (_) {} }
    syncEpoch++;
    setToken("");
    localStorage.removeItem("yn_sync_email");
    // Keep this account's hashes/cursor while signed out. Local edits made in
    // that state can then be recognized and pushed on same-account sign-in,
    // instead of an unversioned pull overwriting them. A different-account
    // sign-in still clears these records in the isolated switch path above.
    everPushedThisSession = false;
    if (window.electronAPI && window.electronAPI.clearCred) { try { window.electronAPI.clearCred(); } catch (_) {} }
  } finally {
    syncTransitioning = false;
  }
  updateSyncUi();
  setStatus("Signed out. Your data stays on this device.");
};

function cleanErr(e) {
  const m = String((e && e.message) || e);
  const i = m.indexOf("Uncaught Error: ");
  return (i >= 0 ? m.slice(i + 16) : m).split("\n")[0].slice(0, 140);
}

// ---------- R2 object + inline-asset helpers ----------
function inlineAssetDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (inlineAssetDb._promise) return inlineAssetDb._promise;
  inlineAssetDb._promise = new Promise((resolve) => {
    const req = indexedDB.open("yn-r2-assets", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("blobs")) req.result.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return inlineAssetDb._promise;
}

async function cachedInlineBlob(localKey) {
  const db = await inlineAssetDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const account = String(localStorage.getItem("yn_sync_account") || localStorage.getItem("yn_sync_email") || "legacy").toLowerCase();
    const req = db.transaction("blobs", "readonly").objectStore("blobs").get(`${account}:${localKey}`);
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
    req.onerror = () => resolve(null);
  });
}

async function cacheInlineBlob(localKey, blob) {
  const db = await inlineAssetDb();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction("blobs", "readwrite");
    const account = String(localStorage.getItem("yn_sync_account") || localStorage.getItem("yn_sync_email") || "legacy").toLowerCase();
    tx.objectStore("blobs").put(blob, `${account}:${localKey}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read cloud file"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl, expectedMime = "application/octet-stream") {
  const source = String(dataUrl || "");
  const comma = source.indexOf(",");
  if (comma < 5 || !source.toLowerCase().startsWith("data:")) {
    throw new Error("Could not prepare embedded file for R2");
  }
  const header = source.slice(5, comma);
  const parts = header.split(";");
  const mime = String(parts[0] || expectedMime || "application/octet-stream").toLowerCase();
  const encoded = source.slice(comma + 1);
  try {
    if (parts.some((part) => part.toLowerCase() === "base64")) {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(encoded)], { type: mime });
  } catch {
    throw new Error(`Could not decode embedded ${mime} for R2`);
  }
}

async function sha256Hex(bytes) {
  if (!(globalThis.crypto && globalThis.crypto.subtle)) throw new Error("This device cannot securely hash an R2 upload");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function inlineAssetName(hash, mime) {
  const ext = mime === "application/pdf" ? "pdf"
    : mime === "image/jpeg" ? "jpg"
      : mime === "image/png" ? "png"
        : mime === "image/webp" ? "webp"
          : mime === "image/gif" ? "gif" : "bin";
  return `inline-${hash.slice(0, 16)}.${ext}`;
}

async function externalizeInlineData(value, assetMap) {
  const source = String(value || "");
  if (!source.includes("data:")) return source;
  const matches = [...source.matchAll(INLINE_DATA_URL_RE)];
  if (!matches.length) return source;
  const replacements = new Map();
  let cursor = 0;
  let out = "";
  for (const match of matches) {
    const dataUrl = match[0];
    let marker = replacements.get(dataUrl);
    if (!marker) {
      const mime = String(match[1] || "application/octet-stream").toLowerCase();
      const blob = dataUrlToBlob(dataUrl, mime);
      const buffer = await blob.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const localKey = `inline/${hash}`;
      marker = `yn-r2://${localKey}?type=${encodeURIComponent(mime)}`;
      replacements.set(dataUrl, marker);
      if (!assetMap.has(localKey)) {
        assetMap.set(localKey, {
          localKey,
          name: inlineAssetName(hash, mime),
          size: blob.size,
          contentType: mime,
          required: true,
          // Keep large bodies out of the JS heap while the remaining values
          // are scanned. IndexedDB supplies it lazily during the sequential PUT.
          loadBody: async () => {
            const cached = await cachedInlineBlob(localKey);
            if (cached) return cached;
            return dataUrlToBlob(dataUrl, mime);
          },
        });
        await cacheInlineBlob(localKey, blob);
      }
    }
    out += source.slice(cursor, match.index) + marker;
    cursor = match.index + dataUrl.length;
  }
  return out + source.slice(cursor);
}

async function hydrateInlineData(value, fileMap) {
  const source = String(value || "");
  if (!source.includes("yn-r2://inline/")) return source;
  const matches = [...source.matchAll(INLINE_R2_MARKER_RE)];
  if (!matches.length) return source;
  const replacements = new Map();
  let cursor = 0;
  let out = "";
  for (const match of matches) {
    const marker = match[0];
    const localKey = match[1];
    const mime = decodeURIComponent(match[2] || "application/octet-stream");
    let dataUrl = replacements.get(marker);
    if (!dataUrl) {
      let blob = await cachedInlineBlob(localKey);
      if (!blob) {
        const url = fileMap[localKey];
        if (!url) throw new Error(`R2 metadata is missing for ${localKey}`);
        const response = await fetchWithTimeout(url, null, 30000, "R2 download");
        if (!response.ok) throw new Error(`R2 download failed (${response.status})`);
        const buffer = await response.arrayBuffer();
        const actualHash = await sha256Hex(buffer);
        if (localKey !== `inline/${actualHash}`) throw new Error("R2 file integrity check failed");
        blob = new Blob([buffer], { type: mime });
        await cacheInlineBlob(localKey, blob);
      } else if (blob.type !== mime) {
        blob = new Blob([blob], { type: mime });
      }
      dataUrl = await blobToDataUrl(blob);
      replacements.set(marker, dataUrl);
    }
    out += source.slice(cursor, match.index) + dataUrl;
    cursor = match.index + marker.length;
  }
  return out + source.slice(cursor);
}

async function refreshFileMap(token, force, session) {
  const cached = getFileMap();
  const refreshAt = parseInt(localStorage.getItem("yn_file_map_refresh_at") || "0", 10);
  if (!force && refreshAt > Date.now()) return cached;
  const map = await withTimeout(client.action(api.r2.presignDownloads, { token }), 30000, "presignDownloads");
  if (session) assertSyncSession(session);
  localStorage.setItem("yn_file_map", JSON.stringify(map || {}));
  // Server URLs last seven days; refresh one day early.
  localStorage.setItem("yn_file_map_refresh_at", String(Date.now() + 6 * 24 * 60 * 60 * 1000));
  return map || {};
}

function missingBatchFunction(error, functionName) {
  const message = String((error && error.message) || error);
  return message.includes(functionName) && /(?:could not find|not found|does not exist)/i.test(message);
}

async function presignUploadBatch(token, keys) {
  try {
    return await withTimeout(client.action(api.r2.presignUploads, { token, keys }), 30000, "presignUploads");
  } catch (error) {
    if (!missingBatchFunction(error, "presignUploads")) throw error;
    const legacy = [];
    for (const key of keys) {
      const signed = await withTimeout(client.action(api.r2.presignUpload, { token, key }), 30000, "presignUpload");
      legacy.push({ key, ...signed });
    }
    return legacy;
  }
}

async function registerR2Batch(token, files) {
  try {
    await withTimeout(client.mutation(api.sync.registerFiles, { token, files }), 30000, "registerFiles");
  } catch (error) {
    if (!missingBatchFunction(error, "registerFiles")) throw error;
    for (const file of files) {
      await withTimeout(client.mutation(api.sync.registerFile, { token, ...file }), 30000, "registerFile");
    }
  }
}

async function uploadR2Objects(token, objects) {
  const deduped = new Map();
  for (const object of objects) if (object && object.localKey && !deduped.has(object.localKey)) deduped.set(object.localKey, object);
  const uploaded = getUploadedFileKeys();
  const knownRemote = getFileMap();
  // The signed download map is backed by registered Convex metadata, so its
  // presence is stronger evidence than device-local upload history. This also
  // prevents a newly signed-in phone from re-uploading an object it just read.
  for (const localKey of deduped.keys()) if (knownRemote[localKey]) uploaded.add(localKey);
  saveUploadedFileKeys(uploaded);
  const todo = [...deduped.values()].filter((object) => !knownRemote[object.localKey] && !uploaded.has(object.localKey));
  let completed = 0;
  for (let offset = 0; offset < todo.length; offset += 50) {
    const group = todo.slice(offset, offset + 50);
    const signed = await presignUploadBatch(token, group.map((object) => object.localKey));
    const signedByKey = new Map(signed.map((entry) => [entry.key, entry]));
    const registered = [];
    for (const object of group) {
      const target = signedByKey.get(object.localKey);
      if (!target) throw new Error(`R2 did not sign ${object.localKey}`);
      let body = object.body || null;
      if (!body && typeof object.loadBody === "function") {
        try { body = await object.loadBody(); }
        catch (error) { console.warn("file read failed", object.localKey, error); }
      }
      // A stale local path or deleted IndexedDB blob is not uploaded, and its
      // metadata is not registered. Required inline assets always have their
      // data-URL fallback, so they do not silently reach the KV write below.
      if (!body) {
        if (object.required) throw new Error(`Could not read required R2 file ${object.localKey}`);
        continue;
      }
      const contentType = body.type || object.contentType || "application/octet-stream";
      let response;
      if (window.electronAPI && window.electronAPI.putR2) {
        response = await withTimeout(
          window.electronAPI.putR2(target.url, contentType, await body.arrayBuffer()),
          30000,
          "R2 upload"
        );
      } else {
        response = await fetchWithTimeout(target.url, {
          method: "PUT",
          body,
          headers: { "content-type": contentType },
        }, 30000, "R2 upload");
      }
      if (!response.ok) throw new Error(`R2 upload failed (${response.status})`);
      registered.push({
        localKey: object.localKey,
        r2Key: target.r2Key,
        name: object.name || object.localKey,
        size: Number(body.size ?? body.byteLength ?? object.size) || 0,
      });
      completed++;
      setStatus(`Uploading files to R2… ${completed}/${todo.length}`);
    }
    if (registered.length) await registerR2Batch(token, registered);
    for (const file of registered) uploaded.add(file.localKey);
    saveUploadedFileKeys(uploaded);
  }
  return completed;
}

// ---------- Push ----------
async function collectReferencedFiles(values) {
  if (!(window.electronAPI && window.electronAPI.readFileBytes)) return []; // files originate on desktop
  const seen = new Set();
  const refs = [];
  for (const v of values) {
    for (const ref of extractFileRefs(v)) {
      if (!seen.has(ref.localKey)) {
        seen.add(ref.localKey);
        refs.push(ref);
      }
    }
  }
  const objects = [];
  for (const r of refs) {
    const ct = guessType(r.name);
    objects.push({
      localKey: r.localKey,
      name: r.name,
      contentType: ct,
      loadBody: async () => {
        const bytes = await window.electronAPI.readFileBytes(fileReadIpcPath(r.full));
        return bytes ? new Blob([bytes], { type: ct }) : null;
      },
    });
  }
  return objects;
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
async function collectBoardBlobs() {
  let items;
  try { items = JSON.parse(localStorage.getItem('opennotes_board') || '[]'); } catch (_) { items = []; }
  const withBlobs = (items || []).filter((it) => it && it.fileId);
  const objects = [];
  for (const it of withBlobs) {
    const name = 'blob_' + it.fileId;
    const fallbackType = guessType(it.name || '');
    objects.push({
      localKey: name,
      name: it.name || name,
      contentType: it.mime || fallbackType,
      loadBody: async () => getBoardBlob(it.fileId),
    });
  }
  return objects;
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
  if (!client || !token || pushing || syncTransitioning) return { pulled: 0, skipped: 0, ok: false };
  const session = captureSyncSession(token);
  let storageMayHaveChanged = false;
  pushing = true;
  try {
    setStatus("Pulling…");
    fileExistsCache.clear();
    const meta = getMeta();
    let fileMap = getFileMap();
    let forcedFileMapRefresh = false;

    let rows;
    let serverCursor = 0;
    let incremental = false;
    const since = parseInt(localStorage.getItem(SYNC_CURSOR_KEY) || "0", 10) || 0;
    try {
      const result = await withTimeout(client.query(api.sync.getChanges, { token, since }), 30000, "getChanges");
      assertSyncSession(session);
      rows = Array.isArray(result && result.rows) ? result.rows : [];
      serverCursor = Number(result && (result.cursor ?? result.serverTime)) || 0;
      incremental = true;
    } catch (error) {
      // Safe staged rollout: an app updated before the Convex functions falls
      // back to the old full query. Other errors are not retried blindly.
      if (!missingBatchFunction(error, "getChanges")) throw error;
      rows = await withTimeout(client.query(api.sync.getAll, { token }), 30000, "getAll");
      assertSyncSession(session);
    }
    // Avoid a full Convex file-manifest read for text-only syncs and while all
    // referenced blobs are already in IndexedDB. The six-day signed-URL cache
    // is refreshed only when rows can actually contain an R2 marker.
    if (rows.some((row) => typeof row.value === "string" && row.value.includes("yn-r2://"))) {
      try {
        fileMap = await refreshFileMap(token, false, session);
        assertSyncSession(session);
      } catch (_) {}
    }
    const chunkMap = {};
    const mainRows = [];
    for (const r of rows) { if (isChunkKey(r.key)) chunkMap[r.key] = r.value; else mainRows.push(r); }
    let pulled = 0, skipped = 0;
    const pendingWrites = [];
    let legacyInlineSeen = false;
    for (const row of mainRows) {
      let value = row.value;
      const deleted = value === KV_DELETE_MARK;
      if (typeof value === "string" && value.startsWith(KV_CHUNK_MARK)) {
        const n = parseInt(value.slice(KV_CHUNK_MARK.length), 10) || 0;
        let acc = "";
        for (let i = 0; i < n; i++) {
          const part = chunkMap[row.key + KV_CHUNK_SEP + i];
          if (typeof part !== "string") throw new Error(`Cloud sync is missing a chunk for ${row.key}`);
          acc += part;
        }
        value = acc;
      }
      if (!deleted && containsInlineDataUrl(value)) legacyInlineSeen = true;
      // Convex stores only the short marker. The device reconstructs the
      // original local data URL from its IndexedDB cache or a signed R2 GET.
      if (!deleted) {
        try {
          value = await hydrateInlineData(value, fileMap);
        } catch (error) {
          // A cached URL may have expired early or a new device may not have a
          // manifest yet. Re-sign once, then fail the whole pull if hydration is
          // still impossible; never advance the cursor without the file bytes.
          if (forcedFileMapRefresh || !String(value).includes("yn-r2://inline/")) throw error;
          fileMap = await refreshFileMap(token, true, session);
          forcedFileMapRefresh = true;
          assertSyncSession(session);
          value = await hydrateInlineData(value, fileMap);
        }
      }
      assertSyncSession(session);
      const known = meta[row.key];
      if (!known || row.updatedAt > known.t) {
        const rawLocalVal = localStorage.getItem(row.key);
        const localHash = rawLocalVal === null ? KV_DELETE_HASH : strHash(rawLocalVal);
        const remoteHash = deleted ? KV_DELETE_HASH : strHash(value);
        const ownsUnversionedLocal = localStorage.getItem(UNVERSIONED_OWNER_KEY) === currentSyncAccount();
        if (!known && ownsUnversionedLocal && rawLocalVal !== null) {
          // This account has a pending local value but no completed sync hash
          // yet (for example an offline edit before first sign-in). Treat it as
          // a conflict and let the following push preserve it; never overwrite
          // it merely because metadata was not created before the interruption.
          skipped++;
          continue;
        }
        if (known && localHash !== known.h && !(deleted && rawLocalVal === null)) {
          // Locally changed since the last synced hash but not yet pushed —
          // pulling now would silently discard the local edit. Skip it; the
          // next push will send it up and reconcile.
          skipped++;
          continue;
        }
        if (!known || localHash !== remoteHash) {
          pendingWrites.push({ key: row.key, value: deleted ? null : value, previous: rawLocalVal });
          pulled++;
        }
        meta[row.key] = { h: remoteHash, t: row.updatedAt };
      }
    }
    assertSyncSession(session);
    // Hydrate and validate every row before touching persistent workspace
    // state, then commit the batch with a best-effort rollback. A late missing
    // R2 blob or quota error can no longer leave half a pull visible while the
    // cursor/meta claims success.
    const previousMeta = localStorage.getItem("yn_sync_meta");
    const previousCursor = localStorage.getItem(SYNC_CURSOR_KEY);
    const previousLastSync = localStorage.getItem("yn_last_sync");
    const previousMigration = localStorage.getItem(INLINE_R2_MIGRATION_KEY);
    const appliedWrites = [];
    const restoreValue = (key, value) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    };
    applyingRemoteValue = true;
    try {
      for (const write of pendingWrites) {
        if (write.value === null) localStorage.removeItem(write.key);
        else localStorage.setItem(write.key, write.value);
        appliedWrites.push(write);
      }
      setMeta(meta);
      // A skipped conflict must remain visible to the next pull. Advancing the
      // cursor here could strand a remote tombstone if the following local push
      // fails (or the local value returns to its old hash before retry). Rows
      // already applied are cheap to re-read because their meta timestamps make
      // them no-ops; advance only after the whole incremental page reconciles.
      if (incremental && serverCursor > 0 && skipped === 0) {
        localStorage.setItem(SYNC_CURSOR_KEY, String(serverCursor));
      }
      localStorage.setItem("yn_last_sync", String(Date.now()));
      // An older client may have written a raw data URL after this device had
      // completed migration. Re-arm one migration push so those bytes move
      // back to R2; already-marker-only pulls leave the flag untouched.
      if (legacyInlineSeen) localStorage.setItem(INLINE_R2_MIGRATION_KEY, "0");
    } catch (commitError) {
      let rollbackOk = true;
      for (let index = appliedWrites.length - 1; index >= 0; index--) {
        const write = appliedWrites[index];
        try { restoreValue(write.key, write.previous); } catch (_) { rollbackOk = false; }
      }
      try { restoreValue("yn_sync_meta", previousMeta); } catch (_) { rollbackOk = false; }
      try { restoreValue(SYNC_CURSOR_KEY, previousCursor); } catch (_) { rollbackOk = false; }
      try { restoreValue("yn_last_sync", previousLastSync); } catch (_) { rollbackOk = false; }
      try { restoreValue(INLINE_R2_MIGRATION_KEY, previousMigration); } catch (_) { rollbackOk = false; }
      storageMayHaveChanged = !rollbackOk;
      throw commitError;
    } finally {
      applyingRemoteValue = false;
    }
    storageMayHaveChanged = pendingWrites.length > 0;
    updateSyncUi();
    const parts = [];
    if (pulled) parts.push(`Pulled ${pulled} item${pulled > 1 ? "s" : ""}`);
    if (skipped) parts.push(`skipped ${skipped} local edit${skipped > 1 ? "s" : ""}`);
    setStatus(parts.length ? parts.join(", ") + "." : "Nothing new to pull.");
    if (pulled > 0 && reloadOnChange) setTimeout(() => location.reload(), 900);
    return { pulled, skipped, ok: true };
  } catch (e) {
    setStatus(cleanErr(e), true);
    return { pulled: 0, skipped: 0, ok: false, error: cleanErr(e), needsReload: storageMayHaveChanged };
  } finally {
    applyingRemoteValue = false;
    pushing = false;
  }
};

// ---------- Push ----------
// Uploads every file body to R2 first, then writes only metadata/text/opaque
// R2 markers to Convex. Values remain chunk-compatible for large legacy text.
window.pushChanges = async function () {
  const token = getToken();
  if (!client || !token) return { pushed: 0, ok: false, error: "Sync is not available" };
  if (pushing || syncTransitioning) return { pushed: 0, ok: false, error: "Sync is already busy" };
  const session = captureSyncSession(token);
  pushing = true;
  try {
    setStatus("Pushing…");
    const meta = getMeta();
    // Snapshot each key's dirty generation up front. A live re-edit increments
    // the generation even when the key was already dirty, so the success path
    // cannot erase a change that landed while network awaits were in flight.
    const dirtyAtStart = new Map([...dirtyKeys].map((key) => [key, dirtyVersions.get(key) || 0]));
    const forceFullScan = !everPushedThisSession;
    const forceInlineMigration = localStorage.getItem(INLINE_R2_MIGRATION_KEY) !== "1";
    const localValues = new Map();
    for (const key of SYNC_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null && value !== undefined) localValues.set(key, value);
    }

    // Externalize inline bytes before any KV mutation. If an R2 upload fails,
    // this push aborts rather than falling back to charging the body to Convex.
    const inlineAssets = new Map();
    const remoteValues = new Map();
    const localHashes = new Map();
    for (const [key, value] of localValues) {
      const known = meta[key];
      const needsChangeCheck = forceFullScan || dirtyAtStart.has(key) || !known;
      let hash = null;
      if (needsChangeCheck) {
        hash = strHash(value);
        localHashes.set(key, hash);
      }
      // Hash first. On normal startup, unchanged hydrated images/PDFs avoid
      // base64 decoding, SHA-256, Blob allocation and IndexedDB writes. A
      // changed/missing key or explicitly re-armed legacy migration still
      // externalizes before any cloud mutation.
      if (forceInlineMigration || !known || (needsChangeCheck && known.h !== hash)) {
        remoteValues.set(key, await externalizeInlineData(value, inlineAssets));
      }
    }
    assertSyncSession(session);

    const referenceValues = [...localValues]
      .filter(([key]) => forceFullScan || dirtyAtStart.has(key))
      .map(([, value]) => value)
      .filter(Boolean);
    const referencedFiles = await collectReferencedFiles(referenceValues);
    const boardBlobs = (forceFullScan || dirtyAtStart.has("opennotes_board")) ? await collectBoardBlobs() : [];
    const uploadedCount = await uploadR2Objects(token, [...referencedFiles, ...boardBlobs, ...inlineAssets.values()]);
    assertSyncSession(session);

    const now = Date.now();
    const rowsToWrite = [];        // flat KV rows (incl. chunk rows)
    const changedMeta = {};        // main-key -> hash, applied after success
    for (const k of SYNC_KEYS) {
      // Use the same start-of-push snapshot for the cloud body and its meta
      // hash. If the live value changes during an await, its newer dirty
      // generation survives and the next push sends it; mixing a newer hash
      // with an older R2/KV payload would incorrectly clear that retry.
      const v = localValues.get(k);
      const known = meta[k];
      if (v === undefined) {
        const alreadyDeleted = known && known.h === KV_DELETE_HASH;
        const deletionPending = dirtyAtStart.has(k) || (forceFullScan && known && !alreadyDeleted);
        if (!deletionPending || alreadyDeleted) continue;
        changedMeta[k] = KV_DELETE_HASH;
        rowsToWrite.push({ key: k, value: KV_DELETE_MARK, updatedAt: now });
        continue;
      }
      const remoteValue = remoteValues.has(k) ? remoteValues.get(k) : v;
      const externalized = remoteValue !== v;
      // A hydrated local value naturally differs from its compact cloud R2
      // marker. That representation difference only forces a KV rewrite while
      // the one-time migration is pending; afterward the normal local hash is
      // authoritative and unchanged inline aggregates stay read/write-free.
      const requiresExternalizedWrite = externalized && forceInlineMigration;
      // Skip the (potentially expensive, e.g. multi-MB opennotes_data) hash
      // entirely when we already have a meta hash for this key AND nothing
      // has told us it changed: not dirty, and not the first push of the
      // session (which does one full scan to re-catch any edit whose push
      // never completed before a reload wiped the in-memory dirty set).
      if (known && !forceFullScan && !dirtyAtStart.has(k) && !requiresExternalizedWrite) continue;
      const h = localHashes.has(k) ? localHashes.get(k) : strHash(v);
      if (known && known.h === h && !requiresExternalizedWrite) continue;
      changedMeta[k] = h;
      const chunks = splitUtf8(remoteValue, KV_CHUNK);
      if (chunks.length === 1) {
        rowsToWrite.push({ key: k, value: chunks[0], updatedAt: now });
      } else {
        rowsToWrite.push({ key: k, value: KV_CHUNK_MARK + chunks.length, updatedAt: now });
        for (let i = 0; i < chunks.length; i++) rowsToWrite.push({ key: k + KV_CHUNK_SEP + i, value: chunks[i], updatedAt: now });
      }
    }
    const pushedCount = Object.keys(changedMeta).length;
    if (rowsToWrite.length) {
      // Keep every logical key (root + all chunks) in one mutation. Otherwise
      // an incremental reader could observe a new root with only half its
      // chunks, or new chunks without a bumped root.
      let batch = [], size = 0;
      const writtenAt = {};
      const sendBatch = async () => {
        if (!batch.length) return;
        const sent = batch;
        const result = await withTimeout(client.mutation(api.sync.setKVBatch, { token, entries: sent }), 30000, "setKVBatch");
        assertSyncSession(session);
        const serverUpdatedAt = Number(result && result.updatedAt) || now;
        for (const row of sent) {
          const splitAt = row.key.indexOf(KV_CHUNK_SEP);
          const root = splitAt === -1 ? row.key : row.key.slice(0, splitAt);
          writtenAt[root] = Math.max(writtenAt[root] || 0, serverUpdatedAt);
        }
        batch = [];
        size = 0;
      };
      const groups = [];
      let currentGroup = [];
      let currentRoot = null;
      for (const row of rowsToWrite) {
        const splitAt = row.key.indexOf(KV_CHUNK_SEP);
        const root = splitAt === -1 ? row.key : row.key.slice(0, splitAt);
        if (currentRoot !== null && root !== currentRoot) {
          groups.push(currentGroup);
          currentGroup = [];
        }
        currentRoot = root;
        currentGroup.push(row);
      }
      if (currentGroup.length) groups.push(currentGroup);
      for (const group of groups) {
        const groupSize = group.reduce((total, row) => total + utf8Size(row.value), 0);
        if (groupSize > KV_BATCH_BYTES) {
          throw new Error("A synced text value is too large after its files were moved to R2");
        }
        if (size + groupSize > KV_BATCH_BYTES && batch.length) await sendBatch();
        batch.push(...group);
        size += groupSize;
      }
      await sendBatch();
      for (const k in changedMeta) meta[k] = { h: changedMeta[k], t: writtenAt[k] || now };
    }
    assertSyncSession(session);
    setMeta(meta);
    // Push succeeded: the keys we accounted for above are no longer dirty.
    // Clear only generations that are still identical to the start snapshot.
    // A same-key edit during this push has a newer generation and survives.
    for (const [key, version] of dirtyAtStart) {
      if (dirtyVersions.get(key) === version) {
        dirtyKeys.delete(key);
        dirtyVersions.delete(key);
      }
    }
    everPushedThisSession = true;
    localStorage.setItem(INLINE_R2_MIGRATION_KEY, "1");
    localStorage.removeItem(UNVERSIONED_OWNER_KEY);
    // Auto-pushes no longer re-presign every file on every text edit. Refresh
    // only when this push actually registered new R2 objects.
    if (uploadedCount > 0) {
      try { await refreshFileMap(token, true, session); } catch (_) {}
      assertSyncSession(session);
    }
    localStorage.setItem("yn_last_sync", String(Date.now()));
    updateSyncUi();
    setStatus(pushedCount ? `Pushed ${pushedCount} item${pushedCount > 1 ? "s" : ""}.` : "Nothing to push.");
    return { pushed: pushedCount, ok: true };
  } catch (e) {
    setStatus(cleanErr(e), true);
    return { pushed: 0, ok: false, error: cleanErr(e) };
  } finally {
    pushing = false;
  }
};

// Full sync: pull then push (used at startup / after sign-in). Kept as the
// single entry point those callers rely on.
window.syncNow = async function () {
  if (!client || !getToken() || pushing || syncTransitioning) return { ok: false };
  setStatus("Syncing…");
  const pullRes = (await window.pullChanges({ reload: false })) || { pulled: 0, skipped: 0, ok: false };
  // A failed pull must never be followed by a push: that could overwrite a
  // newer cloud workspace (and is especially dangerous immediately after an
  // account switch). Leave local changes intact and retry later.
  if (pullRes.ok === false) {
    setStatus(pullRes.error || "Could not pull cloud changes. Nothing was uploaded.", true);
    return { ok: false, pull: pullRes };
  }
  const pushRes = (await window.pushChanges()) || { pushed: 0, ok: false, error: "Could not push cloud changes" };
  if (pushRes.ok === false) {
    setStatus(pushRes.error || "Could not upload changes. They remain pending on this device.", true);
    return { ok: false, pull: pullRes, push: pushRes };
  }
  const parts = [];
  if (pullRes.pulled) parts.push(`pulled ${pullRes.pulled}`);
  if (pullRes.skipped) parts.push(`skipped ${pullRes.skipped} local edit${pullRes.skipped > 1 ? "s" : ""}`);
  if (pushRes.pushed) parts.push(`pushed ${pushRes.pushed}`);
  setStatus(parts.length ? "Synced — " + parts.join(", ") + "." : "Synced ✓");
  if (pullRes.pulled > 0) setTimeout(() => location.reload(), 900);
  return { ok: true, pull: pullRes, push: pushRes };
};

// Called from the Storage override on every setItem — debounced auto-push
// (a full sync isn't needed for a local edit; pushing keeps it lightweight)
window.__syncNotifyChange = function (key) {
  if (!SYNC_KEYS.includes(key)) return;
  // Track dirtiness regardless of sign-in state — cheap, and means a push
  // right after a later sign-in already knows what changed.
  markDirtyKey(key);
  const account = currentSyncAccount();
  const accountBootstrapActive = account
    && String(localStorage.getItem(ACCOUNT_BOOTSTRAP_KEY) || "").toLowerCase() === account;
  if (!syncTransitioning && !applyingRemoteValue) {
    const bootstrappingFreshAccount = account
      && accountBootstrapActive
      && localStorage.getItem(UNVERSIONED_OWNER_KEY) !== account;
    if (account && !bootstrappingFreshAccount && !getMeta()[key]) {
      localStorage.setItem(UNVERSIONED_OWNER_KEY, account);
    }
  }
  // The bootstrap's authoritative pull is the only operation allowed to push
  // this workspace. If it fails, keep all auto-pushes suspended until Retry
  // succeeds or the user explicitly chooses Continue offline.
  if (!client || !getToken() || syncTransitioning || applyingRemoteValue || accountBootstrapActive) return;
  // Failures leave dirty generations intact for manual/startup sync. The
  // helper only retries while another operation is busy or a newer edit lands
  // during a successful push, avoiding an offline Convex retry loop.
  scheduleAutoPush(6000);
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

function createAccountBootstrapBlocker() {
  const root = document.createElement("div");
  root.id = "yn-account-bootstrap";
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  Object.assign(root.style, {
    position: "fixed", inset: "0", zIndex: "2147483647", display: "grid",
    placeItems: "center", padding: "24px", background: "rgba(18, 15, 12, .58)",
    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
  });
  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(420px, 100%)", borderRadius: "24px", padding: "26px",
    background: "#fdf9f2", color: "#2f2924", boxShadow: "0 24px 80px rgba(0,0,0,.28)",
    fontFamily: "system-ui, sans-serif", textAlign: "center",
  });
  const title = document.createElement("strong");
  title.textContent = "Loading your account";
  Object.assign(title.style, { display: "block", fontSize: "20px", marginBottom: "8px" });
  const message = document.createElement("p");
  message.textContent = "Keeping this workspace separate while your notes and R2 files are checked…";
  Object.assign(message.style, { margin: "0", lineHeight: "1.5", color: "#6f6257" });
  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "none", gap: "10px", justifyContent: "center", marginTop: "18px", flexWrap: "wrap" });
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  const offline = document.createElement("button");
  offline.type = "button";
  offline.textContent = "Continue offline";
  for (const button of [retry, offline]) Object.assign(button.style, {
    minHeight: "44px", padding: "0 18px", borderRadius: "999px", border: "1px solid #cdbda9",
    background: button === retry ? "#b97745" : "transparent", color: button === retry ? "white" : "#493f37",
    font: "inherit", fontWeight: "700", cursor: "pointer",
  });
  actions.append(retry, offline);
  card.append(title, message, actions);
  root.append(card);
  document.body.append(root);
  return { root, message, actions, retry, offline };
}

async function finishAccountBootstrap() {
  const ui = createAccountBootstrapBlocker();
  const run = async () => {
    ui.actions.style.display = "none";
    ui.message.textContent = "Keeping this workspace separate while your notes and R2 files are checked…";
    const result = await window.syncNow();
    if (result && result.ok === true) {
      localStorage.removeItem(ACCOUNT_BOOTSTRAP_KEY);
      // syncNow already scheduled the authoritative reload after a pull. Keep
      // the blocker until then so stale in-memory aggregates cannot be edited.
      if (!(result.pull && result.pull.pulled > 0)) ui.root.remove();
      return;
    }
    if (result && result.pull && (result.pull.pulled > 0 || result.pull.needsReload)) {
      // A pull may have committed authoritative cloud rows even if the
      // following push failed. Reload those aggregates before offering any
      // editable offline UI; the bootstrap flag keeps the retry protected.
      location.reload();
      return;
    }
    ui.message.textContent = "Cloud sync is unavailable right now. This account is still isolated on this device.";
    ui.actions.style.display = "flex";
  };
  ui.retry.addEventListener("click", run);
  ui.offline.addEventListener("click", () => {
    localStorage.removeItem(ACCOUNT_BOOTSTRAP_KEY);
    ui.root.remove();
  });
  await run();
}

function initSync() {
  updateSyncUi();
  prefillElectronCreds();
  // signed in → sync shortly after startup (pull newer data from other devices)
  if (client && getToken()) {
    const bootstrapAccount = String(localStorage.getItem(ACCOUNT_BOOTSTRAP_KEY) || "").toLowerCase();
    if (bootstrapAccount && bootstrapAccount === currentSyncAccount()) {
      finishAccountBootstrap().catch((error) => setStatus(cleanErr(error), true));
    } else {
      if (bootstrapAccount) localStorage.removeItem(ACCOUNT_BOOTSTRAP_KEY);
      setTimeout(() => window.syncNow(), 2500);
    }
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSync);
else initSync();
