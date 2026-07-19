#!/bin/bash
# stop.sh — Stop ResolveLink server (macOS/Linux)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/.server.pid" ]; then
    kill "$(cat "$ROOT/.server.pid")" 2>/dev/null || true
    rm -f "$ROOT/.server.pid"
    echo "Server stopped."
else
    echo "No server PID found. Killing by port..."
    lsof -ti:3030 | xargs kill -9 2>/dev/null || true
    echo "Done."
fi
