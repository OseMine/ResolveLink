param([switch]$NoBrowser)

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path $PSScriptRoot -Parent

if (Test-Path "$root\.server.pid") {
    $oldPid = Get-Content "$root\.server.pid"
    Stop-Process -Id $oldPid -Force 2>$null
    Start-Sleep -Milliseconds 500
}

$portUsed = Get-NetTCPConnection -LocalPort 3030 -ErrorAction SilentlyContinue
if ($portUsed) {
    foreach ($conn in $portUsed) {
        Stop-Process -Id $conn.OwningProcess -Force 2>$null
    }
    Start-Sleep -Seconds 1
}

Write-Host "Starting ResolveLink server..." -ForegroundColor Cyan

$proc = Start-Process -FilePath "node" -ArgumentList "server\index.js" `
    -WorkingDirectory $root `
    -PassThru `
    -WindowStyle Hidden

$proc.Id | Out-File -FilePath "$root\.server.pid" -NoNewline
Write-Host "Server PID: $($proc.Id)" -ForegroundColor Gray

Start-Sleep -Seconds 3

try {
    $health = Invoke-RestMethod -Uri "http://localhost:3030/api/health" -TimeoutSec 5
    Write-Host "Server running - http://localhost:3030" -ForegroundColor Green
} catch {
    Write-Host "Server may still be starting, try http://localhost:3030" -ForegroundColor Yellow
}

if (-not $NoBrowser) {
    Start-Process "http://localhost:3030"
}
