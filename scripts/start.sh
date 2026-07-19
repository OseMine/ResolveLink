#!/bin/bash
# start.sh — Start ResolveLink server (macOS/Linux)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/.server.pid" ]; then
    kill "$(cat "$ROOT/.server.pid")" 2>/dev/null || true
    rm -f "$ROOT/.server.pid"
fi

# Kill anything on port 3030
lsof -ti:3030 | xargs kill -9 2>/dev/null || true
sleep 0.5

echo "Starting ResolveLink server..."
cd "$ROOT"
nohup node server/index.js > /dev/null 2>&1 &
echo $! > "$ROOT/.server.pid"
echo "Server PID: $(cat "$ROOT/.server.pid")"

sleep 2

if curl -sf http://localhost:3030/api/health > /dev/null 2>&1; then
    echo "Server running - http://localhost:3030"
else
    echo "Server may still be starting, try http://localhost:3030"
fi
