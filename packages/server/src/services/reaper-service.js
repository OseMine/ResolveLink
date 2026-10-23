const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config.json');
const { createLogger } = require('../logger');

const log = createLogger('REAPER');

function detectReaperPath() {
  const platform = process.platform;

  // .env overrides (set by setup scripts)
  const envPath = platform === 'win32'
    ? process.env.REAPER_PATH_WIN
    : process.env.REAPER_PATH_MAC;
  if (envPath && fs.existsSync(envPath)) return envPath;

  if (platform === 'win32') {
    const candidates = [
      config.reaper?.installPath?.win32,
      'C:\\Program Files\\REAPER',
      'C:\\Program Files (x86)\\REAPER',
      path.join(process.env.LOCALAPPDATA || '', 'REAPER'),
    ];

    for (const p of candidates) {
      if (p && fs.existsSync(path.join(p, 'reaper.exe'))) return p;
    }

    // Check registry
    try {
      const reg = execSync('reg query "HKLM\\SOFTWARE\\REAPER" /ve 2>NUL', { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      const match = reg.match(/REG_SZ\s+(.*)/);
      if (match && fs.existsSync(match[1].trim())) return match[1].trim();
    } catch {}
  } else if (platform === 'darwin') {
    const candidates = [
      '/Applications/REAPER.app/Contents/MacOS',
      path.join(process.env.HOME || '~', 'Applications/REAPER.app/Contents/MacOS'),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(path.join(p, 'reaper'))) return p;
    }
  } else {
    const candidates = ['/usr/bin', '/usr/local/bin', '/opt/reaper'];
    for (const p of candidates) {
      if (p && fs.existsSync(path.join(p, 'reaper'))) return p;
    }
  }

  return null;
}

function isReaperRunning() {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq reaper.exe" /NH 2>NUL', { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      return out.toLowerCase().includes('reaper.exe');
    } else {
      const out = execSync('pgrep -x reaper 2>/dev/null || pgrep -x REAPER 2>/dev/null', { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
      return out.length > 0;
    }
  } catch {
    return false;
  }
}

function getReaperVersion() {
  const installPath = detectReaperPath();
  if (!installPath) return null;

  const platform = process.platform;
  const exe = platform === 'win32' ? 'reaper.exe' : 'reaper';
  const fullPath = path.join(installPath, exe);

  try {
    if (platform === 'win32') {
      // Read version from executable metadata (avoids launching REAPER)
      const psCmd = `(Get-Item '${fullPath.replace(/'/g, "''")}').VersionInfo.ProductVersion`;
      const out = execSync(
        `powershell -NoProfile -Command "${psCmd}"`,
        { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).toString().trim();
      const match = out.match(/(\d+\.\d+)/);
      return match ? match[1] : null;
    } else if (platform === 'darwin') {
      // Read from Info.plist
      const plistPath = path.join(installPath, '..', 'Info.plist');
      if (fs.existsSync(plistPath)) {
        const plist = fs.readFileSync(plistPath, 'utf8');
        const match = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([\d.]+)<\/string>/);
        return match ? match[1] : null;
      }
    } else {
      // Linux: try to read version from executable or skip
      // REAPER on Linux doesn't expose version without launching
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

function getExePath(reaperPath) {
  const platform = process.platform;
  const exe = platform === 'win32' ? 'reaper.exe' : 'reaper';
  const base = reaperPath || detectReaperPath() || '';
  return path.join(base, exe);
}

function launchReaper(reaperPath, opts = {}) {
  const fullPath = getExePath(reaperPath);

  if (!fs.existsSync(fullPath)) {
    log.error(`REAPER not found at: ${fullPath}`);
    return false;
  }

  const args = [];
  if (opts.nosplash) args.push('-nosplash');
  if (opts.noactivate) args.push('-noactivate');

  log.info(`Launching REAPER: "${fullPath}" ${args.join(' ')}`);

  try {
    const child = spawn(fullPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    log.info(`Launched REAPER: ${fullPath}`);
    return true;
  } catch (e) {
    log.error(`Failed to launch REAPER: ${e.message}`);
    return false;
  }
}

function launchWithScript(scriptPath, opts = {}) {
  const reaperPath = opts.reaperPath || detectReaperPath();
  const fullPath = getExePath(reaperPath);

  if (!fs.existsSync(fullPath)) {
    log.error(`REAPER not found at: ${fullPath}`);
    return false;
  }

  // Normalize script path to forward slashes for REAPER compatibility
  const normalizedScriptPath = scriptPath.replace(/\\/g, '/');

  const args = [];
  if (opts.newProject) args.push('-new');
  if (opts.nosplash) args.push('-nosplash');
  if (opts.noactivate) args.push('-noactivate');

  // If REAPER is already running, use -nonewinst to run in existing instance
  if (isReaperRunning()) {
    args.push('-nonewinst');
  }

  // Script path is a positional argument (not a flag)
  args.push(normalizedScriptPath);

  log.info(`Launching REAPER with script: "${fullPath}" ${args.join(' ')}`);

  try {
    const child = spawn(fullPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  } catch (e) {
    log.error(`Failed to launch REAPER with script: ${e.message}`);
    return false;
  }
}

function runScriptInExisting(scriptPath, opts = {}) {
  const reaperPath = opts.reaperPath || detectReaperPath();
  const fullPath = getExePath(reaperPath);

  if (!fs.existsSync(fullPath)) {
    log.error(`REAPER not found at: ${fullPath}`);
    return false;
  }

  // Normalize script path to forward slashes for REAPER compatibility
  const normalizedScriptPath = scriptPath.replace(/\\/g, '/');

  const args = ['-nonewinst'];
  if (opts.noactivate) args.push('-noactivate');
  // Script path is a positional argument (not a flag)
  args.push(normalizedScriptPath);

  log.info(`Running script in existing REAPER: "${fullPath}" ${args.join(' ')}`);

  try {
    const child = spawn(fullPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  } catch (e) {
    log.error(`Failed to run script in REAPER: ${e.message}`);
    return false;
  }
}

function renderProject(rppPath, opts = {}) {
  const reaperPath = opts.reaperPath || detectReaperPath();
  const fullPath = getExePath(reaperPath);

  if (!fs.existsSync(fullPath)) {
    log.error(`REAPER not found at: ${fullPath}`);
    return false;
  }

  if (!fs.existsSync(rppPath)) {
    log.error(`REAPER project not found: ${rppPath}`);
    return false;
  }

  // Normalize project path to forward slashes for REAPER compatibility
  const normalizedRppPath = rppPath.replace(/\\/g, '/');

  const args = ['-nosplash', '-renderproject', `"${normalizedRppPath}"`];
  const cmd = `"${fullPath}" ${args.join(' ')}`;
  log.info(`Rendering REAPER project: ${cmd}`);

  try {
    execSync(cmd, { timeout: opts.timeout || 300000, stdio: 'pipe' });
    log.info(`Render complete: ${rppPath}`);
    return true;
  } catch (e) {
    log.error(`REAPER render failed: ${e.message}`);
    return false;
  }
}

function getStatus() {
  const installPath = detectReaperPath();
  const running = isReaperRunning();
  const version = getReaperVersion();
  const nativeExtension = detectNativeExtension();

  return {
    available: !!installPath,
    installPath: installPath || null,
    running,
    version: version || null,
    nativeExtension: nativeExtension || null,
  };
}

// Detect if the native REAPER extension (resolvelink.dll/.dylib/.so) is installed
function detectNativeExtension() {
  const platform = process.platform;
  const reaperPath = detectReaperPath();
  if (!reaperPath) return null;

  const userPluginsDir = getScriptsDir();
  if (!userPluginsDir) return null;

  const ext = platform === 'win32' ? '.dll' : (platform === 'darwin' ? '.dylib' : '.so');
  const nativePath = path.join(userPluginsDir, 'ResolveLink', `resolvelink${ext}`);

  if (fs.existsSync(nativePath)) {
    return {
      installed: true,
      path: nativePath,
      version: '1.0.0', // Could be enhanced to read version from plugin
    };
  }

  // Also check REAPER's UserPlugins directory directly
  const reaperUserPlugins = path.join(reaperPath, 'UserPlugins', 'ResolveLink', `resolvelink${ext}`);
  if (fs.existsSync(reaperUserPlugins)) {
    return {
      installed: true,
      path: reaperUserPlugins,
      version: '1.0.0',
    };
  }

  return {
    installed: false,
    path: nativePath,
  };
}

function getScriptsDir() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE || '~';

  if (platform === 'win32') {
    const appdata = process.env.APPDATA || '';
    return path.join(appdata, 'REAPER', 'Scripts');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'REAPER', 'Scripts');
  } else {
    return path.join(home, '.config', 'REAPER', 'Scripts');
  }
}

module.exports = {
  detectReaperPath,
  isReaperRunning,
  getReaperVersion,
  launchReaper,
  launchWithScript,
  runScriptInExisting,
  renderProject,
  getStatus,
  getScriptsDir,
  getUserPluginsDir: getScriptsDir, // Alias for native extension detection
};
