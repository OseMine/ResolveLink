/**
 * ResolveLink API Client
 *
 * REST + WebSocket client for communicating with the ResolveLink server.
 * Types are imported from @resolvelink/shared for consistency.
 */
import type {
  ResolveStatus,
  ResolveProject,
  ResolveTimeline,
  ResolveTimelineClip,
  ResolveSelection,
  ResolveClipData,
  ClipData,
  Link,
  LinkClip,
  ReaperStatus,
  ReaperLink,
  SetupConfig,
  JobHistoryEntry,
  RenderPreset,
  TimelineMarker,
  PerfStats,
} from '@resolvelink/shared';

// Re-export all types for backward compatibility
export type {
  ResolveStatus,
  ResolveProject,
  ResolveTimeline,
  ResolveTimelineClip,
  ResolveSelection,
  ResolveClipData,
  ClipData,
  Link,
  LinkClip,
  ReaperStatus,
  ReaperLink,
  SetupConfig,
  JobHistoryEntry,
  RenderPreset,
  TimelineMarker,
  PerfStats,
};

export interface ServerFile {
  path: string;
  name: string;
}

export interface DiagnosticsCheck {
  path: string;
  exists: boolean;
  writable?: boolean;
}

export interface Diagnostics {
  app: {
    name: string;
    version: string;
    platform: string;
    arch: string;
    node: string;
    uptimeSeconds: number;
    port: number;
    host: string;
    authEnabled: boolean;
  };
  config: {
    envPath: string;
    hasEnv: boolean;
    pythonPath: string;
    aePath: string;
    reaperPath: string;
    scriptingPath: string;
  };
  paths: {
    exportDir: DiagnosticsCheck;
    tempDir: DiagnosticsCheck;
    resolveBridge: { path: string; exists: boolean };
  };
  python: {
    command: string;
    found: boolean;
    version: string | null;
    supported: boolean;
    error: string | null;
  };
  integrations: Record<string, {
    available: boolean;
    running: boolean;
    version: string | null;
    installPath: string | null;
    error?: string;
  }>;
}

const API_BASE = (typeof window !== 'undefined' && (window as any).electronAPI?.getServerOrigin)
  ? (window as any).electronAPI.getServerOrigin() + '/api'
  : '/api';
const WS_BASE = (() => {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:3030';

  if ((window as any).electronAPI?.getServerOrigin) {
    return (window as any).electronAPI.getServerOrigin().replace(/^http/, 'ws');
  }

  // Packaged fallback: the page may be opened from file://.
  if (window.location.protocol === 'file:') return 'ws://127.0.0.1:3030';

  const port = window.location.port;
  // The Vite dev server (5173) proxies /api but not the WebSocket upgrade,
  // so connect to the bridge server directly in development.
  const wsPort = !port || port === '5173' ? '3030' : port;
  return `ws://${window.location.hostname}:${wsPort}`;
})();

// Auth token — fetched from server on startup when auth is enabled
let authToken: string | null = null;

