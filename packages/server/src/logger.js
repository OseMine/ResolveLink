/**
 * ResolveLink Structured Logger
 *
 * Replaces bare console.log with leveled, timestamped output.
 * Levels: debug, info, warn, error
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

const minLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(level, tag, msg, data) {
  if (LEVELS[level] < minLevel) return;
  const color = COLORS[level];
  const prefix = `${color}[${ts()}][${level.toUpperCase()}][${tag}]${COLORS.reset}`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

function createLogger(tag) {
  return {
    debug: (msg, data) => log('debug', tag, msg, data),
    info: (msg, data) => log('info', tag, msg, data),
    warn: (msg, data) => log('warn', tag, msg, data),
    error: (msg, data) => log('error', tag, msg, data),
  };
}

module.exports = { createLogger, log };
