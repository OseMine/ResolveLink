<p align="center">
  <img src="assets/icon.svg" width="100" alt="ResolveLink Logo" />
</p>

<h1 align="center">ResolveLink</h1>

<p align="center">
  <strong>Dynamic Link equivalent for DaVinci Resolve to After Effects</strong>
</p>

<p align="center">
  A native DaVinci Resolve Workflow Integration Plugin that bridges DaVinci Resolve and Adobe After Effects, providing a Dynamic Link-like workflow for VFX and motion graphics.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/Resolve-Studio%2021+-orange" alt="DaVinci Resolve" />
  <a href="https://github.com/OseMine/ResolveLink/actions"><img src="https://github.com/OseMine/ResolveLink/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

---

## Screenshots

<p align="center">
  <img src="assets/Resolve Plugin.png" width="800" alt="ResolveLink in DaVinci Resolve" />
</p>

<p align="center">
  <img src="assets/AE Plugin.png" width="800" alt="ResolveLink CEP Extension in After Effects" />
</p>

---

## The Problem

DaVinci Resolve lacks Adobe's Dynamic Link. When VFX work needs to happen in After Effects, editors must manually export clips, open AE, create compositions, import footage, match timecodes, render, and re-import back. This breaks creative flow and wastes hours.

## The Solution

ResolveLink automates the entire round-trip. Select clips in Resolve, click one button, and a synchronized After Effects composition is created instantly. When AE work is rendered, the result automatically syncs back to the Resolve timeline as a compound clip.

```
 ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
 │  DaVinci Resolve  │ ───> │  ResolveLink       │ ───> │  After Effects   │
 │                   │      │  Bridge Server    │      │                  │
 │  Select Clips     │      │  - REST API       │      │  CEP Extension   │
 │  Click "Send"     │      │  - File Watcher   │      │  Auto Comp       │
 │  Auto Re-import   │ <─── │  - WebSocket      │ <─── │  Render & Export │
 └──────────────────┘      └──────────────────┘      └──────────────────┘
```

## Features

- **One-Click Send** — Select clips in the Resolve timeline, send directly to After Effects
- **Auto Composition** — Creates perfectly synchronized AE compositions with correct resolution, framerate, and timecodes
- **Auto Workflow** — If AE is running, jobs are queued for the CEP extension; if not, AE is launched with the script automatically
- **File Watcher** — Monitors render output folders and syncs completed renders back to Resolve automatically
- **Compound Clip Import** — Rendered output is automatically imported back into Resolve as a compound clip (V2 render over V1 originals)
- **Real-time Status** — Live status indicators via WebSocket
- **Desktop Notifications** — Get notified when renders complete or fail
- **Job History** — Track all link creation, render, and import events with real-time updates
- **Setup Wizard** — Auto-detect Python and AE paths, first-run configuration
- **Render Presets** — Save and recall AE render settings
- **Timeline Markers** — View Resolve timeline markers in the plugin panel
- **Batch Export** — Send multiple timelines to AE at once
- **Keyboard Shortcuts** — Ctrl+Shift+R (refresh), Ctrl+Enter (send), Ctrl+T (tools)
- **Structured Logging** — Leveled, tagged, timestamped logs
- **Dark UI** — Matches DaVinci Resolve's professional dark theme exactly
- **CEP Extension** — Panel inside After Effects that polls for jobs, executes scripts, and handles rendering
- **Resolve Launcher** — Lua UI in DaVinci (Workspace > Scripts > ResolveLink) for server control, status, updates
- **Multi-Folder Watch** — Monitor multiple directories for rendered files

---

## Quick Start

### Install via DaVinci Resolve Console

1. Open DaVinci Resolve
2. Go to **Workspace > Console**
3. Switch to **Lua** tab
4. Paste the contents of [`install.lua`](install.lua) and press Enter

That's it. The script will:
- Detect your OS and check for Git + Node.js
- Install missing prerequisites automatically
- Clone ResolveLink to the standard app directory
- Build everything and deploy extensions
- Start the server

### Install Locations

| OS      | Path                                        |
|---------|---------------------------------------------|
| Windows | `%LOCALAPPDATA%\ResolveLink`                |
| macOS   | `~/Applications/ResolveLink`                |
| Linux   | `~/.local/share/ResolveLink`                |

### Alternative: Command Line Install

<details>
<summary>Windows (PowerShell)</summary>

```powershell
iex (iwr -UseBasicParsing "https://raw.githubusercontent.com/OseMine/ResolveLink/main/scripts/install.ps1").Content
```
</details>

