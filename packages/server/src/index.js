/**
 * ResolveLink Server Entry Point
 *
 * Minimal bootstrap: creates Express app, mounts routes, initializes
 * integrations, and starts the server. All business logic lives in
 * routes/, services/, and integrations/.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

const config = require('./config.json');
const { store, initStore, sendInitState } = require('./state');
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

app.use(cors());
app.use(express.json());
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
const DIST_DIR = path.join(__dirname, '..', '..', 'packages', 'ui', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

// --- Initialize State ---

initStore(wss);

// --- Initialize Integrations ---

const integrationsDir = path.join(__dirname, 'integrations');
registry.discoverFromDirectory(integrationsDir);

// --- Mount Routes ---

// System routes (health, history, config, etc.)
const systemRoutes = require('./routes/system');
systemRoutes.initSystemRoutes(TEMP_DIR, EXPORT_DIR);
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

app.get('/api/auth', (_req, res) => {
  res.json({
    enabled: authState.enabled,
    // Only expose token when auth is enabled (so user can share it)
    token: authState.enabled ? authState.token : null,
  });
});

app.post('/api/auth/toggle', (req, res) => {
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

app.post('/api/auth/regenerate', (_req, res) => {
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
  res.json({ token: newToken });
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

// --- WebSocket ---

wss.on('connection', (ws) => {
  log.info('Client connected');
  sendInitState(ws);
  ws.on('close', () => log.info('Client disconnected'));
});

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
});

if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    log.info(`Server running on http://${HOST}:${PORT}`);

    // Start file watchers
    startWatcher(EXPORT_DIR, config);
    startReaperResultsWatcher(REAPER_RESULTS_DIR, EXPORT_DIR);

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

    process.on('SIGTERM', stopPolling);
    process.on('SIGINT', stopPolling);
  });
}

module.exports = { app, server };
