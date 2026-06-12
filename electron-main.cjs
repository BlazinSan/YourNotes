const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const dbus = require('dbus-next');

const fs = require('fs');

// Automatically detect and use native Wayland on GNOME/KDE/Arch if available
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Data persistence
  const userDataPath = app.getPath('userData');
  const storePath = path.join(userDataPath, 'local_storage_backup.json');
  
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

  const url = process.env.VITE_DEV_SERVER_URL || `file://${path.join(__dirname, 'dist', 'index.html')}`;
  mainWindow.loadURL(url);
}

app.whenReady().then(() => {
  createWindow();
  setupMpris();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Helper to add timeout to promises
const withTimeout = (promise, ms = 1000) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
};

let lastMetadataStr = '';
let currentMprisState = { status: 'Stopped', title: '', artist: '' };
let isPolling = false;

async function pollMpris(bus, dbusInterface) {
  if (isPolling) return;
  isPolling = true;
  try {
    const names = await withTimeout(dbusInterface.ListNames(), 1000);
    const players = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
    
    if (players.length > 0) {
      const targetPlayer = players.find(p => p.includes('spotify')) || players[0];
      const playerProxy = await withTimeout(bus.getProxyObject(targetPlayer, '/org/mpris/MediaPlayer2'), 1000);
      
      const properties = playerProxy.getInterface('org.freedesktop.DBus.Properties');
      const metadataVariant = await withTimeout(properties.Get('org.mpris.MediaPlayer2.Player', 'Metadata'), 1000);
      const statusVariant = await withTimeout(properties.Get('org.mpris.MediaPlayer2.Player', 'PlaybackStatus'), 1000);
      
      const metadata = metadataVariant.value;
      const status = statusVariant.value;
      
      const title = metadata['xesam:title'] ? metadata['xesam:title'].value : '';
      const artist = metadata['xesam:artist'] ? (Array.isArray(metadata['xesam:artist'].value) ? metadata['xesam:artist'].value[0] : metadata['xesam:artist'].value) : '';
      
      const currentMetadataStr = `${title}-${artist}-${status}`;
      
      if (currentMetadataStr !== lastMetadataStr) {
        lastMetadataStr = currentMetadataStr;
        currentMprisState = { status, title, artist };
        if (mainWindow) {
          mainWindow.webContents.send('mpris-update', currentMprisState);
        }
      }
    } else {
      if (lastMetadataStr !== 'STOPPED') {
        lastMetadataStr = 'STOPPED';
        currentMprisState = { status: 'Stopped' };
        if (mainWindow) {
          mainWindow.webContents.send('mpris-update', currentMprisState);
        }
      }
    }
  } catch (e) {
    // ignore
  } finally {
    isPolling = false;
  }
}

async function setupMpris() {
  try {
    const bus = dbus.sessionBus();
    const dbusObj = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
    const dbusInterface = dbusObj.getInterface('org.freedesktop.DBus');
    
    // Request initial state from frontend
    ipcMain.on('request-mpris-state', () => {
      if (mainWindow && lastMetadataStr !== '') {
        mainWindow.webContents.send('mpris-update', currentMprisState);
      }
    });

    // Handle controls
    ipcMain.on('mpris-control', async (event, command) => {
      try {
        const currentNames = await withTimeout(dbusInterface.ListNames(), 1000);
        const currentPlayers = currentNames.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
        if (currentPlayers.length > 0) {
          const activePlayer = currentPlayers.find(p => p.includes('spotify')) || currentPlayers[0];
          const currentPlayerProxy = await withTimeout(bus.getProxyObject(activePlayer, '/org/mpris/MediaPlayer2'), 1000);
          const playerInterface = currentPlayerProxy.getInterface('org.mpris.MediaPlayer2.Player');
          if (playerInterface && typeof playerInterface[command] === 'function') {
            await playerInterface[command]();
          }
        }
      } catch(err) {
        console.error("MPRIS Control Error", err.message);
      }
    });

    pollMpris(bus, dbusInterface);
    setInterval(() => pollMpris(bus, dbusInterface), 1000);

  } catch (error) {
    console.error('Failed to setup MPRIS:', error);
  }
}
