#!/bin/bash
# status.sh — Check ResolveLink component status (macOS/Linux)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "  ResolveLink Status"
echo "  =================="
echo ""

# Server
if [ -f "$ROOT/.server.pid" ] && kill -0 "$(cat "$ROOT/.server.pid")" 2>/dev/null; then
    echo "  Server:    running (PID $(cat "$ROOT/.server.pid"))"
else
    echo "  Server:    stopped"
fi

# Node modules
[ -d "$ROOT/node_modules" ] && echo "  Deps:      OK" || echo "  Deps:      missing (run setup)"

# Frontend
[ -f "$ROOT/src/dist/index.html" ] && echo "  Frontend:  OK" || echo "  Frontend:  not built (run setup)"

# Config
[ -f "$ROOT/.env" ] && echo "  Config:    OK" || echo "  Config:    missing (run setup)"

# Resolve script
if [[ "$OSTYPE" == "darwin"* ]]; then
    RESOLVE_SCRIPTS_DIR="$HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Support/Fusion/Scripts/Utility"
else
    RESOLVE_SCRIPTS_DIR="$HOME/.local/share/DaVinci Resolve/Support/Fusion/Scripts/Utility"
fi
[ -f "$RESOLVE_SCRIPTS_DIR/send-to-ae.py" ] && echo "  Resolve:   OK" || echo "  Resolve:   not deployed"

# CEP Extension (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/com.resolvelink.panel"
    [ -d "$CEP_DIR" ] && echo "  CEP Panel: OK" || echo "  CEP Panel: not deployed"
fi

echo ""
