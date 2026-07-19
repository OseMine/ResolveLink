param([switch]$Quiet)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$src = "$root\resolve-scripts\send-to-ae.py"
$dstDir = "$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility"
$dst = "$dstDir\send-to-ae.py"

if (-not (Test-Path $src)) {
    Write-Host "Source not found: $src" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Copy-Item $src $dst -Force

Write-Host "Resolve script deployed -> $dst" -ForegroundColor Green
if (-not $Quiet) {
    Write-Host "In Resolve: Workspace > Scripts > send-to-ae.py" -ForegroundColor Yellow
    Write-Host "Press Ctrl+Shift+R in the Scripts menu to refresh without restarting." -ForegroundColor Yellow
}
