/**
 * System Routes
 * Health check, history, config, update check, batch export, clear, perf, render progress.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../state');
const resolveBridge = require('../services/resolve-service');
const { validate } = require('../middleware/validation');
const { BatchExportRequestSchema, ClearRequestSchema } = require('@resolvelink/shared');
const { createLogger } = require('../logger');

const log = createLogger('System');
const router = express.Router();

// These are set during init
let TEMP_DIR = './temp';
let EXPORT_DIR = './exports';

function initSystemRoutes(tempDir, exportDir) {
  TEMP_DIR = tempDir;
  EXPORT_DIR = exportDir;
}

// GET /api/health — Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', links: store.activeLinks.size });
});

// GET /api/history — Job history
router.get('/history', (_req, res) => {
  res.json(store.jobHistory.slice(0, 50));
});

// GET /api/config — Server config
router.get('/config', (_req, res) => {
  res.json({
    exportDir: EXPORT_DIR,
    tempDir: TEMP_DIR,
    serverPort: process.env.PORT || 3030,
  });
});

// GET /api/render-progress/:id — Render progress
router.get('/render-progress/:id', (req, res) => {
  const { id } = req.params;
  const link = store.activeLinks.get(id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  if (link.exportPath && fs.existsSync(link.exportPath)) {
    const stat = fs.statSync(link.exportPath);
    return res.json({ status: 'done', percent: 100, bytes: stat.size });
  }

  res.json({ status: link.status || 'pending', percent: link.status === 'rendering' ? 50 : 0 });
});

// POST /api/batch-export — Batch export timelines
router.post('/batch-export', validate(BatchExportRequestSchema), async (req, res) => {
  const { timelineNames } = req.body;

  const { generateJSXPayload, generateExtendScript } = require('../integrations/ae/generators');

  const results = [];
  for (const name of timelineNames) {
    try {
      const result = await resolveBridge.executeBridge('timeline-at', [name], 10000);
      if (result.error) {
        results.push({ name, status: 'error', error: result.error });
        continue;
      }

      const clipData = [];
      for (const [track, clips] of Object.entries(result.tracks || {})) {
        for (const clip of clips) {
          clipData.push({ ...clip, trackIndex: parseInt(track.replace('video_', '')) });
        }
      }

      if (clipData.length === 0) {
        results.push({ name, status: 'error', error: 'No clips found' });
        continue;
      }

      const linkId = uuidv4();
      const link = {
        id: linkId,
        clips: clipData.map(c => ({ ...c, linkId, status: 'pending' })),
        settings: {
          width: result.resolution?.width || 1920,
          height: result.resolution?.height || 1080,
          fps: parseFloat(result.frameRate) || 24,
          duration: 10,
        },
        createdAt: new Date().toISOString(),
        status: 'created',
        exportPath: null,
        timelineName: name,
      };
      store.activeLinks.set(linkId, link);

      const jsxPayload = generateJSXPayload(link);
      const payloadPath = path.join(TEMP_DIR, `${linkId}.json`);
      fs.writeFileSync(payloadPath, JSON.stringify(jsxPayload, null, 2));
      const jsxScript = generateExtendScript(link);
      const jsxPath = path.join(TEMP_DIR, `${linkId}.jsx`);
      fs.writeFileSync(jsxPath, jsxScript);
      link.jsxPath = jsxPath;
      link.payloadPath = payloadPath;

      store.broadcast('link:created', link);
      store.addJobHistory({ type: 'create', linkId, status: 'created', clipCount: clipData.length });
      results.push({ name, status: 'created', linkId, clipCount: clipData.length });
    } catch (err) {
      results.push({ name, status: 'error', error: err.message });
    }
  }

  res.json({ results, total: results.length, created: results.filter(r => r.status === 'created').length });
});

// GET /api/update-check — Check for updates
router.get('/update-check', (_req, res) => {
  const options = {
    hostname: 'api.github.com',
    path: '/repos/OseMine/ResolveLink/releases/latest',
    headers: { 'User-Agent': 'ResolveLink' },
  };

  const req2 = https.get(options, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latestVersion = release.tag_name?.replace(/^v/, '') || null;
        const currentVersion = require('../../../package.json').version;
        res.json({
          currentVersion,
          latestVersion,
          updateAvailable: latestVersion && latestVersion !== currentVersion,
          downloadUrl: release.html_url || null,
          releaseNotes: release.body || '',
        });
      } catch {
        res.json({ currentVersion: require('../../../package.json').version, updateAvailable: false, error: 'Failed to parse release info' });
      }
    });
  });

  req2.on('error', () => {
    res.json({ currentVersion: require('../../../package.json').version, updateAvailable: false, error: 'Could not reach GitHub' });
  });
  req2.setTimeout(5000, () => { req2.destroy(); res.json({ currentVersion: require('../../../package.json').version, updateAvailable: false, error: 'Timeout' }); });
});

// POST /api/clear — Clear temp/export directories
router.post('/clear', validate(ClearRequestSchema), (req, res) => {
  const { target } = req.body;
  const dir = target === 'exports' ? EXPORT_DIR : target === 'temp' ? TEMP_DIR : null;
  if (!dir) return res.status(400).json({ error: 'target must be "exports" or "temp"' });

  let removed = 0;
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isFile()) {
        fs.unlinkSync(itemPath);
        removed++;
      } else if (stat.isDirectory()) {
        fs.rmSync(itemPath, { recursive: true, force: true });
        removed++;
      }
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/editing — Get all editing sessions
router.get('/editing', (_req, res) => {
  const now = Date.now();
  const active = {};
  for (const [id, session] of store.editingSessions) {
    if (now - session.lastHeartbeat < 12000) {
      active[id] = { compName: session.compName, lastHeartbeat: session.lastHeartbeat };
    }
  }
  res.json(active);
});

module.exports = router;
module.exports.initSystemRoutes = initSystemRoutes;
