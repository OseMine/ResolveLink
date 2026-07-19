// server/perf.js — Request performance tracking middleware
// Records timing stats for all API endpoints, exposes via /api/perf

const { createLogger } = require('./logger');
const log = createLogger('Perf');

// Store last 100 timings per endpoint
const MAX_SAMPLES = 100;
const stats = {};  // { "GET /api/links": { times: [...], count: 0, totalMs: 0 } }

function getEndpointKey(req) {
  // Normalize route: replace UUIDs and numbers with :id
  let route = req.route?.path || req.path;
  route = route.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
  route = route.replace(/\/\d+/g, '/:num');
  return `${req.method} ${route}`;
}

function recordTiming(key, ms) {
  if (!stats[key]) {
    stats[key] = { times: [], count: 0, totalMs: 0, slowCount: 0, maxMs: 0 };
  }
  const s = stats[key];
  s.times.push(ms);
  if (s.times.length > MAX_SAMPLES) s.times.shift();
  s.count++;
  s.totalMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
  if (ms > 500) s.slowCount++;

  // Warn on slow requests
  if (ms > 1000) {
    log.warn(`Slow request: ${key} took ${Math.round(ms)}ms`);
  }
}

// Express middleware
function perfMiddleware(req, res, next) {
  // Skip non-API and static file requests
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    const key = getEndpointKey(req);
    recordTiming(key, ms);
  });

  next();
}

// GET /api/perf — return performance stats
function getPerfStats(_req, res) {
  const result = {};
  for (const [key, s] of Object.entries(stats)) {
    const avg = s.count > 0 ? s.totalMs / s.count : 0;
    const sorted = [...s.times].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    result[key] = {
      count: s.count,
      avgMs: Math.round(avg * 10) / 10,
      p50Ms: Math.round(p50 * 10) / 10,
      p95Ms: Math.round(p95 * 10) / 10,
      p99Ms: Math.round(p99 * 10) / 10,
      maxMs: Math.round(s.maxMs * 10) / 10,
      slowCount: s.slowCount,
    };
  }

  res.json({
    uptime: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    endpoints: result,
  });
}

// GET /api/perf/slow — return slowest endpoints
function getSlowEndpoints(_req, res) {
  const sorted = Object.entries(stats)
    .map(([key, s]) => ({
      endpoint: key,
      avgMs: s.count > 0 ? Math.round(s.totalMs / s.count * 10) / 10 : 0,
      maxMs: Math.round(s.maxMs * 10) / 10,
      slowCount: s.slowCount,
      count: s.count,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 10);

  res.json({ slowest: sorted });
}

module.exports = { perfMiddleware, getPerfStats, getSlowEndpoints };
