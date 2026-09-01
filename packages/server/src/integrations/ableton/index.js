/**
 * Ableton Live Integration
 *
 * Implements the Integration interface for Ableton Live.
 * Handles OSC-based clip placement, MIDI remote script generation,
 * Max for Live device config, and Resolution import workflows.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../../state');
const { createLogger } = require('../../logger');
const { validate } = require('../../middleware/validation');
const {
  AbletonLinkClipRequestSchema,
  AbletonImportRequestSchema,
} = require('@resolvelink/shared');
const {
  generateOSCPayload,
  generateMIDIRemoteScript,
  generateResolveImportScript,
  generateMaxLiveDevicePayload,
  generateOSCCommandSequence,
  generateMaxLiveDeviceConfig,
} = require('./generators');
const abletonService = require('./service');
const config = require('../../config.json');

const log = createLogger('Ableton');

/** @type {import('@resolvelink/shared').Integration} */
const abletonIntegration = {
  config: {
    name: 'ableton',
    displayName: 'Ableton Live',
    description: 'Audio round-trip workflow with Ableton Live via OSC and MIDI remote scripts',
  },

  async init(storeInstance) {
    log.info('Ableton Live integration initialized');
    log.info(`OSC query port: ${config.ableton?.oscQueryPort || 9000}`);
    log.info(`OSC response port: ${config.ableton?.oscResponsePort || 9001}`);
  },

  getStatus() {
    return abletonService.getStatus();
  },

  getRoutes() {
    const router = express.Router();
    const exportDir = path.resolve(process.env.EXPORT_DIR || config.paths.vfxExportDir);
    const tempDir = path.resolve(process.env.TEMP_DIR || config.paths.tempDir);

    // GET /api/ableton/status — Check Ableton availability
    router.get('/status', (req, res) => {
      const status = abletonService.getStatus();
      res.json({
        integration: 'ableton',
        ...status,
        oscPorts: {
          query: config.ableton?.oscQueryPort || 9000,
          response: config.ableton?.oscResponsePort || 9001,
        },
      });
    });

    // POST /api/ableton/link-clip — Create Ableton link
    router.post('/link-clip', validate(AbletonLinkClipRequestSchema), (req, res) => {
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
          sampleRate: settings?.sampleRate || 48000,
          bpm: settings?.bpm || 120,
          timeSignature: settings?.timeSignature || '4/4',
        },
        status: 'created',
        exportPath: null,
        createdAt: new Date().toISOString(),
        target: 'ableton',
      };

      store.activeLinks.set(linkId, link);

      // Generate OSC payload
      const oscPayload = generateOSCPayload(link);
      const payloadPath = path.join(tempDir, `${linkId}_osc.json`);
      fs.writeFileSync(payloadPath, JSON.stringify(oscPayload, null, 2));

      // Generate MIDI remote script
      const midiScript = generateMIDIRemoteScript(link, exportDir);
      const midiScriptPath = path.join(tempDir, `${linkId}_midi.py`);
      fs.writeFileSync(midiScriptPath, midiScript);

      // Generate OSC command sequence
      const commandSequence = generateOSCCommandSequence(link);
      const commandPath = path.join(tempDir, `${linkId}_osc_sequence.json`);
      fs.writeFileSync(commandPath, JSON.stringify(commandSequence, null, 2));

      // Generate Max for Live device config
      const maxDeviceConfig = generateMaxLiveDeviceConfig(link, exportDir);
      const maxConfigPath = path.join(tempDir, `${linkId}_max.json`);
      fs.writeFileSync(maxConfigPath, maxDeviceConfig);

      link.oscPayloadPath = payloadPath;
      link.midiScriptPath = midiScriptPath;
      link.oscSequencePath = commandPath;
      link.maxDeviceConfigPath = maxConfigPath;

      store.broadcast('link:created', link);
      store.addJobHistory({
        type: 'create',
        linkId: link.id,
        status: 'created',
        clipCount: link.clips.length,
        target: 'ableton',
      });

      res.json({
        linkId,
        status: 'created',
        target: 'ableton',
        oscPayloadPath: payloadPath,
        midiScriptPath,
        oscSequencePath: commandPath,
        maxDeviceConfigPath: maxConfigPath,
        message: 'Ableton link created. Send OSC commands or deploy MIDI remote script.',
      });
    });

    // POST /api/ableton/:id/render — Send to Ableton via OSC / MIDI
    router.post('/:id/render', (req, res, next) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid link ID format' });
      }
      next();
    }, async (req, res) => {
      const { id } = req.params;
      const link = store.activeLinks.get(id);

      if (!link) return res.status(404).json({ error: 'Link not found' });
      if (link.target !== 'ableton') return res.status(400).json({ error: 'Link target is not ableton' });

      link.status = 'sending';
      store.broadcast('link:updated', link);

      try {
        const isRunning = await abletonService.checkAbletonRunning();

        if (isRunning) {
          // Use OSC path
          const compName = `ResolveLink_${id.slice(0, 8)}`;
          const outputFile = path.join(exportDir, `${compName}.wav`);

          const oscSuccess = await abletonService.triggerRender(outputFile);

          if (oscSuccess) {
            link.status = 'rendering';
            link.exportPath = outputFile;
            store.broadcast('link:updated', link);
            res.json({
              status: 'rendering',
              method: 'osc',
              exportPath: outputFile,
              message: 'OSC render command sent to Ableton Live.',
            });
          } else {
            link.status = 'error';
            link.error = 'OSC render command failed';
            store.broadcast('link:updated', link);
            res.status(500).json({ error: 'Failed to send OSC render command to Ableton.' });
          }
        } else {
          // OSC unavailable — try MIDI remote script deployment
          if (link.midiScriptPath && fs.existsSync(link.midiScriptPath)) {
            const midiDir = abletonService.getMIDIScriptsDir();
            const deployDir = path.join(midiDir, 'ResolveLink');

            if (!fs.existsSync(deployDir)) fs.mkdirSync(deployDir, { recursive: true });
            fs.copyFileSync(link.midiScriptPath, path.join(deployDir, `resolve_link_${id.slice(0, 8)}.py`));

            const launchOk = abletonService.launchAbleton();
            link.status = 'sending';

            res.json({
              status: 'sending',
              method: 'midi-script',
              message: 'Ableton not running. MIDI remote script deployed. Launching Ableton...',
              midiScriptPath: link.midiScriptPath,
              launchAttempted: launchOk,
            });
          } else {
            // Try launching with script directly
            const launchOk = abletonService.launchAbleton();
            link.status = 'sending';
            res.json({
              status: 'sending',
              method: 'launch',
              message: 'Ableton not running. Launch attempted without OSC.',
              launchAttempted: launchOk,
            });
          }
        }
      } catch (err) {
        log.error(`Ableton render error for ${id}: ${err.message}`);
        link.status = 'error';
        link.error = err.message;
        store.broadcast('link:updated', link);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/ableton/import-to-resolve — Import rendered audio back
    router.post('/import-to-resolve', validate(AbletonImportRequestSchema), async (req, res) => {
      const { filePath, trackName, positionBeats } = req.body;

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Rendered file not found', filePath });
      }

      try {
        const resolveBridge = require('../../services/resolve-service');
        const args = trackName ? [filePath, trackName] : [filePath];
        const result = await resolveBridge.executeBridge('import-audio', args);

        if (result.error) {
          return res.status(500).json({ error: result.error, result });
        }

        res.json({
          success: true,
          message: 'Audio imported to Resolve',
          filePath,
          trackName: trackName || null,
          result,
        });
      } catch (err) {
        log.error(`Ableton import-to-resolve error: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/ableton/:id/auto — Auto-workflow: OSC or MIDI fallback
    router.post('/:id/auto', (req, res, next) => {
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

      const isRunning = await abletonService.checkAbletonRunning();
      const hasMidiScript = link.midiScriptPath && fs.existsSync(link.midiScriptPath);

      if (isRunning) {
        const jobId = uuidv4();
        const job = {
          type: 'execute-osc',
          linkId: id,
          oscSequencePath: link.oscSequencePath,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        store.jobQueue.set(jobId, job);
        log.info(`Ableton running, OSC job queued: ${jobId} for link: ${id}`);

        res.json({
          status: 'queued',
          method: 'osc',
          jobId,
          message: 'Ableton running. OSC command sequence queued.',
        });
      } else if (hasMidiScript) {
        // Deploy MIDI script and attempt launch
        const midiDir = abletonService.getMIDIScriptsDir();
        const deployDir = path.join(midiDir, 'ResolveLink');
        if (!fs.existsSync(deployDir)) fs.mkdirSync(deployDir, { recursive: true });
        fs.copyFileSync(link.midiScriptPath, path.join(deployDir, `resolve_link_${id.slice(0, 8)}.py`));

        const launched = abletonService.launchAbleton();
        log.info(`Ableton not running, MIDI script deployed and launch attempted for link: ${id}`);

        res.json({
          status: 'sending',
          method: 'midi-script',
          message: 'Ableton not running. MIDI remote script deployed.',
          launchAttempted: launched,
        });
      } else {
        const launched = abletonService.launchAbleton();
        res.json({
          status: 'sending',
          method: 'launch',
          message: 'Ableton not detected. Launch attempted.',
          launchAttempted: launched,
        });
      }
    });

    // GET /api/links/:id/osc-sequence — Serve OSC command sequence
    router.get('/links/:id/osc-sequence', (req, res) => {
      const link = store.activeLinks.get(req.params.id);
      if (!link) return res.status(404).json({ error: 'Link not found' });
      if (!link.oscSequencePath || !fs.existsSync(link.oscSequencePath)) {
        return res.status(404).json({ error: 'OSC sequence file not found' });
      }
      try {
        const content = fs.readFileSync(link.oscSequencePath, 'utf8');
        res.json({ content, path: link.oscSequencePath });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/links/:id/midi-script — Serve MIDI remote script content
    router.get('/links/:id/midi-script', (req, res) => {
      const link = store.activeLinks.get(req.params.id);
      if (!link) return res.status(404).json({ error: 'Link not found' });
      if (!link.midiScriptPath || !fs.existsSync(link.midiScriptPath)) {
        return res.status(404).json({ error: 'MIDI script file not found' });
      }
      try {
        const content = fs.readFileSync(link.midiScriptPath, 'utf8');
        res.json({ content, path: link.midiScriptPath });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    return router;
  },

  generateImportScript(payload) {
    // Per-link import script is generated by generators.js via create-track workflow
    return { scriptPath: null, payloadPath: null };
  },

  async isAvailable() {
    return !!abletonService.detectAbletonPath();
  },
};

module.exports = abletonIntegration;
