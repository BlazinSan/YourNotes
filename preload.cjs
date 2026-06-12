const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onMprisUpdate: (callback) => ipcRenderer.on('mpris-update', (_event, value) => callback(value)),
  mprisControl: (command) => ipcRenderer.send('mpris-control', command),
  requestMprisState: () => ipcRenderer.send('request-mpris-state'),
  loadDataSync: (key) => ipcRenderer.sendSync('load-data-sync', key),
  saveDataSync: (key, value) => ipcRenderer.sendSync('save-data-sync', key, value)
});
