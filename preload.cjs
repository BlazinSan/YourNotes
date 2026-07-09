const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadDataSync: (key) => ipcRenderer.sendSync('load-data-sync', key),
  saveDataSync: (key, value) => ipcRenderer.sendSync('save-data-sync', key, value),
  // Fire-and-forget write: main already debounces the disk write ~400ms and
  // the sync call's returnValue was never used, so drop the round-trip cost.
  saveData: (key, value) => ipcRenderer.send('save-data', key, value),
  clearDataSync: () => ipcRenderer.sendSync('clear-data-sync'),
  storeLoadFailed: () => ipcRenderer.sendSync('store-load-failed'),
  saveBoardFile: (name, buffer) => ipcRenderer.invoke('save-board-file', name, buffer),
  readFileBytes: (p) => ipcRenderer.invoke('read-file-bytes', p),
  openPath: (p) => ipcRenderer.send('open-path', p),
  fileExists: (p) => ipcRenderer.sendSync('file-exists-sync', p),
  tokenGet: () => ipcRenderer.sendSync('token-get-sync'),
  tokenSet: (t) => ipcRenderer.sendSync('token-set-sync', t),
  saveCred: (email, password) => ipcRenderer.invoke('cred-save', { email, password }),
  loadCred: () => ipcRenderer.invoke('cred-load'),
  clearCred: () => ipcRenderer.invoke('cred-clear'),
  onNewNote: (callback) => ipcRenderer.on('menu-new-note', () => callback())
});
