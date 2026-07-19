#!/bin/bash
# install.sh — One-liner installer for ResolveLink (macOS/Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/OseMine/ResolveLink/main/scripts/install.sh | bash

set -e

REPO="https://github.com/OseMine/ResolveLink.git"

# Unified install directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    INSTALL_DIR="$HOME/Applications/ResolveLink"
else
    INSTALL_DIR="$HOME/.local/share/ResolveLink"
fi

echo ""
echo "  ResolveLink Installer"
echo "  ===================="
echo ""

# --- Check Git ---
if ! command -v git &> /dev/null; then
    echo "  [X] Git is not installed."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "      Install with: xcode-select --install"
    elif command -v apt &> /dev/null; then
        echo "      Install with: sudo apt install git"
    elif command -v dnf &> /dev/null; then
        echo "      Install with: sudo dnf install git"
    elif command -v pacman &> /dev/null; then
        echo "      Install with: sudo pacman -S git"
    fi
    exit 1
fi
echo "  [OK] Git $(git --version | awk '{print $3}')"

# --- Check Node.js ---
if ! command -v node &> /dev/null; then
    echo "  [X] Node.js is not installed."
    echo "      Download: https://nodejs.org"
    echo "      Or use nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    exit 1
fi
echo "  [OK] Node.js $(node --version)"

# --- Check npm ---
if ! command -v npm &> /dev/null; then
    echo "  [X] npm is not installed."
    exit 1
fi
echo "  [OK] npm $(npm --version)"

echo ""

# --- Clone or update ---
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  ResolveLink found at $INSTALL_DIR"
    read -rp "  Update to latest? [Y/n] " update
    if [[ "$update" == "n" || "$update" == "N" ]]; then
        echo "  Running setup..."
        bash "$INSTALL_DIR/scripts/setup.sh"
        exit 0
    fi
    echo "  Pulling latest changes..."
    cd "$INSTALL_DIR"
    git pull
else
    if [ -d "$INSTALL_DIR" ]; then
        echo "  Directory $INSTALL_DIR exists but is not a git repo."
        read -rp "  Remove and clone fresh? [y/N] " overwrite
        if [[ "$overwrite" != "y" && "$overwrite" != "Y" ]]; then
            echo "  Aborted."
            exit 1
        fi
        rm -rf "$INSTALL_DIR"
    fi
    echo "  Cloning ResolveLink..."
    git clone "$REPO" "$INSTALL_DIR"
fi

echo ""

# --- Run setup ---
bash "$INSTALL_DIR/scripts/setup.sh"
