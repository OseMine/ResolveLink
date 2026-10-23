const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const SERVER_PORT = Number(process.env.PORT) || 3030;
const SERVER_ORIGIN = `http://127.0.0.1:${SERVER_PORT}`;

/** Dev mode: running from the repository via `npm start` / `electron .`. */
const isDev = !app.isPackaged;

let mainWindow;
let backendProcess = null;
let quitting = false;

// --- Paths -----------------------------------------------------------------

function resourcesDir() {
  return process.resourcesPath || path.join(__dirname, '..');
}

/** Bundled server entry (desktop build) or repo source (dev). */
function getServerPath() {
  return isDev
    ? path.join(__dirname, 'packages', 'server', 'src', 'index.js')
    : path.join(resourcesDir(), 'server', 'server.cjs');
}

/** Directory holding the built React UI. */
function getUIDistPath() {
  return isDev
    ? path.join(__dirname, 'packages', 'ui', 'dist')
    : path.join(resourcesDir(), 'ui', 'dist');
}

/** Writable per-user data directory (config, exports, temp, logs). */
function getDataDir() {
  return app.getPath('userData');
}

/** Minimal .env reader for values that affect process startup. */
function readEnvFile(filePath) {
  const values = {};
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) values[match[1]] = match[2].trim();
    }
  } catch {}
  return values;
}

function ensureDataLayout() {
  const dataDir = getDataDir();
  const dirs = {
    data: dataDir,
    exports: path.join(dataDir, 'exports'),
    temp: path.join(dataDir, 'temp'),
  };
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Seed writable config from the packaged defaults on first launch.
  const configPath = path.join(dataDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    const defaultConfig = path.join(resourcesDir(), 'server', 'config.json');
    try {
      fs.copyFileSync(defaultConfig, configPath);
    } catch {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ server: { port: SERVER_PORT, host: '127.0.0.1' }, auth: { enabled: false, token: '' } }, null, 2),
        'utf8'
      );
    }
  }

  return { ...dirs, configPath };
}

// --- Backend ---------------------------------------------------------------

/** True when a local HTTP endpoint answers successfully. */
function isHttpUp(url, timeoutMs = 700) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function isServerUp() {
  return isHttpUp(`${SERVER_ORIGIN}/api/health`);
}

async function startBackendServer() {
  const serverPath = getServerPath();
  if (!fs.existsSync(serverPath)) {
    console.error('[desktop] Server entry not found:', serverPath);
    return null;
  }

  // Reuse an already-running instance (e.g. `npm run server` in development).
  if (await isServerUp()) {
    console.log('[desktop] Reusing running ResolveLink server on', SERVER_ORIGIN);
    return null;
  }

  const { data, exports: exportDir, temp, configPath } = ensureDataLayout();
  // Values saved by the setup wizard win over the defaults.
  const savedEnv = readEnvFile(path.join(data, '.env'));
  const logFile = path.join(data, 'server.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(SERVER_PORT),
    HOST: '127.0.0.1',
    CONFIG_PATH: configPath,
    ENV_PATH: path.join(data, '.env'),
    PRESETS_PATH: path.join(data, 'render-presets.json'),
    EXPORT_DIR: savedEnv.EXPORT_DIR || exportDir,
    TEMP_DIR: savedEnv.TEMP_DIR || temp,
    UI_DIST_DIR: getUIDistPath(),
    RESOLVE_BRIDGE_SCRIPT: path.join(resourcesDir(), 'server', 'resolve-bridge.py'),
    RESOLVELINK_ROOT: data,
    RESOLVELINK_PARENT_PID: String(process.pid),
    // process.execPath is electron.exe: run it as plain Node for the server.
    ELECTRON_RUN_AS_NODE: '1',
  };

  const child = spawn(process.execPath, [serverPath], {
    cwd: data,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => logStream.write(chunk));
  child.stderr.on('data', (chunk) => logStream.write(chunk));

  child.on('error', (err) => {
    console.error('[desktop] Backend failed to start:', err);
    logStream.write(`\n[desktop] spawn error: ${err.message}\n`);
  });

  child.on('exit', (code, signal) => {
    logStream.end();
    if (!quitting) {
      console.error(`[desktop] Backend exited (code=${code}, signal=${signal}). Log: ${logFile}`);
    }
  });

  return child;
}

function stopBackendServer() {
  if (!backendProcess) return;
  const child = backendProcess;
  backendProcess = null;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch (err) {
    console.error('[desktop] Failed to stop backend:', err.message);
  }
}

// --- Window ----------------------------------------------------------------

function createWindow() {
  const iconPath = isDev
    ? path.join(__dirname, 'assets', 'icon.png')
    : path.join(resourcesDir(), 'icon.png');

  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1a',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev && process.env.RESOLVELINK_DEV_URL !== 'false') {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    isHttpUp(devUrl).then((up) => {
      if (up) {
        mainWindow?.loadURL(devUrl);
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      } else {
        // No Vite server: use the locally spawned server's built UI.
        loadAppWithRetry();
      }
    });
  } else {
    loadAppWithRetry();
  }
}

/**
 * Load the UI from the bundled server so the app is same-origin with the API.
 * The server needs a moment to boot, so retry before falling back to file://.
 */
function loadAppWithRetry(attempt = 0) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.loadURL(SERVER_ORIGIN).catch(() => {
    if (attempt >= 60) {
      const indexPath = path.join(getUIDistPath(), 'index.html');
      if (fs.existsSync(indexPath)) {
        mainWindow.loadFile(indexPath).catch(() => {});
      } else {
        console.error('[desktop] UI not found at:', indexPath);
      }
      return;
    }
    setTimeout(() => loadAppWithRetry(attempt + 1), 500);
  });
}

// --- App lifecycle ---------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    backendProcess = await startBackendServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  stopBackendServer();
});

// --- IPC -------------------------------------------------------------------

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'file:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') shell.openExternal(url);
    } catch {}
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
