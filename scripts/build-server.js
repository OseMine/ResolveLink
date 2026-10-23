#!/usr/bin/env node
/**
 * Build the self-contained server bundle used by the desktop app.
 *
 * The packaged app must not depend on the repository layout or on workspace
 * symlinks, so the server (including its dependencies and @resolvelink/shared)
 * is compiled into a single CommonJS file. Electron then runs that file with
 * ELECTRON_RUN_AS_NODE.
 *
 * Output: packages/server/dist/
 *   server.cjs          bundled server
 *   config.json         default configuration (seeded into userData on first run)
 *   resolve-bridge.py   DaVinci Resolve bridge script
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'packages', 'server', 'dist');

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'packages', 'server', 'src', 'index.js')],
    outfile: path.join(OUT_DIR, 'server.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'info',
    // Optional native add-ons used by chokidar/ws when present. They stay
    // optional at runtime, so keep them out of the bundle.
    external: ['fsevents', 'bufferutil', 'utf-8-validate'],
    define: {
      'process.env.RESOLVELINK_BUNDLED_INTEGRATIONS': '"1"',
    },
  });

  if (result.errors.length > 0) {
    throw new Error('esbuild reported errors');
  }

  fs.copyFileSync(
    path.join(ROOT, 'packages', 'server', 'src', 'config.json'),
    path.join(OUT_DIR, 'config.json')
  );
  fs.copyFileSync(
    path.join(ROOT, 'server', 'resolve-bridge.py'),
    path.join(OUT_DIR, 'resolve-bridge.py')
  );

  const size = fs.statSync(path.join(OUT_DIR, 'server.cjs')).size;
  console.log(`[server] bundled server.cjs (${(size / 1024).toFixed(1)} KB)`);
  console.log(`[server] output: ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error('[server] build failed:', err);
  process.exit(1);
});
