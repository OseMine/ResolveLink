$root = Split-Path $PSScriptRoot -Parent
$stopped = $false

if (Test-Path "$root\.server.pid") {
    $serverPid = Get-Content "$root\.server.pid"
    Stop-Process -Id $serverPid -Force 2>$null
    if ($?) { $stopped = $true }
    Remove-Item "$root\.server.pid" -Force 2>$null
}

$portUsed = Get-NetTCPConnection -LocalPort 3030 -ErrorAction SilentlyContinue
if ($portUsed) {
    foreach ($conn in $portUsed) {
        Stop-Process -Id $conn.OwningProcess -Force 2>$null
        $stopped = $true
    }
}

if ($stopped) {
    Write-Host "Server stopped." -ForegroundColor Green
} else {
    Write-Host "Server was not running." -ForegroundColor Gray
}
