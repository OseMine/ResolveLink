/**
 * ResolveLink Centralized State Store
 * Single source of truth for all in-memory state.
 * Persists links, jobs, and history to JSON files for durability across restarts.
 */
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');
const { DEFAULT_CONFIG } = require('@resolvelink/shared/constants');

const log = createLogger('Store');
const logWS = createLogger('WS');

const MAX_HISTORY = DEFAULT_CONFIG.MAX_HISTORY;

const STATE_DIR = path.resolve(
  process.env.STATE_DIR ||
  path.join(process.env.TEMP_DIR || './temp', 'state')
);
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const STATE_FILE_TMP = path.join(STATE_DIR, 'state.json.tmp');

/** @type {import('@resolvelink/shared').Store} */
const store = {
  activeLinks: new Map(),
  jobQueue: new Map(),
  jobHistory: [],
  editingSessions: new Map(),
  broadcast: null,
  addJobHistory: null,
};

let wss = null;
let saveDebounceTimer = null;

/**
 * Serialize store state to a plain object for JSON persistence.
 */
function serializeState() {
  return {
    activeLinks: Array.from(store.activeLinks.entries()),
    jobQueue: Array.from(store.jobQueue.entries()),
    jobHistory: store.jobHistory,
  };
}

/**
 * Atomically write state to disk. Writes to a temp file then renames.
 */
function saveState() {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    const data = JSON.stringify(serializeState(), null, 2);
    fs.writeFileSync(STATE_FILE_TMP, data, 'utf8');
    fs.renameSync(STATE_FILE_TMP, STATE_FILE);
  } catch (err) {
    log.error(`Failed to save state: ${err.message}`);
  }
}

/**
 * Schedule a debounced state save (500ms after last mutation).
 */
function scheduleSave() {
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(saveState, 500);
}

/**
 * Load persisted state from disk. Gracefully handles missing or corrupt files.
 * Must be called before initStore.
 */
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return;

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);

    if (Array.isArray(data.activeLinks)) {
      store.activeLinks = new Map(data.activeLinks);
    }
    if (Array.isArray(data.jobQueue)) {
      store.jobQueue = new Map(data.jobQueue);
    }
    if (Array.isArray(data.jobHistory)) {
      store.jobHistory = data.jobHistory.slice(0, MAX_HISTORY);
    }

    log.info(`State restored: ${store.activeLinks.size} links, ${store.jobQueue.size} jobs, ${store.jobHistory.length} history entries`);
  } catch (err) {
    log.warn(`Could not load state file (starting fresh): ${err.message}`);
    store.activeLinks = new Map();
    store.jobQueue = new Map();
    store.jobHistory = [];
  }
}

/**
 * Initialize the store with a WebSocket server for broadcasting.
 * @param {import('ws').WebSocketServer} wssInstance
 */
function initStore(wssInstance) {
  wss = wssInstance;

  store.broadcast = function broadcast(type, payload) {
    const message = JSON.stringify({ type, payload });
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(message);
    });
    scheduleSave();
  };

  store.addJobHistory = function addJobHistory(entry) {
    store.jobHistory.unshift({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    if (store.jobHistory.length > MAX_HISTORY) {
      store.jobHistory.length = MAX_HISTORY;
    }
    store.broadcast('job:history', store.jobHistory.slice(0, 20));
  };

  const originalActiveLinks = store.activeLinks;
  const originalJobQueue = store.jobQueue;

  const makeTrackedMap = (map) => {
    return new Proxy(map, {
      get(target, prop) {
        const val = target[prop];
        if (typeof val === 'function') {
          if (prop === 'set' || prop === 'delete' || prop === 'clear') {
            return function (...args) {
              const result = target[prop].apply(target, args);
              scheduleSave();
              return result;
            };
          }
          return val.bind(target);
        }
        return val;
      },
    });
  };

  store.activeLinks = makeTrackedMap(originalActiveLinks);
  store.jobQueue = makeTrackedMap(originalJobQueue);
}

/**
 * Send initial state to a newly connected WebSocket client.
 * @param {import('ws').WebSocket} ws
 */
function sendInitState(ws) {
  ws.send(JSON.stringify({
    type: 'init',
    payload: { links: Array.from(store.activeLinks.values()) },
  }));
}

module.exports = {
  store,
  initStore,
  loadState,
  sendInitState,
  saveState,
};
