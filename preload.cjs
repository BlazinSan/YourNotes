const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadDataSync: (key) => ipcRenderer.sendSync('load-data-sync', key),
  saveDataSync: (key, value) => ipcRenderer.sendSync('save-data-sync', key, value),
  clearDataSync: () => ipcRenderer.sendSync('clear-data-sync'),
  storeLoadFailed: () => ipcRenderer.sendSync('store-load-failed'),
  saveBoardFile: (name, buffer) => ipcRenderer.invoke('save-board-file', name, buffer),
  readFileBytes: (p) => ipcRenderer.invoke('read-file-bytes', p),
  openPath: (p) => ipcRenderer.send('open-path', p),
  onNewNote: (callback) => ipcRenderer.on('menu-new-note', () => callback())
});
