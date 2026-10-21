/**
 * Single source of truth for the application version.
 * Reads the root package.json (three levels above packages/server/src).
 */
const pkg = require('../../../package.json');

module.exports = {
  name: pkg.name,
  version: pkg.version,
};
