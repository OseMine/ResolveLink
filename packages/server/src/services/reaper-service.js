const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config.json');
const { createLogger } = require('../logger');

const log = createLogger('REAPER');

function detectReaperPath() {
  const platform = process.platform;

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
      const reg = execSync('reg query "HKLM\\SOFTWARE\\REAPER" /ve 2>nul', { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
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
      const out = execSync('tasklist /FI "IMAGENAME eq reaper.exe" /NH 2>nul', { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
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

  try {
    const out = execSync(`"${path.join(installPath, exe)}" -v 2>&1`, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    const match = out.match(/v?(\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
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

  const cmd = args.length
    ? `"${fullPath}" ${args.join(' ')}`
    : `"${fullPath}"`;

  log.info(`Launching REAPER: ${cmd}`);

  try {
    execSync(`start "" ${cmd}`, { timeout: 5000, stdio: 'ignore' });
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

  const args = [];
  if (opts.newProject) args.push('-new');
  if (opts.nosplash) args.push('-nosplash');
  if (opts.noactivate) args.push('-noactivate');

  // If REAPER is already running, use -nonewinst to run in existing instance
  if (isReaperRunning()) {
    args.push('-nonewinst');
  }

  // Script path is a positional argument (not a flag)
  args.push(`"${scriptPath}"`);

  const cmd = `"${fullPath}" ${args.join(' ')}`;
  log.info(`Launching REAPER with script: ${cmd}`);

  try {
    execSync(`start "" ${cmd}`, { timeout: 5000, stdio: 'ignore' });
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

  const args = ['-nonewinst'];
  if (opts.noactivate) args.push('-noactivate');
  // Script path is a positional argument (not a flag)
  args.push(`"${scriptPath}"`);

  const cmd = `"${fullPath}" ${args.join(' ')}`;
  log.info(`Running script in existing REAPER: ${cmd}`);

  try {
    execSync(`start "" ${cmd}`, { timeout: 5000, stdio: 'ignore' });
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

  const args = ['-nosplash', '-renderproject', `"${rppPath}"`];
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

  return {
    installed: !!installPath,
    installPath: installPath || null,
    running,
    version: version || null,
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
};
