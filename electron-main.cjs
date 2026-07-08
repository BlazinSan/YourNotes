const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

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

  // Data persistence (JSON file in userData)
  const storePath = path.join(app.getPath('userData'), 'local_storage_backup.json');
  const tmpPath = storePath + '.tmp';

  // Synchronous sleep for read retries (avoids blank-on-transient-lock).
  const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { const t = Date.now() + ms; while (Date.now() < t) {} } };

  const backupPath = storePath + '.backup';
  let loadedFrom = null, readErrors = {};
  const tryRead = (p) => { try { const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')); store = parsed; loadedFrom = p; return true; } catch (e) { readErrors[p] = e.code || e.message; return false; } };

  // CRITICAL: fs.existsSync() returns false for a LOCKED file (EPERM/EBUSY), not just
  // a missing one. Relying on it made a locked store look like a "fresh install", so
  // the app showed a Welcome note. Treat a file as missing ONLY on a real ENOENT.
  const definitelyMissing = (p) => { try { fs.accessSync(p, fs.constants.F_OK); return false; } catch (e) { return e.code === 'ENOENT'; } };

  let store = {};
  let loadOk = false; // becomes true once the store is loaded (or genuinely first-run)
  // Data exists if any store file is present OR merely locked (only truly missing files count as absent).
  const dataExisted = !definitelyMissing(storePath) || !definitelyMissing(tmpPath) || !definitelyMissing(backupPath);

  function attemptLoad(rounds) {
    if (loadOk) return true;
    for (let i = 0; i < rounds && !loadOk; i++) {
      // Only trust the authoritative store and the confirmed-good backup. The .tmp file
      // is write scratch — a failed rename can leave STALE data in it (this is what
      // destroyed notes: a locked store fell back to a leftover Welcome .tmp and wrote
      // it back). Never read .tmp as a normal source.
      if (tryRead(storePath)) { loadOk = true; break; }
      if (tryRead(backupPath)) { loadOk = true; break; }
      sleep(100);
    }
    // Genuine first-write crash ONLY: store and backup are truly absent (ENOENT) and the
    // .tmp holds the only copy of the very first write.
    if (!loadOk && definitelyMissing(storePath) && definitelyMissing(backupPath)) { if (tryRead(tmpPath)) loadOk = true; }
    return loadOk;
  }

  if (!dataExisted) { loadOk = true; } else { attemptLoad(30); } // ~3s patient retry at startup
  // A leftover .tmp is stale/garbage once we have a real store — delete it so it can
  // never be mistaken for data on a future locked-startup.
  if (loadOk && loadedFrom !== tmpPath) { try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {} }
  // Keep a rolling backup of the last known-good store for future rescues.
  if (loadOk && Object.keys(store).length) { try { if (fs.existsSync(storePath)) fs.copyFileSync(storePath, backupPath); } catch (_) {} }

  // Atomic, debounced writes: write to a temp file then rename, so a crash/kill
  // mid-write can never leave a half-written (corrupt) store on disk.
  let writeTimer = null, dirty = false;
  function flushStore() {
    if (!dirty) return;
    // Safety: if we failed to read an existing store this session, never write —
    // that would overwrite the user's good data with our empty memory.
    if (!loadOk) { dirty = false; return; }
    dirty = false;
    const json = JSON.stringify(store);
    // Write the backup FIRST and independently, so it always holds the latest good data
    // even if the primary store is locked and the atomic rename below fails.
    try { fs.writeFileSync(backupPath, json); } catch (_) {}
    try {
      fs.writeFileSync(tmpPath, json);
      fs.renameSync(tmpPath, storePath);
    } catch (e) {
      console.error('Failed to persist store (locked?) — backup holds the latest', e && e.code);
    }
  }
  function scheduleWrite() {
    dirty = true;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushStore, 400);
  }
  app.on('before-quit', flushStore);
  // Extra safety: flush whenever the window loses focus, so even a hard kill
  // (crash, force-close, power loss) can lose at most the last 400ms of edits
  // made while the window was continuously focused.
  mainWindow.on('blur', flushStore);

  // A locked store at startup used to trigger attemptLoad(15) — 15 rounds of a
  // synchronous 100ms Atomics.wait sleep IN THE MAIN PROCESS — on every single
  // getItem call while unresolved, freezing the whole app for ~1.5s per read.
  // Rate-limit retries to at most once every 2s; between attempts just return
  // whatever we've got (last known / empty) instead of blocking main.
  let lastLoadAttempt = 0;
  ipcMain.on('load-data-sync', (event, key) => {
    if (!loadOk) {
      const now = Date.now();
      if (now - lastLoadAttempt > 2000) {
        lastLoadAttempt = now;
        attemptLoad(1); // single quick try; the lock may have cleared since startup
      }
    }
    event.returnValue = (loadOk && store[key] !== undefined) ? store[key] : null;
  });

  // Renderer asks this before rendering: "did the store fail to load even though data exists?"
  // If so the renderer shows a loading state and reloads, rather than showing an empty app.
  ipcMain.on('store-load-failed', (event) => {
    if (!loadOk) attemptLoad(20); // give the read another patient try each time we're asked
    event.returnValue = dataExisted && !loadOk;
  });

  ipcMain.on('save-data-sync', (event, key, value) => {
    if (value === null || value === undefined) delete store[key]; // removeItem
    else store[key] = value;
    scheduleWrite();
    event.returnValue = true;
  });

  // Async twin of save-data-sync (no returnValue — fire-and-forget from the
  // renderer). Same debounced-write path; just skips the sendSync round-trip.
  ipcMain.on('save-data', (event, key, value) => {
    if (value === null || value === undefined) delete store[key]; // removeItem
    else store[key] = value;
    scheduleWrite();
  });

  // Factory reset: wipe the persistent store (localStorage.clear() alone would
  // leave the file intact and every "deleted" key would come back on restart).
  ipcMain.on('clear-data-sync', (event) => {
    store = {};
    dirty = true;
    flushStore();
    event.returnValue = true;
  });

  // Dashboard board: save dropped files to disk (referenced by path, NOT stored as
  // base64 in the JSON) and open them in the OS default app.
  ipcMain.handle('save-board-file', async (event, name, buffer) => {
    const dir = path.join(app.getPath('userData'), 'board_files');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const ext = path.extname(name || '') || '';
    const dest = path.join(dir, Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + ext);
    fs.writeFileSync(dest, Buffer.from(buffer));
    return dest;
  });
  ipcMain.on('open-path', (event, p) => { try { if (p) shell.openPath(p); } catch (_) {} });

  // Board items store an OS path from whichever device pinned them. A path
  // that came from a *different* machine won't exist here — check before
  // trying to open it (or resolve it as a file:// URL) so we can fall back
  // to the cloud copy instead of silently doing nothing. Sync (like the
  // load/save-data-sync handlers above) so callers like resolveFileUrl can
  // stay synchronous.
  ipcMain.on('file-exists-sync', (event, p) => {
    try { event.returnValue = fs.existsSync(String(p).replace(/^file:\/\/\//, '')); }
    catch (_) { event.returnValue = false; }
  });

  // Cloud sync reads app-managed files (college PDFs, banner, board, profile pic)
  // to upload them. Restricted to the app's own data directory.
  ipcMain.handle('read-file-bytes', async (event, p) => {
    try {
      const norm = path.normalize(decodeURIComponent(String(p).replace(/^file:\/\/\//, '')).replace(/\//g, path.sep));
      const base = path.normalize(app.getPath('userData') + path.sep);
      if (!norm.startsWith(base)) return null;
      return fs.readFileSync(norm);
    } catch (_) { return null; }
  });

  // Remembered sync credentials: single-account, OS-encrypted (safeStorage),
  // stored as an encrypted blob in userData — no Electron password manager exists.
  const credsPath = path.join(app.getPath('userData'), 'creds.bin');
  ipcMain.handle('cred-save', async (event, { email, password }) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      const enc = safeStorage.encryptString(JSON.stringify({ email, password }));
      fs.writeFileSync(credsPath, enc);
      return true;
    } catch (_) { return false; }
  });
  ipcMain.handle('cred-load', async () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      if (!fs.existsSync(credsPath)) return null;
      const enc = fs.readFileSync(credsPath);
      return JSON.parse(safeStorage.decryptString(enc));
    } catch (_) { return null; }
  });
  ipcMain.handle('cred-clear', async () => {
    try { fs.unlinkSync(credsPath); } catch (_) {}
    return true;
  });

  // Security: open external links in the OS browser, block in-app navigation away from the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && url !== mainWindow.webContents.getURL()) {
      e.preventDefault();
      if (url.startsWith('http')) shell.openExternal(url);
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || (app.isPackaged ? null : 'http://localhost:5173');
  const url = devUrl || `file://${path.join(__dirname, 'dist', 'index.html')}`;
  mainWindow.loadURL(url);
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
    createWindow();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
  });
}
