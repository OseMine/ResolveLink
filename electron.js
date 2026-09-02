const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
const SERVER_PORT = 3030;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'packages', 'ui', 'dist', 'index.html'));
  }
}

function startBackendServer() {
  const serverPath = path.join(__dirname, 'packages', 'server', 'src', 'index.js');
  const server = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: SERVER_PORT },
  });

  server.on('error', (err) => {
    console.error('Backend server failed to start:', err);
  });

  server.on('exit', (code) => {
    console.log(`Backend server exited with code ${code}`);
  });

  return server;
}

let backendProcess;

app.whenReady().then(() => {
  backendProcess = startBackendServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());

app.on('webContents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const u = new URL(url);
    if (u.protocol !== 'file:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
});

// Open external links — only validated HTTPS
ipcMain.on('open:external', (_event, url) => {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') shell.openExternal(url);
  } catch {}
});

// Reveal a file in the OS file manager
ipcMain.on('file:show-in-folder', (_event, filePath) => {
  try {
    if (typeof filePath === 'string' && filePath.length > 0) {
      shell.showItemInFolder(filePath);
    }
  } catch {}
  });
