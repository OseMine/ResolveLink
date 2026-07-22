# AGENTS.md - ResolveLink (AE-Link)

## Project Overview

ResolveLink is a Dynamic Link equivalent for DaVinci Resolve, bridging it with Adobe After Effects and REAPER. It automates round-trip workflows: editors select clips in Resolve, and ResolveLink handles export, script generation, rendering in the target app, and auto-import back to Resolve.

- **License**: MIT
- **Repository**: `https://github.com/OseMine/ResolveLink`
- **Version**: 1.1.0
- **Platforms**: Windows, macOS, Linux

## Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| Backend | Node.js + Express + WebSocket (ws) | Port 3030, CommonJS |
| Frontend UI | React 18 + TypeScript 5.3 + Tailwind CSS 3.4 | Vite 5, ESM, clsx + tailwind-merge |
| Desktop Shell | Electron 28 | Frameless window, context isolation, IPC preload |
| ExtendScript/JSX | CEP 9+ Extension | HTML/JS panel + ExtendScript host functions |
| Lua | REAPER scripts + DaVinci Resolve launcher | `dofile()` for shared modules |
| Python 3.10+ | DaVinci Resolve bridge | DaVinciResolveScript API via child_process |
| Validation | Zod 3.22 | Runtime schema validation on POST/PUT endpoints |
| File Watching | Chokidar 3.5 | Monitors exports for auto-import |
| Testing | Vitest 4.1.10 | Unit + integration tests |
| Build | Vite 5 + tsc | TypeScript compilation + bundling |
| Package Manager | npm workspaces | Monorepo layout |
| CI/CD | GitHub Actions | Node 20/22 matrix, tag-triggered releases, Vercel deploy |

## Monorepo Structure

```
packages/
  server/          # @resolvelink/server - Express REST API, WebSocket, file watcher, integration registry
  shared/          # @resolvelink/shared - TypeScript types (.d.ts), Zod schemas, JSDoc types (.js), constants
  ui/              # resolve-link-ui - Electron frontend (React + TypeScript + Tailwind)
src/               # Legacy UI (near-duplicate of packages/ui, kept for compatibility)
extension/         # CEP Extension for After Effects (HTML/JS panel + ExtendScript host)
  client/          # CEP Panel UI (index.html, client.js, CSInterface.js, style.css)
  host/            # ExtendScript host (host.jsx with AE scripting functions)
  reaper/          # REAPER web panel (HTML/CSS/JS)
resolve-scripts/   # DaVinci Resolve scripts (ResolveLink.lua, send-to-ae.py, send-to-reaper.py)
reaper-scripts/    # REAPER Lua scripts (7 files: panel, callback, send, update, json, render-lib, logger)
adobe/             # ExtendScript library (import_pipeline.jsx)
scripts/           # Management shell/PowerShell scripts (14 files)
web/               # Marketing website (separate Vite+React app, deployed to Vercel)
docs/              # Documentation (ARCHITECTURE.md, API.md, SETUP.md, WORKFLOW.md)
test/              # Vitest tests (api.test.js, jsx-generator.test.js, resolve-bridge.test.js)
exports/           # Render output directory (watched by Chokidar)
temp/              # Generated scripts/payloads (.jsx, .json, .lua)
```

## Build & Run Commands

```bash
# Install
npm install                    # Root + workspace deps
npm run install:all            # Also installs packages/ui deps

# Development
npm run dev                    # Start server + Vite dev server concurrently
npm run server                 # Backend only (port 3030)
npm run ui                     # Vite dev server only (port 5173)

# Production
npm start                      # Start Electron app
node packages/server/src/index.js  # Server standalone

# Build
npm run build                  # Build packages/ui (tsc + vite build)
cd web && npm run build        # Build marketing website

# Test
npm test                       # Run all Vitest tests (vitest run)
npm run test:watch             # Watch mode (vitest)

# Type-check (no ESLint configured - CI uses tsc only)
npx tsc --noEmit --project packages/ui/
npx tsc --noEmit --project src/
npx tsc --noEmit --project web/

# Management scripts (Windows PowerShell)
.\scripts\setup.ps1 -Force     # Run setup wizard
.\scripts\start.ps1            # Start server
.\scripts\stop.ps1             # Stop server
.\scripts\status.ps1           # Check status
.\scripts\restart.ps1          # Restart server
.\scripts\deploy-extension.ps1 # Deploy CEP extension to AE
.\scripts\deploy-resolve-script.ps1  # Deploy scripts to Resolve
.\scripts\clear.ps1            # Clear temp/exports
```

