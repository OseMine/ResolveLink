/**
 * Discord Rich Presence (RPC) integration.
 *
 * Optional: requires the `discord-rpc` package and a Discord application
 * client ID. When either is missing the module degrades to a no-op so the
 * rest of ResolveLink keeps working.
 *
 * Configure with:
 *   DISCORD_CLIENT_ID=<application id>
 *   DISCORD_RPC_ENABLED=true|false   (default: true when a client ID is set)
 *   DISCORD_LARGE_IMAGE=<asset key>  (optional)
 */
const path = require('path');
const { createLogger } = require('../logger');

const log = createLogger('DiscordRPC');

const DEFAULT_RECONNECT_MS = 60000;

let Client = null;
let client = null;
let initialized = false;
let connected = false;
let connecting = false;
let destroyed = false;
let reconnectTimer = null;
let lastError = null;

let opts = {
  enabled: false,
  clientId: '',
  largeImageKey: '',
  largeImageText: 'ResolveLink',
};

let activity = null;

function loadConfig(config = {}) {
  const discord = config.discord || {};
  const clientId = process.env.DISCORD_CLIENT_ID || discord.clientId || '';
  const envEnabled = process.env.DISCORD_RPC_ENABLED;

  opts = {
    enabled: envEnabled !== undefined
      ? envEnabled === 'true' || envEnabled === '1'
      : discord.enabled !== undefined
        ? Boolean(discord.enabled)
        : Boolean(clientId),
    clientId,
    largeImageKey: process.env.DISCORD_LARGE_IMAGE || discord.largeImageKey || '',
    largeImageText: process.env.DISCORD_LARGE_IMAGE_TEXT || discord.largeImageText || 'ResolveLink',
  };

  return opts;
}

function loadClientClass() {
  if (Client) return Client;
  try {
    // Optional dependency: keep the server bootable without it.
    // eslint-disable-next-line global-require
    const RPC = require('discord-rpc');
    if (RPC && RPC.Client) {
      Client = RPC.Client;
    }
  } catch {
    Client = null;
  }
  return Client;
}

function buildActivity(projectName, custom = {}) {
  const now = Date.now();
  const existing = activity && activity.projectName === projectName ? activity : null;

  return {
    projectName: projectName || null,
    startedAt: existing?.startedAt || now,
    details: custom.details || (projectName ? `Working on ${projectName}` : 'In ResolveLink'),
    state: custom.state || 'ResolveLink',
    largeImageKey: custom.largeImageKey || opts.largeImageKey || undefined,
    largeImageText: custom.largeImageText || opts.largeImageText || undefined,
    smallImageKey: custom.smallImageKey || undefined,
    smallImageText: custom.smallImageText || undefined,
    instance: false,
  };
}

async function pushActivity() {
  if (!client || !connected || !activity) return false;

  const payload = {
    details: activity.details,
    state: activity.state,
    startTimestamp: activity.startedAt,
    instance: false,
  };
  if (activity.largeImageKey) {
    payload.largeImageKey = activity.largeImageKey;
    payload.largeImageText = activity.largeImageText;
  }
  if (activity.smallImageKey) {
    payload.smallImageKey = activity.smallImageKey;
    payload.smallImageText = activity.smallImageText;
  }

  try {
    await client.setActivity(payload);
    return true;
  } catch (err) {
    lastError = err.message;
    log.warn(`Could not update Discord activity: ${err.message}`);
    return false;
  }
}

function scheduleReconnect() {
  if (destroyed || !opts.enabled || reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, DEFAULT_RECONNECT_MS);
  if (typeof reconnectTimer.unref === 'function') reconnectTimer.unref();
}

async function connect() {
  if (!opts.enabled || destroyed || connecting || connected) return false;

  const RPCClient = loadClientClass();
  if (!RPCClient) {
    lastError = 'discord-rpc package is not installed';
    log.info('Discord RPC unavailable (discord-rpc not installed)');
    return false;
  }
  if (!opts.clientId) {
    lastError = 'DISCORD_CLIENT_ID is not configured';
    log.info('Discord RPC disabled (no client ID configured)');
    return false;
  }

  connecting = true;
  try {
    client = new RPCClient({ transport: 'ipc' });

    client.on('ready', () => {
      connected = true;
      connecting = false;
      lastError = null;
      log.info('Discord RPC connected');
      if (activity) pushActivity();
    });

    client.on('disconnected', () => {
      connected = false;
      connecting = false;
      client = null;
      log.info('Discord RPC disconnected');
      scheduleReconnect();
    });

    client.on('error', (err) => {
      lastError = err.message;
      log.warn(`Discord RPC error: ${err.message}`);
    });

    await client.login({ clientId: opts.clientId });
    return true;
  } catch (err) {
    connecting = false;
    lastError = err.message;
    if (client) {
      try {
        client.destroy();
      } catch {}
    }
    client = null;
    log.info(`Discord RPC not connected: ${err.message}`);
    scheduleReconnect();
    return false;
  }
}

/**
 * Initialize Discord RPC. Safe to call once during server startup.
 *
 * @param {object} config Server config (expects an optional `discord` block)
 */
async function initDiscordRpc(config = {}) {
  loadConfig(config);

  if (initialized) return getStatus();
  initialized = true;
  destroyed = false;

  if (!opts.enabled) {
    log.info('Discord RPC disabled');
    return getStatus();
  }

  await connect();
  return getStatus();
}

/**
 * Set (or clear) the project shown in Discord.
 *
 * @param {string|null} projectName
 * @param {object} [custom] Optional details/state overrides
 */
async function setProject(projectName, custom = {}) {
  if (!opts.enabled) return false;

  activity = projectName || custom.details ? buildActivity(projectName, custom) : null;
  if (!activity) return false;
  return pushActivity();
}

async function clearActivity() {
  activity = null;
  if (!client || !connected) return false;

  try {
    await client.clearActivity();
    return true;
  } catch (err) {
    lastError = err.message;
    return false;
  }
}

async function setEnabled(enabled) {
  opts.enabled = Boolean(enabled);

  if (!opts.enabled) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    await clearActivity();
    if (client) {
      try {
        client.destroy();
      } catch {}
    }
    client = null;
    connected = false;
    connecting = false;
    log.info('Discord RPC disabled by user');
    return getStatus();
  }

  if (!client && !connecting) {
    await connect();
  }
  return getStatus();
}

async function reconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (client) {
    try {
      client.destroy();
    } catch {}
    client = null;
  }
  connected = false;
  connecting = false;
  return connect();
}

function getStatus() {
  return {
    enabled: opts.enabled,
    configured: Boolean(opts.clientId),
    installed: Boolean(loadClientClass()),
    connected,
    project: activity?.projectName || null,
    details: activity?.details || null,
    state: activity?.state || null,
    startedAt: activity?.startedAt || null,
    error: lastError,
  };
}

function shutdown() {
  destroyed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (client) {
    try {
      client.destroy();
    } catch {}
  }
  client = null;
  connected = false;
  connecting = false;
}

module.exports = {
  initDiscordRpc,
  setProject,
  clearActivity,
  setEnabled,
  reconnect,
  getStatus,
  shutdown,
};
