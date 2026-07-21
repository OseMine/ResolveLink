/**
 * After Effects Integration
 *
 * Implements the Integration interface for Adobe After Effects.
 * Handles AE-specific routes, script generation, and auto-workflow.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../../state');
const { createLogger } = require('../../logger');
const { validate } = require('../../middleware/validation');
const {
  LinkClipRequestSchema,
  ImportBackRequestSchema,
} = require('@resolvelink/shared');
const {
  generateJSXPayload,
  generateExtendScript,
  generateRenderScript,
  generateActiveCompRenderScript,
} = require('./generators');
const { startRenderWatch } = require('./render-watcher');
const config = require('../../config.json');

const log = createLogger('AE');

/** @type {import('@resolvelink/shared').Integration} */
const aeIntegration = {
  config: {
    name: 'ae',
    displayName: 'After Effects',
    description: 'Adobe After Effects VFX round-trip workflow',
  },

  async init(storeInstance) {
    // AE integration doesn't need special init beyond route registration
    log.info('AE integration initialized');
  },

  getStatus() {
    const aePath = detectAEPath();
    return {
      available: !!aePath,
      running: false, // checked on-demand
      version: null,
      installPath: aePath,
    };
  },

  getRoutes() {
    const router = express.Router();
    const exportDir = path.resolve(process.env.EXPORT_DIR || config.paths.vfxExportDir);
    const tempDir = path.resolve(process.env.TEMP_DIR || config.paths.tempDir);

    // POST /api/link-clip — Create a new AE link
    router.post('/link-clip', validate(LinkClipRequestSchema), (req, res) => {
      const { clipData, settings } = req.body;

      const linkId = uuidv4();
      const link = {
        id: linkId,
        clips: clipData.map((clip) => ({
          ...clip,
          linkId,
          status: 'pending',
        })),
        settings: {
          width: settings?.width || 1920,
          height: settings?.height || 1080,
          fps: settings?.fps || 24,
          duration: settings?.duration || 10,
          renderQueue: settings?.renderQueue || 'Best Settings',
        },
        createdAt: new Date().toISOString(),
        status: 'created',
        exportPath: null,
      };

      store.activeLinks.set(linkId, link);

      const jsxPayload = generateJSXPayload(link);
      const payloadPath = path.join(tempDir, `${linkId}.json`);
      fs.writeFileSync(payloadPath, JSON.stringify(jsxPayload, null, 2));

      const jsxScript = generateExtendScript(link, exportDir);
      const jsxPath = path.join(tempDir, `${linkId}.jsx`);
      fs.writeFileSync(jsxPath, jsxScript);

      link.jsxPath = jsxPath;
      link.payloadPath = payloadPath;

      store.broadcast('link:created', link);
      store.addJobHistory({ type: 'create', linkId: link.id, status: 'created', clipCount: link.clips.length });

      res.json({ linkId, status: 'created', jsxPath, payloadPath });
    });

    // POST /api/links/:id/render — Trigger aerender (non-blocking)
    router.post('/links/:id/render', (req, res, next) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid link ID format' });
      }
      next();
    }, (req, res) => {
      const { id } = req.params;
      const link = store.activeLinks.get(id);

      if (!link) return res.status(404).json({ error: 'Link not found' });

      if (!link.jsxPath || !fs.existsSync(link.jsxPath)) {
        link.status = 'error';
        store.broadcast('link:updated', link);
        return res.status(500).json({ error: 'JSX file not found' });
      }

      const { spawn } = require('child_process');
      const aerenderPath = getAERenderPath();

      if (!aerenderPath) {
        // aerender not available — fall back to CEP panel execution
        log.info('aerender not found, falling back to CEP panel render');
        const jobId = uuidv4();
        const job = {
          type: 'execute-jsx',
          linkId: id,
          jsxPath: link.jsxPath,
          compName: `Resolve_Link_${id.slice(0, 8)}`,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        store.jobQueue.set(jobId, job);
        link.status = 'rendering';
        store.broadcast('link:updated', link);

        res.json({
          status: 'rendering',
          method: 'cep',
          jobId,
          message: 'aerender not found. Job queued for CEP panel execution.',
        });
        return;
      }

      link.status = 'rendering';
      store.broadcast('link:updated', link);

      const compName = `Resolve_Link_${id.slice(0, 8)}`;
      try {
        const child = spawn(aerenderPath, [
          '-project', link.jsxPath,
          '-comp', compName,
          '-output', exportDir,
        ], { stdio: 'pipe', timeout: 300000 });

        let stderr = '';
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
          if (code === 0) {
            link.status = 'rendered';
            store.broadcast('link:updated', link);
          } else {
            link.status = 'error';
            link.error = stderr || `aerender exited with code ${code}`;
            store.broadcast('link:updated', link);
          }
        });

        child.on('error', (err) => {
          link.status = 'error';
          link.error = err.message;
          store.broadcast('link:updated', link);
        });

        res.json({ status: 'rendering' });
      } catch (err) {
        link.status = 'error';
        store.broadcast('link:updated', link);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/links/:id/auto — Auto-workflow: queue or launch AE
    router.post('/links/:id/auto', (req, res, next) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid link ID format' });
      }
      next();
    }, async (req, res) => {
      const { id } = req.params;
      const link = store.activeLinks.get(id);

      if (!link) return res.status(404).json({ error: 'Link not found' });

      link.status = 'sending';
      store.broadcast('link:updated', link);

      if (!link.jsxPath || !fs.existsSync(link.jsxPath)) {
        link.status = 'error';
        store.broadcast('link:updated', link);
        return res.status(500).json({ error: 'JSX file not found' });
      }

      const isAERunning = await checkIfAERunning();

      if (isAERunning) {
        const jobId = uuidv4();
        const job = {
          type: 'execute-jsx',
          linkId: id,
          jsxPath: link.jsxPath,
          compName: `Resolve_Link_${id.slice(0, 8)}`,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        store.jobQueue.set(jobId, job);
        log.info(`AE running, job queued: ${jobId} for link: ${id}`);

        res.json({
          status: 'queued',
          jobId,
          message: 'Job queued. CEP extension will pick it up automatically.',
        });
      } else {
        const aePath = getAEExePath();
        if (!aePath) {
          link.status = 'error';
          store.broadcast('link:updated', link);
          return res.status(500).json({ error: 'After Effects not found' });
        }

        log.info(`AE not running, launching: "${aePath}" -r "${link.jsxPath}"`);

        const { spawn } = require('child_process');
        try {
          const child = spawn(aePath, ['-r', link.jsxPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          });

          child.on('error', (err) => {
            log.error(`Failed to launch AE: ${err.message}`);
            link.status = 'error';
            store.broadcast('link:updated', link);
          });

          child.on('exit', (code) => {
            log.info(`AE process exited with code ${code}`);
          });

          child.unref();
        } catch (err) {
          log.error(`Spawn error: ${err.message}`);
          link.status = 'error';
          store.broadcast('link:updated', link);
          return res.status(500).json({ error: err.message });
        }

        link.status = 'sending';
        store.broadcast('link:updated', link);

        res.json({
          status: 'sending',
          message: 'AE launched with script. It will execute on startup.',
        });
      }
    });

    // GET /api/links/:id/render-script — Generate render script
    router.get('/links/:id/render-script', (req, res) => {
      const { id } = req.params;
      const link = store.activeLinks.get(id);

      if (!link) return res.status(404).json({ error: 'Link not found' });

      const renderScript = generateRenderScript(link, exportDir);
      const scriptPath = path.join(tempDir, `render_${id}.jsx`);
      fs.writeFileSync(scriptPath, renderScript);

      res.json({ scriptPath, message: 'Run this script in After Effects: File > Scripts > Run Script File' });
    });

    // POST /api/render-active-comp — Render the active comp
    router.post('/render-active-comp', (req, res) => {
      const template = (req.body && req.body.template) || 'Best Settings';
      const renderScript = generateActiveCompRenderScript(exportDir, template);
      const scriptPath = path.join(tempDir, `render_active_${Date.now()}.jsx`);
      fs.writeFileSync(scriptPath, renderScript);
      res.json({ scriptPath });
    });

    // POST /api/import-back — Import rendered file back into Resolve
    router.post('/import-back', validate(ImportBackRequestSchema), async (req, res) => {
      const { renderedPath } = req.body;

      const resolveBridge = require('../../services/resolve-service');
      try {
        const result = await resolveBridge.executeBridge('create-compound', [renderedPath]);
        if (result.error) {
          return res.status(500).json(result);
        }
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    return router;
  },

  generateImportScript(payload) {
    // AE scripts are generated per-link, not from a generic payload
    return { scriptPath: null, payloadPath: null };
  },

  async isAvailable() {
    return !!detectAEPath();
  },
};

// --- AE Path Detection ---

function detectAEPath() {
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

function getAERenderPath() {
  const platform = process.platform;
  let aePath = config.paths.aeInstallPath[platform];
  if (!aePath || !fs.existsSync(aePath)) aePath = detectAEPath();
  if (!aePath || !fs.existsSync(aePath)) return null;

  if (platform === 'win32') return path.join(aePath, 'aerender.exe');
  return path.join(aePath, 'aerender');
}

function getAEExePath() {
  const platform = process.platform;
  let aePath = config.paths.aeInstallPath[platform];
  if (!aePath || !fs.existsSync(aePath)) aePath = detectAEPath();
  if (!aePath || !fs.existsSync(aePath)) return null;

  if (platform === 'win32') {
    const exePath = path.join(aePath, 'AfterFX.exe');
    return fs.existsSync(exePath) ? exePath : null;
  }
  return path.join(aePath, 'AfterFX');
}

function checkIfAERunning() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32'
      ? 'tasklist /FI "IMAGENAME eq AfterFX.exe" /NH'
      : 'pgrep -x "After Effects"';
    exec(cmd, (err, stdout) => {
      if (err) return resolve(false);
      resolve(process.platform === 'win32'
        ? stdout.includes('AfterFX.exe')
        : stdout.trim().length > 0);
    });
  });
}

module.exports = aeIntegration;