## Code Conventions

- **No ESLint or Prettier** - CI only runs `tsc --noEmit` type-checking
- **Server code**: CommonJS (`require`/`module.exports`), kebab-case files (`resolve-service.js`)
- **Frontend code**: ESM (`import`/`export`), PascalCase React components (`SendButton.tsx`)
- **Lua scripts**: kebab-case files, `dofile()` for shared module loading
- **ExtendScript**: `$.global` namespace for CEP communication
- **TypeScript**: `strict: true`, `noUnusedLocals: false`, `noUnusedParameters: false`
- **Shared types**: `.js` files with JSDoc types (runtime) + `.d.ts` files (compile-time)
- **Zod schemas** validate all POST/PUT API endpoints via `validate()` middleware
- **Logger**: `createLogger(tag)` produces `[timestamp][LEVEL][tag] message` with color coding

## Architecture

### Integration Registry Pattern

New target apps are added by creating a folder in `packages/server/src/integrations/` implementing the `Integration` interface:

```typescript
interface Integration {
  config: { name: string; displayName: string; description: string };
  init(store: Store): Promise<void>;
  getStatus(): { available: boolean; running: boolean; version: string | null; installPath: string | null };
  getRoutes(): any;  // Express Router
  generateImportScript(payload: ImportPayload): ScriptOutput;
  generateExportScript?(payload: ExportPayload): ScriptOutput;  // Optional
  isAvailable(): Promise<boolean>;
}
```

The registry (`packages/server/src/integrations/registry.js`) auto-discovers integrations from subdirectories (skips dirs starting with `_`). Current integrations: `ae/` and `reaper/`.

### Communication Protocols

- **HTTP REST** - Client-server API (port 3030)
- **WebSocket** - Real-time UI push updates (`init`, `link:created`, `link:updated`, `link:deleted`, `link:rendered`, `link:editing`, `file:new`, `resolve:status`, `job:history`)
- **File-based IPC** - REAPER scripts read/write files (no network dependency)
- **CEP Polling** - After Effects extension polls `/api/jobs/pending` for pending JSX jobs

### Server Startup Flow (`packages/server/src/index.js`)

1. Load `.env` via dotenv
2. Create Express app + HTTP server + WebSocketServer
3. Apply middleware: CORS, JSON body parser, perf tracking, auth
4. Initialize state store with WSS
5. Discover integrations from `integrations/` directory
6. Mount all route groups
7. Set up catch-all for React SPA routing
8. On listen: start file watcher, REAPER results watcher, initialize integrations, start Resolve status polling
9. Graceful shutdown handlers for SIGTERM/SIGINT

### State Management

In-memory store (`packages/server/src/state.js`):
```typescript
interface Store {
  activeLinks: Map<string, Link>;
  jobQueue: Map<string, Job>;
  jobHistory: JobHistoryEntry[];     // Capped at 100
  editingSessions: Map<string, any>; // CEP editing heartbeats
  broadcast(type: string, payload: any): void;
  addJobHistory(entry: Omit<JobHistoryEntry, 'timestamp'>): void;
}
```

## API Reference

### System Routes (`/api`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check (`{ status, links }`) |
| GET | `/api/history` | Last 50 job history entries |
| GET | `/api/config` | Server config (exportDir, tempDir, serverPort) |
| GET | `/api/render-progress/:id` | Render progress for a link |
| GET | `/api/update-check` | Check GitHub releases for updates |
| GET | `/api/editing` | All active editing sessions (heartbeat, 12s timeout) |
| GET | `/api/perf` | Performance stats (uptime, memory, endpoint timing) |
| GET | `/api/perf/slow` | Top 10 slowest endpoints |
| GET | `/api/auth` | Auth state + token |
| POST | `/api/auth/toggle` | Enable/disable auth |
| POST | `/api/auth/regenerate` | Regenerate API token |
| POST | `/api/batch-export` | Batch export timelines |
| POST | `/api/clear` | Clear temp or exports dir |

### Links Routes (`/api/links`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/links` | All active links |
| GET | `/api/links/:id` | Single link by ID |
| PUT | `/api/links/:id/status` | Update link status |
| DELETE | `/api/links/:id` | Delete link |
| POST | `/api/links/:id/editing` | Editing heartbeat from CEP |
| GET | `/api/links/:id/editing` | Get editing status |

