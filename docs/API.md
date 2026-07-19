# API Reference

## Base URL

```
http://localhost:3030
```

## REST Endpoints

### Health Check

```
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "links": 0
}
```

---

### Get Server Config

```
GET /api/config
```

**Response:**
```json
{
  "exportDir": "X:\\coding\\AE-Link\\exports",
  "tempDir": "X:\\coding\\AE-Link\\temp",
  "serverPort": 3030
}
```

---

### DaVinci Resolve Scripting API

These endpoints connect to a running DaVinci Resolve instance via the Python scripting bridge.

#### Resolve Connection Status

```
GET /api/resolve/status
```

Check if DaVinci Resolve is running and the scripting API is reachable.

**Response (connected):**
```json
{
  "connected": true,
  "version": "18.6.4",
  "product": "DaVinci Resolve"
}
```

**Response (not connected):**
```json
{
  "connected": false,
  "error": "DaVinci Resolve not running or Scripting API not enabled"
}
```

> **Note:** Resolve must be running with the Scripting API enabled (default in Studio). The Python `DaVinciResolveScript` module must be findable by the configured `pythonPath`.

---

#### Get Current Project

```
GET /api/resolve/project
```

Returns information about the currently open Resolve project.

**Response:**
```json
{
  "name": "My_VFX_Project",
  "frameRate": "24.0",
  "resolution": { "width": 1920, "height": 1080 },
  "colorSpace": "Rec.709",
  "timelineCount": 3
}
```

---

#### Get Current Timeline

```
GET /api/resolve/timeline
```

Returns timeline information including all video tracks and clips.

**Response:**
```json
{
  "name": "Timeline 1",
  "frameRate": "24.0",
  "resolution": { "width": 1920, "height": 1080 },
  "videoTrackCount": 3,
  "audioTrackCount": 4,
  "currentTimecode": "01:00:12:04",
  "tracks": {
    "video_1": [
      {
        "name": "Interview_A",
        "start": 0,
        "end": 2880,
        "duration": 2880,
        "sourceStart": 144,
        "sourceEnd": 3024,
        "mediaPoolItem": "X:\\footage\\interview_a.mov"
      }
    ],
    "video_2": [
      {
        "name": "VFX_Shot_01",
        "start": 1440,
        "end": 1680,
        "duration": 240,
        "sourceStart": 0,
        "sourceEnd": 240,
        "mediaPoolItem": "X:\\footage\\vfx_shot_01.mov"
      }
    ]
  }
}
```

---

#### Get Selection

```
GET /api/resolve/selection?track=1
```

Returns clips from the current timeline. Optionally filter by track index.

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `track` | number | Filter by video track index (optional) |

**Response:**
```json
{
  "timeline": "Timeline 1",
  "fps": 24.0,
  "width": 1920,
  "height": 1080,
  "clipCount": 2,
  "clips": [
    {
      "name": "VFX_Shot_01",
      "start": 0,
      "end": 240,
      "duration": 240,
      "sourceIn": 0,
      "sourceOut": 240,
      "sourcePath": "X:\\footage\\vfx_shot_01.mov",
      "trackIndex": 1,
      "mediaType": "Video",
      "fps": 24.0,
      "resolution": { "width": 1920, "height": 1080 }
    },
    {
      "name": "VFX_Shot_02",
      "start": 240,
      "end": 480,
      "duration": 240,
      "sourceIn": 0,
      "sourceOut": 240,
      "sourcePath": "X:\\footage\\vfx_shot_02.mov",
      "trackIndex": 1,
      "mediaType": "Video",
      "fps": 24.0,
      "resolution": { "width": 1920, "height": 1080 }
    }
  ]
}
```

