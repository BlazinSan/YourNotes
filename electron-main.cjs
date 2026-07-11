const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');

// The optional asset-heavy Haven build has a different product identity but
// intentionally shares the normal app's local notes, pins, and preferences.
let packageMeta = {};
try { packageMeta = require('./package.json'); } catch (_) {}
if (packageMeta.havenEdition === true) {
  app.setPath('userData', path.join(app.getPath('appData'), 'YourNotes'));
}

// Blocklist for shell.openPath / saved board files: refuse launching executables
// or scripts that arrived via synced/cloud data (poisoned board items, dropped files).
const BLOCKED_EXT = new Set(['.exe','.bat','.cmd','.com','.msi','.lnk','.ps1','.vbs','.js','.scr','.jar','.hta','.mjs','.cjs','.reg','.wsf','.wsh','.pif','.cpl','.msc','.gadget','.application','.ws']);
// True if the filename's real extension is executable/script. Strips trailing
// dots/spaces first — Windows silently drops them when resolving/creating, so
// "evil.exe " would otherwise write a real .exe that slips past a naive check.
function extBlocked(name) {
  const cleaned = String(name || '').replace(/[\s.]+$/, '');
  return BLOCKED_EXT.has(path.extname(cleaned).toLowerCase());
}
function isBlockedTarget(p) {
  const s = String(p || '');
  if (!s) return true;
  // Normalize separators before the UNC test — "\/host\share" / "/\host" are
  // slash-agnostic to the Windows shell and would otherwise evade a raw prefix check.
  if (s.replace(/\//g, '\\').startsWith('\\\\')) return true; // UNC (any separator mix)
  return extBlocked(s);
}

function resolveOpenTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'No file was selected.' };
  if (isBlockedTarget(raw)) {
    return { ok: false, blocked: true, error: 'This file type cannot be opened safely.' };
  }

  let candidate;
  try {
    candidate = /^file:/i.test(raw) ? fileURLToPath(raw) : raw;
  } catch (_) {
    return { ok: false, blocked: true, error: 'The file path is not valid.' };
  }
  if (!path.isAbsolute(candidate)) {
    return { ok: false, blocked: true, error: 'Only app-managed local files can be opened.' };
  }

  const resolved = path.resolve(candidate);
  const userData = path.resolve(app.getPath('userData'));
  const allowedRoots = ['board_files', 'college_pdfs', 'banner_files']
    .map((folder) => path.join(userData, folder));
  const isInside = (target, root) => target === root || target.startsWith(root + path.sep);
  if (!allowedRoots.some((root) => isInside(resolved, root))) {
    return { ok: false, blocked: true, error: 'Only app-managed local files can be opened.' };
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { ok: false, error: 'The selected item is not a file.' };

    // Resolve junctions/symlinks before launching so an entry inside board_files
    // cannot escape the app-owned user-data directory.
    const realTarget = fs.realpathSync(resolved);
    const realUserData = fs.realpathSync(userData);
    if (!isInside(realTarget, realUserData)) {
      return { ok: false, blocked: true, error: 'The file is outside app-managed storage.' };
    }
    if (isBlockedTarget(realTarget)) {
      return { ok: false, blocked: true, error: 'This file type cannot be opened safely.' };
    }
    return { ok: true, path: realTarget };
  } catch (error) {
    const missing = error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
    return { ok: false, error: missing ? 'The file is no longer available on this device.' : 'The file could not be accessed.' };
  }
}

// No application menu bar (File/Edit/View/Window/Help). Set before any window
// is created so the bar never flashes.
Menu.setApplicationMenu(null);

// Native Wayland hints (no-op on Windows/macOS, helps Linux builds)
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');

// Taskbar / window icon association
app.setAppUserModelId('com.raj.yournotes');
app.name = 'YourNotes';

let mainWindow;
let persistence;
let ipcHandlersRegistered = false;
let lifecycleHandlersRegistered = false;
let isQuitting = false;

const sleep = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (_) { const until = Date.now() + ms; while (Date.now() < until) {} }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function writeRuntimeDiagnostic(level, event, details = {}) {
  const record = { at: new Date().toISOString(), level, event, ...details };
  const line = `[runtime] ${JSON.stringify(record)}`;
  const logger = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.info);
  logger(line);
  try {
    const logPath = path.join(app.getPath('userData'), 'runtime-diagnostics.log');
    fs.promises.appendFile(logPath, line + '\n', 'utf8').catch(() => {});
  } catch (_) {}
}

