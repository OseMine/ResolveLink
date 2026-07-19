param(
    [Parameter(Position=0)]
    [ValidateSet("exports", "temp", "all")]
    [string]$Target = "all"
)

$root = Split-Path $PSScriptRoot -Parent

Write-Host "ResolveLink - Clear" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Cyan

function Clear-Dir($dir, $label) {
    if (-not (Test-Path $dir)) {
        Write-Host "  $label — directory does not exist, nothing to clear." -ForegroundColor DarkGray
        return
    }
    $items = Get-ChildItem $dir -Recurse -File
    $count = $items.Count
    $size = ($items | Measure-Object -Property Length -Sum).Sum

    if ($count -eq 0) {
        Write-Host "  $label — already empty." -ForegroundColor DarkGray
        return
    }

    $sizeMB = [math]::Round($size / 1MB, 1)
    Write-Host "  $label — $count file(s), ${sizeMB} MB" -ForegroundColor Yellow
    $confirm = Read-Host "  Delete all files in $label? (y/N)"
    if ($confirm -eq "y" -or $confirm -eq "Y") {
        Remove-Item "$dir\*" -Recurse -Force
        Write-Host "  $label cleared." -ForegroundColor Green
    } else {
        Write-Host "  Skipped." -ForegroundColor DarkGray
    }
}

switch ($Target) {
    "exports" { Clear-Dir "$root\exports" "Exports" }
    "temp"    { Clear-Dir "$root\temp" "Temp" }
    "all"     {
        Clear-Dir "$root\exports" "Exports"
        Clear-Dir "$root\temp" "Temp"
    }
}

Write-Host "`nDone." -ForegroundColor Green
