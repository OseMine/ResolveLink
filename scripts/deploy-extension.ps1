param([switch]$Quiet)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$cepDir = "$env:APPDATA\Adobe\CEP\extensions\com.resolvelink.panel"
$srcDir = "$root\extension"

if (-not (Test-Path $srcDir)) {
    Write-Host "Extension source not found: $srcDir" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $cepDir | Out-Null
Copy-Item -Recurse -Force "$srcDir\client" "$cepDir\client"
Copy-Item -Recurse -Force "$srcDir\CSXS"  "$cepDir\CSXS"
Copy-Item -Recurse -Force "$srcDir\host"  "$cepDir\host"
foreach ($v in 9..12) {
    reg add "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f 2>$null | Out-Null
}

$count = (Get-ChildItem $cepDir -Recurse -File).Count
Write-Host "AE extension deployed ($count files) -> $cepDir" -ForegroundColor Green
if (-not $Quiet) {
    Write-Host "Close and reopen the panel in After Effects to apply." -ForegroundColor Yellow
}
