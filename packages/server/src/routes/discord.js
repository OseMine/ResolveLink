/**
 * Discord Rich Presence routes.
 */
const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validation');
const discord = require('../services/discord-rpc');

const router = express.Router();

const ActivitySchema = z.object({
  projectName: z.string().max(120).nullable().optional(),
  details: z.string().max(128).optional(),
  state: z.string().max(128).optional(),
  largeImageKey: z.string().max(64).optional(),
  largeImageText: z.string().max(128).optional(),
  smallImageKey: z.string().max(64).optional(),
  smallImageText: z.string().max(128).optional(),
});

const ToggleSchema = z.object({
  enabled: z.boolean(),
});

// GET /api/discord/status — Connection and current presence
router.get('/status', (_req, res) => {
  res.json(discord.getStatus());
});

// POST /api/discord/activity — Set the current presence
router.post('/activity', validate(ActivitySchema), async (req, res) => {
  try {
    const { projectName, ...custom } = req.body;
    if (!projectName && !custom.details) {
      await discord.clearActivity();
      return res.json({ success: true, status: discord.getStatus() });
    }

    await discord.setProject(projectName || null, custom);
    res.json({ success: true, status: discord.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/discord/activity — Clear the presence
router.delete('/activity', async (_req, res) => {
  try {
    await discord.clearActivity();
    res.json({ success: true, status: discord.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/discord/toggle — Enable or disable Rich Presence
router.post('/toggle', validate(ToggleSchema), async (req, res) => {
  try {
    const status = await discord.setEnabled(req.body.enabled);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/discord/reconnect — Force a reconnect attempt
router.post('/reconnect', async (_req, res) => {
  try {
    await discord.reconnect();
    res.json({ success: true, status: discord.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
