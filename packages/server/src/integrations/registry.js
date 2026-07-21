/**
 * Integration Registry
 *
 * Discovers and manages integration modules (AE, REAPER, Fusion, etc.).
 * Each integration must implement the Integration interface.
 *
 * To add a new integration:
 * 1. Create a folder in integrations/ (e.g., integrations/fusion/)
 * 2. Create an index.js that exports an object matching the Integration interface
 * 3. The registry will auto-discover it on startup
 */

const path = require('path');
const fs = require('fs');
const { createLogger } = require('../logger');

const log = createLogger('Registry');

/** @type {Map<string, import('@resolvelink/shared').Integration>} */
const integrations = new Map();

/**
 * Register an integration module.
 * @param {import('@resolvelink/shared').Integration} integration
 */
function register(integration) {
  if (!integration.config || !integration.config.name) {
    throw new Error('Integration must have a config.name');
  }

  const name = integration.config.name;
  if (integrations.has(name)) {
    log.warn(`Integration '${name}' already registered, overwriting`);
  }

  integrations.set(name, integration);
  log.info(`Registered integration: ${integration.config.displayName} (${name})`);
}

/**
 * Initialize all registered integrations.
 * @param {import('@resolvelink/shared').Store} store
 */
async function initAll(store) {
  for (const [name, integration] of integrations) {
    try {
      await integration.init(store);
      log.info(`Initialized: ${name}`);
    } catch (err) {
      log.error(`Failed to initialize '${name}': ${err.message}`);
    }
  }
}

/**
 * Get a registered integration by name.
 * @param {string} name
 * @returns {import('@resolvelink/shared').Integration|undefined}
 */
function get(name) {
  return integrations.get(name);
}

/**
 * Get status of all registered integrations.
 * @returns {Record<string, import('@resolvelink/shared').IntegrationStatus>}
 */
function getAllStatus() {
  const status = {};
  for (const [name, integration] of integrations) {
    try {
      status[name] = integration.getStatus();
    } catch (err) {
      status[name] = { available: false, running: false, version: null, installPath: null, error: err.message };
    }
  }
  return status;
}

/**
 * Auto-discover integrations from the integrations/ directory.
 * Each subdirectory with an index.js is treated as an integration.
 */
function discoverFromDirectory(integrationsDir) {
  if (!fs.existsSync(integrationsDir)) return;

  const entries = fs.readdirSync(integrationsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue; // skip private dirs

    const integrationPath = path.join(integrationsDir, entry.name, 'index.js');
    if (!fs.existsSync(integrationPath)) continue;

    try {
      const integration = require(integrationPath);
      if (integration && integration.config) {
        register(integration);
      }
    } catch (err) {
      log.error(`Failed to load integration '${entry.name}': ${err.message}`);
    }
  }
}

module.exports = {
  register,
  initAll,
  get,
  getAllStatus,
  discoverFromDirectory,
};
