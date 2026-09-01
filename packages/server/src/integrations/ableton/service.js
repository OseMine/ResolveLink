/**
 * Ableton Live Service
 *
 * Handles Ableton detection, OSC communication, and process management.
 * Uses Node's dgram module for UDP-based OSC messaging.
 * Falls back to process detection when OSC is unavailable.
 */
const dgram = require('dgram');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../../config.json');
const { createLogger } = require('../../logger');

const log = createLogger('Ableton');

const OSC_QUERY_PORT = config.ableton?.oscQueryPort || 9000;
const OSC_RESPONSE_PORT = config.ableton?.oscResponsePort || 9001;
const OSC_HOST = '127.0.0.1';
const OSC_TIMEOUT_MS = 2000;

// --- OSC Encoding ---

/**
 * Encode a string as a null-terminated, 4-byte-padded OSC string.
 * @param {string} str
 * @returns {Buffer}
 */
function encodeOSCString(str) {
  const nullTerminated = str + '\0';
  const padded = Math.ceil(nullTerminated.length / 4) * 4;
  const buf = Buffer.alloc(padded, 0);
  buf.write(str, 0, 'ascii');
  return buf;
}

/**
 * Encode an OSC type tag string (e.g. ",si").
 * @param {string} tags
 * @returns {Buffer}
 */
function encodeOSCTypeTags(tags) {
  return encodeOSCString(',' + tags);
}

/**
 * Encode a 32-bit big-endian integer for OSC.
 * @param {number} n
 * @returns {Buffer}
 */
function encodeOSCInt(n) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(n, 0);
  return buf;
}

/**
 * Encode a 32-bit big-endian float for OSC.
 * @param {number} n
 * @returns {Buffer}
 */
function encodeOSCFloat(n) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(n, 0);
  return buf;
}

/**
 * Build a raw OSC message buffer.
 * @param {string} address - OSC address (e.g. '/live/version')
 * @param {Array<{ type: 'i'|'f'|'s', value: number|string }>} args
 * @returns {Buffer}
 */
function buildOSCMessage(address, args = []) {
  const addrBuf = encodeOSCString(address);
  const typeTags = args.map(a => a.type).join('');
  const typeTagBuf = encodeOSCTypeTags(typeTags);

  const argBufs = args.map(arg => {
    if (arg.type === 'i') return encodeOSCInt(arg.value);
    if (arg.type === 'f') return encodeOSCFloat(arg.value);
    if (arg.type === 's') return encodeOSCString(String(arg.value));
    return Buffer.alloc(0);
  });

  return Buffer.concat([addrBuf, typeTagBuf, ...argBufs]);
}

/**
 * Parse the OSC address string from a raw response buffer.
 * @param {Buffer} buf
 * @returns {string}
 */
function parseOSCAddress(buf) {
  const end = buf.indexOf(0);
  return end >= 0 ? buf.slice(0, end).toString('ascii') : buf.toString('ascii');
}

// --- OSC Communication ---

/**
 * Send a single OSC message and optionally wait for a response.
 * @param {string} address - OSC address pattern
 * @param {Array<{ type: 'i'|'f'|'s', value: number|string }>} args
 * @param {{ waitResponse?: boolean, responsePort?: number, timeoutMs?: number }} opts
 * @returns {Promise<Buffer|null>} - Raw response buffer, or null if no response expected/timeout
 */
function sendOSC(address, args = [], opts = {}) {
  return new Promise((resolve) => {
    const msg = buildOSCMessage(address, args);
    const client = dgram.createSocket('udp4');
    const timeout = opts.timeoutMs || OSC_TIMEOUT_MS;

    let responseSocket = null;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      try { client.close(); } catch {}
      if (responseSocket) try { responseSocket.close(); } catch {}
    };

    if (opts.waitResponse) {
      const responsePort = opts.responsePort || OSC_RESPONSE_PORT;
      responseSocket = dgram.createSocket('udp4');

      responseSocket.on('error', () => { cleanup(); resolve(null); });

      responseSocket.on('message', (data) => {
        cleanup();
        resolve(data);
      });

      responseSocket.bind(responsePort, OSC_HOST, () => {
        timer = setTimeout(() => { cleanup(); resolve(null); }, timeout);
        client.send(msg, 0, msg.length, OSC_QUERY_PORT, OSC_HOST, (err) => {
          if (err) { cleanup(); resolve(null); }
        });
      });
    } else {
      client.send(msg, 0, msg.length, OSC_QUERY_PORT, OSC_HOST, (err) => {
        client.close();
        resolve(err ? null : Buffer.alloc(0));
      });
    }
  });
}