### Resolve Routes (`/api/resolve`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/resolve/status` | Check Resolve connection via Python bridge |
| GET | `/api/resolve/markers` | Timeline markers |
| GET | `/api/resolve/project` | Current project info |
| GET | `/api/resolve/timeline` | Current timeline info |
| GET | `/api/resolve/selection` | Selected clips (`?track=N` optional) |
| POST | `/api/resolve/clip-properties` | Clip properties |

### AE Integration Routes (`/api`)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/link-clip` | Create AE link (generates JSX + ExtendScript) |
| POST | `/api/links/:id/render` | Trigger aerender (or CEP fallback) |
| POST | `/api/links/:id/auto` | Auto-workflow: queue CEP job or launch AE |
| GET | `/api/links/:id/render-script` | Generate standalone render script |
| POST | `/api/render-active-comp` | Render active AE comp |
| POST | `/api/import-back` | Import rendered file back to Resolve |
| GET | `/api/links/:id/jsx` | Serve JSX content for CEP |

### REAPER Routes (`/api/reaper`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/reaper/status` | REAPER installation/running status |
| POST | `/api/reaper/link-clip` | Create REAPER link |
| POST | `/api/reaper/:id/reaper-auto` | Auto-workflow: launch or send script |
| GET | `/api/reaper/:id/reaper-render-script` | Generate render script |
| POST | `/api/reaper/import-to-resolve` | Import rendered audio to Resolve |

### Setup Routes (`/api/setup`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/setup` | Detect paths and return config |
| POST | `/api/setup` | Write `.env` with configuration |

### Presets Routes (`/api/presets`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/presets` | List render presets |
| POST | `/api/presets` | Create/update preset |
| DELETE | `/api/presets/:name` | Delete preset |

### Jobs Routes (`/api/jobs`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/jobs/pending` | Next pending job for CEP polling |
| PUT | `/api/jobs/:jobId/status` | Update job status (CEP callback) |

## Key Data Types

### Link
```typescript
interface Link {
  id: string;                          // UUID
  clips: Array<ClipData & { linkId: string; status: LinkClipStatus }>;
  settings: LinkSettings;              // { width, height, fps, duration, renderQueue?, sampleRate? }
  status: LinkStatus;                  // 'created' | 'linked' | 'sending' | 'queued' | 'rendering' | 'rendered' | 'imported' | 'error' | 'completed' | 'sent'
  exportPath: string;
  createdAt: string;
  updatedAt?: string;
  target?: 'ae' | 'reaper';
  jsxPath?: string;
  payloadPath?: string;
  reaperScriptPath?: string;
  renderScriptPath?: string;
}
```

### ClipData
```typescript
interface ClipData {
  name: string;
  start: number;         // Timeline position in frames
  duration: number;      // Duration in frames
  sourcePath: string;    // File path on disk
  sourceIn?: number;     // Source in-point
  sourceOut?: number;    // Source out-point
  trackIndex?: number;
  trackName?: string;
  volume?: number;       // 0-2 range
  muted?: boolean;
}
```

### Job
```typescript
interface Job {
  type: string;          // 'execute-jsx' | 'execute-reaper'
  linkId: string;
  status: string;        // 'pending' | 'dispatched' | 'sent' | 'completed' | 'error'
  createdAt: string;
  [key: string]: any;    // Additional payload data
}
```

### Constants
```javascript
DEFAULT_CONFIG = { PORT: 3030, HOST: '127.0.0.1', MAX_HISTORY: 100, EDITING_TIMEOUT_MS: 12000, RENDER_WATCH_MAX_WAIT: 300000, RENDER_WATCH_POLL_INTERVAL: 2000 }
EXPORT_EXTENSIONS = ['.mov', '.mp4', '.exr', '.png', '.tif', '.jpg', '.wav', '.flac', '.aiff', '.ogg', '.mp3']
```

## Configuration

