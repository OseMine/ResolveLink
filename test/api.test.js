import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { server } from '../server/index.js';

let BASE;

beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  BASE = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function del(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${path}`, { method: 'DELETE' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Health', () => {
  it('GET /api/health returns ok', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe('ok');
    expect(typeof res.links).toBe('number');
  });
});

describe('Config', () => {
  it('GET /api/config returns export dir and port', async () => {
    const res = await get('/api/config');
    expect(res.exportDir).toBeDefined();
    expect(res.serverPort).toBeDefined();
  });
});

describe('Setup', () => {
  it('GET /api/setup returns detection info', async () => {
    const res = await get('/api/setup');
    expect(res.hasEnv).toBeDefined();
    expect(res.detected).toBeDefined();
    expect(res.config).toBeDefined();
  });
});

describe('Links lifecycle', () => {
  let linkId;

  it('POST /api/link-clip creates a link', async () => {
    const res = await post('/api/link-clip', {
      clipData: [{
        name: 'test_clip.mp4',
        start: 0,
        duration: 100,
        sourcePath: '/tmp/test.mp4',
        sourceIn: 0,
        sourceOut: 100,
        trackIndex: 1,
      }],
      settings: { width: 1920, height: 1080, fps: 24 },
    });
    expect(res.linkId).toBeDefined();
    expect(res.status).toBe('created');
    linkId = res.linkId;
  });

  it('GET /api/links includes the new link', async () => {
    const res = await get('/api/links');
    expect(Array.isArray(res)).toBe(true);
    expect(res.find((l) => l.id === linkId)).toBeDefined();
  });

  it('GET /api/links/:id returns the link', async () => {
    const res = await get(`/api/links/${linkId}`);
    expect(res.id).toBe(linkId);
    expect(res.clips).toBeDefined();
  });

  it('DELETE /api/links/:id removes the link', async () => {
    const res = await del(`/api/links/${linkId}`);
    expect(res.deleted).toBe(true);

    const links = await get('/api/links');
    expect(links.find((l) => l.id === linkId)).toBeUndefined();
  });
});

describe('Resolve status (may be offline)', () => {
  it('GET /api/resolve/status returns connected field', async () => {
    const res = await get('/api/resolve/status');
    expect(typeof res.connected).toBe('boolean');
  });
});
