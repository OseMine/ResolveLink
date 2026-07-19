# Architecture

ResolveLink is composed of four distinct layers that communicate through well-defined interfaces.

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
│  │  │ - Polling (2s)    │  │ - GetCurrentTimeline()        │  │    │
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
│  │                             └───────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                      │
│          HTTP REST (job polling) + File System Watch                │
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
│                    ExtendScript execution                            │
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

### Electron Main Process (`electron.js`)

- Creates the frameless BrowserWindow (420x700, dark background)
- Spawns the backend server as a child process
- Handles window controls (minimize, close) via IPC
- Manages app lifecycle (quit, activate)
- In development mode, loads `http://localhost:5173`; in production, loads the built HTML

### Preload Script (`preload.js`)

- Exposes a safe `electronAPI` to the renderer via `contextBridge`
- Available methods: `minimize()`, `close()`, `openExternal(url)`
- All communication is context-isolated (no nodeIntegration)

### Backend Server (`server/index.js`)

- **Express REST API** — Handles link CRUD, Resolve scripting proxy, job queue, auto-workflow, setup wizard, job history, render presets, batch export, markers, update check, clear
- **WebSocket Server** — Pushes real-time updates to all connected UI clients
- **Chokidar File Watcher** — Monitors exports + extra directories (multi-folder via `WATCH_FOLDERS`)
- **ExtendScript Generator** — Dynamically creates `.jsx` scripts and `.json` payloads
- **Job Queue** — Pending jobs for CEP extension polling
- **Auto-Workflow** — If AE is running, queues jobs; if not, launches AE with `-r` flag
- **Render Watch** — Polls for render output, triggers auto-import
- **AE Path Detection** — Finds `aerender`/`AfterFX` on Windows/macOS
- **Resolve Polling** — Broadcasts connection status via WebSocket
- **Structured Logging** — Leveled, tagged, timestamped output via `server/logger.js`
- **History Tracking** — Tracks link creation, render, import success/failure (capped at 100)

### Resolve Bridge (`server/resolve-service.js` + `server/resolve-bridge.py`)

- **resolve-service.js** - Node.js wrapper that executes the Python bridge via `child_process.execFile`
  - 3-second connection status cache to avoid hammering Python
  - Configurable polling interval for Resolve connection checks
- **resolve-bridge.py** - Python script that connects to DaVinci Resolve's scripting API
  - Auto-discovers `DaVinciResolveScript` module from multiple install paths
  - Supports: status, project, timeline, selection, clip-properties, create-compound
  - `create-compound` command: imports render, disables originals, creates compound clip

### CEP Extension (`extension/`)

- **client.js** - CEP panel logic running inside After Effects
  - Polls `/api/jobs/pending` every 2 seconds for new jobs
  - Executes JSX scripts via `CSInterface.evalScript()`
  - Reports job completion/error back to the server
  - Handles rendering via ExtendScript render queue
  - Import-back: calls `/api/import-back` to create compound clips in Resolve
  - Persists state via `localStorage` (rendered file path, active link, export dir)
- **host.jsx** - ExtendScript host functions callable from the CEP panel
- **CSInterface.js** - Adobe's CSInterface library for CEP communication

### React Frontend (`src/`)

- **App.tsx** - Root component, orchestrates layout
- **Titlebar.tsx** - Custom window chrome with drag region
- **Dashboard.tsx** - Shows active link count and connection status
- **SendButton.tsx** - Primary action button with loading states
- **LinkQueue.tsx** - Scrollable list of active links (or empty state)
- **LinkCard.tsx** - Individual link with status badge, clip list, metadata
- **StatusIndicator.tsx** - Colored dots and badges for link status
- **useResolveBridge.ts** - React hook managing WebSocket + REST state + Resolve polling
- **api.ts** - Typed API client for REST and WebSocket

### ExtendScript (`adobe/import_pipeline.jsx`)

- **createLinkedComp()** - Main function: creates AE comp, imports footage, places layers
- **renderCurrentComp()** - Adds active comp to render queue and starts render
- **timecodeToFrames()** - Parses HH:MM:SS:FF strings to frame numbers
- Exports functions to `$.global` for BridgeTalk communication
- Can accept a JSON file path as argument for direct execution

## Communication Protocols

### REST API (HTTP)

The frontend and CEP extension communicate with the server via standard HTTP requests:

