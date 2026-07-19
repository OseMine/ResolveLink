$root = Split-Path $PSScriptRoot -Parent
Write-Host "Restarting ResolveLink..." -ForegroundColor Cyan
& "$PSScriptRoot\stop.ps1"
Start-Sleep -Seconds 1
& "$PSScriptRoot\start.ps1" -NoBrowser
Write-Host "Restarted. Refresh http://localhost:3030" -ForegroundColor Green
