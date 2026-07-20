#!/usr/bin/env pwsh
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
#   Windows:  $env:LOCALAPPDATA\ResolveLink
#   macOS:    ~/Applications/ResolveLink
#   Linux:    ~/.local/share/ResolveLink
# ============================================================

param(
    [string]$ReleaseTag = "__RELEASE_TAG__"
)

$ErrorActionPreference = "Stop"

$REPO_URL    = "https://github.com/OseMine/ResolveLink.git"
$REPO_OWNER  = "OseMine"
$REPO_NAME   = "ResolveLink"

# ── Logging ──────────────────────────────────────────────────
function Log($msg)     { Write-Host "[ResolveLink] $msg" }
function Log-Ok($msg)  { Log $msg }
function Log-Warn($msg) { Log "WARN: $msg" }
function Log-Err($msg)  { Log "ERROR: $msg" }
function Log-Step($msg) { Log ">>> $msg" }

# ── OS Detection ─────────────────────────────────────────────
Log-Step "Detected OS: Windows"

# ── Install directory ────────────────────────────────────────
$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) {
    $localAppData = Join-Path $env:USERPROFILE "AppData\Local"
}
$installDir = Join-Path $localAppData "ResolveLink"
Log "Install directory: $installDir"

# ── Helpers ──────────────────────────────────────────────────
function Run-Cmd($cmd) {
    try {
        $output = Invoke-Expression "$cmd 2>&1" | Out-String
        return $output.Trim()
    } catch {
        return $null
    }
}

function File-Exists($path) {
    return Test-Path -Path $path -PathType Leaf
}

function Dir-Exists($path) {
    return Test-Path -Path $path -PathType Container
}

function Rm-Rf($path) {
    if (Dir-Exists $path) {
        Remove-Item -Recurse -Force -Path $path -ErrorAction SilentlyContinue
    } elseif (File-Exists $path) {
        Remove-Item -Force -Path $path -ErrorAction SilentlyContinue
    }
}

# ============================================================
# Step 1: Check and install Git
# ============================================================
Log-Step "Checking Git..."
$gitVersion = Run-Cmd "git --version"
$hasGit = $gitVersion -match "git version"

if (-not $hasGit) {
    Log-Warn "Git not found."
    Log-Err "Please install Git manually: https://git-scm.com/download/win"
    Log-Err "Then re-run this script."
    exit 1
}
Log-Ok "Git found: $gitVersion"

# ============================================================
# Step 2: Check and install Node.js
# ============================================================
Log-Step "Checking Node.js..."
$nodeVersion = Run-Cmd "node --version"
$hasNode = $nodeVersion -match "^v\d"

if (-not $hasNode) {
    Log-Warn "Node.js not found."
    Log-Err "Please install Node.js manually: https://nodejs.org"
    Log-Err "Then re-run this script."
    exit 1
}
Log-Ok "Node.js found: $nodeVersion"

# ============================================================
# Step 3: Check npm
# ============================================================
Log-Step "Checking npm..."
$npmVersion = Run-Cmd "npm --version"
$hasNpm = $npmVersion -match "^\d"
if (-not $hasNpm) {
    Log-Err "npm not found. Please reinstall Node.js from https://nodejs.org"
    exit 1
}
Log-Ok "npm found: $npmVersion"

# ============================================================
# Step 4: Download source code
# ============================================================
$isRelease = ($ReleaseTag -ne "__RELEASE_TAG__") -and ($ReleaseTag -ne "") -and ($null -ne $ReleaseTag)

if ($isRelease) {
    Log-Step "Installing ResolveLink $ReleaseTag (release)..."

    $tmpDir    = if ($env:TEMP) { $env:TEMP } elseif ($env:TMP) { $env:TMP } else { "C:\Temp" }
    $zipPath   = Join-Path $tmpDir "resolvelink.zip"
    $extractDir = Join-Path $tmpDir "resolvelink-extract"

    Rm-Rf $zipPath
    Rm-Rf $extractDir

    $zipUrl = "https://github.com/$REPO_OWNER/$REPO_NAME/archive/refs/tags/$ReleaseTag.zip"
    Log "Downloading $zipUrl"

    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    } catch {
        Log-Err "Download failed. Check your internet connection."
        Log-Err "URL: $zipUrl"
        exit 1
    }

    if (-not (File-Exists $zipPath)) {
        Log-Err "Download failed - file not created."
        exit 1
    }
    Log-Ok "Downloaded $ReleaseTag.zip"

    Log "Extracting..."
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    $innerDir = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    if (-not $innerDir) {
        Log-Err "Could not find extracted directory"
        Rm-Rf $zipPath
        Rm-Rf $extractDir
        exit 1
    }
    $srcDir = $innerDir.FullName

    if (Dir-Exists $installDir) {
        Log "Removing previous installation..."
        Rm-Rf $installDir
    }

    Move-Item -Path $srcDir -Destination $installDir

    Rm-Rf $zipPath
    Rm-Rf $extractDir

    if (-not (Dir-Exists $installDir)) {
        Log-Err "Installation failed - directory not created"
        exit 1
    }
    Log-Ok "Source code installed to $installDir"

} else {
    Log-Step "Installing ResolveLink (from repository)..."

    if (Dir-Exists (Join-Path $installDir ".git")) {
        Log-Step "ResolveLink already installed. Updating..."
        Push-Location $installDir
        git pull
        Pop-Location
    } else {
        Log-Step "Cloning ResolveLink to $installDir..."
        if (Dir-Exists $installDir) {
            Log-Warn "Directory exists but is not a git repo. Removing..."
            Rm-Rf $installDir
        }
        git clone $REPO_URL $installDir

        if (-not (Dir-Exists (Join-Path $installDir ".git"))) {
            Log-Err "Clone failed. Check your internet connection."
            exit 1
        }
    }
    Log-Ok "Repository ready at $installDir"
}

