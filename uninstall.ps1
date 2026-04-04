#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstaller for Claude Status Monitor.
#>

$ErrorActionPreference = "Stop"
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$configDir = Join-Path $env:USERPROFILE ".claude-monitor"

Write-Host ""
Write-Host "  Claude Status Monitor - Uninstaller" -ForegroundColor Cyan
Write-Host "  =====================================" -ForegroundColor DarkGray
Write-Host ""

# ── Stop monitor ─────────────────────────────────────────────────
Write-Host "[1/4] Stopping monitor..." -ForegroundColor Yellow
$port = Get-NetTCPConnection -LocalPort 19823 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 }
if ($port) {
    $port | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Write-Host "  Monitor stopped" -ForegroundColor Green
} else {
    Write-Host "  Monitor not running" -ForegroundColor DarkGray
}

# ── Remove startup shortcut ──────────────────────────────────────
Write-Host "[2/4] Removing startup shortcut..." -ForegroundColor Yellow
$ws = New-Object -ComObject WScript.Shell
$startup = $ws.SpecialFolders("Startup")
$shortcutPath = Join-Path $startup "Claude Monitor.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "  Shortcut removed" -ForegroundColor Green
} else {
    Write-Host "  No shortcut found" -ForegroundColor DarkGray
}

# ── Remove statusline config ────────────────────────────────────
Write-Host "[3/4] Removing statusline config..." -ForegroundColor Yellow

$statuslineFile = Join-Path $claudeDir "statusline.sh"
if (Test-Path $statuslineFile) {
    Remove-Item $statuslineFile -Force
    Write-Host "  Removed statusline.sh" -ForegroundColor Green
}

$settingsFile = Join-Path $claudeDir "settings.json"
if (Test-Path $settingsFile) {
    $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json
    if ($settings.statusLine) {
        $settings.PSObject.Properties.Remove("statusLine")
        $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsFile -Encoding UTF8
        Write-Host "  Removed statusLine from settings.json" -ForegroundColor Green
    }
}

# ── Remove config dir ────────────────────────────────────────────
Write-Host "[4/4] Removing config..." -ForegroundColor Yellow
if (Test-Path $configDir) {
    Remove-Item $configDir -Recurse -Force
    Write-Host "  Removed $configDir" -ForegroundColor Green
} else {
    Write-Host "  No config dir found" -ForegroundColor DarkGray
}

# Clean up temp caches
Remove-Item "/tmp/claude-sl-*" -Force -ErrorAction SilentlyContinue 2>$null

Write-Host ""
Write-Host "  Uninstall complete!" -ForegroundColor Green
Write-Host "  Note: The project files remain in this directory. Delete manually if no longer needed." -ForegroundColor DarkGray
Write-Host ""
