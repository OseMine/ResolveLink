/**
 * Link Management Routes
 * CRUD operations for link lifecycle.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { store } = require('../state');
const { createLogger } = require('../logger');

const log = createLogger('Links');
const router = express.Router();

// These are set during init
let TEMP_DIR = './temp';
let EXPORT_DIR = './exports';

function initLinkRoutes(tempDir, exportDir) {
  TEMP_DIR = tempDir;
  EXPORT_DIR = exportDir;
}

// GET /api/links — Get all active links
router.get('/', (_req, res) => {
  res.json(Array.from(store.activeLinks.values()));
});

// GET /api/links/:id — Get a single link by ID
router.get('/:id', (req, res) => {
  const link = store.activeLinks.get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  res.json(link);
});

// PUT /api/links/:id/status — Update link status
router.put('/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, exportPath } = req.body;

  const link = store.activeLinks.get(id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  link.status = status;
  if (exportPath) link.exportPath = exportPath;
  link.updatedAt = new Date().toISOString();

  store.broadcast('link:updated', link);
  res.json(link);
});

// DELETE /api/links/:id — Delete a link
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (!store.activeLinks.has(id)) {
    return res.status(404).json({ error: 'Link not found' });
  }
  store.activeLinks.delete(id);
  store.editingSessions.delete(id);
  store.broadcast('link:deleted', { id });
  res.json({ deleted: true });
});

// POST /api/links/:id/editing — Editing heartbeat
router.post('/:id/editing', (req, res) => {
  const { id } = req.params;
  const { compName, status } = req.body;

  if (status === 'idle') {
    store.editingSessions.delete(id);
    store.broadcast('link:editing', { id, editing: false });
    return res.json({ ok: true });
  }

  store.editingSessions.set(id, {
    compName: compName || null,
    lastHeartbeat: Date.now(),
    clientIp: req.ip,
  });

  store.broadcast('link:editing', { id, editing: true, compName: compName || null });
  res.json({ ok: true });
});

// GET /api/links/:id/editing — Get editing status for a link
router.get('/:id/editing', (req, res) => {
  const { id } = req.params;
  const session = store.editingSessions.get(id);
  if (!session) return res.json({ editing: false });

  const alive = Date.now() - session.lastHeartbeat < 12000;
  if (!alive) {
    store.editingSessions.delete(id);
    return res.json({ editing: false });
  }
  res.json({ editing: true, compName: session.compName });
});

// GET /api/editing — Get all editing sessions
router.get('/', (_req, res) => {
  // This overlaps with GET /api/links — redirect to the editing endpoint
  res.redirect('/api/editing');
});

module.exports = router;
module.exports.initLinkRoutes = initLinkRoutes;