<details>
<summary>macOS / Linux (Terminal)</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/OseMine/ResolveLink/main/scripts/install.sh | bash
```
</details>

<details>
<summary>Manual Setup</summary>

```bash
# Clone to standard app directory
git clone https://github.com/OseMine/ResolveLink.git ~/.local/share/ResolveLink  # Linux
git clone https://github.com/OseMine/ResolveLink.git ~/Applications/ResolveLink  # macOS
git clone https://github.com/OseMine/ResolveLink.git "$env:LOCALAPPDATA\ResolveLink"  # Windows

# Run setup (Windows: .\scripts\setup.ps1, macOS/Linux: bash scripts/setup.sh)
```
</details>

---

## Scripts

All management scripts live in `scripts/`:

| Script | Description |
|--------|-------------|
| **Setup** | |
| `setup.ps1` | Windows unified installer — detects state, offers update/clear/reinstall |
| `setup.sh` | macOS/Linux unified installer |
| **Server** | |
| `start.ps1` / `start.sh` | Start the server as a background process |
| `stop.ps1` / `stop.sh` | Stop the running server |
| `restart.ps1` | Stop then start the server (Windows) |
| `status.ps1` / `status.sh` | Check server, Resolve, CEP extension, and AE status |
| `clear.ps1` | Clear exports and/or temp directories |
| **Deploy** | |
| `deploy-extension.ps1` | Deploy the CEP extension to After Effects |
| `deploy-resolve-script.ps1` | Deploy the Resolve utility script |

See [`install.lua`](install.lua) in the root directory for the recommended one-step install.

```powershell
# First install (Windows)
.\scripts\setup.ps1

# First install (macOS/Linux)
bash scripts/setup.sh

# After an update (git pull)
.\scripts\setup.ps1          # detects existing install, offers update
.\scripts\setup.ps1 -Force   # skip detection, full reinstall