export async function fetchAuthToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/auth`);
    const data = await res.json();
    authToken = data.enabled ? data.token : null;
    return authToken;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers,
      ...options,
    });
  } catch {
    throw new Error(
      'Cannot reach the ResolveLink bridge. Make sure ResolveLink is running, then try again.'
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    let message = err.error || res.statusText || 'Request failed';

    if (res.status === 401 || res.status === 403) {
      message = 'Access denied. Enable the correct API token in Settings.';
    } else if (Array.isArray(err.details) && err.details.length > 0) {
      message = `${message}: ${err.details[0].message || err.details[0].path}`;
    }

    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Health
  health: () => request<{ status: string; links: number; version: string }>('/health'),

  // Diagnostics (plain-language environment check)
  getDiagnostics: () => request<Diagnostics>('/diagnostics'),

  // Setup
  getSetup: () => request<SetupConfig>('/setup'),
  saveSetup: (data: Record<string, string | number>) =>
    request<{ success: boolean; message: string }>('/setup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // History
  getHistory: () => request<JobHistoryEntry[]>('/history'),

  // Render presets
  getPresets: () => request<{ presets: RenderPreset[] }>('/presets'),
  savePreset: (preset: RenderPreset) =>
    request<{ success: boolean; preset: RenderPreset }>('/presets', {
      method: 'POST', body: JSON.stringify(preset),
    }),
  deletePreset: (name: string) =>
    request<{ success: boolean }>(`/presets/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Render progress
  getRenderProgress: (id: string) => request<{ status: string; percent: number; bytes?: number }>(`/render-progress/${id}`),

  // Batch export
  batchExport: (timelineNames: string[]) =>
    request<{ results: any[]; total: number; created: number }>('/batch-export', {
      method: 'POST', body: JSON.stringify({ timelineNames }),
    }),

  // Markers
  getMarkers: () => request<{ timeline: string; fps: number; markers: TimelineMarker[]; count: number }>('/resolve/markers'),

  // Update check
  checkUpdate: () => request<{ currentVersion: string; latestVersion: string | null; updateAvailable: boolean; downloadUrl?: string }>('/update-check'),

  // Clear
  clear: (target: 'exports' | 'temp') =>
    request<{ success: boolean; removed: number }>('/clear', {
      method: 'POST', body: JSON.stringify({ target }),
    }),

  // Performance
  getPerf: () => request<{ uptime: number; memoryMB: number; endpoints: Record<string, PerfStats> }>('/perf'),
  getSlowEndpoints: () => request<{ slowest: Array<{ endpoint: string; avgMs: number; maxMs: number; slowCount: number; count: number }> }>('/perf/slow'),

  // Editing status
  getEditing: () => request<Record<string, { compName: string; lastHeartbeat: number }>>('/editing'),
  reportEditing: (linkId: string, compName: string | null, status: 'editing' | 'idle') =>
    request<{ ok: boolean }>(`/links/${linkId}/editing`, {
      method: 'POST', body: JSON.stringify({ compName, status }),
    }),

  // Links
  getLinks: () => request<Link[]>('/links'),
  linkClip: (
    clipData: ClipData[],
    settings?: Partial<Link['settings']>,
    presetName?: string,
    markers?: TimelineMarker[]
  ) =>
    request<{ linkId: string; status: string; jsxPath: string; payloadPath: string }>(
      '/link-clip',
      { method: 'POST', body: JSON.stringify({ clipData, settings, presetName, markers }) }
    ),
  updateLinkStatus: (id: string, status: string, exportPath?: string) =>
    request<Link>(`/links/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, exportPath }),
    }),
  deleteLink: (id: string) =>
    request<{ deleted: boolean }>(`/links/${id}`, { method: 'DELETE' }),
  triggerRender: (id: string) =>
    request<{ status: string }>(`/links/${id}/render`, { method: 'POST' }),
  autoWorkflow: (id: string) =>
    request<{ status: string; message: string }>(`/links/${id}/auto`, { method: 'POST' }),

  // REAPER
  reaperStatus: () => request<ReaperStatus>('/reaper/status'),
  reaperLinkClip: (clipData: ClipData[], settings?: { fps?: number; sampleRate?: number; duration?: number }) =>
    request<ReaperLink>('/reaper/link-clip', {
      method: 'POST', body: JSON.stringify({ clipData, settings }),
    }),
  reaperAuto: (id: string) =>
    request<{ status: string; jobId?: string; message: string }>(`/links/${id}/reaper-auto`, { method: 'POST' }),
  reaperRenderScript: (id: string) =>
    request<{ scriptPath: string; message: string }>(`/links/${id}/reaper-render-script`),

  // Resolve Scripting API
  resolveStatus: () => request<ResolveStatus>('/resolve/status'),
  resolveProject: () => request<ResolveProject>('/resolve/project'),
  resolveTimeline: () => request<ResolveTimeline>('/resolve/timeline'),
  resolveSelection: (track?: number) =>
    request<ResolveSelection>(`/resolve/selection${track ? `?track=${track}` : ''}`),
  resolveClipProperties: (clipPath: string) =>
    request<any>('/resolve/clip-properties', {
      method: 'POST',
      body: JSON.stringify({ clipPath }),
    }),
};

// --- WebSocket (single shared connection) ---
//
// Every component subscribes to the same socket. This prevents duplicate
// connections (React StrictMode double-mount, multiple components) and makes
// sure a deliberate unmount never triggers a reconnect loop.

type WSHandler = (type: string, payload: any) => void;
type WSStatusHandler = (connected: boolean) => void;

const WS_MAX_RETRY = 30000;
const WS_INITIAL_RETRY = 3000;

let sharedSocket: WebSocket | null = null;
let sharedRetryDelay = WS_INITIAL_RETRY;
let sharedRetryTimer: ReturnType<typeof setTimeout> | null = null;
let sharedConnected = false;
const sharedHandlers = new Set<WSHandler>();
const sharedStatusHandlers = new Set<WSStatusHandler>();

function getWebSocketUrl(): string {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.getServerOrigin) {
    return (window as any).electronAPI.getServerOrigin().replace(/^http/, 'ws');
  }
  return WS_BASE;
}

function notifyStatus(connected: boolean) {
  if (sharedConnected === connected) return;
  sharedConnected = connected;
  sharedStatusHandlers.forEach((handler) => {
    try {
      handler(connected);
    } catch {
      // A broken subscriber must not take down the socket.
    }
  });
}

function scheduleReconnect() {
  if (sharedRetryTimer) return;
  if (sharedHandlers.size === 0 && sharedStatusHandlers.size === 0) return;

  sharedRetryTimer = setTimeout(() => {
    sharedRetryTimer = null;
    ensureSocket();
  }, sharedRetryDelay);

  sharedRetryDelay = Math.min(sharedRetryDelay * 1.5, WS_MAX_RETRY);
}

function ensureSocket() {
  if (typeof window === 'undefined') return;
  if (sharedSocket && (sharedSocket.readyState === WebSocket.OPEN || sharedSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const socket = new WebSocket(getWebSocketUrl());
  sharedSocket = socket;

  socket.onopen = () => {
    sharedRetryDelay = WS_INITIAL_RETRY;
    notifyStatus(true);
  };

  socket.onmessage = (event) => {
    let message: { type: string; payload: any };
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    sharedHandlers.forEach((handler) => {
      try {
        handler(message.type, message.payload);
      } catch (err) {
        console.error('[WS] Handler failed:', err);
      }
    });
  };

  socket.onclose = () => {
    if (sharedSocket !== socket) return;
    sharedSocket = null;
    notifyStatus(false);
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose always follows onerror; keep the console clean.
  };
}

function closeSocketIfUnused() {
  if (sharedHandlers.size > 0 || sharedStatusHandlers.size > 0) return;
  if (sharedRetryTimer) {
    clearTimeout(sharedRetryTimer);
    sharedRetryTimer = null;
  }
  if (sharedSocket) {
    const socket = sharedSocket;
    sharedSocket = null;
    socket.onclose = null;
    socket.close();
  }
  notifyStatus(false);
}

/** Subscribe to real-time server events. Returns an unsubscribe function. */
export function subscribeWebSocket(handler: WSHandler): () => void {
  sharedHandlers.add(handler);
  ensureSocket();

  return () => {
    sharedHandlers.delete(handler);
    closeSocketIfUnused();
  };
}

/** Subscribe to bridge connection changes. Fires immediately with current state. */
export function subscribeWebSocketStatus(handler: WSStatusHandler): () => void {
  sharedStatusHandlers.add(handler);
  ensureSocket();
  handler(sharedConnected);

  return () => {
    sharedStatusHandlers.delete(handler);
    closeSocketIfUnused();
  };
}

export function isWebSocketConnected(): boolean {
  return sharedConnected;
}
