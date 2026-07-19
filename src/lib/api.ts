const API_BASE = '/api';
const WS_BASE = `ws://${window.location.hostname}:${window.location.port || 3030}`;

// --- Resolve Scripting API Types ---

export interface ResolveStatus {
  connected: boolean;
  version?: string;
  product?: string;
  error?: string;
}

export interface ResolveProject {
  name: string;
  frameRate: string;
  resolution: { width: number; height: number };
  colorSpace: string;
  timelineCount: number;
}

export interface ResolveTimeline {
  name: string;
  frameRate: string;
  resolution: { width: number; height: number };
  videoTrackCount: number;
  audioTrackCount: number;
  currentTimecode: string;
  tracks: Record<string, ResolveTimelineClip[]>;
}

export interface ResolveTimelineClip {
  name: string;
  start: number;
  end: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  mediaPoolItem: string | null;
}

export interface ResolveSelection {
  timeline: string;
  fps: number;
  width: number;
  height: number;
  clips: ResolveClipData[];
  clipCount: number;
  error?: string;
}

export interface ResolveClipData {
  name: string;
  start: number;
  end: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  sourcePath: string;
  trackIndex: number;
  mediaType: string;
  fps: number;
  resolution: { width: number; height: number };
}

// --- Link API Types ---

export interface ClipData {
  name: string;
  start: number;
  duration: number;
  sourcePath: string;
  sourceIn?: number;
  sourceOut?: number;
  trackIndex?: number;
}

export interface LinkClip {
  name: string;
  linkId: string;
  status: 'pending' | 'linked' | 'rendering' | 'rendered' | 'error';
  filePath: string;
  startTimecode: number;
  durationFrames: number;
}

export interface Link {
  id: string;
  clips: LinkClip[];
  settings: {
    width: number;
    height: number;
    fps: number;
    duration: number;
  };
  status: 'created' | 'linked' | 'sending' | 'queued' | 'rendering' | 'rendered' | 'imported' | 'error';
  exportPath: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ServerFile {
  path: string;
  name: string;
}

// --- REST API ---

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export interface SetupConfig {
  hasEnv: boolean;
  detected: {
    pythonPath: string | null;
    pythonVersion: string | null;
    aePath: string | null;
    platform: string;
  };
  config: {
    port: number;
    host: string;
    exportDir: string;
    tempDir: string;
    pythonPath: string;
    aePath: string;
    scriptingPath: string;
  };
}

export interface JobHistoryEntry {
  type: 'create' | 'render' | 'import';
  linkId: string;
  status: 'created' | 'success' | 'error';
  file?: string;
  clipCount?: number;
  error?: string;
  timestamp: string;
}

export interface RenderPreset {
  name: string;
  template?: string;
  outputModule?: string;
  settings?: Record<string, any>;
}

export interface TimelineMarker {
  frame: number;
  name: string;
  note: string;
  color: string;
  duration: number;
  trackType: string;
  trackIndex: number;
  clipName: string | null;
  startTimecode: string;
}

export interface PerfStats {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  slowCount: number;
}

export const api = {
  // Health
  health: () => request<{ status: string; links: number }>('/health'),

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
  linkClip: (clipData: ClipData[], settings?: Partial<Link['settings']>) =>
    request<{ linkId: string; status: string; jsxPath: string; payloadPath: string }>(
      '/link-clip',
      { method: 'POST', body: JSON.stringify({ clipData, settings }) }
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

// --- WebSocket ---

type WSHandler = (type: string, payload: any) => void;

export function createWebSocket(onMessage: WSHandler): WebSocket {
  const ws = new WebSocket(WS_BASE);

  ws.onopen = () => console.log('[WS] Connected to ResolveLink server');

  ws.onmessage = (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);
      onMessage(type, payload);
    } catch (e) {
      console.error('[WS] Invalid message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected. Reconnecting in 3s...');
    setTimeout(() => createWebSocket(onMessage), 3000);
  };

  ws.onerror = (err) => console.error('[WS] Error:', err);

  return ws;
}
