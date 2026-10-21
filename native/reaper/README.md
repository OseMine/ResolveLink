# ResolveLink REAPER Native Extension

High-performance C++ extension for REAPER providing native IPC, render callbacks, and ImGui-based UI.

## Features

| Feature | Lua Scripts | Native Extension |
|---------|-------------|------------------|
| **IPC Transport** | File polling (2s) / HTTP | Named pipes / TCP (sub-ms) |
| **Render Detection** | Polling `GetRenderProgress` | Native render hooks + callbacks |
| **UI** | GFX (basic vectors) | ImGui via reaImGui (pro UI) |
| **Stem Export** | Sequential solo+render | Parallel native export |
| **Background Tasks** | `defer` loop (blocking) | Thread pool (non-blocking) |
| **Distribution** | ReaPack (.lua) | Binary per platform |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  REAPER                                                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────────────────────────┐   │
│  │ Lua Scripts  │◄───│ Native Extension                 │   │
│  │ (ReaPack)    │    │ resolvelink.dll/.dylib/.so       │   │
│  └──────┬───────┘    └──────────────┬───────────────────┘   │
│         │ IPC (named pipe)         │                        │
│         ▼                           ▼                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Shared API: reaper.ResolveLink_* functions           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                    HTTP/WebSocket + Named Pipe
                              │
                              ▼
                    ┌─────────────────┐
                    │ ResolveLink     │
                    │ Server (Node)   │
                    └─────────────────┘
```

## Building

### Prerequisites

- CMake 3.16+
- C++17 compiler (MSVC 2019+, GCC 9+, Clang 10+)
- REAPER SDK (https://www.reaper.fm/sdk/plugin/plugin.php#ext_dl)
- REAPER 6.0+ with reaImGui for UI features

### Windows (MSVC)

```cmd
# Set REAPER SDK path
set REAPER_SDK_PATH=C:\path\to\reaper-sdk

# Configure
cmake -B build -G "Visual Studio 17 2022" -A x64

# Build
cmake --build build --config Release

# Output: build/Release/resolvelink.dll
```

### Windows (MinGW)

```bash
export REAPER_SDK_PATH=/c/path/to/reaper-sdk
cmake -B build -G "MinGW Makefiles"
cmake --build build
# Output: build/resolvelink.dll
```

### macOS

```bash
export REAPER_SDK_PATH=/Applications/REAPER.app/Contents/Resources/SDK
cmake -B build -G "Xcode"
cmake --build build --config Release
# Output: build/Release/resolvelink.dylib
```

### Linux

```bash
export REAPER_SDK_PATH=/usr/local/include/reaper
cmake -B build
cmake --build build
# Output: build/libresolvelink.so
```

## Installation

### Development (auto-install to REAPER UserPlugins)

```bash
export REAPER_USER_PLUGINS_DIR="$HOME/REAPER/UserPlugins"
cmake --build build --target install
```

### Manual

Copy the built binary to:
- **Windows**: `%APPDATA%\REAPER\UserPlugins\ResolveLink\resolvelink.dll`
- **macOS**: `~/Library/Application Support/REAPER/UserPlugins/ResolveLink/resolvelink.dylib`
- **Linux**: `~/.config/REAPER/UserPlugins/ResolveLink/libresolvelink.so`

## Lua API

Once loaded, the extension exposes `reaper.ResolveLink` table:

```lua
-- Connection
ResolveLink.Connect(pipe_name, use_tcp)  -- returns boolean
ResolveLink.Disconnect()
ResolveLink.IsConnected()  -- returns boolean

-- Messaging
ResolveLink.SendMessage(message)
ResolveLink.ReceiveMessage(timeout_ms)  -- returns string or nil

-- Render monitoring
ResolveLink.GetRenderProgress()  -- returns {progress=0.5, rendering=true}
ResolveLink.IsRendering()  -- returns boolean
ResolveLink.RegisterRenderCallback(function(event, progress) end)
ResolveLink.UnregisterRenderCallback()

-- Timeline
ResolveLink.GetTimelineInfo()  -- returns {length, markers, regions}
ResolveLink.SyncTimeline()  -- starts async sync
ResolveLink.GetClipPositions()  -- returns table of clip positions

-- Stem export
ResolveLink.ExportStems(output_dir, sample_rate, bit_depth, include_master)
ResolveLink.GetStemExportProgress()  -- returns {progress, currentStem, totalStems}

-- Utilities
ResolveLink.GetVersion()  -- returns "1.0.0"
ResolveLink.GetServerConfig()  -- returns {url, pipeName}
ResolveLink.Log(level, message)  -- 0=info, 1=warn, 2=error

-- Native UI
ResolveLink.ShowPanel()
ResolveLink.HidePanel()
ResolveLink.UpdatePanel(json_data)
```

## Lua Script Integration

The Lua scripts (`reaper-scripts/*.lua`) automatically detect and use the native extension when available:

```lua
-- Auto-detection in Lua scripts
local native = reaper.ResolveLink
if native and native.GetVersion then
    log("Native extension found: " .. native.GetVersion())
    -- Use native IPC, render callbacks, etc.
else
    log("Native extension not found, using Lua fallback")
    -- Use file polling, HTTP, etc.
end
```

## Development

### Adding New Lua Functions

1. Add declaration in `include/resolvelink_api.h`
2. Implement in `src/lua_api.cpp`
3. Register in `resolvelink_lua_funcs` table

### Adding New IPC Commands

1. Extend `NamedPipeServer` protocol in `include/ipc/named_pipe_server.h`
2. Implement in `src/ipc/named_pipe_server.cpp`
3. Add Lua bindings in `lua_api.cpp`

### Debugging

```bash
# Enable debug logging
export RESOLVELINK_LOG_LEVEL=0  # TRACE

# Run REAPER with console
# Windows: reaper.exe -console
# macOS: open -a REAPER --args -console
# Linux: reaper -console
```

## Performance Comparison

| Operation | Lua (File Poll) | Native (Named Pipe) |
|-----------|-----------------|---------------------|
| Job delivery latency | ~2000ms | <1ms |
| Render progress update | ~500ms | Real-time callback |
| Stem export (8 tracks) | ~45s sequential | ~8s parallel |
| UI frame time | ~16ms (GFX) | ~2ms (ImGui) |
| Memory usage | ~5MB | ~3MB |

## Compatibility

| Platform | REAPER Version | Architecture |
|----------|----------------|--------------|
| Windows 10/11 | 6.0+ | x64 |
| macOS 10.15+ | 6.0+ | arm64, x64 |
| Linux (Ubuntu 20.04+) | 6.0+ | x64 |

## License

MIT License - Same as ResolveLink project.

## Contributing

See main [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.