/**
 * Listen on the OSC response port for a single message.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<Buffer|null>}
 */
function listenOSC(port, timeoutMs = OSC_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      try { sock.close(); } catch {}
    };

    sock.on('error', () => { cleanup(); resolve(null); });

    sock.on('message', (data) => { cleanup(); resolve(data); });

    sock.bind(port, OSC_HOST, () => {
      timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    });
  });
}

/**
 * Ping Ableton via OSC /live/version. Returns true if a response is received.
 * @returns {Promise<boolean>}
 */
async function checkAbletonRunning() {
  try {
    const response = await sendOSC('/live/version', [], { waitResponse: true, timeoutMs: OSC_TIMEOUT_MS });
    if (response && response.length > 0) {
      const addr = parseOSCAddress(response);
      return addr.includes('/live/version') || response.length > 4;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Send an OSC sequence to create a track with audio clips at their timeline positions.
 * Uses AbletonOSC convention: /live/song/create_audio_track, /live/track/set_name,
 * /live/clip_slot/create_clip, /live/clip/set_file.
 *
 * @param {string} trackName
 * @param {Array<{ name: string, start: number, duration: number, sourcePath: string, volume: number, muted: boolean }>} clips
 * @returns {Promise<boolean>}
 */
async function createTrack(trackName, clips) {
  try {
    await sendOSC('/live/song/create_audio_track', [{ type: 'i', value: -1 }]);

    await new Promise(r => setTimeout(r, 100));

    await sendOSC('/live/track/set_name', [
      { type: 'i', value: -1 },
      { type: 's', value: trackName },
    ]);

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];

      await sendOSC('/live/clip_slot/create_clip', [
        { type: 'i', value: -1 },
        { type: 'i', value: i },
        { type: 'f', value: clip.duration },
      ]);

      await new Promise(r => setTimeout(r, 50));

      const safeSourcePath = clip.sourcePath.replace(/\\/g, '/');
      await sendOSC('/live/clip/set_file', [
        { type: 'i', value: -1 },
        { type: 'i', value: i },
        { type: 's', value: safeSourcePath },
      ]);

      if (clip.start > 0) {
        await sendOSC('/live/clip/set_start_marker', [
          { type: 'i', value: -1 },
          { type: 'i', value: i },
          { type: 'f', value: clip.start },
        ]);
      }

      if (clip.volume != null && clip.volume !== 1.0) {
        await sendOSC('/live/track/set_mixer_device/volume', [
          { type: 'i', value: -1 },
          { type: 'f', value: Math.min(Math.max(clip.volume, 0), 2.0) },
        ]);
      }

      if (clip.muted) {
        await sendOSC('/live/track/set_mute', [
          { type: 'i', value: -1 },
          { type: 'i', value: 1 },
        ]);
      }
    }

    return true;
  } catch (err) {
    log.error(`createTrack OSC error: ${err.message}`);
    return false;
  }
}

/**
 * Trigger Ableton arrangement export via OSC.
 * Sends /live/song/export_audio with the target output path.
 * @param {string} outputPath
 * @returns {Promise<boolean>}
 */
async function triggerRender(outputPath) {
  try {
    const safePath = outputPath.replace(/\\/g, '/');
    await sendOSC('/live/song/export_audio', [{ type: 's', value: safePath }]);
    log.info(`Triggered Ableton render to: ${outputPath}`);
    return true;
  } catch (err) {
    log.error(`triggerRender OSC error: ${err.message}`);
    return false;
  }
}

// --- Path Detection ---

/**
 * Detect Ableton Live installation path.
 * Checks .env overrides, config, and standard install locations.
 * @returns {string|null}
 */
function detectAbletonPath() {
  const platform = process.platform;

  const envPath = platform === 'win32'
    ? process.env.ABLETON_PATH_WIN
    : process.env.ABLETON_PATH_MAC;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const cfgPath = config.ableton?.installPath?.[platform];
  if (cfgPath && fs.existsSync(cfgPath)) return cfgPath;

  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Ableton\\Live 12 Suite\\Program',
      'C:\\Program Files\\Ableton\\Live 11 Suite\\Program',
      'C:\\Program Files\\Ableton\\Live 12 Standard\\Program',
      'C:\\Program Files\\Ableton\\Live 11 Standard\\Program',
      'C:\\Program Files\\Ableton\\Live 12 Intro\\Program',
    ];
    for (const p of candidates) {
      if (fs.existsSync(path.join(p, 'Ableton Live.exe'))) return p;
    }

    try {
      const abletonBase = 'C:\\Program Files\\Ableton';
      if (fs.existsSync(abletonBase)) {
        const dirs = fs.readdirSync(abletonBase)
          .filter(d => d.startsWith('Live'))
          .sort()
          .reverse();
        for (const d of dirs) {
          const prog = path.join(abletonBase, d, 'Program');
          if (fs.existsSync(path.join(prog, 'Ableton Live.exe'))) return prog;
        }
      }
    } catch {}
  } else if (platform === 'darwin') {
    const candidates = [
      '/Applications/Ableton Live 12 Suite.app/Contents/MacOS',
      '/Applications/Ableton Live 11 Suite.app/Contents/MacOS',
      '/Applications/Ableton Live 12 Standard.app/Contents/MacOS',
      '/Applications/Ableton Live 11 Standard.app/Contents/MacOS',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    try {
      const apps = fs.readdirSync('/Applications')
        .filter(d => d.startsWith('Ableton Live'))
        .sort()
        .reverse();
      for (const d of apps) {
        const p = `/Applications/${d}/Contents/MacOS`;
        if (fs.existsSync(p)) return p;
      }
    } catch {}
  }

  return null;
}