function createPersistence() {
  const storePath = path.join(app.getPath('userData'), 'local_storage_backup.json');
  const tmpPath = storePath + '.tmp';
  const backupPath = storePath + '.backup';
  let loadedFrom = null;
  let readErrors = {};
  let store = {};
  let loadOk = false;
  let writeTimer = null;
  let dirty = false;
  let lastBackup = 0;
  let flushChain = Promise.resolve();

  const definitelyMissing = (p) => {
    try { fs.accessSync(p, fs.constants.F_OK); return false; }
    catch (error) { return error && error.code === 'ENOENT'; }
  };

  function readCandidate(p) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!isPlainObject(parsed)) {
        const error = new Error('Persistent store root must be a plain object');
        error.code = 'EINVALIDSTORE';
        throw error;
      }
      let mtimeMs = 0;
      try { mtimeMs = Number(fs.statSync(p).mtimeMs) || 0; } catch (_) {}
      return { ok: true, value: parsed, mtimeMs };
    } catch (error) {
      const code = error && error.code ? error.code : (error instanceof SyntaxError ? 'EINVALIDJSON' : 'EUNKNOWN');
      const kind = code === 'ENOENT' ? 'missing' :
        (code === 'EINVALIDSTORE' || code === 'EINVALIDJSON' || error instanceof SyntaxError ? 'invalid' : 'io');
      readErrors[p] = code;
      return { ok: false, error, code, kind };
    }
  }

  function adopt(candidate, source) {
    store = candidate.value;
    loadedFrom = source;
    loadOk = true;
    return true;
  }

  // Retry only the authoritative primary during transient locks. Falling back to
  // backup on the first failed read can roll recent edits back. Backup is used only
  // when the primary is genuinely absent or structurally/JSON invalid.
  function attemptLoad(rounds = 1) {
    if (loadOk) return true;
    const tries = Math.max(1, Number(rounds) || 1);
    let primaryFailure = { kind: 'missing', code: 'ENOENT' };

    let primaryCandidate = null;
    if (!definitelyMissing(storePath)) {
      for (let i = 0; i < tries; i++) {
        const candidate = readCandidate(storePath);
        if (candidate.ok) {
          primaryCandidate = candidate;
          break;
        }
        primaryFailure = candidate;
        if (candidate.kind === 'invalid' || candidate.kind === 'missing') break;
        if (i < tries - 1) sleep(100);
      }
      if (!primaryCandidate && primaryFailure.kind === 'io') return false;
    }

    const backup = readCandidate(backupPath);
    if (primaryCandidate) {
      // A failed primary rename deliberately leaves the newest snapshot in the
      // backup. Both files are valid in that case, so validity alone is not enough:
      // select the newer snapshot rather than copying stale primary over rescue data.
      if (backup.ok && backup.mtimeMs > primaryCandidate.mtimeMs) {
        writeRuntimeDiagnostic('warn', 'store-newer-backup-selected');
        return adopt(backup, backupPath);
      }
      return adopt(primaryCandidate, storePath);
    }
    if (backup.ok) return adopt(backup, backupPath);

    // A .tmp file is valid recovery only for the first-ever write, when both
    // primary and backup truly do not exist. It may otherwise be stale scratch.
    if (definitelyMissing(storePath) && definitelyMissing(backupPath)) {
      const firstWrite = readCandidate(tmpPath);
      if (firstWrite.ok) return adopt(firstWrite, tmpPath);
    }
    return false;
  }

  const dataExisted = !definitelyMissing(storePath) || !definitelyMissing(tmpPath) || !definitelyMissing(backupPath);
  if (!dataExisted) loadOk = true;
  else attemptLoad(30);

  if (loadOk && loadedFrom !== tmpPath) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
  }
  // Only a successfully parsed primary is allowed to refresh the backup. If the
  // backup rescued a corrupt primary, copying primary here would destroy rescue data.
  if (loadOk && loadedFrom === storePath) {
    try { fs.copyFileSync(storePath, backupPath); } catch (_) {}
  }

  if (!loadOk && dataExisted) {
    writeRuntimeDiagnostic('error', 'store-load-failed', { errors: Object.values(readErrors) });
  }

  function serializeStore() {
    try { return JSON.stringify(store); }
    catch (error) {
      writeRuntimeDiagnostic('error', 'store-serialize-failed', { message: String(error && error.message || error) });
      return null;
    }
  }

  function flushStore(sync = false) {
    // Never overwrite an existing-but-unreadable store with an empty in-memory one.
    if (!loadOk) return;
    if (sync === true) {
      const json = serializeStore();
      if (json === null) return;
      dirty = false;
      try { fs.writeFileSync(backupPath, json); } catch (_) {}
      try {
        const quitTmp = storePath + '.qtmp';
        fs.writeFileSync(quitTmp, json);
        fs.renameSync(quitTmp, storePath);
      } catch (error) {
        writeRuntimeDiagnostic('error', 'store-quit-flush-failed', { code: error && error.code });
      }
      return;
    }
    if (!dirty) return;
    const json = serializeStore();
    if (json === null) return;
    dirty = false;
    flushChain = flushChain.then(async () => {
      if (Date.now() - lastBackup > 30000) {
        lastBackup = Date.now();
        try { await fs.promises.writeFile(backupPath, json); } catch (_) {}
      }
      try {
        await fs.promises.writeFile(tmpPath, json);
        await fs.promises.rename(tmpPath, storePath);
      } catch (error) {
        // The primary may be transiently locked. Keep the latest valid snapshot in
        // backup even when the normal 30s backup throttle would have skipped it.
        try { await fs.promises.writeFile(backupPath, json); lastBackup = Date.now(); } catch (_) {}
        writeRuntimeDiagnostic('error', 'store-flush-failed', { code: error && error.code });
      }
    });
  }

  function scheduleWrite() {
    if (!loadOk) return false;
    dirty = true;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => flushStore(), 400);
    return true;
  }

  async function flushDurably() {
    clearTimeout(writeTimer);
    // Let any libuv write/rename already in flight settle first. The final
    // synchronous snapshot must be the last writer, not race an older async flush.
    try { await flushChain; } catch (_) {}
    flushStore(true);
  }

  return {
    flushStore,
    flushDurably,
    load(key) {
      if (!loadOk) attemptLoad(1);
      return loadOk && store[key] !== undefined ? store[key] : null;
    },
    storeLoadFailed() {
      if (!loadOk) attemptLoad(20);
      return dataExisted && !loadOk;
    },
    save(key, value) {
      if (!loadOk) return false;
      if (value === null || value === undefined) delete store[key];
      else store[key] = value;
      return scheduleWrite();
    },
    clear() {
      if (!loadOk) return false;
      store = {};
      dirty = true;
      flushStore();
      return true;
    }
  };
}

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.on('load-data-sync', (event, key) => { event.returnValue = persistence.load(key); });
  ipcMain.on('store-load-failed', (event) => { event.returnValue = persistence.storeLoadFailed(); });
  ipcMain.on('save-data-sync', (event, key, value) => { event.returnValue = persistence.save(key, value); });
  ipcMain.on('save-data', (event, key, value) => { persistence.save(key, value); });
  ipcMain.on('clear-data-sync', (event) => { event.returnValue = persistence.clear(); });

  ipcMain.handle('save-board-file', async (event, name, buffer) => {
    const dir = path.join(app.getPath('userData'), 'board_files');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    if (extBlocked(name)) throw new Error('blocked file type');
    const ext = path.extname(String(name || '').replace(/[\s.]+$/, '')) || '';
    const dest = path.join(dir, Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + ext);
    fs.writeFileSync(dest, Buffer.from(buffer));
    return dest;
  });
  ipcMain.handle('open-path', async (event, p) => {
    try {
      const target = resolveOpenTarget(p);
      if (!target.ok) {
        writeRuntimeDiagnostic(target.blocked ? 'warn' : 'info', 'open-path-refused', {
          blocked: target.blocked === true,
          error: target.error
        });
        return target;
      }
      const message = await shell.openPath(target.path);
      if (message) {
        writeRuntimeDiagnostic('warn', 'open-path-failed', { message });
        return { ok: false, error: message };
      }
      return { ok: true };
    } catch (error) {
      const message = String(error && error.message || error || 'The file could not be opened.');
      writeRuntimeDiagnostic('warn', 'open-path-failed', { message });
      return { ok: false, error: message };
    }
  });
  ipcMain.on('file-exists-sync', (event, p) => {
    try { event.returnValue = fs.existsSync(String(p).replace(/^file:\/\/\//, '')); }
    catch (_) { event.returnValue = false; }
  });

  const tokenPath = path.join(app.getPath('userData'), 'token.bin');
  ipcMain.on('token-get-sync', (event) => {
    try {
      event.returnValue = safeStorage.isEncryptionAvailable() && fs.existsSync(tokenPath) ?
        safeStorage.decryptString(fs.readFileSync(tokenPath)) : '';
    } catch (_) { event.returnValue = ''; }
  });
  ipcMain.on('token-set-sync', (event, token) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) { event.returnValue = false; return; }
      if (token) fs.writeFileSync(tokenPath, safeStorage.encryptString(String(token)));
      else { try { fs.unlinkSync(tokenPath); } catch (_) {} }
      event.returnValue = true;
    } catch (_) { event.returnValue = false; }
  });

  ipcMain.handle('read-file-bytes', async (event, p) => {
    try {
      const norm = path.normalize(decodeURIComponent(String(p).replace(/^file:\/\/\//, '')).replace(/\//g, path.sep));
      const base = path.normalize(app.getPath('userData') + path.sep);
      if (!norm.startsWith(base)) return null;
      return fs.readFileSync(norm);
    } catch (_) { return null; }
  });

  ipcMain.handle('r2-put', async (_event, url, contentType, buffer) => {
    const target = new URL(String(url || ''));
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.r2.cloudflarestorage.com')) {
      throw new Error('Refused an untrusted upload destination');
    }
    const response = await net.fetch(target.toString(), {
      method: 'PUT',
      headers: { 'content-type': String(contentType || 'application/octet-stream') },
      body: Buffer.from(buffer),
    });
    return { ok: response.ok, status: response.status };
  });
  ipcMain.handle('r2-get', async (_event, url) => {
    const target = new URL(String(url || ''));
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.r2.cloudflarestorage.com')) {
      throw new Error('Refused an untrusted download destination');
    }
    const response = await net.fetch(target.toString());
    if (!response.ok) return { ok: false, status: response.status };
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  });

  const credsPath = path.join(app.getPath('userData'), 'creds.bin');
  ipcMain.handle('cred-save', async (event, { email, password }) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      fs.writeFileSync(credsPath, safeStorage.encryptString(JSON.stringify({ email, password })));
      return true;
    } catch (_) { return false; }
  });
  ipcMain.handle('cred-load', async () => {
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(credsPath)) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(credsPath)));
    } catch (_) { return null; }
  });
  ipcMain.handle('cred-clear', async () => {
    try { fs.unlinkSync(credsPath); } catch (_) {}
    return true;
  });
}

