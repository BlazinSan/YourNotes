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
      sandbox: true
    }
  });

  // Data persistence (JSON file in userData)
  const storePath = path.join(app.getPath('userData'), 'local_storage_backup.json');

  let store = {};
  try {
    if (fs.existsSync(storePath)) {
      store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load store', e);
  }

  ipcMain.on('load-data-sync', (event, key) => {
    event.returnValue = store[key] !== undefined ? store[key] : null;
  });

  ipcMain.on('save-data-sync', (event, key, value) => {
    store[key] = value;
    try {
      fs.writeFileSync(storePath, JSON.stringify(store));
    } catch (e) {
      console.error('Failed to save store', e);
    }
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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
