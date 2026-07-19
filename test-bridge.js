#!/usr/bin/env node

// test-bridge.js
// Tests the bridge server API including the new Resolve scripting endpoints.

const http = require('http');

const SERVER = 'http://localhost:3030';
let passed = 0;
let failed = 0;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = `${SERVER}${path}`;
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            parsed._statusCode = res.statusCode;
          }
          resolve(parsed);
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function ok(label, data) {
  passed++;
  console.log(`  [PASS] ${label}`);
  if (data !== undefined) {
    const str = typeof data === 'object' ? JSON.stringify(data) : String(data);
    if (str.length < 200) console.log(`         ${str}`);
  }
}

function fail(label, err) {
  failed++;
  console.log(`  [FAIL] ${label}: ${err}`);
}

async function main() {
  console.log('=== ResolveLink Bridge Test ===\n');

  // --- Section 1: Server Health ---
  console.log('1. Server Health');
  try {
    const health = await request('/api/health');
    ok('health check', health);
  } catch (err) {
    fail('health check', err.message);
    console.error('\n       Server not reachable. Start it with: npm run server');
    process.exit(1);
  }

  // --- Section 2: Resolve Scripting API ---
  console.log('\n2. Resolve Scripting API');

  try {
    const status = await request('/api/resolve/status');
    if (status.connected) {
      ok('Resolve connection', status);
    } else {
      console.log(`  [SKIP] Resolve not running (${status.error || 'not detected'})`);
    }
  } catch (err) {
    console.log(`  [SKIP] Resolve status endpoint: ${err.message}`);
  }

  try {
    const project = await request('/api/resolve/project');
    if (project.error) {
      console.log(`  [SKIP] No project open (${project.error})`);
    } else {
      ok('Resolve project', project);
    }
  } catch (err) {
    console.log(`  [SKIP] Resolve project endpoint: ${err.message}`);
  }

  try {
    const timeline = await request('/api/resolve/timeline');
    if (timeline.error) {
      console.log(`  [SKIP] No timeline open (${timeline.error})`);
    } else {
      ok('Resolve timeline', { name: timeline.name, tracks: timeline.videoTrackCount, tc: timeline.currentTimecode });
    }
  } catch (err) {
    console.log(`  [SKIP] Resolve timeline endpoint: ${err.message}`);
  }

  try {
    const selection = await request('/api/resolve/selection');
    if (selection.error) {
      console.log(`  [SKIP] No selection (${selection.error})`);
    } else {
      ok('Resolve selection', { clips: selection.clipCount, fps: selection.fps });
    }
  } catch (err) {
    console.log(`  [SKIP] Resolve selection endpoint: ${err.message}`);
  }

  // --- Section 3: Link CRUD ---
  console.log('\n3. Link CRUD');

  let linkId = null;
  try {
    const result = await request('/api/link-clip', {
      method: 'POST',
      body: {
        clipData: [
          {
            name: 'Test_Clip_01',
            start: 0,
            duration: 120,
            sourcePath: 'X:\\footage\\test_clip_01.mov',
            sourceIn: 0,
            sourceOut: 120,
          },
          {
            name: 'Test_Clip_02',
            start: 120,
            duration: 96,
            sourcePath: 'X:\\footage\\test_clip_02.mov',
            sourceIn: 0,
            sourceOut: 96,
          },
        ],
        settings: {
          width: 1920,
          height: 1080,
          fps: 24,
          duration: 8,
        },
      },
    });
    linkId = result.linkId;
    ok('create link', { linkId, status: result.status });
  } catch (err) {
    fail('create link', err.message);
  }

  try {
    const links = await request('/api/links');
    ok('list links', { count: links.length });
  } catch (err) {
    fail('list links', err.message);
  }

  if (linkId) {
    try {
      const del = await request(`/api/links/${linkId}`, { method: 'DELETE' });
      ok('delete link', del);
    } catch (err) {
      fail('delete link', err.message);
    }

    try {
      await request(`/api/links/${linkId}`, { method: 'DELETE' });
      fail('delete non-existent link (should 404)', 'no error thrown');
    } catch (err) {
      // Expected to fail
    }
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
