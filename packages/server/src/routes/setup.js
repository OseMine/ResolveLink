/**
 * Setup Wizard Routes
 * Handles initial configuration and .env file generation.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { validate } = require('../middleware/validation');
const { SetupRequestSchema } = require('@resolvelink/shared');
const reaperService = require('../services/reaper-service');

const router = express.Router();

function detectPythonPath() {
  const { execSync } = require('child_process');
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py -3', 'py -3.14', 'py -3.12', 'py -3.11', 'py -3.10']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const out = execSync(`${cmd} --version`, { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      const match = out.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1]);
        const minor = parseInt(match[2]);
        if (major >= 3 && minor >= 10) {
          const which = execSync(
            process.platform === 'win32' ? `where ${cmd.split(' ')[0]}` : `which ${cmd}`,
            { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
          ).toString().trim().split('\n')[0];
          if (which && fs.existsSync(which)) {
            return { path: which, version: `${major}.${minor}` };
          }
        }
      }
    } catch {}
  }
  return null;
}

function detectAEPath(config) {
  const platform = process.platform;
  const configPaths = config.paths.aeInstallPath[platform];
  if (configPaths && fs.existsSync(configPaths)) return configPaths;

  if (platform === 'win32') {
    const adobeDir = 'C:\\Program Files\\Adobe';
    try {
      const dirs = fs.readdirSync(adobeDir).filter(d => d.startsWith('Adobe After Effects'));
      if (dirs.length > 0) {
        const latest = dirs.sort().pop();
        const fullPath = path.join(adobeDir, latest, 'Support Files');
        if (fs.existsSync(fullPath)) return fullPath;
      }
    } catch {}
  } else if (platform === 'darwin') {
    try {
      const apps = fs.readdirSync('/Applications').filter(d => d.startsWith('Adobe After Effects'));
      if (apps.length > 0) {
        const latest = apps.sort().pop();
        if (fs.existsSync(`/Applications/${latest}`)) return `/Applications/${latest}`;
      }
    } catch {}
  }
  return null;
}

// The .env file lives at the repository root, four levels above this file
// (packages/server/src/routes -> packages/server/src -> packages/server -> packages -> root).
const ENV_PATH = process.env.ENV_PATH || path.join(__dirname, '..', '..', '..', '..', '.env');

function initSetupRoutes(config, port, host, exportDir, tempDir) {
  // GET /api/setup — Detect paths and return current config
  router.get('/', (_req, res) => {
    const hasEnv = fs.existsSync(ENV_PATH);

    const python = detectPythonPath();
    const aePath = detectAEPath(config);
    const reaperStatus = reaperService.getStatus();

    res.json({
      hasEnv,
      detected: {
        pythonPath: python?.path || null,
        pythonVersion: python?.version || null,
        aePath: aePath || null,
        reaperPath: reaperStatus.installPath || null,
        reaperVersion: reaperStatus.version || null,
        reaperInstalled: reaperStatus.installed,
        platform: process.platform,
      },
      config: {
        port,
        host,
        exportDir,
        tempDir,
        pythonPath: process.env.PYTHON_PATH || '',
        aePath: process.env.AE_PATH_WIN || process.env.AE_PATH_MAC || '',
        scriptingPath: process.env.RESOLVE_SCRIPTING_PATH || '',
        reaperPath: process.env.REAPER_PATH_WIN || process.env.REAPER_PATH_MAC || '',
      },
    });
  });

  // POST /api/setup — Write .env file (merges with existing values)
  router.post('/', validate(SetupRequestSchema), (req, res) => {
    const { pythonPath, aePath, reaperPath, exportDir, tempDir, port, host, scriptingPath } = req.body;

    const updates = {
      PORT: String(port || 3030),
      HOST: host || '127.0.0.1',
      EXPORT_DIR: exportDir || './exports',
      TEMP_DIR: tempDir || './temp',
    };

    if (pythonPath) updates.PYTHON_PATH = pythonPath;
    if (aePath) updates[process.platform === 'win32' ? 'AE_PATH_WIN' : 'AE_PATH_MAC'] = aePath;
    if (scriptingPath) updates.RESOLVE_SCRIPTING_PATH = scriptingPath;
    if (reaperPath) updates[process.platform === 'win32' ? 'REAPER_PATH_WIN' : 'REAPER_PATH_MAC'] = reaperPath;

    try {
      // Preserve keys the wizard doesn't manage (LOG_LEVEL, WATCH_FOLDERS, ...)
      const existing = {};
      if (fs.existsSync(ENV_PATH)) {
        for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
          const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
          if (match) existing[match[1]] = match[2];
        }
      }

      const merged = { ...existing, ...updates };
      const lines = ['# ResolveLink Configuration', '# Saved by the setup wizard'];
      for (const [key, value] of Object.entries(merged)) {
        lines.push(`${key}=${value}`);
      }
      lines.push('');

      fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
      res.json({
        success: true,
        envPath: ENV_PATH,
        restartRequired: true,
        message: 'Configuration saved. Restart ResolveLink to apply the changes.',
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to write .env: ${err.message}` });
    }
  });
}

module.exports = router;
module.exports.initSetupRoutes = initSetupRoutes;
