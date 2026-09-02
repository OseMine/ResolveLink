const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.send('open:external', url),
  showItemInFolder: (filePath) => ipcRenderer.send('file:show-in-folder', filePath),
  getServerOrigin: () => 'http://127.0.0.1:3030',
});
