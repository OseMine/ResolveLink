/**
 * File system helpers.
 *
 * Atomic writes prevent readers (REAPER's Lua polling, the CEP panel, etc.)
 * from ever seeing a half-written JSON file.
 */
const fs = require('fs');
const path = require('path');

/**
 * Write a file atomically: write to a temp sibling first, then rename.
 * @param {string} filePath Destination path
 * @param {string|Buffer} contents File contents
 */
function writeFileAtomic(filePath, contents) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    fs.writeFileSync(tmpPath, contents, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best effort cleanup
    }
    throw err;
  }
}

module.exports = { writeFileAtomic };