**Field Reference - Selection Clip:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Clip name in the timeline |
| `start` | number | Timeline start position in frames |
| `end` | number | Timeline end position in frames |
| `duration` | number | Duration in frames |
| `sourceIn` | number | Source media in-point (left offset) in frames |
| `sourceOut` | number | Source media out-point (right offset) in frames |
| `sourcePath` | string | Absolute path to the source media file |
| `trackIndex` | number | Video track index (1-based) |
| `mediaType` | string | Media type (Video, Audio, etc.) |
| `fps` | number | Frame rate of the source clip |
| `resolution` | object | Source resolution `{ width, height }` |

---

#### Get Clip Properties

```
POST /api/resolve/clip-properties
```

Returns detailed properties of a specific clip from the media pool.

**Request Body:**
```json
{
  "clipPath": "X:\\footage\\vfx_shot_01.mov"
}
```

**Response:**
```json
{
  "name": "vfx_shot_01",
  "properties": {
    "File Path": "X:\\footage\\vfx_shot_01.mov",
    "Resolution Width": "1920",
    "Resolution Height": "1080",
    "Type": "Video",
    "FPS": "24.0",
    "Duration": "01:00:12:04",
    "Codec": "H.264"
  }
}
```

---

### List Active Links

```
GET /api/links
```

**Response:**
```json
[
  {
    "id": "32b0ff89-8d3b-4724-a3f4-e273c2547b54",
    "clips": [
      {
        "name": "VFX_Shot_01",
        "linkId": "32b0ff89-8d3b-4724-a3f4-e273c2547b54",
        "status": "pending",
        "filePath": "X:\\footage\\VFX_Shot_01.mov",
        "startTimecode": 0,
        "durationFrames": 120,
        "start": 0,
        "duration": 120,
        "sourcePath": "X:\\footage\\VFX_Shot_01.mov",
        "sourceIn": 0,
        "sourceOut": 120
      }
    ],
    "settings": {
      "width": 1920,
      "height": 1080,
      "fps": 24,
      "duration": 10,
      "renderQueue": "Best Settings"
    },
    "status": "created",
    "exportPath": null,
    "createdAt": "2026-07-18T10:43:43.914Z",
    "jsxPath": "X:\\coding\\AE-Link\\temp\\32b0ff89-...jsx",
    "payloadPath": "X:\\coding\\AE-Link\\temp\\32b0ff89-...json"
  }
]
```

---

### Create Link

Sends clip data from the Resolve timeline and generates an AE composition script.

```
POST /api/link-clip
```

**Request Body:**
```json
{
  "clipData": [
    {
      "name": "VFX_Shot_01",
      "start": 0,
      "duration": 120,
      "sourcePath": "X:\\footage\\VFX_Shot_01.mov",
      "sourceIn": 0,
      "sourceOut": 120,
      "trackIndex": 1
    },
    {
      "name": "VFX_Shot_02",
      "start": 120,
      "duration": 96,
      "sourcePath": "X:\\footage\\VFX_Shot_02.mov",
      "sourceIn": 0,
      "sourceOut": 96,
      "trackIndex": 1
    }
  ],
  "settings": {
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "duration": 8
  }
}
```

**Field Reference - `clipData[]`:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name of the clip |
| `start` | number | Yes | Timeline position in frames |
| `duration` | number | Yes | Clip duration in frames |
| `sourcePath` | string | Yes | Absolute path to the source media file |
| `sourceIn` | number | No | Source in-point in frames (default: 0) |
| `sourceOut` | number | No | Source out-point in frames (default: duration) |
| `trackIndex` | number | No | Video track index in Resolve |

**Field Reference - `settings`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `width` | number | 1920 | Composition width in pixels |
| `height` | number | 1080 | Composition height in pixels |
| `fps` | number | 24 | Frames per second |
| `duration` | number | 10 | Composition duration in seconds |
| `renderQueue` | string | "Best Settings" | AE render queue preset name |

**Response (200):**
```json
{
  "linkId": "32b0ff89-8d3b-4724-a3f4-e273c2547b54",
  "status": "created",
  "jsxPath": "X:\\coding\\AE-Link\\temp\\32b0ff89-...jsx",
  "payloadPath": "X:\\coding\\AE-Link\\temp\\32b0ff89-...json"
}
```

