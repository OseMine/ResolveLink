/**
 * Export Watcher
 * Watches the export directory for new VFX assets and matches them to active links.
 */
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { store } = require('../state');
const resolveBridge = require('./resolve-service');
const { createLogger } = require('../logger');

const log = createLogger('Watcher');

let watcherDebounce = null;

/**
 * Start the file watcher on the export directory.
 * @param {string} exportDir
 * @param {object} config
 * @returns {import('chokidar').FSWatcher}
 */
function startWatcher(exportDir, config) {
  if (!config.watcher.enabled) return null;

  const watchDirs = [exportDir];

  const extraFolders = process.env.WATCH_FOLDERS;
  if (extraFolders) {
    for (const f of extraFolders.split(',').map(s => s.trim()).filter(Boolean)) {
      const resolved = path.resolve(f);
      if (!watchDirs.includes(resolved)) watchDirs.push(resolved);
    }
  }

  const watcher = chokidar.watch(watchDirs, {
    persistent: true,
    ignoreInitial: true,
    depth: 2,
  });

  log.info(`Monitoring ${watchDirs.length} director${watchDirs.length > 1 ? 'ies' : 'y'}: ${watchDirs.join(', ')}`);

  watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!config.watcher.extensions.includes(ext)) return;

    clearTimeout(watcherDebounce);
    watcherDebounce = setTimeout(async () => {
      log.info(`New VFX asset detected: ${filePath}`);

      const fileName = path.basename(filePath, ext);
      let matchedLink = null;

      for (const [, link] of store.activeLinks) {
        const idPrefix = link.id.slice(0, 8);
        if (fileName.startsWith('Resolve_Link_' + idPrefix) || fileName.includes(idPrefix)) {
          matchedLink = link;
          break;
        }
      }

      if (matchedLink) {
        matchedLink.status = 'rendered';
        matchedLink.exportPath = filePath;
        matchedLink.updatedAt = new Date().toISOString();
        store.broadcast('link:rendered', matchedLink);
        log.info(`Matched to link: ${matchedLink.id}`);

        try {
          log.info(`Auto-importing to Resolve: ${filePath}`);
          const result = await resolveBridge.executeBridge('create-compound', [filePath]);
          if (result.error) {
            log.error(`Auto-import failed: ${result.error}`);
            matchedLink.status = 'error';
          } else {
            log.info('Auto-import success', result);
            matchedLink.status = 'imported';
          }
        } catch (e) {
          log.error(`Auto-import error: ${e.message}`);
          matchedLink.status = 'error';
        }
        matchedLink.updatedAt = new Date().toISOString();
        store.broadcast('link:updated', matchedLink);
      } else {
        store.broadcast('file:new', { path: filePath, name: path.basename(filePath) });
      }
    }, config.watcher.debounceMs);
  });

  watcher.on('error', (err) => {
    log.error('Error:', err);
  });

  log.info(`Monitoring: ${exportDir}`);
  return watcher;
}

module.exports = { startWatcher };