# Quick commands
.\scripts\start.ps1
.\scripts\stop.ps1
.\scripts\status.ps1
.\scripts\clear.ps1 exports
.\scripts\clear.ps1 temp
.\scripts\clear.ps1 all
```

---

## Configuration

On first run, the setup wizard auto-detects Python and After Effects paths and generates a `.env` file. You can re-run it anytime:

```powershell
.\scripts\setup.ps1 -Force
```

All configuration is driven by `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3030` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `EXPORT_DIR` | `./exports` | Where renders are saved |
| `TEMP_DIR` | `./temp` | Generated scripts location |
| `PYTHON_PATH` | `python` | Python executable |
| `AE_PATH_WIN` | *(auto-detected)* | After Effects install path |
| `AE_PATH_MAC` | *(auto-detected)* | After Effects install path |
| `RESOLVE_SCRIPTING_PATH` | *(auto-detected)* | Resolve scripting modules |
| `WATCHER_ENABLED` | `true` | Enable file watcher |
| `WATCH_FOLDERS` | *(none)* | Extra folders to watch (comma-separated) |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |

See `.env.example` for all options.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend UI** | React 18, TypeScript, Tailwind CSS, Lucide Icons |
| **Desktop Shell** | Electron 28 |
| **Backend Server** | Node.js, Express, Chokidar, WebSocket (ws), dotenv |
| **Resolve Bridge** | Python (DaVinciResolveScript API), Node.js child_process wrapper |
| **Adobe Automation** | CEP Extension (HTML/JS panel), ExtendScript (.jsx) |
| **Testing** | Vitest (unit + integration) |

## Project Structure

```
resolve-link/
├── install.lua                 # One-step installer (paste into Resolve Console)
├── scripts/                     # All management scripts
│   ├── install.ps1              # One-liner installer (Windows, via iex)
│   ├── install.sh               # One-liner installer (macOS/Linux, via curl)
│   ├── setup.ps1                # Unified installer/updater (Windows)
│   ├── setup.sh                 # Unified installer/updater (macOS/Linux)
│   ├── start.ps1 / start.sh     # Start server (background)
│   ├── stop.ps1 / stop.sh       # Stop server
│   ├── restart.ps1              # Restart server (Windows)
│   ├── status.ps1 / status.sh   # Check component status
│   ├── clear.ps1                # Clear exports/temp
│   ├── deploy-extension.ps1     # Deploy CEP extension
│   └── deploy-resolve-script.ps1 # Deploy Resolve script
│
├── server/                      # Backend
│   ├── index.js                 # Express + WebSocket + Chokidar + Job queue
│   ├── config.json              # Default config
│   ├── logger.js                # Structured logging
│   ├── resolve-service.js       # Node.js wrapper for Python bridge
│   └── resolve-bridge.py        # Python DaVinci Resolve scripting bridge
│
├── src/                         # Frontend (React + Vite + TypeScript)
│   ├── components/
│   │   ├── Titlebar.tsx         # Custom frameless window titlebar
│   │   ├── Dashboard.tsx        # Link count & connection status
│   │   ├── SendButton.tsx       # Primary "Send to AE" action
│   │   ├── LinkCard.tsx         # Individual link display
│   │   ├── LinkQueue.tsx        # Scrollable list of active links
│   │   ├── JobHistory.tsx       # Real-time job history
│   │   ├── SetupWizard.tsx      # First-run configuration wizard
│   │   ├── UpdateNotification.tsx # Auto-update checker
│   │   ├── TimelineMarkers.tsx  # Resolve timeline markers
│   │   ├── BatchExport.tsx      # Multi-timeline export
│   │   ├── RenderPresets.tsx    # AE render preset management
│   │   └── KeyboardShortcuts.tsx # Keyboard shortcut system
│   ├── lib/
│   │   ├── api.ts               # REST + WebSocket client + types
│   │   ├── useResolveBridge.ts  # React hook for bridge state
│   │   └── utils.ts             # Utility functions
│   ├── App.tsx                  # Root component
│   ├── main.tsx                 # Entry point
│   ├── index.css                # Tailwind + custom styles
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── package.json
│
├── extension/                   # CEP Extension (inside After Effects)
│   ├── CSXS/manifest.xml
│   ├── client/                  # Panel UI (HTML/JS/CSS)
│   │   ├── index.html
│   │   ├── client.js            # Job polling, render, import
│   │   ├── style.css
│   │   └── CSInterface.js
│   └── host/host.jsx            # ExtendScript host functions
│
├── resolve-scripts/             # DaVinci Resolve scripts
│   ├── ResolveLink.lua           # Main launcher (Workspace > Scripts)
│   └── send-to-ae.py            # Clip send dialog (tkinter)
│
├── adobe/                       # ExtendScript library
│   └── import_pipeline.jsx      # Standalone AE composition importer
│
├── test/                        # Test suite
│   ├── jsx-generator.test.js    # JSX payload generation
│   ├── resolve-bridge.test.js   # Python bridge CLI
│   └── api.test.js              # API integration tests
│
├── docs/                        # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── SETUP.md
│   └── WORKFLOW.md
│
├── assets/
│   ├── icon.svg                 # App logo
│   ├── Resolve Plugin.png      # DaVinci Resolve panel screenshot
│   └── AE Plugin.png           # After Effects CEP extension screenshot
│
├── .github/workflows/
│   └── ci.yml                   # CI: build, test, type-check
│
├── exports/                     # Render output (watched)
├── temp/                        # Generated .jsx + .json
├── render-presets.json          # Saved render presets
├── vitest.config.js             # Test config
├── electron.js                  # Electron main process
├── preload.js                   # Electron preload
├── .env.example                 # Configuration template
├── .gitignore
├── LICENSE
├── package.json
└── README.md
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, component interaction |
| [API Reference](docs/API.md) | REST endpoints, WebSocket protocol, data types |
| [Setup Guide](docs/SETUP.md) | Installation, configuration, troubleshooting |
| [Workflow Guide](docs/WORKFLOW.md) | Step-by-step user workflow |

---

## Development

### Prerequisites

- Node.js 18+
- Python 3.10+ (for Resolve scripting bridge)
- DaVinci Resolve Studio 21+ (for scripting API)
- Adobe After Effects 2022+ (for CEP)

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server + Vite dev server concurrently |
| `npm run server` | Start only the backend server |
| `npm run ui` | Start only the Vite dev server |
| `npm run build` | Build the frontend for production |
| `npm start` | Start the Electron app |
| `npm test` | Run all tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |

---

## How It Works

1. **Selection** — Editor selects clips in the Resolve timeline
2. **Send** — Clicks "Send Selection to After Effects"
3. **Translate** — Plugin reads clip metadata via the Python scripting bridge
4. **Generate** — Server creates `.jsx` + `.json`, queues job for CEP extension
5. **Execute** — CEP extension inside AE picks up the job, creates synchronized composition
6. **Edit** — VFX artist works in After Effects
7. **Render** — Artist renders (via CEP panel, plugin, or manually)
8. **Detect** — File watcher detects the new render in exports/
9. **Import** — Render is automatically imported back into Resolve as a compound clip
10. **Sync** — UI shows updated link status via WebSocket

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+R` | Refresh selection from Resolve |
| `Ctrl+Enter` | Send selected clips to AE |
| `Ctrl+T` | Toggle tools panel |
| `Ctrl+,` | Open setup wizard |

---

## License

MIT

---

<p align="center">
  Built for editors who refuse to break their creative flow.
</p>
