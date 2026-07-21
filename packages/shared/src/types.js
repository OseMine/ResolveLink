/**
 * ResolveLink Shared Types
 * Used by both server (CommonJS) and UI (ESM/TypeScript).
 */

// --- Resolve Scripting Types ---

/** @typedef {{ connected: boolean; version?: string; product?: string; error?: string }} ResolveStatus */

/** @typedef {{ name: string; frameRate: string; resolution: { width: number; height: number }; colorSpace: string; timelineCount: number }} ResolveProject */

/** @typedef {{ name: string; frameRate: string; resolution: { width: number; height: number }; videoTrackCount: number; audioTrackCount: number; currentTimecode: string; tracks: Record<string, ResolveTimelineClip[]> }} ResolveTimeline */

/** @typedef {{ name: string; start: number; end: number; duration: number; sourceStart: number; sourceEnd: number; mediaPoolItem: string | null }} ResolveTimelineClip */

/** @typedef {{ timeline: string; fps: number; width: number; height: number; clips: ResolveClipData[]; clipCount: number; error?: string }} ResolveSelection */

/** @typedef {{ name: string; start: number; end: number; duration: number; sourceIn: number; sourceOut: number; sourcePath: string; trackIndex: number; mediaType: string; fps: number; resolution: { width: number; height: number } }} ResolveClipData */

// --- Link Types ---

/** @typedef {{ name: string; start: number; duration: number; sourcePath: string; sourceIn?: number; sourceOut?: number; trackIndex?: number; trackName?: string; volume?: number; muted?: boolean }} ClipData */

/** @typedef {'pending' | 'linked' | 'rendering' | 'rendered' | 'error'} LinkClipStatus */

/** @typedef {{ name: string; linkId: string; status: LinkClipStatus; filePath: string; startTimecode: number; durationFrames: number }} LinkClip */

/** @typedef {'created' | 'linked' | 'sending' | 'queued' | 'rendering' | 'rendered' | 'imported' | 'error' | 'completed' | 'sent'} LinkStatus */

/** @typedef {{ id: string; clips: Array<ClipData & { linkId: string; status: string }>; settings: LinkSettings; status: LinkStatus; exportPath: string | null; createdAt: string; updatedAt?: string; target?: 'ae' | 'reaper' }} Link */

/** @typedef {{ width: number; height: number; fps: number; duration: number; renderQueue?: string; sampleRate?: number }} LinkSettings */

// --- REAPER Types ---

/** @typedef {{ installed: boolean; installPath: string | null; running: boolean; version: string | null }} ReaperStatus */

/** @typedef {{ linkId: string; status: string; scriptPath: string; payloadPath: string; renderPath: string }} ReaperLink */

// --- Job Types ---

/** @typedef {'create' | 'render' | 'import' | 'reaper-create'} JobHistoryType */
/** @typedef {'created' | 'success' | 'error'} JobHistoryStatus */

/** @typedef {{ type: JobHistoryType; linkId: string; status: JobHistoryStatus; file?: string; clipCount?: number; error?: string; timestamp: string; target?: 'ae' | 'reaper'; details?: any }} JobHistoryEntry */

/** @typedef {{ type: string; linkId: string; status: string; createdAt: string; [key: string]: any }} Job */

// --- Setup Types ---

/** @typedef {{ hasEnv: boolean; detected: { pythonPath: string | null; pythonVersion: string | null; aePath: string | null; reaperPath: string | null; reaperVersion: string | null; reaperInstalled: boolean; platform: string }; config: { port: number; host: string; exportDir: string; tempDir: string; pythonPath: string; aePath: string; scriptingPath: string; reaperPath: string } }} SetupConfig */

// --- Preset Types ---

/** @typedef {{ name: string; template?: string; outputModule?: string; settings?: Record<string, any> }} RenderPreset */

// --- Marker Types ---

/** @typedef {{ frame: number; name: string; note: string; color: string; duration: number; trackType: string; trackIndex: number; clipName: string | null; startTimecode: string }} TimelineMarker */

// --- Perf Types ---

/** @typedef {{ count: number; avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number; slowCount: number }} PerfStats */

// --- WebSocket Message Types ---

/** @typedef {{ type: string; payload: any }} WSMessage */

// --- Integration Types ---

/**
 * @typedef {Object} IntegrationConfig
 * @property {string} name - Unique identifier (e.g., 'ae', 'reaper', 'fusion')
 * @property {string} displayName - Human-readable name
 * @property {string} description - What this integration does
 */

/**
 * @typedef {Object} IntegrationStatus
 * @property {boolean} available - Whether the integration is detected/installed
 * @property {boolean} running - Whether the target app is currently running
 * @property {string|null} version - Version string if detected
 * @property {string|null} installPath - Installation path if detected
 */

/**
 * @typedef {Object} ImportPayload
 * @property {string} linkId
 * @property {Array<ClipData & { linkId: string }>} clips
 * @property {LinkSettings} settings
 */

/**
 * @typedef {Object} ScriptOutput
 * @property {string} scriptPath - Path to the generated script file
 * @property {string|null} payloadPath - Path to the generated payload JSON
 */

/**
 * @typedef {Object} ExportPayload
 * @property {string} linkId
 * @property {string} exportDir
 */

/**
 * @typedef {Object} BroadcastFn
 * @property {(type: string, payload: any) => void} broadcast
 */

/**
 * @typedef {Object} Store
 * @property {Map} activeLinks
 * @property {Map} jobQueue
 * @property {Array<JobHistoryEntry>} jobHistory
 * @property {Map} editingSessions
 * @property {BroadcastFn} broadcast
 * @property {function} addJobHistory
 */

/**
 * @interface Integration
 * Each integration (AE, REAPER, Fusion, etc.) must implement this interface.
 */
// @ts-ignore - JSDoc interface for documentation; actual enforcement via runtime checks

module.exports = {};
