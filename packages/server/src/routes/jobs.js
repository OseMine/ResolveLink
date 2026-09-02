/**
 * Job Queue Routes
 * Handles CEP extension polling and job status updates.
 */
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { store } = require('../state');
const { validate } = require('../middleware/validation');
const { JobStatusRequestSchema } = require('@resolvelink/shared');
const { createLogger } = require('../logger');

const log = createLogger('Jobs');
const router = express.Router();

const LEASE_DURATION_MS = 30000;

// GET /api/jobs/pending — Get next pending job for CEP extension
router.get('/pending', (_req, res) => {
  const now = Date.now();
  for (const [jobId, job] of store.jobQueue) {
    const leaseExpired = !job.leasedAt || now > job.expiresAt;
    if (job.status === 'pending' || (job.status === 'dispatched' && leaseExpired)) {
      const leaseId = uuidv4();
      job.status = 'dispatched';
      job.leasedAt = now;
      job.leaseId = leaseId;
      job.expiresAt = now + LEASE_DURATION_MS;
      job.dispatchedAt = new Date().toISOString();
      job.attempts = (job.attempts || 0) + 1;
      return res.json({ jobId, ...job });
    }
  }
  res.json({ jobId: null });
});

// PUT /api/jobs/:jobId/status — Update job status (called by CEP extension)
router.put('/:jobId/status', validate(JobStatusRequestSchema), (req, res) => {
  const { jobId } = req.params;
  const { status, result, error, leaseId } = req.body;

  const job = store.jobQueue.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (status === 'executing') {
    if (!leaseId || job.leaseId !== leaseId) {
      return res.status(409).json({ error: 'Lease ID mismatch' });
    }
  }

  if (status === 'pending') {
    job.status = 'pending';
    job.leasedAt = null;
    job.leaseId = null;
    job.expiresAt = null;
    job.updatedAt = new Date().toISOString();
    return res.json({ success: true });
  }

  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (result !== undefined) job.result = result;
  if (error !== undefined) job.error = error;

  if (job.linkId) {
    const link = store.activeLinks.get(job.linkId);
    if (link) {
      if (status === 'completed') {
        link.status = 'rendering';
        try {
          const { startRenderWatch } = require('../integrations/ae/render-watcher');
          const config = require('../config.json');
          const exportDir = path.resolve(process.env.EXPORT_DIR || config.paths.vfxExportDir);
          startRenderWatch(link, job.result, exportDir);
        } catch {
          // render watcher not yet available
        }
      } else if (status === 'error') {
        link.status = 'error';
        link.error = error;

        if ((job.attempts || 0) < (job.maxAttempts || 3)) {
          log.warn(`Job ${jobId} failed (attempt ${job.attempts}/${job.maxAttempts || 3}), requeueing`);
          job.status = 'pending';
          job.leasedAt = null;
          job.leaseId = null;
          job.expiresAt = null;
        } else {
          log.error(`Job ${jobId} failed after ${job.attempts} attempts, removing from queue`);
          store.jobQueue.delete(jobId);
        }
      }
      store.broadcast('link:updated', link);
    }
  }

  if (status === 'completed') {
    store.jobQueue.delete(jobId);
  }

  res.json({ success: true });
});

module.exports = router;
