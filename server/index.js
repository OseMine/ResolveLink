require('dotenv').config();
const express = require('express');
const cors = require('cors');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
const http = require('http');
const config = require('./config.json');
const resolveBridge = require('./resolve-service');
const reaperService = require('./reaper-service');
const { createLogger } = require('./logger');
const { perfMiddleware, getPerfStats, getSlowEndpoints } = require('./perf');

const log = createLogger('Server');
const logRW = createLogger('RenderWatch');
const logAuto = createLogger('Auto');
const logWatch = createLogger('Watcher');
const logWS = createLogger('WS');
const logResolve = createLogger('Resolve');
const logReaper = createLogger('REAPER');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(perfMiddleware);

// Serve built React frontend
const DIST_DIR = path.join(__dirname, '..', 'src', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

const PORT = process.env.PORT || config.server.port;
const HOST = process.env.HOST || '127.0.0.1';
const EXPORT_DIR = path.resolve(process.env.EXPORT_DIR || config.paths.vfxExportDir);
const TEMP_DIR = path.resolve(process.env.TEMP_DIR || config.paths.tempDir);

// Ensure directories exist
[EXPORT_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// File-based IPC directories for REAPER (no HTTP needed from Lua)
const REAPER_JOBS_DIR = path.join(EXPORT_DIR, 'reaper-jobs');
const REAPER_RESULTS_DIR = path.join(EXPORT_DIR, 'reaper-results');
[REAPER_JOBS_DIR, REAPER_RESULTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// In-memory link registry
const activeLinks = new Map();

// Job queue for CEP extension to poll
const jobQueue = new Map();

// Job history (capped at 100 entries)
const jobHistory = [];
const MAX_HISTORY = 100;

// Active editing sessions — tracks which links are being edited in AE
// { linkId: { compName, lastHeartbeat, clientIp } }
const editingSessions = new Map();
const EDITING_TIMEOUT_MS = 12000; // 12s without heartbeat = not editing

function addJobHistory(entry) {
  jobHistory.unshift({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  if (jobHistory.length > MAX_HISTORY) jobHistory.length = MAX_HISTORY;
  broadcast('job:history', jobHistory.slice(0, 20));
}

// Broadcast to all connected Resolve UI clients
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(message);
  });
}

// --- Job Queue API (for CEP extension) ---

// Get next pending job for CEP extension
app.get('/api/jobs/pending', (_req, res) => {
  for (const [jobId, job] of jobQueue) {
    if (job.status === 'pending') {
      job.status = 'dispatched';
      job.dispatchedAt = new Date().toISOString();
      return res.json({ jobId, ...job });
    }
  }
  res.json({ jobId: null });
});

// Update job status (called by CEP extension)
app.put('/api/jobs/:jobId/status', (req, res) => {
  const { jobId } = req.params;
  const { status, result, error } = req.body;

  const job = jobQueue.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (result) job.result = result;
  if (error) job.error = error;

  // If job is done, update the associated link
  if (job.linkId) {
    const link = activeLinks.get(job.linkId);
    if (link) {
      if (status === 'completed') {
        link.status = 'rendering';
        // Start watching for render output
        startRenderWatch(link, job.result);
      } else if (status === 'error') {
        link.status = 'error';
        link.error = error;
      }
      broadcast('link:updated', link);
    }
  }

  res.json({ success: true });
});

// Start watching for render output
function startRenderWatch(link, renderInfo) {
  const compName = renderInfo?.compName || `Resolve_Link_${link.id.slice(0, 8)}`;
  const expectedFile = path.join(EXPORT_DIR, `${compName}.mov`);
  const maxWait = 300000; // 5 minutes
  const pollInterval = 2000;
  let elapsed = 0;

  logRW.info(`Waiting for: ${expectedFile}`);

  const poll = setInterval(async () => {
    elapsed += pollInterval;

    if (fs.existsSync(expectedFile)) {
      clearInterval(poll);
      logRW.info(`Render detected: ${expectedFile}`);

      link.status = 'rendered';
      link.exportPath = expectedFile;
      broadcast('link:updated', link);

      // Auto-import to Resolve
      try {
        const result = await resolveBridge.executeBridge('create-compound', [expectedFile]);
        if (result.error) {
          logRW.error(`Import failed: ${result.error}`);
          link.status = 'error';
          addJobHistory({ type: 'import', linkId: link.id, status: 'error', file: expectedFile, error: result.error });
        } else {
          logRW.info('Import success', result);
          link.status = 'imported';
          addJobHistory({ type: 'import', linkId: link.id, status: 'success', file: expectedFile, details: result });
        }
      } catch (e) {
        logRW.error(`Import error: ${e.message}`);
        link.status = 'error';
        addJobHistory({ type: 'import', linkId: link.id, status: 'error', file: expectedFile, error: e.message });
      }

      broadcast('link:updated', link);
    }

    if (elapsed >= maxWait) {
      clearInterval(poll);
      logRW.warn(`Timeout waiting for render: ${expectedFile}`);
      link.status = 'error';
      broadcast('link:updated', link);
    }
  }, pollInterval);
}

// --- REST API ---

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', links: activeLinks.size });
});

// Job history
app.get('/api/history', (_req, res) => {
  res.json(jobHistory.slice(0, 50));
});

// Get server config (export path, etc.)
app.get('/api/config', (_req, res) => {
  res.json({
    exportDir: EXPORT_DIR,
    tempDir: TEMP_DIR,
    serverPort: PORT,
  });
});

// --- Setup Wizard API ---

function detectPythonPath() {
  const { execSync } = require('child_process');
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py -3', 'py -3.14', 'py -3.12', 'py -3.11', 'py -3.10']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const out = execSync(`${cmd} --version`, { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      const match = out.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1]);
        const minor = parseInt(match[2]);
        if (major >= 3 && minor >= 10) {
          const which = execSync(process.platform === 'win32' ? `where ${cmd.split(' ')[0]}` : `which ${cmd}`, { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim().split('\n')[0];
          if (which && fs.existsSync(which)) {
            return { path: which, version: `${major}.${minor}` };
          }
        }
      }
    } catch {}
  }
  return null;
}