function registerLifecycleHandlers() {
  if (lifecycleHandlersRegistered) return;
  lifecycleHandlersRegistered = true;
  let quitFlushFinished = false;
  let quitFlushPromise = null;
  app.on('before-quit', (event) => {
    isQuitting = true;
    if (quitFlushFinished || !persistence) return;
    event.preventDefault();
    if (!quitFlushPromise) {
      quitFlushPromise = persistence.flushDurably()
        .catch((error) => writeRuntimeDiagnostic('error', 'store-before-quit-failed', {
          message: String(error && error.message || error)
        }))
        .finally(() => {
          quitFlushFinished = true;
          app.quit();
        });
    }
  });
}

function installWindowRecovery(win) {
  const contents = win.webContents;
  let recoveryCount = 0;
  let lastRecoveryAt = 0;
  let recoveryTimer = null;
  let stableTimer = null;
  let unresponsiveTimer = null;

  const scheduleRecovery = (reason, details = {}, baseDelay = 400) => {
    if (isQuitting || win.isDestroyed() || contents.isDestroyed()) return;
    const now = Date.now();
    if (now - lastRecoveryAt > 30000) recoveryCount = 0;
    lastRecoveryAt = now;
    if (recoveryCount >= 3) {
      writeRuntimeDiagnostic('error', 'window-recovery-exhausted', { reason, ...details });
      return;
    }
    recoveryCount++;
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      if (isQuitting || win.isDestroyed() || contents.isDestroyed()) return;
      writeRuntimeDiagnostic('warn', 'window-reloading', { reason, attempt: recoveryCount });
      try { contents.reload(); }
      catch (error) { writeRuntimeDiagnostic('error', 'window-reload-failed', { reason, message: String(error && error.message || error) }); }
    }, baseDelay * recoveryCount);
  };

  contents.on('render-process-gone', (event, details) => {
    writeRuntimeDiagnostic('error', 'render-process-gone', {
      reason: details && details.reason,
      exitCode: details && details.exitCode
    });
    // Queue the newest snapshot after any older async write. A direct sync write
    // here could otherwise be overwritten by the older operation when it finishes.
    if (persistence) persistence.flushDurably().catch(() => {});
    scheduleRecovery('render-process-gone', { exitReason: details && details.reason });
  });
  contents.on('unresponsive', () => {
    writeRuntimeDiagnostic('warn', 'renderer-unresponsive');
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = setTimeout(() => {
      if (persistence) persistence.flushDurably().catch(() => {});
      scheduleRecovery('renderer-unresponsive', {}, 250);
    }, 12000);
  });
  contents.on('responsive', () => {
    clearTimeout(unresponsiveTimer);
    writeRuntimeDiagnostic('info', 'renderer-responsive');
  });
  contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame === false || errorCode === -3) return; // subframe or ERR_ABORTED
    writeRuntimeDiagnostic('error', 'did-fail-load', { errorCode, errorDescription });
    scheduleRecovery('did-fail-load', { errorCode, errorDescription }, 750);
  });
  contents.on('did-finish-load', () => {
    clearTimeout(stableTimer);
    stableTimer = setTimeout(() => { recoveryCount = 0; }, 30000);
  });
  contents.on('destroyed', () => {
    clearTimeout(recoveryTimer);
    clearTimeout(stableTimer);
    clearTimeout(unresponsiveTimer);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      plugins: true // enable the built-in PDF viewer for College Notes
    }
  });

  const win = mainWindow;
  // Window-local listeners may be registered for every recreated window; the
  // persistence state and all process-wide IPC/lifecycle handlers remain singletons.
  win.on('blur', () => persistence.flushStore());

  // Windows/Chromium sometimes fails to regrow the compositor surface when the
  // window is maximized/restored. A 1px nudge forces compositor/layout reflow.
  const nudgeReflow = () => {
    try {
      const bounds = win.getBounds();
      win.setBounds({ ...bounds, width: bounds.width + 1 });
      setTimeout(() => { try { if (!win.isDestroyed()) win.setBounds(bounds); } catch (_) {} }, 0);
    } catch (_) {}
  };
  win.on('maximize', nudgeReflow);
  win.on('unmaximize', nudgeReflow);
  win.on('enter-full-screen', nudgeReflow);
  win.on('leave-full-screen', nudgeReflow);

  const devUrl = process.env.VITE_DEV_SERVER_URL || (app.isPackaged ? null : 'http://localhost:5173');
  const appUrl = devUrl || `file://${path.join(__dirname, 'dist', 'index.html')}`;

  // Security: open external links in the OS browser, block in-app navigation away from the app.
  // ONLY the app's own URL (appUrl, e.g. the loaded dist/index.html or the Vite dev
  // server) may be navigated to — everything else is blocked. Dropping an arbitrary
  // file onto the window used to navigate the whole window to it (white-screen crash);
  // now that's blocked too since it isn't appUrl.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Robust allow-list: the current page (normalized), the dev-server origin, and any
  // file:// URL whose path is our own index.html (tolerates file://C:\ vs file:///C:/).
  const isOwnUrl = (url) => {
    if (url === appUrl || url === win.webContents.getURL()) return true;
    if (devUrl && url.startsWith(devUrl)) return true;
    if (url.startsWith('file://')) {
      try { return decodeURIComponent(new URL(url).pathname).replace(/\\/g, '/').endsWith('/dist/index.html'); }
      catch { return false; }
    }
    return false;
  };
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnUrl(url)) {
      e.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    }
  });

  installWindowRecovery(win);
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.loadURL(appUrl).catch((error) => {
    writeRuntimeDiagnostic('error', 'initial-load-rejected', {
      message: String(error && error.message || error)
    });
  });
}

// Single-instance lock: a second launch focuses the existing window instead of
// starting another copy that would race on the data file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    persistence = createPersistence();
    registerIpcHandlers();
    registerLifecycleHandlers();
    createWindow();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
  });
}
