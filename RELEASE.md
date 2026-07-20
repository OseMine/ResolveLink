# ResolveLink v1.0.0

**Dynamic Link for DaVinci Resolve — to After Effects and REAPER**

ResolveLink bridges DaVinci Resolve with After Effects and REAPER, enabling a full round-trip VFX and audio workflow without leaving your NLE.

---

## Features

### DaVinci Resolve → After Effects
- Send selected clips or entire timelines to After Effects with a single click
- Auto-generates `.jsx` import scripts — no manual file management
- Reverse lookup: render from AE and automatically import back into Resolve

### DaVinci Resolve → REAPER
- Send video to REAPER as reference (full timeline or selected clips)
- Background callback worker auto-imports rendered audio back into Resolve
- "Update Project" syncs REAPER items to match Resolve timeline changes (position, length, track)
- File-based IPC — no network dependency between REAPER scripts

### REAPER Panel
- Unified GFX UI panel combining all REAPER functions:
  - **Callback toggle** — turn background worker ON/OFF
  - **Send to Resolve** — render and import audio to DaVinci
  - **Update Project** — sync REAPER to match DaVinci timeline
  - Live status display and scrollable log

### Server
- Express.js API running locally on port 3030
- Health endpoint, polling cache, project management
- Configurable polling intervals

### Electron UI
- Desktop control panel for server management
- Project browser and workflow status

---

## Installation

### DaVinci Resolve (Recommended)

1. Download `install.lua` from this release
2. Open DaVinci Resolve
3. Go to **Workspace > Console** (or press Alt+F9)
4. Paste the contents of `install.lua` and press Enter

The installer will:
- Check for Git and Node.js (install if possible)
- Clone the repository to the correct location for your OS
- Run the full setup (dependencies, build, extensions, .env)
- Deploy Resolve scripts and CEP extension
- Start the server

### REAPER (ReaPack)

Add this URL in ReaPack > Edit repositories:
```
https://raw.githubusercontent.com/OseMine/ResolveLink/feature/reaper-integration/index.xml
```

Available scripts:
- **ResolveLink Callback** — background worker for auto-import
- **ResolveLink Send to Resolve** — render and import to DaVinci
- **ResolveLink Update Project** — sync REAPER to DaVinci timeline
- **ResolveLink Panel** — unified control panel (all-in-one)

---

## Requirements

- [Git](https://git-scm.com)
- [Node.js](https://nodejs.org) 18+
- [DaVinci Resolve Studio](https://www.blackmagicdesign.com/products/davinciresolve/) 18+ (free version does not support scripting)
- [REAPER](https://www.reaper.fm/) 6+ (for audio workflow)
- [SWS Extension](https://www.sws-extension.org/) (recommended for REAPER)

---

## Install Locations

| OS      | Path                                      |
|---------|-------------------------------------------|
| Windows | `%LOCALAPPDATA%\ResolveLink`              |
| macOS   | `~/Applications/ResolveLink`              |
| Linux   | `~/.local/share/ResolveLink`              |

---

## Links

- **GitHub**: https://github.com/OseMine/ResolveLink
- **Issues**: https://github.com/OseMine/ResolveLink/issues
- **License**: MIT
