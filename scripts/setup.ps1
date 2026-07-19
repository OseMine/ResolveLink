# setup.ps1 — Unified installer/updater for ResolveLink
# Detects if already installed and runs appropriate action.
param(
    [switch]$Force,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

# --- Detect install state ---
$installed = Test-Path "$root\.server.pid" -ErrorAction SilentlyContinue
$hasEnv = Test-Path "$root\.env" -ErrorAction SilentlyContinue
$hasNodeModules = Test-Path "$root\node_modules" -ErrorAction SilentlyContinue
$hasFrontend = Test-Path "$root\src\node_modules" -ErrorAction SilentlyContinue
$hasDist = Test-Path "$root\src\dist\index.html" -ErrorAction SilentlyContinue

if ($installed -and -not $Force) {
    Write-Host "ResolveLink is already installed." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Detected:" -ForegroundColor Yellow
    if ($hasEnv)        { Write-Host "    .env config      OK" -ForegroundColor Green }
    if ($hasNodeModules) { Write-Host "    node_modules     OK" -ForegroundColor Green }
    if ($hasFrontend)   { Write-Host "    frontend deps    OK" -ForegroundColor Green }
    if ($hasDist)       { Write-Host "    frontend build   OK" -ForegroundColor Green }
    Write-Host ""
    Write-Host "  Choose an action:" -ForegroundColor Yellow
    Write-Host "    [U] Update  — reinstall deps, rebuild, redeploy, restart" -ForegroundColor DarkGray
    Write-Host "    [C] Clear   — clear exports and/or temp directories" -ForegroundColor DarkGray
    Write-Host "    [R] Restart — restart the server" -ForegroundColor DarkGray
    Write-Host "    [S] Status  — check all components" -ForegroundColor DarkGray
    Write-Host "    [F] Force   — full reinstall from scratch" -ForegroundColor DarkGray
    Write-Host "    [Q] Quit" -ForegroundColor DarkGray
    Write-Host ""

    $choice = Read-Host "  Action"
    switch ($choice.ToUpper()) {
        "U" { & "$PSScriptRoot\setup.ps1" -Force; return }
        "C" { & "$PSScriptRoot\clear.ps1"; return }
        "R" { & "$PSScriptRoot\start.ps1"; return }
        "S" { & "$PSScriptRoot\status.ps1"; return }
        "F" { Write-Host "`n  Proceeding with full install..." -ForegroundColor Yellow }
        default { return }
    }
}

Write-Host ""
Write-Host "ResolveLink Setup" -ForegroundColor Cyan
Write-Host "================" -ForegroundColor Cyan

# --- Step 1: Install server dependencies ---
Write-Host "`n[1/7] Installing server dependencies..." -ForegroundColor Yellow
Push-Location "$root"
npm install
Pop-Location

# --- Step 2: Install + build frontend ---
Write-Host "`n[2/7] Building frontend..." -ForegroundColor Yellow
Push-Location "$root\src"
npm install
npm run build
Pop-Location

# --- Step 3: Deploy CEP extension ---
Write-Host "`n[3/7] Deploying AE extension..." -ForegroundColor Yellow
& "$PSScriptRoot\deploy-extension.ps1" -Quiet

# --- Step 4: Deploy Resolve script ---
Write-Host "`n[4/7] Deploying Resolve script..." -ForegroundColor Yellow
& "$PSScriptRoot\deploy-resolve-script.ps1" -Quiet

# --- Step 5: Ensure directories ---
New-Item -ItemType Directory -Force -Path "$root\exports" | Out-Null
New-Item -ItemType Directory -Force -Path "$root\temp" | Out-Null

# --- Step 6: Configure .env ---
if (-not $hasEnv -or $Force) {
    Write-Host "`n[5/7] Configuring paths..." -ForegroundColor Yellow
    Write-Host ""

    # Detect Python
    $pythonPath = ""
    foreach ($cmd in @("python", "python3", "py -3")) {
        try {
            $base = $cmd.Split(' ')[0]
            $ver = & cmd /c "$base --version 2>&1"
            if ($ver -match "Python 3\.(\d+)") {
                $minor = [int]$Matches[1]
                if ($minor -ge 10) {
                    $pythonPath = & cmd /c "where $base 2>nul" | Select-Object -First 1
                    Write-Host "  Found Python: $pythonPath ($ver)" -ForegroundColor Green
                    break
                }
            }
        } catch {}
    }

    # Detect AE — find all versions with valid AfterFX.exe
    $aePath = ""
    $aeChoices = @()
    if (Test-Path "C:\Program Files\Adobe") {
        $aeDirs = Get-ChildItem "C:\Program Files\Adobe" -Directory |
            Where-Object { $_.Name -like "Adobe After Effects*" } |
            Sort-Object Name
        foreach ($dir in $aeDirs) {
            $supportFiles = Join-Path $dir.FullName "Support Files"
            $exePath = Join-Path $supportFiles "AfterFX.exe"
            if (Test-Path $exePath) {
                $aeChoices += @{ Name = $dir.Name; Path = $supportFiles }
            }
        }
    }

    if ($aeChoices.Count -eq 1) {
        $aePath = $aeChoices[0].Path
        Write-Host "  Found After Effects: $($aeChoices[0].Name)" -ForegroundColor Green
    } elseif ($aeChoices.Count -gt 1) {
        Write-Host "  Multiple After Effects versions found:" -ForegroundColor Yellow
        for ($i = 0; $i -lt $aeChoices.Count; $i++) {
            Write-Host "    [$($i + 1)] $($aeChoices[$i].Name)" -ForegroundColor DarkGray
        }
        Write-Host "    [0] Skip — I'll set it manually" -ForegroundColor DarkGray
        Write-Host ""
        $aeChoice = Read-Host "  Select version [1]"
        if (-not $aeChoice) { $aeChoice = "1" }
        $aeIdx = [int]$aeChoice - 1
        if ($aeIdx -ge 0 -and $aeIdx -lt $aeChoices.Count) {
            $aePath = $aeChoices[$aeIdx].Path
            Write-Host "  Selected: $($aeChoices[$aeIdx].Name)" -ForegroundColor Green
        }
    } else {
        Write-Host "  No After Effects found in C:\Program Files\Adobe" -ForegroundColor DarkGray
    }

    Write-Host ""
    $port = Read-Host "  Server port [3030]"
    if (-not $port) { $port = "3030" }

    $exportDir = Read-Host "  Export directory [./exports]"
    if (-not $exportDir) { $exportDir = "./exports" }

    $extraWatch = Read-Host "  Extra watch folders (comma-separated, or empty)"

    $envLines = @(
        "# ResolveLink Configuration (auto-generated by setup.ps1)"
        "PORT=$port"
        "HOST=127.0.0.1"
        "EXPORT_DIR=$exportDir"
        "TEMP_DIR=./temp"
        ""
    )
    if ($pythonPath) { $envLines += "PYTHON_PATH=$pythonPath" }
    if ($aePath)     { $envLines += "AE_PATH_WIN=$aePath" }
    if ($extraWatch) { $envLines += "WATCH_FOLDERS=$extraWatch" }
    $envLines += ""

    Set-Content -Path "$root\.env" -Value ($envLines -join "`n")
    Write-Host "`n  .env created!" -ForegroundColor Green
} else {
    Write-Host "`n[5/7] .env exists, skipping." -ForegroundColor DarkGray
}

# --- Step 7: Start server ---
Write-Host "`n[6/7] Starting server..." -ForegroundColor Yellow
& "$PSScriptRoot\start.ps1" -NoBrowser

# --- Done ---
Write-Host "`n[7/7] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  ResolveLink is running at http://localhost:3030" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Commands:" -ForegroundColor DarkGray
Write-Host "    .\scripts\setup.ps1         — Reinstall / update" -ForegroundColor DarkGray
Write-Host "    .\scripts\start.ps1         — Start server" -ForegroundColor DarkGray
Write-Host "    .\scripts\stop.ps1          — Stop server" -ForegroundColor DarkGray
Write-Host "    .\scripts\status.ps1        — Check component status" -ForegroundColor DarkGray
Write-Host "    .\scripts\clear.ps1         — Clear exports/temp" -ForegroundColor DarkGray
Write-Host "    .\scripts\deploy-*          — Deploy extensions only" -ForegroundColor DarkGray

if (-not $NoBrowser) {
    Start-Process "http://localhost:3030"
}
