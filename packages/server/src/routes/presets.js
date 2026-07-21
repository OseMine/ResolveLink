/**
 * Render Presets Routes
 * Manages saved render presets (persisted to JSON file).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { validate } = require('../middleware/validation');
const { PresetRequestSchema } = require('@resolvelink/shared');

const router = express.Router();

const PRESETS_PATH = path.join(__dirname, '..', '..', '..', 'render-presets.json');

function loadPresets() {
  try { return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8')); }
  catch { return { presets: [] }; }
}

function savePresets(data) {
  fs.writeFileSync(PRESETS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/presets — List all presets
router.get('/', (_req, res) => {
  res.json(loadPresets());
});

// POST /api/presets — Create or update a preset
router.post('/', validate(PresetRequestSchema), (req, res) => {
  const { name, template, outputModule, settings } = req.body;

  const data = loadPresets();
  const existing = data.presets.findIndex(p => p.name === name);
  const preset = {
    name,
    template: template || 'Best Settings',
    outputModule: outputModule || '',
    settings: settings || {},
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    data.presets[existing] = preset;
  } else {
    data.presets.push(preset);
  }
  savePresets(data);
  res.json({ success: true, preset });
});

// DELETE /api/presets/:name — Delete a preset
router.delete('/:name', (req, res) => {
  const data = loadPresets();
  data.presets = data.presets.filter(p => p.name !== req.params.name);
  savePresets(data);
  res.json({ success: true });
});

module.exports = router;