/**
 * Get the full path to the Ableton Live executable.
 * @returns {string|null}
 */
function getAbletonExePath() {
  const installPath = detectAbletonPath();
  if (!installPath) return null;

  if (process.platform === 'win32') {
    const exe = path.join(installPath, 'Ableton Live.exe');
    return fs.existsSync(exe) ? exe : null;
  }

  const macExe = path.join(installPath, 'Live');
  return fs.existsSync(macExe) ? macExe : null;
}

/**
 * Check if Ableton Live is currently running via process list.
 * @returns {boolean}
 */
function isAbletonRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq Ableton Live.exe" /NH 2>NUL', {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString();
      return out.toLowerCase().includes('ableton live.exe');
    } else {
      const out = execSync('pgrep -i "ableton live" 2>/dev/null || true', {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString().trim();
      return out.length > 0;
    }
  } catch {
    return false;
  }
}

/**
 * Launch Ableton Live, optionally with a set file.
 * @param {string|null} alsPath - Optional .als project path
 * @returns {boolean}
 */
function launchAbleton(alsPath = null) {
  const exePath = getAbletonExePath();
  if (!exePath) {
    log.error('Ableton Live not found');
    return false;
  }

  const args = alsPath ? [alsPath] : [];
  log.info(`Launching Ableton: "${exePath}" ${args.join(' ')}`);

  try {
    const child = spawn(exePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  } catch (err) {
    log.error(`Failed to launch Ableton: ${err.message}`);
    return false;
  }
}

/**
 * Get the MIDI Remote Scripts directory for user-installed scripts.
 * @returns {string}
 */
function getMIDIScriptsDir() {
  const platform = process.platform;
  const home = process.env.USERPROFILE || process.env.HOME || '';

  if (platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      'Ableton', 'Live 12.0.0', 'Preferences', 'User Remote Scripts'
    );
  } else if (platform === 'darwin') {
    return path.join(
      home, 'Library', 'Preferences', 'Ableton', 'Live 12.0.0', 'User Remote Scripts'
    );
  }
  return path.join(home, '.ableton', 'User Remote Scripts');
}

/**
 * Get the full status object for the Ableton integration.
 * @returns {{ available: boolean, running: boolean, version: string|null, installPath: string|null }}
 */
function getStatus() {
  const installPath = detectAbletonPath();
  const running = isAbletonRunning();

  return {
    available: !!installPath,
    running,
    version: null,
    installPath: installPath || null,
  };
}

module.exports = {
  sendOSC,
  listenOSC,
  buildOSCMessage,
  checkAbletonRunning,
  createTrack,
  triggerRender,
  detectAbletonPath,
  getAbletonExePath,
  isAbletonRunning,
  launchAbleton,
  getMIDIScriptsDir,
  getStatus,
};
