# Architecture

ResolveLink is composed of distinct layers that communicate through well-defined interfaces.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LAYER 1: RESOLVE UI                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Electron BrowserWindow (420x700, frameless)                │    │
│  │                                                             │    │
│  │  ┌──────────┐  ┌────────────┐  ┌────────────────────────┐ │    │
│  │  │Titlebar  │  │ Dashboard  │  │    SendButton          │ │    │
│  │  │(drag)    │  │ (links #)  │  │  "Send to AE"          │ │    │
│  │  └──────────┘  └────────────┘  └────────────────────────┘ │    │
│  │                                                             │    │
│  │  ┌─────────────────────────────────────────────────────┐   │    │
│  │  │  LinkQueue                                          │   │    │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐           │   │    │
│  │  │  │ LinkCard │ │ LinkCard │ │ LinkCard │  ...       │   │    │
│  │  │  └──────────┘ └──────────┘ └──────────┘           │   │    │
│  │  └─────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                      │
│                    HTTP REST + WebSocket                             │
│                              │                                      │
├──────────────────────────────┼──────────────────────────────────────┤
│                    LAYER 1b: RESOLVE SCRIPTING API                   │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Python Bridge (resolve-bridge.py)                           │    │
│  │                                                             │    │
│  │  ┌──────────────────┐  ┌────────────────────────────────┐  │    │
│  │  │ resolve-service.js│  │ DaVinciResolveScript module    │  │    │
│  │  │ (Node.js wrapper) │  │ (Python, via child_process)    │  │    │
│  │  │                   │  │                                │  │    │
│  │  │ - execFile()      │──│ - GetProjectManager()         │  │    │
│  │  │ - Caching (3s TTL)│  │ - GetCurrentProject()         │  │    │
│  │  │ - Polling (5s)    │  │ - GetCurrentTimeline()        │  │    │
│  │  │ - JSON parsing    │  │ - GetItemListInTrack()        │  │    │
│  │  └──────────────────┘  │ - GetMediaPoolItem()           │  │    │
│  │                         │ - CreateCompoundClip()         │  │    │
│  │                         └────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                      │
├──────────────────────────────┼──────────────────────────────────────┤
│                        LAYER 2: BRIDGE SERVER                       │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Express + WebSocket (port 3030)                            │    │
│  │                                                             │    │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐   │    │
│  │  │ REST API │  │ WS Broadcaster│  │  File Watcher      │   │    │
│  │  │ /api/*   │  │ (push events) │  │  (Chokidar)        │   │    │
│  │  └──────────┘  └──────────────┘  └────────────────────┘   │    │
│  │                                                             │    │
│  │  ┌──────────────────────┐  ┌───────────────────────────┐  │    │
│  │  │  Job Queue           │  │  ExtendScript Generator   │  │    │
│  │  │  - Queue for CEP     │  │  - Generates .jsx from    │  │    │
│  │  │  - Track status      │  │    clip data              │  │    │
│  │  │  - Dispatch to CEP   │  │  - Generates .json        │  │    │
│  │  └──────────────────────┘  │  - Writes to temp/        │  │    │
│  │                             │                           │  │    │
│  │  ┌──────────────────────┐  │  REAPER Generator         │  │    │
│  │  │  REAPER Service       │  │  - Lua import scripts     │  │    │
│  │  │  - Path detection     │  │  - JSON payloads (sec)   │  │    │
│  │  │  - Process detection  │  │  - Render Lua scripts     │  │    │
│  │  │  - CLI (positional)   │  │  - Job files (IPC)        │  │    │
│  │  │  - File-based IPC     │  │                           │  │    │
│  │  └──────────────────────┘  └───────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                      │
│          HTTP REST + File System (Job/Result directories)           │
│                              │                                      │
├──────────────────────────────┼──────────────────────────────────────┤
│                     LAYER 3: CEP EXTENSION                          │
│                     (Inside After Effects)                          │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  CEP Panel (client.js)                                      │    │
│  │                                                             │    │
│  │  ┌──────────────────┐  ┌────────────────────────────────┐  │    │
│  │  │ Job Polling      │  │ Render / Import Back           │  │    │
│  │  │ (every 2s)       │  │ - Render active comp           │  │    │
│  │  │ - GET /jobs/     │  │ - Import to Resolve            │  │    │
│  │  │   pending        │  │                                │  │    │
│  │  │ - Execute JSX    │  └────────────────────────────────┘  │    │
│  │  │ - Report status  │                                      │    │
│  │  └──────────────────┘  ┌────────────────────────────────┐  │    │
│  │                         │ CSInterface.evalScript()       │  │    │
│  │                         │ - Reads JSX from temp/         │  │    │
│  │                         │ - Executes in AE               │  │    │
│  │                         │ - Reports completion           │  │    │
│  │                         └────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                      │
├──────────────────────────────┼──────────────────────────────────────┤
│                  LAYER 3b: REAPER SCRIPTING                         │
│                  (Inside REAPER DAW)                                │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  resolve-link-panel.lua (Pure GFX, v2.2.0)                 │    │
│  │                                                             │    │
│  │  ┌──────────────────┐  ┌────────────────────────────────┐  │    │
│  │  │ Callback Toggle  │  │ Action Buttons                 │  │    │
│  │  │ - ON/OFF state   │  │ - Send Render to Resolve       │  │    │
│  │  │ - Polls job dir  │  │ - Update Project from Resolve  │  │    │
│  │  │ - File-based IPC │  │                                │  │    │
│  │  └──────────────────┘  └────────────────────────────────┘  │    │
│  │                                                             │    │
│  │  ┌──────────────────┐  ┌────────────────────────────────┐  │    │
│  │  │ Import Handler   │  │ Status + Log                   │  │    │
│  │  │ - Read payload   │  │ - Colored status indicator     │  │    │
│  │  │ - Create items   │  │ - Scrollable log console       │  │    │
│  │  │ - Auto-save      │  │ - Job counter                  │  │    │
│  │  └──────────────────┘  └────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                      │
│              File System (exports/reaper-jobs/)                     │
│                              │                                      │
├──────────────────────────────┼──────────────────────────────────────┤
│                        LAYER 4: AFTER EFFECTS                       │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ExtendScript Engine                                        │    │
│  │                                                             │    │
│  │  ┌──────────────────────────────────────────────────────┐  │    │
│  │  │  import_pipeline.jsx                                 │  │    │
│  │  │  - Reads JSON payload                                │  │    │
│  │  │  - Creates CompItem with matching settings           │  │    │
│  │  │  - Imports footage at correct timecodes              │  │    │
│  │  │  - Exposes functions via $.global for BridgeTalk     │  │    │
│  │  └──────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Outbound: Resolve -> After Effects (Auto-Workflow)

```
User clicks "Send to AE"
        │
        ▼
┌─────────────────────┐
│ SendButton.tsx      │
│ calls sendToAE()    │
└─────────┬───────────┘
          │ POST /api/link-clip
          ▼
┌─────────────────────┐
│ server/index.js     │
│                     │
│ 1. Generate UUID    │
│ 2. Store in Map     │
│ 3. Write .json      │──> temp/{uuid}.json
│ 4. Generate .jsx    │──> temp/{uuid}.jsx
│ 5. Broadcast event  │──> WebSocket clients
└─────────┬───────────┘
          │ POST /api/links/:id/auto
          ▼
┌─────────────────────┐
│ Auto-Workflow       │
│                     │
│ Is AE running?      │
│   YES ──> Queue job │──> Job Queue
│   NO  ──> Launch AE │──> spawn(AfterFX.exe -r jsx)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ CEP Extension       │
│ (if AE running)     │
│                     │
│ 1. Polls /jobs/     │
│    pending (2s)     │
│ 2. Reads .jsx file  │
│ 3. evalScript()     │
│ 4. Creates CompItem │
│ 5. Reports status   │
└─────────┬───────────┘
          │ PUT /api/jobs/:id/status
          ▼
┌─────────────────────┐
│ server/index.js     │
│                     │
│ Job completed       │
│ Link status =       │
│ "rendering"         │
│ Start render watch  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Render Watch        │
│ (polls for output)  │
│                     │
│ 1. Poll export dir  │
│    every 2s         │
│ 2. Detect .mov      │
│ 3. Update status    │
│    to "rendered"    │
│ 4. Auto-import to   │
│    Resolve          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Resolve Compound    │
│ Clip Creation       │
│                     │
│ 1. Import render    │
│    to media pool    │
│ 2. Disable original │
│    clips on track   │
│ 3. Append render    │
│    to timeline      │
│ 4. Create compound  │
│    clip             │
│ 5. Status =         │
│    "imported"       │
└─────────────────────┘
```

### Outbound: Resolve -> REAPER (Audio Workflow)

```
User clicks "Send Audio to REAPER"
        │
        ▼
┌─────────────────────┐
│ send-to-reaper.py   │
│ Tkinter dialog      │
│ selects audio clips │
└─────────┬───────────┘
          │ POST /api/reaper/link-clip
          ▼
┌─────────────────────┐
│ server/index.js     │
│                     │
│ 1. Generate UUID    │
│ 2. Convert frames   │
│    to seconds       │
│ 3. Write .json      │──> temp/{uuid}.json
│ 4. Write job file   │──> exports/reaper-jobs/{uuid}.json
│ 5. Store link       │
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│ resolve-link-panel  │
│ Callback (ON)       │
│                     │
│ 1. Polls job dir    │
│    every 2s         │
│ 2. Reads job file   │
│ 3. Reads payload    │
│ 4. Creates items    │
│ 5. Writes result    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ REAPER Mix & Render │
│                     │
│ 1. Audio engineer   │
│    mixes project    │
│ 2. Panel auto-saves │
│    project          │
│ 3. Renders to       │
│    export dir       │
│ 4. Panel sends      │
│    to server        │
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│ Server receives     │
│ audio file          │
│                     │
│ 1. Bridge imports   │
│    to Resolve       │
│ 2. Creates audio    │
│    track            │
│ 3. Mutes old clips  │
└─────────────────────┘
```

### Inbound: After Effects -> Resolve

```
exports/ directory receives new .mov/.mp4
        │
        ▼
┌─────────────────────┐
│ Chokidar Watcher    │
│                     │
│ 1. Detect new file  │
│ 2. Debounce (1s)    │
│ 3. Match to Link ID │
│ 4. Update status    │
└─────────┬───────────┘
          │ broadcast('link:rendered')
          ▼
┌─────────────────────┐
│ Auto-Import         │
│                     │
│ 1. Python bridge    │
│    create-compound  │
│ 2. Import to pool   │
│ 3. Disable originals│
│ 4. Create compound  │
│ 5. Status =         │
│    "imported"       │
└─────────┬───────────┘
          │ broadcast('link:updated')
          ▼
┌─────────────────────┐
│ WebSocket clients   │
│                     │
│ React state updates │
│ Status badge changes│
│ exportPath available│
└─────────────────────┘
```

## Component Responsibilities

### Backend Server (`server/index.js`)

- **Express REST API** — Handles link CRUD, Resolve scripting proxy, job queue, auto-workflow, setup wizard, job history, render presets, batch export, markers, update check, clear, REAPER import-to-resolve
- **WebSocket Server** — Pushes real-time updates to all connected UI clients
- **Chokidar File Watcher** — Monitors exports + extra directories (multi-folder via `WATCH_FOLDERS`)
- **ExtendScript Generator** — Dynamically creates `.jsx` scripts and `.json` payloads
- **Job Queue** — Pending jobs for CEP extension polling
- **Auto-Workflow** — If AE is running, queues jobs; if not, launches AE with `-r` flag
- **Render Watch** — Polls for render output, triggers auto-import
- **Resolve Polling** — Broadcasts connection status via WebSocket (5s interval)
- **REAPER File IPC** — Writes job files to `exports/reaper-jobs/`, watches `exports/reaper-results/` for responses
- **REAPER Import** — `POST /api/reaper/import-to-resolve` receives rendered audio, calls bridge to import into Resolve

### Resolve Bridge (`server/resolve-service.js` + `server/resolve-bridge.py`)

- **resolve-service.js** - Node.js wrapper that executes the Python bridge via `child_process.execFile`
  - 3-second connection status cache
  - 5-second polling interval for Resolve connection checks
- **resolve-bridge.py** - Python script that connects to DaVinci Resolve's scripting API
  - Auto-discovers `DaVinciResolveScript` module from multiple install paths
  - Commands: status, project, timeline, selection, clip-properties, create-compound, import-audio, import-rendered
  - `import-audio`: Imports rendered audio into Resolve media pool "REAPER Renders" bin, adds to audio track, mutes old clips

### REAPER Service (`server/reaper-service.js`)

- **Path Detection** — Auto-finds REAPER install on Windows and macOS
- **Process Detection** — Checks if REAPER is running via `tasklist` (Windows) or `pgrep` (macOS)
- **Version Detection** — Parses REAPER version from executable properties
- **CLI Execution** — Runs scripts via positional arguments (e.g., `reaper.exe -nonewinst "path/to/script.lua"`)
- **Lua Generation** — Generates import scripts, render scripts, and callback scripts
- **File-based IPC** — Writes job files to `exports/reaper-jobs/`, watches `exports/reaper-results/`

### REAPER Panel (`reaper-scripts/resolve-link-panel.lua`)

- **Pure GFX UI** — No external dependencies, works on any REAPER install
- **Custom Dark Theme** — Sleek dark background with card-based layout
- **Callback Toggle** — ON/OFF button to start/stop background polling
- **Send to Resolve** — Renders audio and sends to DaVinci via server
- **Update Project** — Fetches Resolve timeline, syncs REAPER items (position, length, track)
- **Import Handler** — Reads job payloads, creates media items, positions on timeline
- **Auto-Save** — Saves REAPER project to `exports/reaper-projects/`
- **Scrollable Log** — Shows recent activity with timestamps

### Shared REAPER Modules

- **`reaper-scripts/json.lua`** — Shared JSON decoder used by panel, callback, and update-project scripts
- **`reaper-scripts/render-lib.lua`** — Shared render config + import logic (`sendFileToResolve`, `ensureDir`, `applyRenderConfig`). Used by both `send-to-resolve.lua` and `resolve-link-panel.lua`

### CEP Extension (`extension/`)

- **client.js** - CEP panel logic running inside After Effects
  - Polls `/api/jobs/pending` every 2 seconds for new jobs
  - Executes JSX scripts via `CSInterface.evalScript()`
  - Reports job completion/error back to the server
  - Handles rendering via ExtendScript render queue
  - Import-back: calls `/api/import-back` to create compound clips in Resolve
- **host.jsx** - ExtendScript host functions callable from the CEP panel

## Communication Protocols

### REST API (HTTP)

```
Client (React)  ──POST /api/link-clip──────>  Server (Express)
Client (React)  ──GET  /api/links──────────>  Server (Express)
Client (React)  ──PUT  /api/links/:id──────>  Server (Express)
Client (React)  ──DEL  /api/links/:id──────>  Server (Express)
Client (React)  ──POST /api/links/:id/auto─>  Server (Express)
Client (React)  ──POST /api/import-back────>  Server (Express)

CEP Extension   ──GET  /api/jobs/pending───>  Server (Express)
CEP Extension   ──PUT  /api/jobs/:id/stat─>  Server (Express)

REAPER Scripts  ──PUT  /api/reaper/import-to-resolve──>  Server (Express)
REAPER Scripts  ──GET  /api/resolve/timeline──────────>  Server (Express)
```

### File System (REAPER IPC)

REAPER scripts communicate with the server via the file system:

```
Server writes:  exports/reaper-jobs/{uuid}.json   (job file)
Panel reads:    exports/reaper-jobs/{uuid}.json   (polls directory)
Panel deletes:  exports/reaper-jobs/{uuid}.json   (after reading)

Panel writes:   exports/reaper-results/{uuid}.json (result file)
Server watches: exports/reaper-results/            (chokidar watcher)
```

This approach avoids network dependencies between REAPER scripts and the server. The panel polls the jobs directory every 2 seconds using `reaper.EnumerateFiles()`.

### File System (AE Watch)

```
exports/ ──watch──>  new .mov/.mp4 detected
    │
    ├── Match by filename convention (contains link UUID or "Resolve_Link")
    ├── Update link status to "rendered"
    ├── Auto-import to Resolve via Python bridge
    └── Broadcast via WebSocket
```

### Job Queue (CEP Polling)

The CEP extension polls for pending jobs every 2 seconds:

```
CEP Extension ──GET /api/jobs/pending──>  Server
                  │
                  ├── No job? Return { jobId: null }
                  └── Has job? Mark as "dispatched", return job details
                        │
                        ├── CEP reads JSX file from disk
                        ├── CEP executes via evalScript()
                        ├── CEP reports status back to server
                        └── Server updates link status
```

## State Management

### In-Memory Link Registry

The server maintains a `Map<string, Link>` in memory:

```typescript
{
  id: string;                    // UUID v4
  clips: LinkClip[];             // Array of clip references
  settings: {                    // Composition settings
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

### In-Memory Job Queue

The server maintains a `Map<string, Job>` for CEP extension job polling:

```typescript
// AE job
{
  type: 'execute-jsx';
  linkId: string;
  jsxPath: string;
  compName: string;
  status: 'pending' | 'dispatched' | 'executing' | 'completed' | 'error';
  createdAt: string;
}

// REAPER jobs are file-based (no in-memory queue)
// Job files written to: exports/reaper-jobs/{uuid}.json
```

### React State (useResolveBridge hook)

```typescript
{
  connected: boolean;            // WebSocket connection status
  links: Link[];                 // All active links
  newFiles: ServerFile[];        // Unmatched detected files
  resolve: ResolveStatus;        // DaVinci Resolve connection status
  selection: ResolveSelection;   // Current clip selection from Resolve
  selectionLoading: boolean;
}
```

State is updated via WebSocket events, not polling.

## Security Model

- **Context Isolation**: Electron's `contextIsolation: true` prevents renderer access to Node.js
- **No Node Integration**: `nodeIntegration: false` in webPreferences
- **Preload Only**: Only explicitly exposed APIs are available to the renderer
- **Local Only**: Server binds to `localhost` only, no external network access
- **CORS**: Enabled for local development cross-origin requests
- **CEP Debug Mode**: Requires `PlayerDebugMode=1` registry key for unsigned extensions
