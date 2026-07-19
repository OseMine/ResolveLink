$root = Split-Path $PSScriptRoot -Parent

Write-Host "ResolveLink Status" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Cyan

# Server
$portUsed = Get-NetTCPConnection -LocalPort 3030 -ErrorAction SilentlyContinue
if ($portUsed) {
    Write-Host "`n  Server:  " -NoNewline; Write-Host "RUNNING" -ForegroundColor Green -NoNewline; Write-Host " (port 3030)"
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:3030/api/health" -TimeoutSec 3
        Write-Host "  Links:  $($health.links)"
    } catch {
        Write-Host "  Links:  (unreachable)"
    }
} else {
    Write-Host "`n  Server:  " -NoNewline; Write-Host "STOPPED" -ForegroundColor Red
}

# Resolve
try {
    $resolve = Invoke-RestMethod -Uri "http://localhost:3030/api/resolve/status" -TimeoutSec 3
    if ($resolve.connected) {
        Write-Host "  Resolve: " -NoNewline; Write-Host "CONNECTED" -ForegroundColor Green -NoNewline; Write-Host " (v$($resolve.version -join '.'))"
    } else {
        Write-Host "  Resolve: " -NoNewline; Write-Host "DISCONNECTED" -ForegroundColor Red
    }
} catch {
    Write-Host "  Resolve: " -NoNewline; Write-Host "UNKNOWN" -ForegroundColor Yellow
}

# CEP Extension
$cepDir = "C:\Users\$env:USERNAME\AppData\Roaming\Adobe\CEP\extensions\com.resolvelink.panel"
if (Test-Path "$cepDir\CSXS\manifest.xml") {
    Write-Host "  CEP:     " -NoNewline; Write-Host "INSTALLED" -ForegroundColor Green
} else {
    Write-Host "  CEP:     " -NoNewline; Write-Host "NOT INSTALLED" -ForegroundColor Red -NoNewline; Write-Host " (run .\scripts\setup.ps1)"
}

# AE
$aeProc = Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue
if ($aeProc) {
    Write-Host "  AE:      " -NoNewline; Write-Host "RUNNING" -ForegroundColor Green
} else {
    Write-Host "  AE:      " -NoNewline; Write-Host "NOT RUNNING" -ForegroundColor Yellow
}

Write-Host ""
