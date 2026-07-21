/**
 * Resolve Scripting Routes
 * Proxies requests to the Python DaVinci Resolve bridge.
 */
const express = require('express');
const resolveBridge = require('../services/resolve-service');
const { validate } = require('../middleware/validation');
const { ClipPropertiesRequestSchema } = require('@resolvelink/shared');

const router = express.Router();

// GET /api/resolve/status — Check DaVinci Resolve connection
router.get('/status', async (_req, res) => {
  try {
    const status = await resolveBridge.checkConnection(true);
    res.json(status);
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// GET /api/resolve/markers — Get timeline markers
router.get('/markers', async (_req, res) => {
  try {
    const result = await resolveBridge.executeBridge('markers', [], 10000);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message, markers: [] });
  }
});

// GET /api/resolve/project — Get current project info
router.get('/project', async (_req, res) => {
  try {
    const result = await resolveBridge.getProject();
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET /api/resolve/timeline — Get current timeline info
router.get('/timeline', async (_req, res) => {
  try {
    const result = await resolveBridge.getTimeline();
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// GET /api/resolve/selection — Get selected clips
router.get('/selection', async (req, res) => {
  try {
    const track = req.query.track ? parseInt(req.query.track, 10) : undefined;
    const result = await resolveBridge.getSelection(track);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// POST /api/resolve/clip-properties — Get clip properties
router.post('/clip-properties', validate(ClipPropertiesRequestSchema), async (req, res) => {
  try {
    const { clipPath } = req.body;
    const result = await resolveBridge.getClipProperties(clipPath);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;