```
Client (React)  ──POST /api/link-clip──────>  Server (Express)
Client (React)  ──GET  /api/links──────────>  Server (Express)
Client (React)  ──PUT  /api/links/:id──────>  Server (Express)
Client (React)  ──DEL  /api/links/:id──────>  Server (Express)
Client (React)  ──POST /api/links/:id/auto─>  Server (Express)
Client (React)  ──POST /api/import-back────>  Server (Express)

CEP Extension   ──GET  /api/jobs/pending───>  Server (Express)
CEP Extension   ──PUT  /api/jobs/:id/stat─>  Server (Express)
CEP Extension   ──POST /api/import-back───>  Server (Express)
```

### WebSocket (Real-time)

The server pushes state changes to all connected clients:

```
Server  ──{ type: "init", payload: { links } }──────>  Client
Server  ──{ type: "link:created", payload: {...} }──>  Client
Server  ──{ type: "link:updated", payload: {...} }──>  Client
Server  ──{ type: "link:rendered", payload: {...} }─>  Client
Server  ──{ type: "link:deleted", payload: { id } }─>  Client
Server  ──{ type: "file:new", payload: {...} }──────>  Client
Server  ──{ type: "resolve:status", payload: {...} }>  Client
```

### File System (Watch)

Chokidar monitors the exports directory:

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

The server maintains a `Map<string, Link>` in memory. Each link has:

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
  exportPath: string | null;     // Path to rendered output
  createdAt: string;             // ISO timestamp
  updatedAt?: string;            // Last status change
  jsxPath?: string;              // Generated .jsx path
  payloadPath?: string;          // Generated .json path
  error?: string;                // Error message if status is 'error'
}
```

### In-Memory Job Queue

The server maintains a `Map<string, Job>` for CEP extension job polling:

```typescript
{
  type: 'execute-jsx';
  linkId: string;                // Associated link UUID
  jsxPath: string;               // Path to JSX file to execute
  compName: string;              // Expected composition name
  status: 'pending' | 'dispatched' | 'executing' | 'completed' | 'error';
  createdAt: string;
  dispatchedAt?: string;
  result?: { compName: string };
  error?: string;
}
```

### React State (useResolveBridge hook)

```typescript
{
  connected: boolean;            // WebSocket connection status
  links: Link[];                 // All active links
  newFiles: ServerFile[];        // Unmatched detected files
  resolve: ResolveStatus;        // DaVinci Resolve connection status
  selection: ResolveSelection;   // Current clip selection from Resolve
  selectionLoading: boolean;     // Selection fetch in progress
}
```

State is updated via WebSocket events, not polling. The hook manages:

1. Initial link fetch on mount
2. WebSocket connection with auto-reconnect (3s interval)
3. State mutations for each event type
4. Resolve connection status polling (3s interval)
5. Action callbacks: `sendToAE()`, `deleteLink()`, `triggerRender()`, `fetchSelection()`

## Security Model

- **Context Isolation**: Electron's `contextIsolation: true` prevents renderer access to Node.js
- **No Node Integration**: `nodeIntegration: false` in webPreferences
- **Preload Only**: Only explicitly exposed APIs are available to the renderer
- **Local Only**: Server binds to `localhost` only, no external network access
- **CORS**: Enabled for local development cross-origin requests
- **CEP Debug Mode**: Requires `PlayerDebugMode=1` registry key for unsigned extensions

## Extension Points

### Adding New Export Formats

Add extensions to `server/config.json`:

```json
{
  "watcher": {
    "extensions": [".mov", ".mp4", ".exr", ".png", ".tif", ".jpg", ".webm"]
  }
}
```

### Adding New Status States

1. Add the state to `Link.status` in `src/lib/api.ts`
2. Add a color/label entry in `StatusIndicator.tsx`
3. Handle the new state in the WebSocket message handler

### Custom AE Compositions

Modify `adobe/import_pipeline.jsx` or the `generateExtendScript()` function in `server/index.js` to customize how compositions are built (e.g., adding adjustment layers, markers, or expressions).

### Adding Resolve Scripting Commands

1. Add a new `cmd_*` function in `server/resolve-bridge.py`
2. Register it in the `COMMANDS` dict
3. Add a wrapper method in `server/resolve-service.js`
4. Add a REST endpoint in `server/index.js`
