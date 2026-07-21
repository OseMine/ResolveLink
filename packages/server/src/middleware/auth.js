/**
 * API Token Authentication Middleware
 *
 * When auth is enabled, validates Bearer token on write endpoints.
 * GET endpoints remain public (read-only).
 */
const { createLogger } = require('../logger');
const crypto = require('crypto');

const log = createLogger('Auth');

/**
 * Generate a cryptographically secure random token.
 * @param {number} bytes - Number of random bytes (default 32 = 64 hex chars)
 * @returns {string}
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Read or initialize the auth token from config.
 * If config.auth.token is empty, generates and persists a new one.
 * @param {string} configPath - Path to config.json
 * @returns {{ enabled: boolean, token: string }}
 */
function initAuth(configPath) {
  const fs = require('fs');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { enabled: false, token: '' };
  }

  if (!config.auth) config.auth = { enabled: false, token: '' };

  if (config.auth.enabled && !config.auth.token) {
    config.auth.token = generateToken();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    log.info('Generated new API auth token');
  }

  return { enabled: !!config.auth.enabled, token: config.auth.token || '' };
}

/**
 * Express middleware that enforces Bearer token auth on write requests.
 * GET/HEAD/OPTIONS requests are always allowed (read-only, safe).
 * When auth is disabled, all requests pass through.
 *
 * @param {{ enabled: boolean, token: string }} authState - Shared auth state
 * @returns {import('express').RequestHandler}
 */
function requireAuth(authState) {
  return (req, res, next) => {
    // Read-only methods are always allowed
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    // Auth disabled — pass through
    if (!authState.enabled || !authState.token) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.warn(`Auth failed: missing token — ${req.method} ${req.path} from ${req.ip}`);
      return res.status(401).json({ error: 'Authentication required. Provide Authorization: Bearer <token> header.' });
    }

    const token = authHeader.slice(7);
    // Constant-time comparison to prevent timing attacks
    const expected = Buffer.from(authState.token);
    const provided = Buffer.from(token);
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      log.warn(`Auth failed: invalid token — ${req.method} ${req.path} from ${req.ip}`);
      return res.status(403).json({ error: 'Invalid auth token.' });
    }

    next();
  };
}

module.exports = { generateToken, initAuth, requireAuth };
