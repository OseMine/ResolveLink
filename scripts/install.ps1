# install.ps1 — One-liner installer for ResolveLink (Windows)
# Usage: iex (iwr -UseBasicParsing "https://raw.githubusercontent.com/OseMine/ResolveLink/main/scripts/install.ps1").Content

$ErrorActionPreference = "Stop"
$repo = "https://github.com/OseMine/ResolveLink.git"
$installDir = "$env:LOCALAPPDATA\ResolveLink"

Write-Host ""
Write-Host "  ResolveLink Installer" -ForegroundColor Cyan
Write-Host "  ====================" -ForegroundColor Cyan
Write-Host ""

# --- Check Git ---
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [X] Git is not installed." -ForegroundColor Red
    Write-Host "      Download: https://git-scm.com/download/win" -ForegroundColor DarkGray
    exit 1
}
Write-Host "  [OK] Git $(git --version.Split(' ')[2])" -ForegroundColor Green

# --- Check Node.js ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [X] Node.js is not installed." -ForegroundColor Red
    Write-Host "      Download: https://nodejs.org" -ForegroundColor DarkGray
    exit 1
}
Write-Host "  [OK] Node.js $(node --version)" -ForegroundColor Green

# --- Check npm ---
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "  [X] npm is not installed." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] npm $(npm --version)" -ForegroundColor Green

Write-Host ""

# --- Clone or update ---
if (Test-Path "$installDir\.git") {
    Write-Host "  ResolveLink found at $installDir" -ForegroundColor Yellow
    $update = Read-Host "  Update to latest? [Y/n]"
    if ($update -eq "n" -or $update -eq "N") {
        Write-Host "  Running setup..." -ForegroundColor DarkGray
        & "$installDir\scripts\setup.ps1"
        exit 0
    }
    Write-Host "  Pulling latest changes..." -ForegroundColor Yellow
    Push-Location $installDir
    git pull
    Pop-Location
} else {
    if (Test-Path $installDir) {
        Write-Host "  Directory $installDir exists but is not a git repo." -ForegroundColor Red
        $overwrite = Read-Host "  Remove and clone fresh? [y/N]"
        if ($overwrite -ne "y" -and $overwrite -ne "Y") {
            Write-Host "  Aborted." -ForegroundColor Red
            exit 1
        }
        Remove-Item -Recurse -Force $installDir
    }
    Write-Host "  Cloning ResolveLink..." -ForegroundColor Yellow
    git clone $repo $installDir
}

Write-Host ""

# --- Run setup ---
& "$installDir\scripts\setup.ps1"