**Response (400):**
```json
{
  "error": "clipData array is required"
}
```

---

### Auto-Workflow

Triggers the auto-workflow for a link: if AE is running, queues a job for the CEP extension; if not, launches AE with the generated script.

```
POST /api/links/:id/auto
```

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Link UUID |

**Response (200) - AE running, job queued:**
```json
{
  "status": "queued",
  "jobId": "a1b2c3d4-...",
  "message": "Job queued. CEP extension will pick it up automatically."
}
```

**Response (200) - AE not running, launching:**
```json
{
  "status": "sending",
  "message": "AE launched with script. It will execute on startup."
}
```

**Response (404):**
```json
{
  "error": "Link not found"
}
```

**Response (500):**
```json
{
  "error": "After Effects not found"
}
```

---

### Update Link Status

```
PUT /api/links/:id/status
```

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Link UUID |

**Request Body:**
```json
{
  "status": "rendered",
  "exportPath": "X:\\coding\\AE-Link\\exports\\Resolve_Link_32b0ff89.mov"
}
```

**Valid Status Values:**

| Status | Description |
|--------|-------------|
| `created` | Link created, JSX generated |
| `sending` | AE is being launched or job is being queued |
| `queued` | Job queued, waiting for CEP extension to pick up |
| `linked` | AE composition confirmed open |
| `rendering` | aerender is processing |
| `rendered` | Render complete, file available |
| `imported` | Render imported back into Resolve as compound clip |
| `error` | Something went wrong |

**Response (200):** Updated link object

**Response (404):**
```json
{
  "error": "Link not found"
}
```

---

### Delete Link

```
DELETE /api/links/:id
```

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Link UUID |

**Response (200):**
```json
{
  "deleted": true
}
```

**Response (404):**
```json
{
  "error": "Link not found"
}
```

---

### Trigger Render

Starts `aerender` for the specified link's composition.

```
POST /api/links/:id/render
```

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Link UUID |

**Response (200):**
```json
{
  "status": "rendered"
}
```

**Response (500):**
```json
{
  "error": "After Effects not found"
}
```

---

### Get Render Script

Generates a standalone render script that can be run manually in After Effects.

```
GET /api/links/:id/render-script
```

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Link UUID |

**Response (200):**
```json
{
  "scriptPath": "X:\\coding\\AE-Link\\temp\\render_32b0ff89-....jsx",
  "message": "Run this script in After Effects: File > Scripts > Run Script File"
}
```

---

### Render Active Comp

Generates a render script for the currently active composition in After Effects (called by the CEP extension).

```
POST /api/render-active-comp
```

**Response (200):**
```json
{
  "scriptPath": "X:\\coding\\AE-Link\\temp\\render_active_1721312345678.jsx"
}
```

---

### Get Render Progress

```
GET /api/render-progress/:id
```

Returns render progress for a given render ID.

**Response:**
```json
{
  "status": "rendering",
  "percent": 65,
  "bytes": 1048576
}
```

---

### Render Presets

```
GET    /api/presets                — List all presets
POST   /api/presets                — Create/update a preset
DELETE /api/presets/:name          — Delete a preset
```

**POST Request Body:**
```json
{
  "name": "ProRes 4444",
  "template": "Best Settings",
  "outputModule": "ProRes 4444"
}
```

**GET Response:**
```json
{
  "presets": [
    { "name": "ProRes 4444", "template": "Best Settings", "outputModule": "ProRes 4444" }
  ]
}
```

---

### Batch Export

Sends multiple timelines to AE at once.

```
POST /api/batch-export
```

**Request Body:**
```json
{
  "timelineNames": ["Timeline 1", "Timeline 2"]
}
```

**Response:**
```json
{
  "results": [...],
  "total": 2,
  "created": 2
}
```

---

