param([switch]$Quiet)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dstDir = "$env:APPDATA\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility"

$scripts = @(
    @{ Src = "$root\resolve-scripts\send-to-ae.py";      Dst = "$dstDir\send-to-ae.py" },
    @{ Src = "$root\resolve-scripts\send-to-reaper.py";   Dst = "$dstDir\send-to-reaper.py" },
    @{ Src = "$root\resolve-scripts\ResolveLink.lua";     Dst = "$dstDir\ResolveLink.lua" }
)

New-Item -ItemType Directory -Force -Path $dstDir | Out-Null

foreach ($s in $scripts) {
    if (-not (Test-Path $s.Src)) {
        Write-Host "Source not found: $($s.Src)" -ForegroundColor Red
        exit 1
    }
    Copy-Item $s.Src $s.Dst -Force
    Write-Host "Deployed -> $($s.Dst)" -ForegroundColor Green
}

if (-not $Quiet) {
    Write-Host "In Resolve: Workspace > Scripts > ResolveLink" -ForegroundColor Yellow
    Write-Host "Press Ctrl+Shift+R in the Scripts menu to refresh without restarting." -ForegroundColor Yellow
}