# ============================================================
# Step 5: Run platform-specific setup
# ============================================================
Log-Step "Running setup (this may take a minute)..."
$setupScript = Join-Path $installDir "scripts\setup.ps1"
powershell -ExecutionPolicy Bypass -File $setupScript -NoBrowser -Force

# ============================================================
# Step 6: Deploy Resolve script
# ============================================================
Log-Step "Deploying Resolve script..."
$appData = $env:APPDATA
$resolveScriptsDir = Join-Path $appData "Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility"
New-Item -ItemType Directory -Force -Path $resolveScriptsDir | Out-Null

$scriptsToDeploy = @(
    @{ Src = "send-to-ae.py";    Dst = "send-to-ae.py" },
    @{ Src = "send-to-reaper.py"; Dst = "send-to-reaper.py" },
    @{ Src = "ResolveLink.lua";  Dst = "ResolveLink.lua" }
)

foreach ($item in $scriptsToDeploy) {
    $srcScript = Join-Path $installDir "resolve-scripts\$($item.Src)"
    $dstScript = Join-Path $resolveScriptsDir $item.Dst
    if (File-Exists $srcScript) {
        Copy-Item -Path $srcScript -Destination $dstScript -Force
        Log-Ok "Deployed -> $dstScript"
    } else {
        Log-Warn "$($item.Src) not found at $srcScript"
    }
}

# ============================================================
# Step 7: Deploy CEP extension (AE side)
# ============================================================
Log-Step "Deploying AE CEP extension..."
$cepDir = Join-Path $appData "Adobe\CEP\extensions\com.resolvelink.panel"
New-Item -ItemType Directory -Force -Path $cepDir | Out-Null

$cefSubdirs = @("client", "CSXS", "host")
foreach ($sub in $cefSubdirs) {
    $srcSub = Join-Path $installDir "extension\$sub"
    $dstSub = Join-Path $cepDir $sub
    if (Dir-Exists $srcSub) {
        Copy-Item -Path $srcSub -Destination $dstSub -Recurse -Force
    }
}

# Enable CEP debug mode
try {
    $regPath = "HKCU:\Software\Adobe\CSXS.11"
    if (-not (Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }
    Set-ItemProperty -Path $regPath -Name "PlayerDebugMode" -Value "1" -Type String
} catch {
    Log-Warn "Could not set CEP debug mode in registry (non-critical)"
}
Log-Ok "CEP extension deployed"

# ============================================================
# Step 8: Start server
# ============================================================
Log-Step "Starting ResolveLink server..."
Push-Location $installDir
Start-Process -FilePath "node" -ArgumentList "server\index.js" -WindowStyle Hidden
Pop-Location

Start-Sleep -Seconds 3

$healthOk = $false
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3030/api/health" -UseBasicParsing -TimeoutSec 5
    $healthOk = ($response.StatusCode -eq 200)
} catch {
    $healthOk = $false
}

# ============================================================
# Done
# ============================================================
$versionStr = if ($isRelease) { " ($ReleaseTag)" } else { "" }
Write-Host ""
Write-Host "========================================"
Write-Host "  ResolveLink installed successfully!$versionStr"
Write-Host "========================================"
Write-Host ""
Write-Host "  Server:  http://localhost:3030"
Write-Host "  Install: $installDir"
if ($isRelease) {
    Write-Host "  Version: $ReleaseTag"
}
Write-Host ""
Write-Host "  Usage in Resolve:"
Write-Host "    Workspace > Scripts > send-to-ae.py"
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    Start:   $installDir\scripts\start.ps1"
Write-Host "    Stop:    $installDir\scripts\stop.ps1"
Write-Host "    Status:  $installDir\scripts\status.ps1"
Write-Host "    Update:  $installDir\scripts\setup.ps1"
Write-Host ""
