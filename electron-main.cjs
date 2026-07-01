const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
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

  let store = {};
  let loadOk = true; // false only when an existing store failed to load — then we refuse to write
  {
    const target = fs.existsSync(storePath) ? storePath : (fs.existsSync(tmpPath) ? tmpPath : null);
    if (target) {
      let ok = false, lastErr = null;
      // Retry reads: another instance / antivirus may briefly lock the file. Do NOT
      // start blank (which could then overwrite good data) unless every attempt fails.
      for (let attempt = 0; attempt < 5 && !ok; attempt++) {
        try { store = JSON.parse(fs.readFileSync(target, 'utf-8')); ok = true; }
        catch (e) { lastErr = e; sleep(150); }
      }
      if (!ok) {
        console.error('Store unreadable after retries', lastErr);
        try { if (fs.existsSync(tmpPath)) { store = JSON.parse(fs.readFileSync(tmpPath, 'utf-8')); ok = true; } } catch (_) {}
        if (!ok) { try { fs.copyFileSync(storePath, storePath + '.unreadable-' + Date.now()); } catch (_) {} }
      }
      loadOk = ok; // if we couldn't read an existing store, stay read-only this session
    }
  }

  // Atomic, debounced writes: write to a temp file then rename, so a crash/kill
  // mid-write can never leave a half-written (corrupt) store on disk.
  let writeTimer = null, dirty = false;
  function flushStore() {
    if (!dirty) return;
    // Safety: if we failed to read an existing store this session, never write —
    // that would overwrite the user's good data with our empty memory.
    if (!loadOk) { dirty = false; return; }
    dirty = false;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(store));
      fs.renameSync(tmpPath, storePath);
    } catch (e) {
      console.error('Failed to persist store', e);
    }
  }
  function scheduleWrite() {
    dirty = true;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushStore, 120);
  }
  app.on('before-quit', flushStore);

  ipcMain.on('load-data-sync', (event, key) => {
    event.returnValue = store[key] !== undefined ? store[key] : null;
  });

  ipcMain.on('save-data-sync', (event, key, value) => {
    store[key] = value;
    scheduleWrite();
    event.returnValue = true;
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
