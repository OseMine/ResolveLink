/**
 * Diagnostics Service
 *
 * Collects a single, human-readable snapshot of the environment so the UI can
 * show non-technical users exactly what is ready and what needs attention.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config.json');
const registry = require('../integrations/registry');
const { version } = require('../version');

// Repo root is four levels above packages/server/src/services.
const ROOT_DIR = path.join(__dirname, '..', '..', '..', '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const RESOLVE_BRIDGE = path.join(ROOT_DIR, 'server', 'resolve-bridge.py');

let pythonCache = { at: 0, value: null };
const PYTHON_CACHE_MS = 30_000;

function checkDirectory(dir) {
  const result = { path: dir, exists: false, writable: false };
  try {
    result.exists = fs.existsSync(dir);
    if (result.exists) fs.accessSync(dir, fs.constants.W_OK);
    result.writable = result.exists;
  } catch {
    result.writable = false;
  }
  return result;
}

function checkPython() {
  if (pythonCache.value && Date.now() - pythonCache.at < PYTHON_CACHE_MS) {
    return Promise.resolve(pythonCache.value);
  }

  const command = process.env.PYTHON_PATH || config.resolve.pythonPath || 'python';

  return new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim();
      const match = output.match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
      const minor = match ? parseInt(match[2], 10) : -1;
      const value = {
        command,
        found: !err && !!match,
        version: match ? match[0].replace(/^Python\s+/i, '') : null,
        supported: !err && !!match && minor >= 10,
        error: err ? String(err.message || err).split('\n')[0] : null,
      };
      pythonCache = { at: Date.now(), value };
      resolve(value);
    });
  });
}

/**
 * @param {{ port?: string|number, host?: string, exportDir: string, tempDir: string, authEnabled?: boolean }} options
 */
async function getDiagnostics(options = {}) {
  const python = await checkPython();
  const integrations = registry.getAllStatus();

  return {
    app: {
      name: 'ResolveLink',
      version,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      port: Number(options.port) || 3030,
      host: options.host || '127.0.0.1',
      authEnabled: !!options.authEnabled,
    },
    config: {
      envPath: ENV_PATH,
      hasEnv: fs.existsSync(ENV_PATH),
      pythonPath: process.env.PYTHON_PATH || '',
      aePath: process.env.AE_PATH_WIN || process.env.AE_PATH_MAC || '',
      reaperPath: process.env.REAPER_PATH_WIN || process.env.REAPER_PATH_MAC || '',
      scriptingPath: process.env.RESOLVE_SCRIPTING_PATH || '',
    },
    paths: {
      exportDir: checkDirectory(options.exportDir || path.join(ROOT_DIR, 'exports')),
      tempDir: checkDirectory(options.tempDir || path.join(ROOT_DIR, 'temp')),
      resolveBridge: {
        path: RESOLVE_BRIDGE,
        exists: fs.existsSync(RESOLVE_BRIDGE),
      },
    },
    python,
    integrations,
  };
}

module.exports = { getDiagnostics };