### Server Config (`packages/server/src/config.json`)
```json
{
  "server": { "port": 3030, "host": "127.0.0.1" },
  "auth": { "enabled": false, "token": "" },
  "paths": { "vfxExportDir": "./exports", "tempDir": "./temp", "aeInstallPath": { "win32": "", "darwin": "" } },
  "watcher": { "enabled": true, "extensions": [...], "debounceMs": 1000 },
  "ae": { "renderCommand": "aerender", "projectExtension": ".aep" },
  "resolve": { "pythonPath": "python", "pollIntervalMs": 5000, "bridgeScript": "./resolve-bridge.py" },
  "reaper": { "installPath": { "win32": "C:\\Program Files\\REAPER", "darwin": "/Applications/REAPER.app/Contents/MacOS" }, "renderFormat": "wav" }
}
```

### Environment Variables (`.env`)
`PORT`, `HOST`, `EXPORT_DIR`, `TEMP_DIR`, `AE_PATH_WIN`, `AE_PATH_MAC`, `PYTHON_PATH`, `RESOLVE_SCRIPTING_PATH`, `REAPER_PATH_WIN`, `REAPER_PATH_MAC`, `WATCHER_ENABLED`, `WATCH_FOLDERS`, `LOG_LEVEL` (`debug|info|warn|error`)

## Middleware

- **`validate(schema, source='body')`** - Zod validation. Returns 400 with `{ error, details }` on failure. Replaces req[source] with parsed data.
- **`perfMiddleware`** - Records timing for all `/api/` endpoints. Normalizes routes (replaces UUIDs with `:id`). Keeps last 100 samples per endpoint.
- **`requireAuth(authState)`** - Token-based auth. GET/HEAD/OPTIONS always allowed. Constant-time token comparison via `crypto.timingSafeEqual`. Returns 401 (missing) or 403 (invalid).

## Services

- **`resolve-service.js`** - Python bridge wrapper. `executeBridge(command, args, timeout)` spawns `resolve-bridge.py` with `PYTHONPATH` set to Resolve scripting modules. Cached connection check (3s TTL).
- **`reaper-service.js`** - REAPER path/process detection. Multi-strategy: .env override, config paths, standard dirs, Windows registry, macOS/Linux standard paths. Platform-specific process detection (`tasklist`/`pgrep`).
- **`export-watcher.js`** - Chokidar file watcher. Matches new files by `Resolve_Link_{8-char-prefix}` against link IDs. Auto-imports matched files to Resolve. Broadcasts `file:new` for unmatched files.

## React Frontend

### Core Hook: `useResolveBridge.ts`
State: `{ connected, links, newFiles, resolve, selection, selectionLoading, editingLinks }`
Actions: `sendToAE()`, `deleteLink()`, `triggerRender()`, `fetchSelection()`
- Resolve status polled every 3s when WebSocket connected
- WebSocket reconnect with exponential backoff (3s initial, 30s max, 1.5x multiplier)

### Components
`Dashboard`, `SendButton`, `LinkCard`, `LinkQueue`, `JobHistory`, `SetupWizard`, `Titlebar`, `StatusIndicator`, `TimelineMarkers`, `BatchExport`, `RenderPresets`, `KeyboardShortcuts`, `UpdateNotification`

### API Client (`api.ts`)
REST client with auth header injection. WebSocket client with reconnection. All API methods return typed responses.

## Testing

Vitest config: 15s timeout, includes `test/**/*.test.{js,ts}`. Three test files:
- `test/api.test.js` - REST API integration tests
- `test/jsx-generator.test.js` - JSX payload generation unit tests
- `test/resolve-bridge.test.js` - Python bridge CLI tests

## CI Pipeline (`.github/workflows/ci.yml`)

- **build-and-test**: Ubuntu, Node 20+22 matrix, `npm ci` -> build -> `npm test` -> health check
- **lint**: Ubuntu, Node 22, `npx tsc --noEmit` (type-check only)
- Triggers: push/PR to `main` or `master`

## Key Files

- `packages/server/src/index.js` - Server entry point
- `packages/server/src/integrations/registry.js` - Integration auto-discovery
- `packages/server/src/state.js` - In-memory link/job store
- `packages/server/src/middleware/validation.js` - Zod validation middleware
- `packages/server/src/middleware/auth.js` - Token-based auth middleware
- `packages/server/src/middleware/perf.js` - Request performance tracking
- `packages/server/src/services/resolve-service.js` - Python bridge wrapper
- `packages/server/src/services/reaper-service.js` - REAPER detection/launch
- `packages/server/src/services/export-watcher.js` - Chokidar file watcher
- `packages/server/src/integrations/ae/generators.js` - JSX/ExtendScript generators
- `packages/server/src/integrations/reaper/generators.js` - Lua script generators
- `packages/shared/src/schemas.js` - Zod validation schemas
- `packages/shared/src/types.d.ts` - TypeScript type definitions
- `packages/shared/src/constants.js` - Status enums, defaults
- `packages/ui/App.tsx` - React root component
- `packages/ui/lib/useResolveBridge.ts` - Core React hook (state + actions)
- `packages/ui/lib/api.ts` - REST + WebSocket client
- `electron.js` - Electron main process
- `preload.js` - Electron preload (IPC bridge)
- `extension/host/host.jsx` - ExtendScript host functions
- `extension/client/client.js` - CEP panel job polling

