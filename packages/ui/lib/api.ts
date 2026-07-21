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

export interface ProjectStats {
  bugs: number;
  features: number;
  bugLabels: string[];
  featureLabels: string[];
}

const API_BASE = '/api';
const WS_BASE = `ws://${window.location.hostname}:${window.location.port}`;

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

export const api = {
  // Health
  health: () => request<{ status: string; links: number }>('/health'),
  stats: () => request<ProjectStats>('/stats'),

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

// --- WebSocket ---

type WSHandler = (type: string, payload: any) => void;

let wsRetryDelay = 3000;
const WS_MAX_RETRY = 30000;

export function createWebSocket(onMessage: WSHandler): WebSocket {
  const ws = new WebSocket(WS_BASE);

  ws.onopen = () => {
    console.log('[WS] Connected to ResolveLink server');
    wsRetryDelay = 3000;
  };

  ws.onmessage = (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);
      onMessage(type, payload);
    } catch (e) {
      console.error('[WS] Invalid message:', e);
    }
  };

  ws.onclose = () => {
    console.log(`[WS] Disconnected. Reconnecting in ${wsRetryDelay / 1000}s...`);
    setTimeout(() => createWebSocket(onMessage), wsRetryDelay);
    wsRetryDelay = Math.min(wsRetryDelay * 1.5, WS_MAX_RETRY);
  };

  ws.onerror = (err) => console.error('[WS] Error:', err);

  return ws;
}
