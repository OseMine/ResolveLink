#!/usr/bin/env bash
# ============================================================
# ResolveLink Installer for DaVinci Resolve
# ============================================================
# What it does:
#   1. Detects your OS and checks for Git + Node.js
#   2. Downloads the correct release version (or clones from repo)
#   3. Runs the full setup (deps, build, extensions, .env)
#   4. Deploys scripts and starts the server
#
# Install locations:
#   macOS:   ~/Applications/ResolveLink
#   Linux:   ~/.local/share/ResolveLink
# ============================================================

set -euo pipefail

RELEASE_TAG="${RELEASE_TAG:-__RELEASE_TAG__}"
REPO_URL="https://github.com/OseMine/ResolveLink.git"
REPO_OWNER="OseMine"
REPO_NAME="ResolveLink"

# ── Logging ──────────────────────────────────────────────────
log()     { echo "[ResolveLink] $1"; }
log_ok()  { log "$1"; }
log_warn(){ log "WARN: $1"; }
log_err() { log "ERROR: $1"; }
log_step(){ log ">>> $1"; }

# ── OS Detection ─────────────────────────────────────────────
OS_NAME="unknown"
OS_FLAG="unknown"

UNAME_S="$(uname -s 2>/dev/null || true)"
case "$UNAME_S" in
    Darwin)
        OS_NAME="macOS"
        OS_FLAG="darwin"
        ;;
    Linux)
        OS_NAME="Linux"
        OS_FLAG="linux"
        ;;
    *)
        log_err "Unsupported OS: $UNAME_S"
        exit 1
        ;;
esac

log_step "Detected OS: $OS_NAME"

# ── Install directory ────────────────────────────────────────
if [ "$OS_FLAG" = "darwin" ]; then
    INSTALL_DIR="${HOME}/Applications/ResolveLink"
else
    INSTALL_DIR="${HOME}/.local/share/ResolveLink"
fi

log "Install directory: $INSTALL_DIR"

# ── Helpers ──────────────────────────────────────────────────
run() {
    eval "$1" 2>&1 || true
}

file_exists() {
    [ -f "$1" ]
}

dir_exists() {
    [ -d "$1" ]
}

rm_rf() {
    rm -rf "$1" 2>/dev/null || true
}

# ============================================================
# Step 1: Check and install Git
# ============================================================
log_step "Checking Git..."
HAS_GIT=false
if command -v git >/dev/null 2>&1 && git --version 2>/dev/null | grep -q "git version"; then
    HAS_GIT=true
fi

if [ "$HAS_GIT" = false ]; then
    log_warn "Git not found. Attempting install..."
    if [ "$OS_FLAG" = "darwin" ]; then
        xcode-select --install 2>/dev/null || true
        log_warn "A macOS dialog may have appeared. Accept it, then re-run this script."
        exit 1
    else
        INSTALLED=false
        for PKG_MGR in apt dnf pacman zypper; do
            if command -v "$PKG_MGR" >/dev/null 2>&1; then
                case "$PKG_MGR" in
                    apt)
                        sudo apt update && sudo apt install -y git
                        ;;
                    dnf)
                        sudo dnf install -y git
                        ;;
                    pacman)
                        sudo pacman -S --noconfirm git
                        ;;
                    zypper)
                        sudo zypper install -y git
                        ;;
                esac
                if command -v git >/dev/null 2>&1 && git --version 2>/dev/null | grep -q "git version"; then
                    INSTALLED=true
                fi
                break
            fi
        done
        if [ "$INSTALLED" = false ]; then
            log_err "Could not install Git automatically."
            log_err "Install manually and re-run this script."
            exit 1
        fi
    fi
fi
log_ok "Git found: $(git --version)"

# ============================================================
# Step 2: Check and install Node.js
# ============================================================
log_step "Checking Node.js..."
HAS_NODE=false
if command -v node >/dev/null 2>&1 && node --version 2>/dev/null | grep -qE "^v[0-9]"; then
    HAS_NODE=true
fi