### Timeline Markers

```
GET /api/resolve/markers
```

Returns all markers on the current Resolve timeline.

**Response:**
```json
{
  "timeline": "Timeline 1",
  "fps": 24.0,
  "markers": [
    {
      "frame": 120,
      "name": "VFX Shot",
      "note": "Add particles here",
      "color": "#ff0000",
      "duration": 1,
      "trackType": "video",
      "trackIndex": 1,
      "clipName": "VFX_Shot_01",
      "startTimecode": "00:00:05:00"
    }
  ],
  "count": 1
}
```

---

### Update Check

```
GET /api/update-check
```

Checks GitHub for newer versions.

**Response:**
```json
{
  "currentVersion": "1.0.0",
  "latestVersion": "1.1.0",
  "updateAvailable": true,
  "downloadUrl": "https://github.com/..."
}
```

---

### Performance Stats

```
GET /api/perf
```

Returns timing statistics for all API endpoints (last 100 requests per endpoint).

**Response:**
```json
{
  "uptime": 3600,
  "memoryMB": 45,
  "endpoints": {
    "GET /api/links": {
      "count": 120,
      "avgMs": 12.3,
      "p50Ms": 8.1,
      "p95Ms": 45.2,
      "p99Ms": 89.0,
      "maxMs": 120.5,
      "slowCount": 2
    }
  }
}
```

---

### Slow Endpoints

```
GET /api/perf/slow
```

Returns the 10 slowest endpoints sorted by average response time.

**Response:**
```json
{
  "slowest": [
    {
      "endpoint": "POST /api/batch-export",
      "avgMs": 2340.5,
      "maxMs": 5120.0,
      "slowCount": 5,
      "count": 12
    }
  ]
}
```

---

### Clear Temp/Export Files

```
POST /api/clear
```

**Request Body:**
```json
{
  "target": "exports"
}
```

**Response:**
```json
{
  "success": true,
  "removed": 12
}
```

---

### Job History

```
GET /api/history
```

Returns recent job history (capped at 100 entries).

**Response:**
```json
[
  {
    "type": "create",
    "linkId": "32b0ff89-...",
    "status": "created",
    "clipCount": 3,
    "timestamp": "2026-07-19T10:00:00.000Z"
  },
  {
    "type": "import",
    "linkId": "32b0ff89-...",
    "status": "success",
    "file": "Resolve_Link_32b0ff89.mov",
    "timestamp": "2026-07-19T10:15:00.000Z"
  }
]
```

---

### Setup (First-Run Configuration)

```
GET  /api/setup   — Get auto-detected paths and .env state
POST /api/setup   — Write .env configuration
```

**GET Response:**
```json
{
  "hasEnv": true,
  "detected": {
    "pythonPath": "C:\\Python314\\python.exe",
    "pythonVersion": "3.14.0",
    "aePath": "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files",
    "platform": "win32"
  },
  "config": {
    "port": 3030,
    "host": "127.0.0.1",
    "exportDir": "./exports",
    "tempDir": "./temp",
    "pythonPath": "python",
    "aePath": "",
    "scriptingPath": ""
  }
}
```

**POST Request Body:**
```json
{
  "PORT": 3030,
  "EXPORT_DIR": "./exports",
  "PYTHON_PATH": "C:\\Python314\\python.exe",
  "AE_PATH_WIN": "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files"
}
```

---

### Import Back to Resolve

Imports a rendered file back into DaVinci Resolve, creating a compound clip with the render over the originals.

```
POST /api/import-back
```

**Request Body:**
```json
{
  "renderedPath": "X:\\coding\\AE-Link\\exports\\Resolve_Link_32b0ff89.mov"
}
```

**Response (200):**
```json
{
  "status": "success",
  "disabledClips": 3,
  "renderedFile": "X:\\coding\\AE-Link\\exports\\Resolve_Link_32b0ff89.mov",
  "compoundCreated": true,
  "trackIndex": 1
}
```

