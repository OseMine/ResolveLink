/**
 * ResolveLink - DaVinci Resolve Bridge Service
 *
 * Wraps the Python resolve-bridge.py script, executing it as a child process
 * and returning parsed JSON results. Provides caching and polling support.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config.json');

const PYTHON_PATH = process.env.PYTHON_PATH || config.resolve.pythonPath || 'python';
const BRIDGE_SCRIPT = path.join(__dirname, 'resolve-bridge.py');
const SCRIPT_EXISTS = fs.existsSync(BRIDGE_SCRIPT);

// Cache for connection status (avoids hammering Python on every poll)
let connectionCache = {
  connected: false,
  lastCheck: 0,
  ttl: 3000, // 3s cache
};

/**
 * Execute the Python bridge script with a given command.
 * @param {string} command - The command to run (status, project, timeline, selection)
 * @param {string[]} args - Additional arguments
 * @param {number} timeout - Timeout in ms (default 10s)
 * @returns {Promise<object>} Parsed JSON result from the Python script
 */
function executeBridge(command, args = [], timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!SCRIPT_EXISTS) {
      return resolve({
        error: 'resolve-bridge.py not found',
        connected: false,
      });
    }

    const scriptArgs = [BRIDGE_SCRIPT, command, ...args];

    const defaultScriptingPath = process.platform === 'win32'
      ? 'C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules'
      : '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules';

    const env = {
      ...process.env,
      PYTHONPATH: process.env.RESOLVE_SCRIPTING_PATH || defaultScriptingPath,
    };

    execFile(PYTHON_PATH, scriptArgs, { timeout, maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) {
        // Timeout or execution error
        if (err.killed) {
          return resolve({ error: 'Bridge script timed out', connected: false });
        }
        // Python may still have printed output before error
        if (stdout) {
          try {
            return resolve(JSON.parse(stdout.toString()));
          } catch {
            // fall through
          }
        }
        return resolve({ error: err.message, connected: false, stderr: stderr?.toString() });
      }

      try {
        const data = JSON.parse(stdout.toString());
        resolve(data);
      } catch (parseErr) {
        resolve({ error: 'Invalid JSON from bridge script', raw: stdout.toString() });
      }
    });
  });
}

/**
 * Check if DaVinci Resolve is running and the scripting API is reachable.
 * Uses caching to avoid repeated Python invocations.
 */
async function checkConnection(force = false) {
  const now = Date.now();
  if (!force && now - connectionCache.lastCheck < connectionCache.ttl) {
    return connectionCache;
  }

  const result = await executeBridge('status', [], 5000);
  connectionCache = {
    ...result,
    lastCheck: now,
    ttl: 3000,
  };
  return connectionCache;
}

/**
 * Get current project information from Resolve.
 */
async function getProject() {
  return executeBridge('project', [], 5000);
}

/**
 * Get current timeline information including all tracks.
 */
async function getTimeline() {
  return executeBridge('timeline', [], 5000);
}

/**
 * Get selected clips from the current timeline.
 * @param {number} [track] - Optional track index to filter by
 */
async function getSelection(track) {
  const args = track ? ['--track', String(track)] : [];
  return executeBridge('selection', args, 5000);
}

/**
 * Get properties of a specific clip from the media pool.
 * @param {string} clipPath - Absolute path to the clip file
 */
async function getClipProperties(clipPath) {
  return executeBridge('clip-properties', [clipPath], 5000);
}

/**
 * Start a polling loop that checks Resolve connection status
 * and broadcasts changes via the provided callback.
 * @param {function} onStatusChange - Called with new status object
 * @param {number} intervalMs - Polling interval (default from config)
 * @returns {function} Stop function
 */
function startPolling(onStatusChange, intervalMs) {
  const interval = intervalMs || config.resolve.pollIntervalMs || 2000;
  let stopped = false;

  const poll = async () => {
    if (stopped) return;

    try {
      const status = await checkConnection();
      onStatusChange(status);
    } catch {
      onStatusChange({ connected: false, error: 'Poll failed' });
    }
  };

  // Initial check
  poll();

  const timer = setInterval(poll, interval);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = {
  executeBridge,
  checkConnection,
  getProject,
  getTimeline,
  getSelection,
  getClipProperties,
  startPolling,
};
