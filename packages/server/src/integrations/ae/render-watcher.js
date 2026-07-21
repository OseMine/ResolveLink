/**
 * AE Render Watcher
 * Polls for render output files and auto-imports back into Resolve.
 */
const path = require('path');
const fs = require('fs');
const { store } = require('../../state');
const resolveBridge = require('../../services/resolve-service');
const { createLogger } = require('../../logger');

const log = createLogger('RenderWatch');

/**
 * Start watching for a render output file for a specific link.
 * @param {import('@resolvelink/shared').Link} link
 * @param {object} renderInfo
 * @param {string} exportDir
 */
function startRenderWatch(link, renderInfo, exportDir) {
  const compName = renderInfo?.compName || `Resolve_Link_${link.id.slice(0, 8)}`;
  const expectedFile = path.join(exportDir, `${compName}.mov`);
  const maxWait = 300000; // 5 minutes
  const pollInterval = 2000;
  let elapsed = 0;

  log.info(`Waiting for: ${expectedFile}`);

  const poll = setInterval(async () => {
    elapsed += pollInterval;

    if (fs.existsSync(expectedFile)) {
      clearInterval(poll);
      log.info(`Render detected: ${expectedFile}`);

      link.status = 'rendered';
      link.exportPath = expectedFile;
      store.broadcast('link:updated', link);

      try {
        const result = await resolveBridge.executeBridge('create-compound', [expectedFile]);
        if (result.error) {
          log.error(`Import failed: ${result.error}`);
          link.status = 'error';
          store.addJobHistory({ type: 'import', linkId: link.id, status: 'error', file: expectedFile, error: result.error });
        } else {
          log.info('Import success', result);
          link.status = 'imported';
          store.addJobHistory({ type: 'import', linkId: link.id, status: 'success', file: expectedFile, details: result });
        }
      } catch (e) {
        log.error(`Import error: ${e.message}`);
        link.status = 'error';
        store.addJobHistory({ type: 'import', linkId: link.id, status: 'error', file: expectedFile, error: e.message });
      }

      store.broadcast('link:updated', link);
    }

    if (elapsed >= maxWait) {
      clearInterval(poll);
      log.warn(`Timeout waiting for render: ${expectedFile}`);
      link.status = 'error';
      store.broadcast('link:updated', link);
    }
  }, pollInterval);
}

module.exports = { startRenderWatch };