**Response (500):**
```json
{
  "error": "DaVinci Resolve not running"
}
```

The import-back process:
1. Imports the rendered file into the Resolve media pool
2. Disables all original clips on the target track
3. Appends the rendered clip to the timeline
4. Creates a compound clip from all timeline items

---

## REAPER Integration

### REAPER Status

```
GET /api/reaper/status
```

Returns REAPER installation and running status.

**Response (installed and running):**
```json
{
  "installed": true,
  "installPath": "C:\\Program Files\\REAPER",
  "running": true,
  "version": "7.12"
}
```

**Response (installed, not running):**
```json
{
  "installed": true,
  "installPath": "C:\\Program Files\\REAPER",
  "running": false,
  "version": "7.12"
}
```

**Response (not installed):**
```json
{
  "installed": false,
  "installPath": null,
  "running": false,
  "version": null
}
```

---

### REAPER Link Clip

```
POST /api/reaper/link-clip
```

Sends audio clip data from Resolve to REAPER. Generates a Lua import script, a seconds-based JSON payload, and queues a `reaper-create` job.

**Request Body:**
```json
{
  "clipData": [
    {
      "name": "Dialogue_A",
      "start": 0,
      "duration": 240,
      "sourcePath": "X:\\audio\\dialogue_a.wav",
      "sourceIn": 0,
      "sourceOut": 240,
      "trackIndex": 1
    },
    {
      "name": "SFX_Explosion",
      "start": 120,
      "duration": 96,
      "sourcePath": "X:\\audio\\sfx_explosion.wav",
      "sourceIn": 0,
      "sourceOut": 96,
      "trackIndex": 2
    }
  ],
  "settings": {
    "width": 1920,
    "height": 1080,
    "fps": 24,
    "duration": 10
  }
}
```

**Response (200):**
```json
{
  "linkId": "32b0ff89-8d3b-4724-a3f4-e273c2547b54",
  "status": "created",
  "payloadPath": "X:\\coding\\AE-Link\\temp\\32b0ff89-...json",
  "importScriptPath": "X:\\coding\\AE-Link\\temp\\32b0ff89-...lua"
}
```

The server converts frame-based clip data to seconds-based for REAPER (`seconds = frames / fps`) and groups clips by track.

**Response (400):**
```json
{
  "error": "clipData array is required"
}
```

---

### REAPER Auto-Workflow

```
POST /api/links/:id/reaper-auto
```

Triggers the REAPER auto-workflow: if REAPER is running, queues a `reaper-create` job for the Lua callback script; if not, launches REAPER with the generated import script.

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Link UUID |

**Response (200) - REAPER running, job queued:**
```json
{
  "status": "queued",
  "jobId": "a1b2c3d4-...",
  "message": "Job queued. reaper-callback.lua will pick it up automatically."
}
```

**Response (200) - REAPER not running, launching:**
```json
{
  "status": "sending",
  "message": "REAPER launched with import script."
}
```

**Response (404):**
```json
{
  "error": "Link not found"
}
```

---

### REAPER Render Script

```
GET /api/links/:id/reaper-render-script
```

Generates a standalone Lua script that opens REAPER's render dialog for the specified link.

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Link UUID |

**Response (200):**
```json
{
  "scriptPath": "X:\\coding\\AE-Link\\temp\\render_reaper_32b0ff89-....lua",
  "message": "Run this script in REAPER: Actions > Show action list > Browse > Run"
}
```

---

### Job Queue API

These endpoints are used by the CEP extension and REAPER callback script to poll for and report on jobs.

### Get Next Pending Job

```
GET /api/jobs/pending
```

Returns the next pending job and marks it as dispatched. Called by the CEP extension every 2 seconds.