function detectAEPath() {
  const platform = process.platform;
  const configPaths = config.paths.aeInstallPath[platform];
  if (configPaths && fs.existsSync(configPaths)) return configPaths;

  if (platform === 'win32') {
    const adobeDir = 'C:\\Program Files\\Adobe';
    try {
      const dirs = fs.readdirSync(adobeDir).filter(d => d.startsWith('Adobe After Effects'));
      if (dirs.length > 0) {
        const latest = dirs.sort().pop();
        const fullPath = path.join(adobeDir, latest, 'Support Files');
        if (fs.existsSync(fullPath)) return fullPath;
      }
    } catch {}
  } else if (platform === 'darwin') {
    try {
      const apps = fs.readdirSync('/Applications').filter(d => d.startsWith('Adobe After Effects'));
      if (apps.length > 0) {
        const latest = apps.sort().pop();
        if (fs.existsSync(`/Applications/${latest}`)) return `/Applications/${latest}`;
      }
    } catch {}
  }
  return null;
}

// GET /api/setup — detect paths and return current config
app.get('/api/setup', (_req, res) => {
  const envPath = path.join(__dirname, '..', '.env');
  const hasEnv = fs.existsSync(envPath);

  const python = detectPythonPath();
  const aePath = detectAEPath();
  const reaperStatus = reaperService.getStatus();

  res.json({
    hasEnv,
    detected: {
      pythonPath: python?.path || null,
      pythonVersion: python?.version || null,
      aePath: aePath || null,
      reaperPath: reaperStatus.installPath || null,
      reaperVersion: reaperStatus.version || null,
      reaperInstalled: reaperStatus.installed,
      platform: process.platform,
    },
    config: {
      port: PORT,
      host: HOST,
      exportDir: EXPORT_DIR,
      tempDir: TEMP_DIR,
      pythonPath: process.env.PYTHON_PATH || '',
      aePath: process.env.AE_PATH_WIN || process.env.AE_PATH_MAC || '',
      scriptingPath: process.env.RESOLVE_SCRIPTING_PATH || '',
      reaperPath: process.env.REAPER_PATH_WIN || process.env.REAPER_PATH_MAC || '',
    },
  });
});

// POST /api/setup — write .env file
app.post('/api/setup', (req, res) => {
  const { pythonPath, aePath, reaperPath, exportDir, tempDir, port, host, scriptingPath } = req.body;

  const lines = [
    '# ResolveLink Configuration',
    `PORT=${port || 3030}`,
    `HOST=${host || '127.0.0.1'}`,
    `EXPORT_DIR=${exportDir || './exports'}`,
    `TEMP_DIR=${tempDir || './temp'}`,
    '',
  ];

  if (pythonPath) lines.push(`PYTHON_PATH=${pythonPath}`);
  if (aePath) {
    if (process.platform === 'win32') {
      lines.push(`AE_PATH_WIN=${aePath}`);
    } else {
      lines.push(`AE_PATH_MAC=${aePath}`);
    }
  }
  if (scriptingPath) lines.push(`RESOLVE_SCRIPTING_PATH=${scriptingPath}`);
  if (reaperPath) {
    if (process.platform === 'win32') {
      lines.push(`REAPER_PATH_WIN=${reaperPath}`);
    } else {
      lines.push(`REAPER_PATH_MAC=${reaperPath}`);
    }
  }
  lines.push('');

  const envPath = path.join(__dirname, '..', '.env');
  try {
    fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
    res.json({ success: true, message: 'Configuration saved. Restart the server to apply.' });
  } catch (err) {
    res.status(500).json({ error: `Failed to write .env: ${err.message}` });
  }
});

// --- Render Progress ---

app.get('/api/render-progress/:id', (req, res) => {
  const { id } = req.params;
  const link = activeLinks.get(id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  if (link.exportPath && fs.existsSync(link.exportPath)) {
    const stat = fs.statSync(link.exportPath);
    return res.json({ status: 'done', percent: 100, bytes: stat.size });
  }

  const compName = `Resolve_Link_${id.slice(0, 8)}`;

  res.json({ status: link.status || 'pending', percent: link.status === 'rendering' ? 50 : 0 });
});

// --- Render Presets ---

const PRESETS_PATH = path.join(__dirname, '..', 'render-presets.json');

function loadPresets() {
  try { return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8')); }
  catch { return { presets: [] }; }
}

function savePresets(data) {
  fs.writeFileSync(PRESETS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

app.get('/api/presets', (_req, res) => {
  res.json(loadPresets());
});

app.post('/api/presets', (req, res) => {
  const { name, template, outputModule, settings } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const data = loadPresets();
  const existing = data.presets.findIndex(p => p.name === name);
  const preset = { name, template: template || 'Best Settings', outputModule: outputModule || '', settings: settings || {}, updatedAt: new Date().toISOString() };

  if (existing >= 0) {
    data.presets[existing] = preset;
  } else {
    data.presets.push(preset);
  }
  savePresets(data);
  res.json({ success: true, preset });
});

app.delete('/api/presets/:name', (req, res) => {
  const data = loadPresets();
  data.presets = data.presets.filter(p => p.name !== req.params.name);
  savePresets(data);
  res.json({ success: true });
});

// --- Batch Export ---

app.post('/api/batch-export', async (req, res) => {
  const { timelineNames } = req.body;
  if (!timelineNames || !Array.isArray(timelineNames) || timelineNames.length === 0) {
    return res.status(400).json({ error: 'timelineNames array is required' });
  }

  const results = [];
  for (const name of timelineNames) {
    try {
      const result = await resolveBridge.executeBridge('timeline-at', [name], 10000);
      if (result.error) {
        results.push({ name, status: 'error', error: result.error });
        continue;
      }

      const clipData = [];
      for (const [track, clips] of Object.entries(result.tracks || {})) {
        for (const clip of clips) {
          clipData.push({ ...clip, trackIndex: parseInt(track.replace('video_', '')) });
        }
      }

      if (clipData.length === 0) {
        results.push({ name, status: 'error', error: 'No clips found' });
        continue;
      }

      const linkId = uuidv4();
      const link = {
        id: linkId, clips: clipData.map(c => ({ ...c, linkId, status: 'pending' })),
        settings: { width: result.resolution?.width || 1920, height: result.resolution?.height || 1080, fps: parseFloat(result.frameRate) || 24, duration: 10 },
        createdAt: new Date().toISOString(), status: 'created', exportPath: null, timelineName: name,
      };
      activeLinks.set(linkId, link);

      const jsxPayload = generateJSXPayload(link);
      const payloadPath = path.join(TEMP_DIR, `${linkId}.json`);
      fs.writeFileSync(payloadPath, JSON.stringify(jsxPayload, null, 2));
      const jsxScript = generateExtendScript(link);
      const jsxPath = path.join(TEMP_DIR, `${linkId}.jsx`);
      fs.writeFileSync(jsxPath, jsxScript);
      link.jsxPath = jsxPath;
      link.payloadPath = payloadPath;

      broadcast('link:created', link);
      addJobHistory({ type: 'create', linkId, status: 'created', clipCount: clipData.length });
      results.push({ name, status: 'created', linkId, clipCount: clipData.length });
    } catch (err) {
      results.push({ name, status: 'error', error: err.message });
    }
  }

  res.json({ results, total: results.length, created: results.filter(r => r.status === 'created').length });
});

// --- Update Check ---

const httpsModule = require('https');

app.get('/api/update-check', (_req, res) => {
  const options = {
    hostname: 'api.github.com',
    path: '/repos/OseMine/ResolveLink/releases/latest',
    headers: { 'User-Agent': 'ResolveLink' },
  };

  const req2 = httpsModule.get(options, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latestVersion = release.tag_name?.replace(/^v/, '') || null;
        const currentVersion = require('../package.json').version;
        res.json({
          currentVersion,
          latestVersion,
          updateAvailable: latestVersion && latestVersion !== currentVersion,
          downloadUrl: release.html_url || null,
          releaseNotes: release.body || '',
        });
      } catch {
        res.json({ currentVersion: require('../package.json').version, updateAvailable: false, error: 'Failed to parse release info' });
      }
    });
  });

  req2.on('error', () => {
    res.json({ currentVersion: require('../package.json').version, updateAvailable: false, error: 'Could not reach GitHub' });
  });
  req2.setTimeout(5000, () => { req2.destroy(); res.json({ currentVersion: require('../package.json').version, updateAvailable: false, error: 'Timeout' }); });
});