## Known Issues & Planned Features

### Open Bugs
- No marker transfer to AE comp (markers endpoint exists but never applied)
- File-based IPC has no locking (partial fix only)
- No bidirectional "update link" sync
- **TOFIX.md**

### Planned Integrations (rated by doability 1-5)
Fusion (4), Nuke (3), Blender (3), Ableton Live (2), Maxon Autograph (3), Cavalry (3)

### Planned AE Features
Render progress WebSocket (3), compound clip export (3), round-trip updates (2), text layers from markers (4), blend modes (4), null objects (3)

### Planned REAPER Features
WS/named pipe IPC (3), auto-import-back (3), stem export (3), batch multi-link (3), timecode sync (3)

## Clip Data Flow (Resolve → AE Round-Trip)

### Forward Path (Resolve → AE)
1. **`resolve-scripts/send-to-ae.py`** - Runs in Resolve's Python environment
   - Collects clip metadata: `item.GetStart()`, `item.GetEnd()`, `item.GetEnd() - item.GetStart()` (duration), `item.GetLeftOffset()` (sourceIn), `item.GetRightOffset()` (sourceOut)
   - Outputs JSON payload to stdout
   - **IMPORTANT**: `item.GetDuration()` returns source media total frames, NOT trimmed timeline duration. Use `item.GetEnd() - item.GetStart()` for trimmed duration.

2. **`packages/server/src/integrations/ae/generators.js`** - Server-side JSX/ExtendScript generation
   - `generateJSXPayload(link)` - Creates JSON payload for CEP consumption
   - `generateExtendScript(link, payloadPath)` - Generates ExtendScript that creates AE comp and layers
   - Layer positioning logic: `layer.startTime = clip.start / fps`, `layer.outPoint = clip.start / fps + clip.duration / fps`

3. **`extension/host/host.jsx`** - CEP panel ExtendScript (parallel logic)
   - Receives job from polling, creates comp and layers
   - Uses `clip.duration / fps` for layer outPoint calculation

### Import Back Path (AE → Resolve)
1. **`server/resolve-bridge.py`** - `cmd_import_rendered()` function
   - Calculates `total_duration = latest_end - earliest_start`
   - Uses `AppendToTimeline()` with inclusive frame ranges: `endFrame: total_duration - 1`
   - Places rendered clip on new top tracks, disables original clips

### Resolve API Semantics
- `item.GetStart()` - Timeline position in frames (0-indexed)
- `item.GetEnd()` - End position in frames (exclusive)
- `item.GetEnd() - item.GetStart()` - Trimmed duration in frames
- `item.GetDuration()` - **BUGGY** - Returns source media total frames, not trimmed duration
- `item.GetLeftOffset()` - Source in-point (frames from start of source media)
- `AppendToTimeline()` - Uses inclusive frame ranges (`endFrame` is inclusive)

## Legacy vs Monorepo File Mapping

| Legacy Path | Active Path | Notes |
|-------------|-------------|-------|
| `server/index.js` | `packages/server/src/index.js` | Server entry point |
| `server/resolve-bridge.py` | `packages/server/src/services/resolve-service.js` | Python bridge wrapper |
| `server/routes/*.js` | `packages/server/src/routes/*.js` | API routes |
| `src/lib/useResolveBridge.ts` | `packages/ui/lib/useResolveBridge.ts` | React hook |
| `src/lib/api.ts` | `packages/ui/lib/api.ts` | REST/WebSocket client |
| `src/components/*.tsx` | `packages/ui/components/*.tsx` | React components |

**Note**: Legacy files in `server/` and `src/` are kept for compatibility but NOT used by the active dev server. Always edit files in `packages/` for changes that affect the running application.