**Response (job available):**
```json
{
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "execute-jsx",
  "linkId": "32b0ff89-8d3b-4724-a3f4-e273c2547b54",
  "jsxPath": "X:\\coding\\AE-Link\\temp\\32b0ff89-...jsx",
  "compName": "Resolve_Link_32b0ff89",
  "status": "dispatched",
  "createdAt": "2026-07-18T10:43:43.914Z",
  "dispatchedAt": "2026-07-18T10:43:45.123Z"
}
```

**Response (no pending jobs):**
```json
{
  "jobId": null
}
```

---

### Update Job Status

```
PUT /api/jobs/:jobId/status
```

Called by the CEP extension to report job progress or completion.

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `jobId` | Job UUID |

**Request Body:**
```json
{
  "status": "completed",
  "result": { "compName": "Resolve_Link_32b0ff89" }
}
```

Or on error:
```json
{
  "status": "error",
  "error": "Script not found: X:\\temp\\abc.jsx"
}
```

**Valid Job Status Values:**

| Status | Description |
|--------|-------------|
| `pending` | Job created, waiting to be dispatched |
| `dispatched` | Job returned to CEP extension |
| `executing` | CEP extension is running the script |
| `completed` | Script executed successfully |
| `error` | Script execution failed |

**Response (200):**
```json
{
  "success": true
}
```

**Response (404):**
```json
{
  "error": "Job not found"
}
```

When a job completes successfully, the associated link status is updated to `rendering` and a render watch is started.

---

## WebSocket Protocol

### Connection

```
ws://localhost:3030
```

### Message Format

All messages are JSON with the following structure:

```json
{
  "type": "event_name",
  "payload": { ... }
}
```

### Server -> Client Events

#### `init`

Sent on connection. Contains all current links.

```json
{
  "type": "init",
  "payload": {
    "links": [ ... ]
  }
}
```

#### `link:created`

Broadcast when a new link is created.

```json
{
  "type": "link:created",
  "payload": {
    "id": "uuid",
    "clips": [...],
    "settings": {...},
    "status": "created",
    "exportPath": null,
    "createdAt": "2026-07-18T10:43:43.914Z"
  }
}
```

#### `link:updated`

Broadcast when a link's status changes.

```json
{
  "type": "link:updated",
  "payload": {
    "id": "uuid",
    "status": "rendering",
    "updatedAt": "2026-07-18T10:45:00.000Z"
  }
}
```

#### `link:rendered`

Broadcast when the file watcher detects a completed render matching a link.

```json
{
  "type": "link:rendered",
  "payload": {
    "id": "uuid",
    "status": "rendered",
    "exportPath": "X:\\exports\\render.mov",
    "updatedAt": "2026-07-18T10:50:00.000Z"
  }
}
```

#### `link:deleted`

Broadcast when a link is removed.

```json
{
  "type": "link:deleted",
  "payload": {
    "id": "uuid"
  }
}
```

#### `file:new`

Broadcast when the watcher detects a file that doesn't match any active link.

```json
{
  "type": "file:new",
  "payload": {
    "path": "X:\\exports\\unknown_render.mov",
    "name": "unknown_render.mov"
  }
}
```

#### `resolve:status`

Broadcast when the DaVinci Resolve connection status changes (connected/disconnected).

```json
{
  "type": "resolve:status",
  "payload": {
    "connected": true,
    "version": "18.6.4",
    "product": "DaVinci Resolve"
  }
}
```

---

## TypeScript Types

### ClipData (Request)

```typescript
interface ClipData {
  name: string;
  start: number;        // Timeline position in frames
  duration: number;     // Duration in frames
  sourcePath: string;   // Absolute file path
  sourceIn?: number;    // Source in-point in frames
  sourceOut?: number;   // Source out-point in frames
  trackIndex?: number;  // Resolve track index
}
```

### LinkClip (Stored)

```typescript
interface LinkClip {
  name: string;
  linkId: string;
  status: 'pending' | 'linked' | 'rendering' | 'rendered' | 'error';
  filePath: string;
  startTimecode: number;
  durationFrames: number;
}
```

### Link (Stored)