// --- Performance Profiling ---

app.get('/api/perf', getPerfStats);
app.get('/api/perf/slow', getSlowEndpoints);

// --- Clear Temp/Export ---

app.post('/api/clear', (req, res) => {
  const { target } = req.body;
  const dir = target === 'exports' ? EXPORT_DIR : target === 'temp' ? TEMP_DIR : null;
  if (!dir) return res.status(400).json({ error: 'target must be "exports" or "temp"' });

  let removed = 0;
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = fs.statSync(itemPath);
      if (stat.isFile()) {
        fs.unlinkSync(itemPath);
        removed++;
      } else if (stat.isDirectory()) {
        fs.rmSync(itemPath, { recursive: true, force: true });
        removed++;
      }
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Resolve Scripting API Endpoints ---

// Check if DaVinci Resolve is running and reachable
app.get('/api/resolve/status', async (_req, res) => {
  try {
    const status = await resolveBridge.checkConnection(true);
    res.json(status);
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// Get timeline markers
app.get('/api/resolve/markers', async (_req, res) => {
  try {
    const result = await resolveBridge.executeBridge('markers', [], 10000);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message, markers: [] });
  }
});

// Get current Resolve project info
app.get('/api/resolve/project', async (_req, res) => {
  try {
    const result = await resolveBridge.getProject();
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Get current timeline info (all tracks, clips)
app.get('/api/resolve/timeline', async (_req, res) => {
  try {
    const result = await resolveBridge.getTimeline();
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Get selected clips from Resolve timeline
// Query param: ?track=1 (optional, filters by track index)
app.get('/api/resolve/selection', async (req, res) => {
  try {
    const track = req.query.track ? parseInt(req.query.track, 10) : undefined;
    const result = await resolveBridge.getSelection(track);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Get properties of a specific clip from the media pool
// Body: { clipPath: "X:\\path\\to\\clip.mov" }
app.post('/api/resolve/clip-properties', async (req, res) => {
  try {
    const { clipPath } = req.body;
    if (!clipPath) {
      return res.status(400).json({ error: 'clipPath is required' });
    }
    const result = await resolveBridge.getClipProperties(clipPath);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// --- End Resolve API Endpoints ---

// Get all active links
app.get('/api/links', (_req, res) => {
  res.json(Array.from(activeLinks.values()));
});

// Get a single link by ID
app.get('/api/links/:id', (req, res) => {
  const link = activeLinks.get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  res.json(link);
});

// Create a new link: Resolve sends clip data, we generate AE project
app.post('/api/link-clip', (req, res) => {
  const { clipData, settings } = req.body;

  if (!clipData || !Array.isArray(clipData) || clipData.length === 0) {
    return res.status(400).json({ error: 'clipData array is required' });
  }

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
      renderQueue: settings?.renderQueue || 'Best Settings',
    },
    createdAt: new Date().toISOString(),
    status: 'created',
    exportPath: null,
  };

  activeLinks.set(linkId, link);

  // Generate ExtendScript JSON payload
  const jsxPayload = generateJSXPayload(link);
  const payloadPath = path.join(TEMP_DIR, `${linkId}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(jsxPayload, null, 2));

  // Generate the actual .jsx script
  const jsxScript = generateExtendScript(link);
  const jsxPath = path.join(TEMP_DIR, `${linkId}.jsx`);
  fs.writeFileSync(jsxPath, jsxScript);

  link.jsxPath = jsxPath;
  link.payloadPath = payloadPath;

  broadcast('link:created', link);
  addJobHistory({ type: 'create', linkId: link.id, status: 'created', clipCount: link.clips.length });

  res.json({ linkId, status: 'created', jsxPath, payloadPath });
});

// Update link status (called by AE watcher or manual trigger)
app.put('/api/links/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, exportPath } = req.body;

  const link = activeLinks.get(id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  link.status = status;
  if (exportPath) link.exportPath = exportPath;
  link.updatedAt = new Date().toISOString();

  broadcast('link:updated', link);
  res.json(link);
});

// Delete a link
app.delete('/api/links/:id', (req, res) => {
  const { id } = req.params;
  if (!activeLinks.has(id)) {
    return res.status(404).json({ error: 'Link not found' });
  }
  activeLinks.delete(id);
  editingSessions.delete(id);
  broadcast('link:deleted', { id });
  res.json({ deleted: true });
});

// --- Editing Status Sync ---
// CEP extension sends heartbeat every 5s when a comp is active
app.post('/api/links/:id/editing', (req, res) => {
  const { id } = req.params;
  const { compName, status } = req.body; // status: "editing" | "idle"

  if (status === 'idle') {
    editingSessions.delete(id);
    broadcast('link:editing', { id, editing: false });
    return res.json({ ok: true });
  }

  editingSessions.set(id, {
    compName: compName || null,
    lastHeartbeat: Date.now(),
    clientIp: req.ip,
  });

  broadcast('link:editing', { id, editing: true, compName: compName || null });
  res.json({ ok: true });
});

// Get editing status for a link
app.get('/api/links/:id/editing', (req, res) => {
  const { id } = req.params;
  const session = editingSessions.get(id);
  if (!session) return res.json({ editing: false });

  const alive = Date.now() - session.lastHeartbeat < EDITING_TIMEOUT_MS;
  if (!alive) {
    editingSessions.delete(id);
    return res.json({ editing: false });
  }
  res.json({ editing: true, compName: session.compName });
});

// Get all editing sessions
app.get('/api/editing', (_req, res) => {
  const now = Date.now();
  const active = {};
  for (const [id, session] of editingSessions) {
    if (now - session.lastHeartbeat < EDITING_TIMEOUT_MS) {
      active[id] = { compName: session.compName, lastHeartbeat: session.lastHeartbeat };
    }
  }
  res.json(active);
});

// Trigger aerender for a specific link
app.post('/api/links/:id/render', (req, res) => {
  const { id } = req.params;
  const link = activeLinks.get(id);

  if (!link) return res.status(404).json({ error: 'Link not found' });

  const { execSync } = require('child_process');
  const aerenderPath = getAERenderPath();

  if (!aerenderPath) {
    return res.status(500).json({ error: 'After Effects not found' });
  }

  link.status = 'rendering';
  broadcast('link:updated', link);

  try {
    const compName = `Resolve_Link_${id.slice(0, 8)}`;
    execSync(
      `"${aerenderPath}" -project "${link.jsxPath}" -comp "${compName}" -output "${EXPORT_DIR}"`,
      { timeout: 300000 }
    );
    link.status = 'rendered';
    broadcast('link:updated', link);
    res.json({ status: 'rendered' });
  } catch (err) {
    link.status = 'error';
    broadcast('link:updated', link);
    res.status(500).json({ error: err.message });
  }
});

// Auto-workflow: queue job for CEP extension, or launch AE with -r if not running
app.post('/api/links/:id/auto', async (req, res) => {
  const { id } = req.params;
  const link = activeLinks.get(id);

  if (!link) return res.status(404).json({ error: 'Link not found' });

  link.status = 'sending';
  broadcast('link:updated', link);

  if (!link.jsxPath || !fs.existsSync(link.jsxPath)) {
    link.status = 'error';
    broadcast('link:updated', link);
    return res.status(500).json({ error: 'JSX file not found' });
  }

  // Check if AE is already running (CEP extension can pick up jobs)
  const isAERunning = await checkIfAERunning();

  if (isAERunning) {
    // Queue job for CEP extension to pick up (send path, not content)
    const jobId = uuidv4();
    const job = {
      type: 'execute-jsx',
      linkId: id,
      jsxPath: link.jsxPath,
      compName: `Resolve_Link_${id.slice(0, 8)}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    jobQueue.set(jobId, job);
    logAuto.info(`AE running, job queued: ${jobId} for link: ${id}`);

    res.json({
      status: 'queued',
      jobId: jobId,
      message: 'Job queued. CEP extension will pick it up automatically.',
    });
  } else {
    // AE not running - launch with -r flag (will execute on startup)
    const aePath = getAEExePath();
    if (!aePath) {
      link.status = 'error';
      broadcast('link:updated', link);
      return res.status(500).json({ error: 'After Effects not found' });
    }

    logAuto.info(`AE not running, launching: "${aePath}" -r "${link.jsxPath}"`);

    const { spawn } = require('child_process');
    try {
      const child = spawn(aePath, ['-r', link.jsxPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });

      child.on('error', (err) => {
        logAuto.error(`Failed to launch AE: ${err.message}`);
        link.status = 'error';
        broadcast('link:updated', link);
      });

      child.on('exit', (code) => {
        logAuto.info(`AE process exited with code ${code}`);
      });

      child.unref();
    } catch (err) {
      logAuto.error(`Spawn error: ${err.message}`);
      link.status = 'error';
      broadcast('link:updated', link);
      return res.status(500).json({ error: err.message });
    }

    link.status = 'sending';
    broadcast('link:updated', link);

    res.json({
      status: 'sending',
      message: 'AE launched with script. It will execute on startup.',
    });
  }
});

// Helper: check if AE is running
function checkIfAERunning() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32'
      ? 'tasklist /FI "IMAGENAME eq AfterFX.exe" /NH'
      : 'pgrep -x "After Effects"';
    exec(cmd, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(process.platform === 'win32'
        ? stdout.includes('AfterFX.exe')
        : stdout.trim().length > 0);
    });
  });
}

// Generate a render script for a link (user runs this in AE)
app.get('/api/links/:id/render-script', (req, res) => {
  const { id } = req.params;
  const link = activeLinks.get(id);

  if (!link) return res.status(404).json({ error: 'Link not found' });

  const renderScript = generateRenderScript(link);
  const scriptPath = path.join(TEMP_DIR, `render_${id}.jsx`);
  fs.writeFileSync(scriptPath, renderScript);

  res.json({ scriptPath, message: 'Run this script in After Effects: File > Scripts > Run Script File' });
});

// Import rendered file back into Resolve — render & replace workflow
app.post('/api/import-back', async (req, res) => {
  const { renderedPath } = req.body;

  if (!renderedPath) return res.status(400).json({ error: 'renderedPath is required' });

  try {
    const result = await resolveBridge.executeBridge('create-compound', [renderedPath]);
    if (result.error) {
      return res.status(500).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate a render script for the active comp (called by CEP extension)
app.post('/api/render-active-comp', (req, res) => {
  const exportDirNorm = EXPORT_DIR.replace(/\\/g, '/');

  const renderScript = `// ResolveLink Active Comp Render
(function() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return "ERROR: No active comp";
    }

    if (app.project.file) {
        app.project.save(app.project.file);
    }

    var rq = app.project.renderQueue;
    while (rq.numItems > 0) {
        rq.item(1).remove();
    }

    var renderItem = rq.items.add(comp);
    var om = renderItem.outputModule(1);
    try { om.applyTemplate("Best Settings"); } catch(e) {}

    var safeName = comp.name.replace(/[\\\\/:*?"<>|]/g, "_");
    var p = "${exportDirNorm}/" + safeName + ".mov";
    om.file = new File(p);
    rq.render();
    return "OK:" + p;
})();`;

  const scriptPath = path.join(TEMP_DIR, `render_active_${Date.now()}.jsx`);
  fs.writeFileSync(scriptPath, renderScript);
  res.json({ scriptPath });
});

// --- REAPER Endpoints ---

// Check REAPER status
app.get('/api/reaper/status', (_req, res) => {
  res.json(reaperService.getStatus());
});

// Create a REAPER link: Resolve sends audio clip data, we generate REAPER import script
app.post('/api/reaper/link-clip', (req, res) => {
  const { clipData, settings, timelineMode } = req.body;

  if (!clipData || !Array.isArray(clipData) || clipData.length === 0) {
    return res.status(400).json({ error: 'clipData array is required' });
  }

  const linkId = uuidv4();

  const link = {
    id: linkId,
    target: 'reaper',
    timelineMode: !!timelineMode,
    clips: clipData.map((clip) => ({
      ...clip,
      linkId,
      status: 'pending',
    })),
    settings: {
      fps: settings?.fps || 24,
      sampleRate: settings?.sampleRate || 48000,
      duration: settings?.duration || 10,
    },
    createdAt: new Date().toISOString(),
    status: 'created',
    exportPath: null,
  };

  activeLinks.set(linkId, link);

  // Generate REAPER payload (JSON)
  const reaperPayload = generateReaperPayload(link);
  const payloadPath = path.join(TEMP_DIR, `${linkId}_reaper.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(reaperPayload, null, 2));

  // Generate REAPER import Lua script
  const reaperScript = generateReaperImportScript(link);
  const scriptPath = path.join(TEMP_DIR, `${linkId}_reaper.lua`);
  fs.writeFileSync(scriptPath, reaperScript);

  // Generate REAPER render Lua script
  const renderScript = generateReaperRenderScript(link);
  const renderPath = path.join(TEMP_DIR, `render_${linkId}_reaper.lua`);
  fs.writeFileSync(renderPath, renderScript);

  link.reaperScriptPath = scriptPath;
  link.renderScriptPath = renderPath;
  link.payloadPath = payloadPath;

  broadcast('link:created', link);
  addJobHistory({ type: 'reaper-create', linkId: link.id, status: 'created', clipCount: link.clips.length, target: 'reaper' });

  logReaper.info(`REAPER link created: ${linkId} (${link.clips.length} clips)`);

  res.json({ linkId, status: 'created', scriptPath, payloadPath, renderPath });
});

// REAPER auto-workflow: run import script directly via -script CLI flag
app.post('/api/links/:id/reaper-auto', async (req, res) => {
  const { id } = req.params;
  const link = activeLinks.get(id);

  if (!link) return res.status(404).json({ error: 'Link not found' });

  link.status = 'sending';
  broadcast('link:updated', link);

  if (!link.reaperScriptPath || !fs.existsSync(link.reaperScriptPath)) {
    link.status = 'error';
    broadcast('link:updated', link);
    return res.status(500).json({ error: 'REAPER import script not found' });
  }

  const installPath = reaperService.detectReaperPath();
  if (!installPath) {
    link.status = 'error';
    broadcast('link:updated', link);
    return res.status(500).json({ error: 'REAPER not found on this system' });
  }

  // If REAPER is already running, run script in existing instance (-nonewinst -script)
  // Otherwise, launch REAPER with the script (-new -script)
  const running = reaperService.isReaperRunning();

  if (running) {
    logReaper.info(`REAPER running, sending script to existing instance: ${link.reaperScriptPath}`);
    const ok = reaperService.runScriptInExisting(link.reaperScriptPath, {
      reaperPath: installPath,
      noactivate: true,
    });
    if (!ok) {
      link.status = 'error';
      broadcast('link:updated', link);
      return res.status(500).json({ error: 'Failed to send script to REAPER' });
    }
  } else {
    logReaper.info(`REAPER not running, launching with script: ${link.reaperScriptPath}`);
    const ok = reaperService.launchWithScript(link.reaperScriptPath, {
      reaperPath: installPath,
      newProject: true,
      nosplash: true,
      noactivate: true,
    });
    if (!ok) {
      link.status = 'error';
      broadcast('link:updated', link);
      return res.status(500).json({ error: 'Failed to launch REAPER' });
    }
  }

  // Queue job for status tracking
  const jobId = uuidv4();
  const job = {
    type: 'execute-reaper',
    linkId: id,
    reaperScriptPath: link.reaperScriptPath,
    payloadPath: link.payloadPath,
    status: 'sent',
    createdAt: new Date().toISOString(),
  };
  jobQueue.set(jobId, job);

  // Write job file for file-based IPC (Lua reads this without HTTP)
  try {
    const jobFile = path.join(REAPER_JOBS_DIR, `${jobId}.json`);
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
    logReaper.info(`Job file written: ${jobFile}`);
  } catch (e) {
    logReaper.warn(`Failed to write job file: ${e.message}`);
  }

  link.status = 'sent';
  broadcast('link:updated', link);

  res.json({
    status: 'sent',
    jobId,
    method: running ? 'nonewinst-script' : 'new-script',
    message: running
      ? 'Script sent to running REAPER via -nonewinst -script.'
      : 'REAPER launched with import script via -new -script.',
  });
});

// Generate REAPER render script for a link
app.get('/api/links/:id/reaper-render-script', (req, res) => {
  const { id } = req.params;
  const link = activeLinks.get(id);

  if (!link) return res.status(404).json({ error: 'Link not found' });

  const renderScript = generateReaperRenderScript(link);
  const scriptPath = path.join(TEMP_DIR, `render_${id}_reaper.lua`);
  fs.writeFileSync(scriptPath, renderScript);

  res.json({ scriptPath, message: 'Run this script inside REAPER: Actions > Show action list > Load' });
});

// --- ExtendScript Generator ---

function generateJSXPayload(link) {
  const fps = link.settings.fps || 24;

  // Find first clip start to offset the comp (comp starts at first clip, not Resolve frame 0)
  const firstClipStart = link.clips.reduce((min, clip) => {
    const s = clip.start || 0;
    return s < min ? s : min;
  }, Infinity);

  const maxEnd = link.clips.reduce((max, clip) => {
    const end = (clip.start || 0) + (clip.duration || 0);
    return end > max ? end : max;
  }, 0);

  return {
    linkId: link.id,
    compName: `Resolve_Link_${link.id.slice(0, 8)}`,
    width: link.settings.width,
    height: link.settings.height,
    fps: fps,
    duration: (maxEnd - firstClipStart) / fps,
    clips: link.clips.map((clip) => ({
      name: clip.name,
      filePath: (clip.sourcePath || '').replace(/\\/g, '/'),
      compStartFrames: (clip.start || 0) - firstClipStart,
      durationFrames: clip.duration || 0,
      sourceIn: clip.sourceIn || 0,
    })),
  };
}

function generateExtendScript(link) {
  const payload = generateJSXPayload(link);
  const clipsJSON = JSON.stringify(payload.clips);
  const exportPath = path.join(EXPORT_DIR, payload.compName).replace(/\\/g, '\\\\');

  return `// ResolveLink Auto-Generated ExtendScript
// Link ID: ${link.id}
// Generated: ${new Date().toISOString()}

(function() {
    var linkData = {
        compName: "${payload.compName}",
        width: ${payload.width},
        height: ${payload.height},
        fps: ${payload.fps},
        duration: ${payload.duration},
        clips: ${clipsJSON}
    };

    var fps = linkData.fps;

    // --- Create comp ---
    var comp = app.project.items.addComp(
        linkData.compName,
        linkData.width,
        linkData.height,
        1.0,
        linkData.duration,
        fps
    );

    for (var i = 0; i < linkData.clips.length; i++) {
        var clip = linkData.clips[i];

        try {
            var file = new File(clip.filePath);
            if (!file.exists) {
                alert("ResolveLink: File not found: " + clip.filePath);
                continue;
            }

            var importOptions = new ImportOptions(file);
            var footage = app.project.importFile(importOptions);
            var layer = comp.layers.add(footage);

            layer.name = clip.name;

            var compStartSec = clip.compStartFrames / fps;
            var durationSec = clip.durationFrames / fps;
            var sourceInSec = clip.sourceIn / fps;

            layer.startTime = compStartSec - sourceInSec;
            layer.inPoint = compStartSec;
            layer.outPoint = compStartSec + durationSec;

        } catch (e) {
            alert("ResolveLink: Failed to import " + clip.filePath + "\\n" + e.toString());
        }
    }

    comp.openInViewer();
})();
`;
}

// --- Render Script Generator ---

function generateRenderScript(link) {
  const payload = generateJSXPayload(link);
  const exportDir = EXPORT_DIR.replace(/\\/g, '\\\\');
  const exportPath = path.join(EXPORT_DIR, payload.compName).replace(/\\/g, '\\\\');

  return `// ResolveLink Render Script
// Link ID: ${link.id}
// Generated: ${new Date().toISOString()}

(function() {
    var compName = "${payload.compName}";
    var exportDir = "${exportDir}";
    var exportPath = "${exportPath}";

    // Find the comp
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof CompItem && item.name === compName) {
            comp = item;
            break;
        }
    }

    if (!comp) {
        alert("ResolveLink: Comp not found: " + compName);
        return;
    }

    // Save the project first
    if (app.project.file) {
        app.project.save(app.project.file);
    }

    // Ensure export directory exists
    var exportFolder = new Folder(exportDir);
    if (!exportFolder.exists) {
        exportFolder.create();
    }

    // Clear existing render queue items
    var rq = app.project.renderQueue;
    while (rq.numItems > 0) {
        rq.item(1).remove();
    }

    // Add comp to render queue
    var renderItem = rq.items.add(comp);

    // Set output module
    var om = renderItem.outputModule(1);

    // Try to apply a good template, fall back to defaults
    try {
        om.applyTemplate("Best Settings");
    } catch(e) {}

    // Set output path
    om.file = new File(exportPath + ".mov");

    // Render (no undo group around render to avoid mismatch warning)
    rq.render();

    alert("ResolveLink: Render complete!\\n" + exportPath + ".mov");
})();
`;
}

// --- REAPER Script Generators ---

function generateReaperPayload(link) {
  const fps = link.settings.fps || 24;
  const sampleRate = link.settings.sampleRate || 48000;

  // In timeline mode, positions are already absolute — don't re-zero
  const firstClipStart = link.timelineMode ? 0 : link.clips.reduce((min, clip) => {
    const s = clip.start || 0;
    return s < min ? s : min;
  }, Infinity);

  const maxEnd = link.clips.reduce((max, clip) => {
    const end = (clip.start || 0) + (clip.duration || 0);
    return end > max ? end : max;
  }, 0);

  const totalDurationSec = (maxEnd - firstClipStart) / fps;

  // Group clips by track
  const trackMap = new Map();
  for (const clip of link.clips) {
    const trackIdx = clip.trackIndex || 1;
    if (!trackMap.has(trackIdx)) {
      trackMap.set(trackIdx, {
        trackIndex: trackIdx,
        name: clip.trackName || `Track ${trackIdx}`,
        items: [],
      });
    }
    trackMap.get(trackIdx).items.push({
      name: clip.name,
      filePath: (clip.sourcePath || '').replace(/\\/g, '/'),
      positionSeconds: ((clip.start || 0) - firstClipStart) / fps,
      durationSeconds: (clip.duration || 0) / fps,
      sourceOffsetSeconds: (clip.sourceIn || 0) / fps,
      volume: clip.volume != null ? clip.volume : 1.0,
      muted: clip.muted || false,
    });
  }

  return {
    linkId: link.id,
    projectName: `ResolveLink_Audio_${link.id.slice(0, 8)}`,
    sampleRate,
    fps,
    totalDuration: totalDurationSec,
    tracks: Array.from(trackMap.values()),
  };
}

function generateReaperImportScript(link) {
  const payload = generateReaperPayload(link);
  const payloadJSON = JSON.stringify(payload);
  const payloadPath = path.join(TEMP_DIR, `${link.id}_reaper.json`).replace(/\\/g, '/');

  return `-- ResolveLink REAPER Import Script
-- Link ID: ${link.id}
-- Generated: ${new Date().toISOString()}
--
-- Usage: Run this script inside REAPER (Actions > Show action list > Load)
-- It reads the payload from: ${payloadPath}

local json_path = "${payloadPath}"

-- Read JSON file
local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*a")
    f:close()
    return content
end

-- Minimal JSON decoder (handles nested objects and arrays)
local function json_decode(str)
    local pos = 1
    local function skip_ws()
        pos = str:find("[^ \\t\\n\\r]", pos) or (#str + 1)
    end
    local function peek() skip_ws(); return str:sub(pos, pos) end
    local function advance() pos = pos + 1 end
    local parse_val

    local function parse_string()
        pos = pos + 1
        local start = pos
        while pos <= #str do
            local c = str:sub(pos, pos)
            if c == '\\\\' then pos = pos + 2
            elseif c == '"' then
                local s = str:sub(start, pos - 1)
                pos = pos + 1
                return s
            else pos = pos + 1
            end
        end
        return str:sub(start)
    end

    local function parse_number()
        local start = pos
        if str:sub(pos, pos) == '-' then pos = pos + 1 end
        while pos <= #str and str:sub(pos, pos):match("[%d%.eE%+%-]") do pos = pos + 1 end
        return tonumber(str:sub(start, pos - 1))
    end

    local function parse_array()
        pos = pos + 1
        local arr = {}
        skip_ws()
        if peek() == ']' then pos = pos + 1; return arr end
        while true do
            arr[#arr + 1] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == ']' then advance(); return arr
            else break end
        end
        return arr
    end

    local function parse_object()
        pos = pos + 1
        local obj = {}
        skip_ws()
        if peek() == '}' then pos = pos + 1; return obj end
        while true do
            skip_ws()
            local key = parse_string()
            skip_ws()
            advance() -- ':'
            obj[key] = parse_val()
            skip_ws()
            if peek() == ',' then advance()
            elseif peek() == '}' then advance(); return obj
            else break end
        end
        return obj
    end

    parse_val = function()
        skip_ws()
        local c = peek()
        if c == '"' then return parse_string()
        elseif c == '{' then return parse_object()
        elseif c == '[' then return parse_array()
        elseif c == 't' then pos = pos + 4; return true
        elseif c == 'f' then pos = pos + 5; return false
        elseif c == 'n' then pos = pos + 4; return nil
        else return parse_number()
        end
    end

    return parse_val()
end

-- Main import logic
local json_str = readFile(json_path)
if not json_str then
    reaper.ShowMessageBox("Could not read payload:\\n" .. json_path, "ResolveLink", 0)
    return
end

local data = json_decode(json_str)
if not data then
    reaper.ShowMessageBox("Invalid JSON payload", "ResolveLink", 0)
    return
end

-- Create new project
reaper.Main_OnCommand(40023, 0) -- File: New project

if data.sampleRate then
    reaper.SetCurrentBPM(0, data.sampleRate, false)
end

for _, trackData in ipairs(data.tracks) do
    local trackIdx = trackData.trackIndex - 1
    local track = reaper.GetTrack(0, trackIdx)

    if not track then
        local trackCount = reaper.CountTracks(0)
        while trackCount < trackData.trackIndex do
            reaper.InsertTrackAtIndex(trackCount, true)
            trackCount = reaper.CountTracks(0)
        end
        track = reaper.GetTrack(0, trackIdx)
    end

    if track then
        reaper.GetSetMediaTrackInfo_String(track, "P_NAME", trackData.name, true)

        for _, item in ipairs(trackData.items) do
            if item.filePath and item.filePath ~= "" then
                reaper.SetOnlyTrackSelected(track)
                reaper.SetEditCurPos(item.positionSeconds, false, false)
                reaper.InsertMedia(item.filePath, 0)

                local itemCount = reaper.CountTrackMediaItems(track)
                local newItem = reaper.GetTrackMediaItem(track, itemCount - 1)
                if newItem then
                    reaper.SetMediaItemInfo_Value(newItem, "D_POSITION", item.positionSeconds)
                    reaper.SetMediaItemInfo_Value(newItem, "D_LENGTH", item.durationSeconds)

                    local take = reaper.GetActiveTake(newItem)
                    if take then
                        if item.sourceOffsetSeconds then
                            reaper.SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", item.sourceOffsetSeconds)
                        end
                        if item.volume then
                            reaper.SetMediaItemTakeInfo_Value(take, "D_VOL", item.volume)
                        end
                    end

                    if item.muted then
                        reaper.SetMediaItemInfo_Value(newItem, "B_MUTE", 1)
                    end

                    reaper.UpdateItemInProject(newItem)
                end
            end
        end
    end
end

reaper.Main_OnCommand(40295, 0) -- View: Zoom to selected items
reaper.UpdateArrange()

reaper.ShowMessageBox("ResolveLink: Imported " .. #data.tracks .. " track(s) from Resolve", "ResolveLink", 0)
`;
}

function generateReaperRenderScript(link) {
  const payload = generateReaperPayload(link);
  const compName = `ResolveLink_Audio_${link.id.slice(0, 8)}`;
  const exportDir = EXPORT_DIR.replace(/\\/g, '/');
  const exportPath = path.join(exportDir, compName).replace(/\\/g, '/');

  return `-- ResolveLink REAPER Render Script
-- Link ID: ${link.id}
-- Generated: ${new Date().toISOString()}

local export_dir = "${exportDir}"
local export_path = "${exportPath}"
local comp_name = "${compName}"

-- Ensure export directory exists
reaper.RecursiveCreateDirectory(export_dir, 0)

-- Render master mix
reaper.Main_OnCommand(40015, 0) -- File: Render to file

-- Set render dialog fields
reaper.GetSetProjectInfo(0, "RENDER_PATTERN", export_path, true)
reaper.GetSetProjectInfo(0, "RENDER_SRATE", "48000", true)

reaper.ShowMessageBox("ResolveLink: Render configured.\\nCheck the Render dialog and click Render.\\nOutput: " .. export_path .. ".wav", "ResolveLink", 0)
`;
}

// --- AE Path Detection ---

function getAERenderPath() {
  const platform = process.platform;
  let aePath = config.paths.aeInstallPath[platform];

  if (!aePath || !fs.existsSync(aePath)) {
    aePath = detectAEPath();
  }

  if (!aePath || !fs.existsSync(aePath)) return null;

  if (platform === 'win32') {
    return path.join(aePath, 'aerender.exe');
  }
  return path.join(aePath, 'aerender');
}

function getAEExePath() {
  const platform = process.platform;
  let aePath = config.paths.aeInstallPath[platform];

  if (!aePath || !fs.existsSync(aePath)) {
    aePath = detectAEPath();
  }

  if (!aePath || !fs.existsSync(aePath)) return null;

  if (platform === 'win32') {
    const exePath = path.join(aePath, 'AfterFX.exe');
    return fs.existsSync(exePath) ? exePath : null;
  }
  return path.join(aePath, 'AfterFX');
}

// --- File Watcher ---

let watcherDebounce = null;

function startWatcher() {
  if (!config.watcher.enabled) return;

  const watchDirs = [EXPORT_DIR];

  // Extra watch folders from env (comma-separated)
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

  logWatch.info(`Monitoring ${watchDirs.length} director${watchDirs.length > 1 ? 'ies' : 'y'}: ${watchDirs.join(', ')}`);

  watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!config.watcher.extensions.includes(ext)) return;

    clearTimeout(watcherDebounce);
    watcherDebounce = setTimeout(async () => {
      logWatch.info(`New VFX asset detected: ${filePath}`);

      // Try to match to an active link by filename convention
      const fileName = path.basename(filePath, ext);
      let matchedLink = null;

      for (const [, link] of activeLinks) {
        if (fileName.includes(link.id.slice(0, 8)) || fileName.includes('Resolve_Link')) {
          matchedLink = link;
          break;
        }
      }

      if (matchedLink) {
        matchedLink.status = 'rendered';
        matchedLink.exportPath = filePath;
        matchedLink.updatedAt = new Date().toISOString();
        broadcast('link:rendered', matchedLink);
        logWatch.info(`Matched to link: ${matchedLink.id}`);

        // Auto-import to Resolve
        try {
          logWatch.info(`Auto-importing to Resolve: ${filePath}`);
          const result = await resolveBridge.executeBridge('create-compound', [filePath]);
          if (result.error) {
            logWatch.error(`Auto-import failed: ${result.error}`);
            matchedLink.status = 'error';
          } else {
            logWatch.info('Auto-import success', result);
            matchedLink.status = 'imported';
          }
        } catch (e) {
          logWatch.error(`Auto-import error: ${e.message}`);
          matchedLink.status = 'error';
        }
        matchedLink.updatedAt = new Date().toISOString();
        broadcast('link:updated', matchedLink);
      } else {
        broadcast('file:new', { path: filePath, name: path.basename(filePath) });
      }
    }, config.watcher.debounceMs);
  });

  watcher.on('error', (err) => {
    logWatch.error('Error:', err);
  });

  logWatch.info(`Monitoring: ${EXPORT_DIR}`);
  return watcher;
}

// --- REAPER Results Watcher (file-based IPC) ---
// Watches for result files written by the Lua GUI script.
// When Lua finishes a job, it writes a .json result file here.

function startReaperResultsWatcher() {
  const watcher = chokidar.watch(REAPER_RESULTS_DIR, {
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
        const job = jobQueue.get(jobId);
        if (job) {
          job.status = 'completed';
          logReaper.info(`REAPER job completed via file IPC: ${jobId}`);

          const link = activeLinks.get(job.linkId);
          if (link) {
            link.status = 'completed';
            broadcast('link:updated', link);
          }
        }
      } else if (result.status === 'error') {
        logReaper.error(`REAPER job failed: ${jobId} - ${result.error}`);
      }

      // Clean up result file
      fs.unlinkSync(filePath);
    } catch (e) {
      logReaper.warn(`Failed to process REAPER result: ${e.message}`);
    }
  });

  logReaper.info(`Watching for REAPER results in: ${REAPER_RESULTS_DIR}`);
  return watcher;
}

// --- Catch-all: serve React app for any non-API route ---
app.get('*', (_req, res) => {
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built. Run: cd src && npm run build' });
  }
});

// --- WebSocket ---

wss.on('connection', (ws) => {
  logWS.info('Client connected');
  ws.send(JSON.stringify({ type: 'init', payload: { links: Array.from(activeLinks.values()) } }));

  ws.on('close', () => {
    logWS.info('Client disconnected');
  });
});

// --- Start ---

let lastResolveStatus = null;

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err);
});

server.listen(PORT, HOST, () => {
  log.info(`Server running on http://${HOST}:${PORT}`);
  startWatcher();
  startReaperResultsWatcher();

  // Start polling DaVinci Resolve connection status
  const stopPolling = resolveBridge.startPolling((status) => {
    const changed = !lastResolveStatus || status.connected !== lastResolveStatus.connected;
    lastResolveStatus = status;

    if (changed) {
      logResolve.info(`${status.connected ? 'Connected' : 'Disconnected'} ${status.version || ''}`);
      broadcast('resolve:status', status);
    }
  });

  // Clean shutdown
  process.on('SIGTERM', stopPolling);
  process.on('SIGINT', stopPolling);
});

module.exports = { app, server };
