const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.send('open:external', url),
  getServerOrigin: () => 'http://127.0.0.1:3030',
});