```typescript
interface Link {
  id: string;
  clips: LinkClip[];
  settings: {
    width: number;
    height: number;
    fps: number;
    duration: number;
  };
  status: 'created' | 'sending' | 'queued' | 'linked' | 'rendering' | 'rendered' | 'imported' | 'error';
  exportPath: string | null;
  createdAt: string;
  updatedAt?: string;
  jsxPath?: string;
  payloadPath?: string;
  error?: string;
}
```

### ResolveStatus

```typescript
interface ResolveStatus {
  connected: boolean;
  version?: string;
  product?: string;
  error?: string;
}
```

### ResolveSelection

```typescript
interface ResolveSelection {
  timeline: string;
  fps: number;
  width: number;
  height: number;
  clips: ResolveClipData[];
  clipCount: number;
  error?: string;
}
```

### ResolveClipData

```typescript
interface ResolveClipData {
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
```

### Job

```typescript
interface Job {
  type: 'execute-jsx' | 'reaper-create';
  linkId: string;
  jsxPath?: string;              // For AE jobs
  compName?: string;             // For AE jobs
  payloadPath?: string;          // For REAPER jobs (seconds-based JSON)
  importScriptPath?: string;     // For REAPER jobs (Lua import script)
  status: 'pending' | 'dispatched' | 'executing' | 'completed' | 'error';
  createdAt: string;
  dispatchedAt?: string;
  result?: { compName: string } | { projectName: string };
  error?: string;
}
```

### ReaperStatus

```typescript
interface ReaperStatus {
  installed: boolean;
  installPath: string | null;
  running: boolean;
  version: string | null;
}
```

### ReaperLink

```typescript
interface ReaperLink {
  linkId: string;
  status: string;
  payloadPath: string;
  importScriptPath: string;
}
```

---

## Configuration

See `server/config.json`:

```json
{
  "server": {
    "port": 3030,
    "host": "localhost"
  },
  "paths": {
    "vfxExportDir": "./exports",
    "tempDir": "./temp",
    "aeInstallPath": {
      "win32": "C:\\Program Files\\Adobe\\Adobe After Effects 2026\\Support Files",
      "darwin": "/Applications/Adobe After Effects 2024/"
    }
  },
  "watcher": {
    "enabled": true,
    "extensions": [".mov", ".mp4", ".exr", ".png", ".tif", ".jpg", ".wav", ".flac", ".aiff", ".ogg", ".mp3"],
    "debounceMs": 1000
  },
  "ae": {
    "renderCommand": "aerender",
    "projectExtension": ".aep"
  },
  "resolve": {
    "pythonPath": "python",
    "pollIntervalMs": 2000,
    "bridgeScript": "./resolve-bridge.py"
  }
}
```

| Key | Type | Description |
|-----|------|-------------|
| `server.port` | number | HTTP/WS port |
| `server.host` | string | Bind address |
| `paths.vfxExportDir` | string | Directory watched for renders |
| `paths.tempDir` | string | Directory for generated scripts |
| `paths.aeInstallPath.win32` | string | After Effects install path (Windows) |
| `paths.aeInstallPath.darwin` | string | After Effects install path (macOS) |
| `watcher.enabled` | boolean | Enable/disable file watcher |
| `watcher.extensions` | string[] | File extensions to watch |
| `watcher.debounceMs` | number | Debounce interval for batch detection |
| `ae.renderCommand` | string | aerender executable name |
| `ae.projectExtension` | string | AE project file extension |
| `resolve.pythonPath` | string | Python executable path |
| `resolve.pollIntervalMs` | number | Resolve connection polling interval |
| `resolve.bridgeScript` | string | Path to Python bridge script |
| `reaper.installPath` | object | REAPER install paths `{ win32, darwin }` |
| `reaper.pollIntervalMs` | number | REAPER callback polling interval |
| `reaper.renderFormat` | string | Default REAPER render format (e.g. "wav") |
