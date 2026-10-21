/**
 * ResolveLink Server Entry Point
 *
 * Minimal bootstrap: creates Express app, mounts routes, initializes
 * integrations, and starts the server. All business logic lives in
 * routes/, services/, and integrations/.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

const config = require('./config.json');
const { store, initStore, loadState, sendInitState } = require('./state');
const { createLogger } = require('./logger');
const { perfMiddleware, getPerfStats, getSlowEndpoints } = require('./middleware/perf');
const { initAuth, requireAuth } = require('./middleware/auth');
const registry = require('./integrations/registry');

const log = createLogger('Server');

// --- Directory Setup ---

const PORT = process.env.PORT || config.server.port;
const HOST = process.env.HOST || '127.0.0.1';
const EXPORT_DIR = path.resolve(process.env.EXPORT_DIR || config.paths.vfxExportDir);
const TEMP_DIR = path.resolve(process.env.TEMP_DIR || config.paths.tempDir);

[EXPORT_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const REAPER_JOBS_DIR = path.join(EXPORT_DIR, 'reaper-jobs');
const REAPER_RESULTS_DIR = path.join(EXPORT_DIR, 'reaper-results');

// --- Express App ---

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Loopback-only CORS: no Access-Control-Allow-Origin for non-loopback origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    // "null" is the origin browsers send for file:// pages (packaged Electron).
    if (origin === 'null') {
      res.setHeader('Access-Control-Allow-Origin', 'null');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    } else {
      try {
        const url = new URL(origin);
        const h = url.hostname;
        if (h === '127.0.0.1' || h === 'localhost' || h === '::1') {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          if (req.method === 'OPTIONS') return res.sendStatus(204);
        }
      } catch {}
    }
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(perfMiddleware);

// --- Auth ---
const configPath = path.join(__dirname, 'config.json');
const authState = initAuth(configPath);
if (authState.enabled) {
  log.info('API authentication enabled');
} else {
  log.info('API authentication disabled (set auth.enabled=true in config.json to enable)');
}
app.use(requireAuth(authState));

// Serve built React frontend
// packages/server/src -> packages/ui/dist
const DIST_DIR = path.join(__dirname, '..', '..', 'ui', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

// --- Initialize State ---

loadState();
initStore(wss);

// --- Initialize Integrations ---

const integrationsDir = path.join(__dirname, 'integrations');
registry.discoverFromDirectory(integrationsDir);

// --- Mount Routes ---

// System routes (health, history, config, etc.)
const systemRoutes = require('./routes/system');
systemRoutes.initSystemRoutes(TEMP_DIR, EXPORT_DIR, {
  port: PORT,
  host: HOST,
  authEnabled: authState.enabled,
});
app.use('/api', systemRoutes);

// Job queue routes
app.use('/api/jobs', require('./routes/jobs'));

// Link management routes
const linksRoutes = require('./routes/links');
linksRoutes.initLinkRoutes(TEMP_DIR, EXPORT_DIR);
app.use('/api/links', linksRoutes);

// Editing sessions (mounted at /api/editing for the GET endpoint)
app.get('/api/editing', (_req, res) => {
  const now = Date.now();
  const active = {};
  for (const [id, session] of store.editingSessions) {
    if (now - session.lastHeartbeat < 12000) {
      active[id] = { compName: session.compName, lastHeartbeat: session.lastHeartbeat };
    }
  }
  res.json(active);
});

// Resolve scripting routes
app.use('/api/resolve', require('./routes/resolve'));

// REAPER routes
const reaperRoutes = require('./routes/reaper');
reaperRoutes.initReaperRoutes(TEMP_DIR, EXPORT_DIR);
app.use('/api/reaper', reaperRoutes);

// AE integration routes (mounted at root /api since they use /api/link-clip etc.)
const aeIntegration = registry.get('ae');
if (aeIntegration) {
  app.use('/api', aeIntegration.getRoutes());
}

// Ableton integration routes
const abletonIntegration = registry.get('ableton');
if (abletonIntegration) {
  app.use('/api/ableton', abletonIntegration.getRoutes());
}

// Setup wizard routes
const setupRoutes = require('./routes/setup');
setupRoutes.initSetupRoutes(config, PORT, HOST, EXPORT_DIR, TEMP_DIR);
app.use('/api/setup', setupRoutes);

// Preset routes
app.use('/api/presets', require('./routes/presets'));

// Performance routes
app.get('/api/perf', getPerfStats);
app.get('/api/perf/slow', getSlowEndpoints);

// Auth management endpoints
const { generateToken } = require('./middleware/auth');

app.get('/api/auth', (req, res) => {
  res.json({
    enabled: authState.enabled,
    token: null,
  });
});

app.post('/api/auth/toggle', requireAuth(authState), (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }

  authState.enabled = enabled;

  // Persist to config.json
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!cfg.auth) cfg.auth = { enabled: false, token: '' };
    cfg.auth.enabled = enabled;
    if (enabled && !cfg.auth.token) {
      cfg.auth.token = generateToken();
      authState.token = cfg.auth.token;
    }
    if (!enabled) {
      cfg.auth.token = '';
      authState.token = '';
    }
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    log.error(`Failed to persist auth config: ${e.message}`);
  }

  log.info(`API authentication ${enabled ? 'enabled' : 'disabled'}`);
  res.json({ enabled: authState.enabled });
});

app.post('/api/auth/regenerate', requireAuth(authState), (_req, res) => {
  const newToken = generateToken();
  authState.token = newToken;

  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!cfg.auth) cfg.auth = { enabled: false, token: '' };
    cfg.auth.token = newToken;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    log.error(`Failed to persist auth config: ${e.message}`);
  }

  log.info('API auth token regenerated');
  res.json({ success: true });
});

// --- Catch-all: serve React app for non-API, non-file routes ---

app.get('*', (req, res) => {
  // Don't serve index.html for API routes or file requests
  if (req.path.startsWith('/api/') || req.path.includes('.')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built. Run: cd packages/ui && npm run build' });
  }
});

// Centralized error handler
app.use((err, _req, res, _next) => {
  log.error('Unhandled error:', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

// --- WebSocket ---

// Track REAPER WebSocket connections
const reaperWsClients = new Set();

wss.on('connection', (ws, req) => {
  const url = req.url || '/';
  
  if (url.startsWith('/api/ws/reaper')) {
    // REAPER WebSocket connection for real-time job delivery
    log.info('REAPER WebSocket connected');
    reaperWsClients.add(ws);
    
    ws.on('close', () => {
      reaperWsClients.delete(ws);
      log.info('REAPER WebSocket disconnected');
    });
    
    ws.on('error', (err) => {
      log.error('REAPER WebSocket error:', err.message);
    });
    
    // Send initial config
    ws.send(JSON.stringify({
      type: 'config',
      payload: {
        serverUrl: `http://${HOST}:${PORT}`,
        jobsDir: REAPER_JOBS_DIR.replace(/\\/g, '/'),
        resultsDir: REAPER_RESULTS_DIR.replace(/\\/g, '/'),
      }
    }));
  } else {
    // Standard UI WebSocket
    log.info('Client connected');
    sendInitState(ws);
    ws.on('close', () => log.info('Client disconnected'));
  }
});

// Broadcast job to all connected REAPER WebSocket clients
function broadcastReaperJob(job) {
  const msg = JSON.stringify(job);
  for (const ws of reaperWsClients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(msg);
    }
  }
}

// Export for use in routes
global.broadcastReaperJob = broadcastReaperJob;

// --- File Watchers ---

const { startWatcher } = require('./services/export-watcher');
const { startReaperResultsWatcher } = require('./integrations/reaper');

// --- Start ---

let lastResolveStatus = null;

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err);
  gracefulShutdown(1);
});

let fileWatcherHandle = null;
let reaperWatcherHandle = null;

function gracefulShutdown(exitCode = 0) {
  log.info('Shutting down gracefully...');
  if (fileWatcherHandle) fileWatcherHandle.close();
  if (reaperWatcherHandle) reaperWatcherHandle.close();
  wss.clients.forEach((ws) => ws.close());
  wss.close();
  server.close(() => {
    log.info('Server closed');
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    log.info(`Server running on http://${HOST}:${PORT}`);

    // Start file watchers
    fileWatcherHandle = startWatcher(EXPORT_DIR, config);
    reaperWatcherHandle = startReaperResultsWatcher(REAPER_RESULTS_DIR, EXPORT_DIR);

    // Initialize integrations
    await registry.initAll(store);

    // Start polling DaVinci Resolve connection status
    const resolveBridge = require('./services/resolve-service');
    const stopPolling = resolveBridge.startPolling((status) => {
      const changed = !lastResolveStatus || status.connected !== lastResolveStatus.connected;
      lastResolveStatus = status;

      if (changed) {
        log.info(`Resolve ${status.connected ? 'Connected' : 'Disconnected'} ${status.version || ''}`);
        store.broadcast('resolve:status', status);
      }
    });

    process.on('SIGTERM', () => { stopPolling(); gracefulShutdown(0); });
    process.on('SIGINT', () => { stopPolling(); gracefulShutdown(0); });
  });
}

module.exports = { app, server };
