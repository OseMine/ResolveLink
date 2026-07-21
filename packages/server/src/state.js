/**
 * ResolveLink Centralized State Store
 * Single source of truth for all in-memory state.
 * Replaces scattered Map objects and arrays in index.js.
 */
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');
const { DEFAULT_CONFIG } = require('@resolvelink/shared');

const log = createLogger('Store');
const logWS = createLogger('WS');

const MAX_HISTORY = DEFAULT_CONFIG.MAX_HISTORY;

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
  sendInitState,
};