if [ "$HAS_NODE" = false ]; then
    log_warn "Node.js not found. Attempting install..."
    if [ "$OS_FLAG" = "darwin" ]; then
        if command -v brew >/dev/null 2>&1; then
            brew install node
        else
            log_err "Install Node.js manually: https://nodejs.org"
            log_err "Or install Homebrew first: https://brew.sh"
            exit 1
        fi
    else
        INSTALLED=false
        if [ -f "${HOME}/.nvm/nvm.sh" ] || command -v nvm >/dev/null 2>&1; then
            bash -c "source ~/.nvm/nvm.sh && nvm install --lts"
            if command -v node >/dev/null 2>&1 && node --version 2>/dev/null | grep -qE "^v[0-9]"; then
                INSTALLED=true
            fi
        elif command -v apt >/dev/null 2>&1; then
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt install -y nodejs
            if command -v node >/dev/null 2>&1 && node --version 2>/dev/null | grep -qE "^v[0-9]"; then
                INSTALLED=true
            fi
        fi
        if [ "$INSTALLED" = false ]; then
            log_err "Could not install Node.js automatically."
            log_err "Install manually: https://nodejs.org"
            exit 1
        fi
    fi
fi
log_ok "Node.js found: $(node --version)"

# ============================================================
# Step 3: Check npm
# ============================================================
log_step "Checking npm..."
HAS_NPM=false
if command -v npm >/dev/null 2>&1 && npm --version 2>/dev/null | grep -qE "^[0-9]"; then
    HAS_NPM=true
fi
if [ "$HAS_NPM" = false ]; then
    log_err "npm not found. Please reinstall Node.js from https://nodejs.org"
    exit 1
fi
log_ok "npm found: $(npm --version)"

# ============================================================
# Step 4: Download source code
# ============================================================
IS_RELEASE=false
if [ "$RELEASE_TAG" != "__RELEASE_TAG__" ] && [ -n "$RELEASE_TAG" ]; then
    IS_RELEASE=true
fi

if [ "$IS_RELEASE" = true ]; then
    log_step "Installing ResolveLink $RELEASE_TAG (release)..."

    TMP_DIR="/tmp"
    ZIP_PATH="$TMP_DIR/resolvelink.zip"
    EXTRACT_DIR="$TMP_DIR/resolvelink-extract"

    rm_rf "$ZIP_PATH"
    rm_rf "$EXTRACT_DIR"

    ZIP_URL="https://github.com/$REPO_OWNER/$REPO_NAME/archive/refs/tags/$RELEASE_TAG.zip"
    log "Downloading $ZIP_URL"

    if ! curl -fSL -o "$ZIP_PATH" "$ZIP_URL"; then
        log_err "Download failed. Check your internet connection."
        log_err "URL: $ZIP_URL"
        exit 1
    fi
    log_ok "Downloaded $RELEASE_TAG.zip"

    log "Extracting..."
    mkdir -p "$EXTRACT_DIR"
    unzip -q "$ZIP_PATH" -d "$EXTRACT_DIR"

    INNER_DIR="$(ls -1 "$EXTRACT_DIR" | head -n1)"
    if [ -z "$INNER_DIR" ]; then
        log_err "Could not find extracted directory"
        rm_rf "$ZIP_PATH"
        rm_rf "$EXTRACT_DIR"
        exit 1
    fi

    SRC_DIR="$EXTRACT_DIR/$INNER_DIR"

    if dir_exists "$INSTALL_DIR"; then
        log "Removing previous installation..."
        rm_rf "$INSTALL_DIR"
    fi

    mv "$SRC_DIR" "$INSTALL_DIR"

    rm_rf "$ZIP_PATH"
    rm_rf "$EXTRACT_DIR"

    if ! dir_exists "$INSTALL_DIR"; then
        log_err "Installation failed - directory not created"
        exit 1
    fi
    log_ok "Source code installed to $INSTALL_DIR"

else
    log_step "Installing ResolveLink (from repository)..."

    if dir_exists "$INSTALL_DIR/.git"; then
        log_step "ResolveLink already installed. Updating..."
        cd "$INSTALL_DIR"
        git pull
        cd - >/dev/null
    else
        log_step "Cloning ResolveLink to $INSTALL_DIR..."
        if dir_exists "$INSTALL_DIR"; then
            log_warn "Directory exists but is not a git repo. Removing..."
            rm_rf "$INSTALL_DIR"
        fi
        nohup git clone "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 &

        WAIT=0
        while ! dir_exists "$INSTALL_DIR/.git" && [ "$WAIT" -lt 60 ]; do
            sleep 1
            WAIT=$((WAIT + 1))
            if [ $((WAIT % 5)) -eq 0 ]; then
                log "  Waiting for clone... (${WAIT}s)"
            fi
        done

        if ! dir_exists "$INSTALL_DIR/.git"; then
            log_err "Clone failed after ${WAIT}s. Check your internet connection."
            exit 1
        fi
    fi
    log_ok "Repository ready at $INSTALL_DIR"
