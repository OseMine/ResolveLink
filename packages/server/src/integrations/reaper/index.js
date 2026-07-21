/**
 * REAPER Integration
 *
 * Implements the Integration interface for REAPER DAW.
 * Handles REAPER-specific routes, script generation, and file-based IPC.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../../state');
const reaperService = require('../../services/reaper-service');
const { createLogger } = require('../../logger');
const {
  generateReaperPayload,
  generateReaperImportScript,
  generateReaperRenderScript,
} = require('./generators');

const log = createLogger('REAPER');
const logReaper = createLogger('REAPER-IPC');

/** @type {import('@resolvelink/shared').Integration} */
const reaperIntegration = {
  config: {
    name: 'reaper',
    displayName: 'REAPER',
    description: 'REAPER DAW audio round-trip workflow',
  },

  async init(storeInstance) {
    log.info('REAPER integration initialized');
  },

  getStatus() {
    return reaperService.getStatus();
  },

  getRoutes() {
    const router = express.Router();
    return router; // REAPER routes are registered separately in routes/reaper.js
  },

  generateImportScript(payload) {
    return { scriptPath: null, payloadPath: null };
  },

  async isAvailable() {
    return reaperService.getStatus().installed;
  },
};

// --- REAPER File Watcher (file-based IPC) ---

/**
 * Start watching for REAPER result files.
 * @param {string} resultsDir
 * @param {string} exportDir
 */
function startReaperResultsWatcher(resultsDir, exportDir) {
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const watcher = chokidar.watch(resultsDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
  });

  watcher.on('add', (filePath) => {
    if (!filePath.endsWith('.json')) return;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const result = JSON.parse(content);
      const jobId = path.basename(filePath, '.json');

      if (result.status === 'completed') {
        const job = store.jobQueue.get(jobId);
        if (job) {
          job.status = 'completed';
          logReaper.info(`REAPER job completed via file IPC: ${jobId}`);

          const link = store.activeLinks.get(job.linkId);
          if (link) {
            link.status = 'completed';
            store.broadcast('link:updated', link);
          }
        }
      } else if (result.status === 'error') {
        logReaper.error(`REAPER job failed: ${jobId} - ${result.error}`);
      }

      fs.unlinkSync(filePath);
    } catch (e) {
      logReaper.warn(`Failed to process REAPER result: ${e.message}`);
    }
  });

  logReaper.info(`Watching for REAPER results in: ${resultsDir}`);
  return watcher;
}

module.exports = reaperIntegration;
module.exports.startReaperResultsWatcher = startReaperResultsWatcher;
