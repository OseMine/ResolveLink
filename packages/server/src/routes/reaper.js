/**
 * REAPER Routes
 * REAPER-specific link creation, auto-workflow, and import endpoints.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../state');
const reaperService = require('../services/reaper-service');
const { validate } = require('../middleware/validation');
const { ReaperLinkClipRequestSchema, ReaperImportRequestSchema } = require('@resolvelink/shared');
const { createLogger } = require('../logger');

const log = createLogger('REAPER');
const router = express.Router();

// These are set during init
let TEMP_DIR = './temp';
let EXPORT_DIR = './exports';
let REAPER_JOBS_DIR = '';
let REAPER_RESULTS_DIR = '';

function initReaperRoutes(tempDir, exportDir) {
  TEMP_DIR = tempDir;
  EXPORT_DIR = exportDir;
  REAPER_JOBS_DIR = path.join(exportDir, 'reaper-jobs');
  REAPER_RESULTS_DIR = path.join(exportDir, 'reaper-results');
  [REAPER_JOBS_DIR, REAPER_RESULTS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

// GET /api/reaper/status — Check REAPER status
router.get('/status', (_req, res) => {
  res.json(reaperService.getStatus());
});

// POST /api/reaper/link-clip — Create a REAPER link
router.post('/link-clip', validate(ReaperLinkClipRequestSchema), (req, res) => {
  const { clipData, settings, timelineMode, projectName, timelineName } = req.body;

  const linkId = uuidv4();
  const { generateReaperPayload, generateReaperImportScript, generateReaperRenderScript } = require('../integrations/reaper/generators');

  const link = {
    id: linkId,
    target: 'reaper',
    timelineMode: !!timelineMode,
    projectName: projectName || 'ResolveLink',
    timelineName: timelineName || 'Timeline',
    clips: clipData.map((clip) => ({
      ...clip,
      linkId,
      status: 'pending',
    })),
    settings: {
      fps: settings?.fps || 24,
      sampleRate: settings?.sampleRate || 48000,
      duration: settings?.duration || 10,
    },
    createdAt: new Date().toISOString(),
    status: 'created',
    exportPath: null,
  };

  store.activeLinks.set(linkId, link);

  const reaperPayload = generateReaperPayload(link);
  const payloadPath = path.join(TEMP_DIR, `${linkId}_reaper.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(reaperPayload, null, 2));

  const reaperScript = generateReaperImportScript(link, TEMP_DIR);
  const scriptPath = path.join(TEMP_DIR, `${linkId}_reaper.lua`);
  fs.writeFileSync(scriptPath, reaperScript);

  const renderScript = generateReaperRenderScript(link, TEMP_DIR);
  const renderPath = path.join(TEMP_DIR, `render_${linkId}_reaper.lua`);
  fs.writeFileSync(renderPath, renderScript);

  link.reaperScriptPath = scriptPath;
  link.renderScriptPath = renderPath;
  link.payloadPath = payloadPath;

  store.broadcast('link:created', link);
  store.addJobHistory({ type: 'reaper-create', linkId: link.id, status: 'created', clipCount: link.clips.length, target: 'reaper' });

  log.info(`REAPER link created: ${linkId} (${link.clips.length} clips)`);

  res.json({ linkId, status: 'created', scriptPath, payloadPath, renderPath });
});

// POST /api/links/:id/reaper-auto — REAPER auto-workflow
router.post('/:id/reaper-auto', async (req, res) => {
  const { id } = req.params;
  const link = store.activeLinks.get(id);

  if (!link) return res.status(404).json({ error: 'Link not found' });

  link.status = 'sending';
  store.broadcast('link:updated', link);

  if (!link.reaperScriptPath || !fs.existsSync(link.reaperScriptPath)) {
    link.status = 'error';
    store.broadcast('link:updated', link);
    return res.status(500).json({ error: 'REAPER import script not found' });
  }

  const installPath = reaperService.detectReaperPath();
  if (!installPath) {
    link.status = 'error';
    store.broadcast('link:updated', link);
    return res.status(500).json({ error: 'REAPER not found on this system' });
  }

  const running = reaperService.isReaperRunning();

  if (running) {
    log.info(`REAPER running, sending script: ${link.reaperScriptPath}`);
    const ok = reaperService.runScriptInExisting(link.reaperScriptPath, {
      reaperPath: installPath,
      noactivate: true,
    });
    if (!ok) {
      link.status = 'error';
      store.broadcast('link:updated', link);
      return res.status(500).json({ error: 'Failed to send script to REAPER' });
    }
  } else {
    log.info(`REAPER not running, launching: ${link.reaperScriptPath}`);
    const ok = reaperService.launchWithScript(link.reaperScriptPath, {
      reaperPath: installPath,
      newProject: true,
      nosplash: true,
      noactivate: true,
    });
    if (!ok) {
      link.status = 'error';
      store.broadcast('link:updated', link);
      return res.status(500).json({ error: 'Failed to launch REAPER' });
    }
  }

  const jobId = uuidv4();
  const job = {
    type: 'execute-reaper',
    linkId: id,
    reaperScriptPath: link.reaperScriptPath,
    payloadPath: link.payloadPath,
    status: 'sent',
    createdAt: new Date().toISOString(),
  };
  store.jobQueue.set(jobId, job);

  if (REAPER_JOBS_DIR) {
    try {
      const jobFile = path.join(REAPER_JOBS_DIR, `${jobId}.json`);
      fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
      log.info(`Job file written: ${jobFile}`);
    } catch (e) {
      log.warn(`Failed to write job file: ${e.message}`);
    }
  }

  link.status = 'sent';
  store.broadcast('link:updated', link);

  res.json({
    status: 'sent',
    jobId,
    method: running ? 'nonewinst-script' : 'new-script',
    message: running
      ? 'Script sent to running REAPER via -nonewinst -script.'
      : 'REAPER launched with import script via -new -script.',
  });
});

// GET /api/links/:id/reaper-render-script — Generate REAPER render script
router.get('/:id/reaper-render-script', (req, res) => {
  const { id } = req.params;
  const link = store.activeLinks.get(id);

  if (!link) return res.status(404).json({ error: 'Link not found' });

  const { generateReaperRenderScript } = require('../integrations/reaper/generators');
  const renderScript = generateReaperRenderScript(link, TEMP_DIR);
  const scriptPath = path.join(TEMP_DIR, `render_${id}_reaper.lua`);
  fs.writeFileSync(scriptPath, renderScript);

  res.json({ scriptPath, message: 'Run this script inside REAPER: Actions > Show action list > Load' });
});

// POST/PUT /api/reaper/import-to-resolve — Import rendered audio back to Resolve
const importToResolveHandler = async (req, res) => {
  const { filePath, trackName, positionFrames } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'filePath is required' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: `File not found: ${filePath}` });
  }

  const resolveBridge = require('../services/resolve-service');

  try {
    const bridgeArgs = [filePath.replace(/\\/g, '/')];
    if (trackName) bridgeArgs.push(trackName);
    if (typeof positionFrames === 'number') bridgeArgs.push(String(positionFrames));

    const result = await resolveBridge.executeBridge('import-audio', bridgeArgs);
    if (result.error) {
      return res.status(500).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.post('/import-to-resolve', validate(ReaperImportRequestSchema), importToResolveHandler);
router.put('/import-to-resolve', validate(ReaperImportRequestSchema), importToResolveHandler);

module.exports = router;
module.exports.initReaperRoutes = initReaperRoutes;
