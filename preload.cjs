const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadDataSync: (key) => ipcRenderer.sendSync('load-data-sync', key),
  saveDataSync: (key, value) => ipcRenderer.sendSync('save-data-sync', key, value),
  onNewNote: (callback) => ipcRenderer.on('menu-new-note', () => callback())
});
