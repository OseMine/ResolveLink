/**
 * ResolveLink Shared Constants
 */

const LINK_STATUS = {
  CREATED: 'created',
  LINKED: 'linked',
  SENDING: 'sending',
  QUEUED: 'queued',
  RENDERING: 'rendering',
  RENDERED: 'rendered',
  IMPORTED: 'imported',
  ERROR: 'error',
  COMPLETED: 'completed',
  SENT: 'sent',
};

const JOB_TYPES = {
  EXECUTE_JSX: 'execute-jsx',
  EXECUTE_REAPER: 'execute-reaper',
};

const JOB_STATUS = {
  PENDING: 'pending',
  DISPATCHED: 'dispatched',
  SENT: 'sent',
  COMPLETED: 'completed',
  ERROR: 'error',
};

const DEFAULT_CONFIG = {
  PORT: 3030,
  HOST: '127.0.0.1',
  MAX_HISTORY: 100,
  EDITING_TIMEOUT_MS: 12000,
  RENDER_WATCH_MAX_WAIT: 300000,
  RENDER_WATCH_POLL_INTERVAL: 2000,
};

const EXPORT_EXTENSIONS = [
  '.mov', '.mp4', '.exr', '.png', '.tif', '.jpg',
  '.wav', '.flac', '.aiff', '.ogg', '.mp3',
];

module.exports = {
  LINK_STATUS,
  JOB_TYPES,
  JOB_STATUS,
  DEFAULT_CONFIG,
  EXPORT_EXTENSIONS,
};