fi

# ============================================================
# Step 5: Run platform-specific setup
# ============================================================
log_step "Running setup (this may take a minute)..."
bash "$INSTALL_DIR/scripts/setup.sh" --force

# ============================================================
# Step 6: Deploy Resolve script
# ============================================================
log_step "Deploying Resolve script..."
if [ "$OS_FLAG" = "darwin" ]; then
    RESOLVE_SCRIPTS_DIR="${HOME}/Library/Application Support/Blackmagic Design/DaVinci Resolve/Support/Fusion/Scripts/Utility"
else
    RESOLVE_SCRIPTS_DIR="${HOME}/.local/share/DaVinci Resolve/Support/Fusion/Scripts/Utility"
fi

mkdir -p "$RESOLVE_SCRIPTS_DIR"

SCRIPTS_TO_DEPLOY=(
    "send-to-ae.py:send-to-ae.py"
    "send-to-reaper.py:send-to-reaper.py"
    "ResolveLink.lua:ResolveLink.lua"
)

for ENTRY in "${SCRIPTS_TO_DEPLOY[@]}"; do
    SRC_NAME="${ENTRY%%:*}"
    DST_NAME="${ENTRY##*:}"
    SRC_SCRIPT="$INSTALL_DIR/resolve-scripts/$SRC_NAME"
    DST_SCRIPT="$RESOLVE_SCRIPTS_DIR/$DST_NAME"
    if file_exists "$SRC_SCRIPT"; then
        cp "$SRC_SCRIPT" "$DST_SCRIPT"
        log_ok "Deployed -> $DST_SCRIPT"
    else
        log_warn "$SRC_NAME not found at $SRC_SCRIPT"
    fi
done

# ============================================================
# Step 7: Deploy CEP extension (AE side) - macOS only
# ============================================================
if [ "$OS_FLAG" = "darwin" ]; then
    log_step "Deploying AE CEP extension..."
    CEP_DIR="${HOME}/Library/Application Support/Adobe/CEP/extensions/com.resolvelink.panel"
    mkdir -p "$CEP_DIR"

    for SUB in client CSXS host; do
        SRC_SUB="$INSTALL_DIR/extension/$SUB"
        DST_SUB="$CEP_DIR/$SUB"
        if dir_exists "$SRC_SUB"; then
            cp -R "$SRC_SUB" "$DST_SUB"
        fi
    done

    defaults write com.adobe.CSXS.11 PlayerDebugMode 1
    log_ok "CEP extension deployed"
fi

# ============================================================
# Step 8: Start server
# ============================================================
log_step "Starting ResolveLink server..."
cd "$INSTALL_DIR"
nohup node server/index.js >/dev/null 2>&1 &
cd - >/dev/null

sleep 3

HEALTH_OK=false
if curl -sf http://localhost:3030/api/health >/dev/null 2>&1; then
    HEALTH_OK=true
fi

# ============================================================
# Done
# ============================================================
VERSION_STR=""
if [ "$IS_RELEASE" = true ]; then
    VERSION_STR=" ($RELEASE_TAG)"
fi

echo ""
echo "========================================"
echo "  ResolveLink installed successfully!${VERSION_STR}"
echo "========================================"
echo ""
echo "  Server:  http://localhost:3030"
echo "  Install: $INSTALL_DIR"
if [ "$IS_RELEASE" = true ]; then
    echo "  Version: $RELEASE_TAG"
fi
echo ""
echo "  Usage in Resolve:"
echo "    Workspace > Scripts > send-to-ae.py"
echo ""
echo "  Useful commands:"
echo "    Start:   $INSTALL_DIR/scripts/start.sh"
echo "    Stop:    $INSTALL_DIR/scripts/stop.sh"
echo "    Status:  $INSTALL_DIR/scripts/status.sh"
echo "    Update:  $INSTALL_DIR/scripts/setup.sh"
echo ""
