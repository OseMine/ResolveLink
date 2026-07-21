/**
 * Job Queue Routes
 * Handles CEP extension polling and job status updates.
 */
const express = require('express');
const { store } = require('../state');
const { validate } = require('../middleware/validation');
const { JobStatusRequestSchema } = require('@resolvelink/shared');
const { createLogger } = require('../logger');

const log = createLogger('Jobs');
const router = express.Router();

// GET /api/jobs/pending — Get next pending job for CEP extension
router.get('/pending', (_req, res) => {
  for (const [jobId, job] of store.jobQueue) {
    if (job.status === 'pending') {
      job.status = 'dispatched';
      job.dispatchedAt = new Date().toISOString();
      return res.json({ jobId, ...job });
    }
  }
  res.json({ jobId: null });
});

// PUT /api/jobs/:jobId/status — Update job status (called by CEP extension)
router.put('/:jobId/status', validate(JobStatusRequestSchema), (req, res) => {
  const { jobId } = req.params;
  const { status, result, error } = req.body;

  const job = store.jobQueue.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (result) job.result = result;
  if (error) job.error = error;

  // If job is done, update the associated link and start render watch
  if (job.linkId) {
    const link = store.activeLinks.get(job.linkId);
    if (link) {
      if (status === 'completed') {
        link.status = 'rendering';
        // Start watching for render output (imported from ae integration)
        try {
          const { startRenderWatch } = require('../integrations/ae/render-watcher');
          startRenderWatch(link, job.result);
        } catch {
          // render watcher not yet available
        }
      } else if (status === 'error') {
        link.status = 'error';
        link.error = error;
      }
      store.broadcast('link:updated', link);
    }
  }

  res.json({ success: true });
});

module.exports = router;
