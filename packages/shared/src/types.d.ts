/**
 * ResolveLink Shared Type Definitions (TypeScript declarations)
 * Used by the UI for compile-time type checking.
 */

// --- Resolve Scripting Types ---

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

// --- Link Types ---

export interface ClipData {
  name: string;
  start: number;
  duration: number;
  sourcePath: string;
  sourceIn?: number;
  sourceOut?: number;
  trackIndex?: number;
  trackName?: string;
  volume?: number;
  muted?: boolean;
}

export type LinkClipStatus = 'pending' | 'linked' | 'rendering' | 'rendered' | 'error';

export interface LinkClip {
  name: string;
  linkId: string;
  status: LinkClipStatus;
  filePath: string;
  startTimecode: number;
  durationFrames: number;
}

export type LinkStatus = 'created' | 'linked' | 'sending' | 'queued' | 'rendering' | 'rendered' | 'imported' | 'error' | 'completed' | 'sent';

export interface LinkSettings {
  width: number;
  height: number;
  fps: number;
  duration: number;
  renderQueue?: string;
  sampleRate?: number;
}

export interface Link {
  id: string;
  clips: Array<ClipData & { linkId: string; status: string }>;
  settings: LinkSettings;
  status: LinkStatus;
  exportPath: string | null;
  createdAt: string;
  updatedAt?: string;
  target?: 'ae' | 'reaper';
  jsxPath?: string;
  payloadPath?: string;
  reaperScriptPath?: string;
  renderScriptPath?: string;
}

// --- REAPER Types ---

export interface ReaperStatus {
  installed: boolean;
  installPath: string | null;
  running: boolean;
  version: string | null;
}

export interface ReaperLink {
  linkId: string;
  status: string;
  scriptPath: string;
  payloadPath: string;
  renderPath: string;
}

// --- Job Types ---

export type JobHistoryType = 'create' | 'render' | 'import' | 'reaper-create';
export type JobHistoryStatus = 'created' | 'success' | 'error';

export interface JobHistoryEntry {
  type: JobHistoryType;
  linkId: string;
  status: JobHistoryStatus;
  file?: string;
  clipCount?: number;
  error?: string;
  timestamp: string;
  target?: 'ae' | 'reaper';
  details?: any;
}

export interface Job {
  type: string;
  linkId: string;
  status: string;
  createdAt: string;
  [key: string]: any;
}

// --- Setup Types ---

export interface SetupConfig {
  hasEnv: boolean;
  detected: {
    pythonPath: string | null;
    pythonVersion: string | null;
    aePath: string | null;
    reaperPath: string | null;
    reaperVersion: string | null;
    reaperInstalled: boolean;
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
    reaperPath: string;
  };
}

// --- Preset Types ---

export interface RenderPreset {
  name: string;
  template?: string;
  outputModule?: string;
  settings?: Record<string, any>;
}

// --- Marker Types ---

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

// --- Perf Types ---

export interface PerfStats {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  slowCount: number;
}

// --- Integration Types ---

export interface IntegrationConfig {
  name: string;
  displayName: string;
  description: string;
}

export interface IntegrationStatus {
  available: boolean;
  running: boolean;
  version: string | null;
  installPath: string | null;
}

export interface ImportPayload {
  linkId: string;
  clips: Array<ClipData & { linkId: string }>;
  settings: LinkSettings;
}

export interface ScriptOutput {
  scriptPath: string;
  payloadPath: string | null;
}

export interface ExportPayload {
  linkId: string;
  exportDir: string;
}

export interface Store {
  activeLinks: Map<string, Link>;
  jobQueue: Map<string, Job>;
  jobHistory: JobHistoryEntry[];
  editingSessions: Map<string, any>;
  broadcast: (type: string, payload: any) => void;
  addJobHistory: (entry: Omit<JobHistoryEntry, 'timestamp'>) => void;
}

export interface Integration {
  config: IntegrationConfig;
  init(store: Store): Promise<void>;
  getStatus(): IntegrationStatus;
  getRoutes(): any; // Express Router
  generateImportScript(payload: ImportPayload): ScriptOutput;
  generateExportScript?(payload: ExportPayload): ScriptOutput;
  isAvailable(): Promise<boolean>;
}
