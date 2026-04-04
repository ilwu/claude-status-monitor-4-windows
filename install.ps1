#Requires -Version 5.1
<#
.SYNOPSIS
    One-click installer for Claude Status Monitor on Windows.
.DESCRIPTION
    - Installs npm dependencies
    - Copies statusline script to ~/.claude/
    - Merges statusLine config into ~/.claude/settings.json
    - Creates startup shortcut for auto-launch
    - Starts the monitor
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitorDir = Join-Path $scriptDir "monitor"
$statuslineDir = Join-Path $scriptDir "statusline"
$claudeDir = Join-Path $env:USERPROFILE ".claude"

Write-Host ""
Write-Host "  Claude Status Monitor - Installer" -ForegroundColor Cyan
Write-Host "  ===================================" -ForegroundColor DarkGray
Write-Host ""

# ── Pre-checks ────────────────────────────────────────────────────
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

# Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
$nodeVer = (node --version) -replace '^v',''
Write-Host "  Node.js $nodeVer" -ForegroundColor Green

# Git Bash
$gitBash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $gitBash) {
    $gitBash = Get-Command "C:\Program Files\Git\bin\bash.exe" -ErrorAction SilentlyContinue
}
if (-not $gitBash) {
    Write-Host "  ERROR: Git Bash not found. Install from https://git-scm.com/" -ForegroundColor Red
    exit 1
}
Write-Host "  Git Bash found" -ForegroundColor Green

# Claude Code
$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
    Write-Host "  WARNING: claude command not found (may still work if installed elsewhere)" -ForegroundColor Yellow
} else {
    Write-Host "  Claude Code found" -ForegroundColor Green
}

# Check if already running
$existing = Get-NetTCPConnection -LocalPort 19823 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 }
if ($existing) {
    Write-Host "  WARNING: Port 19823 already in use. Stopping existing monitor..." -ForegroundColor Yellow
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

# ── npm install ───────────────────────────────────────────────────
Write-Host "[2/5] Installing dependencies..." -ForegroundColor Yellow
Push-Location $monitorDir
npm install --silent 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    npm install 2>&1
    Write-Host "  ERROR: npm install failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Dependencies installed" -ForegroundColor Green

# ── Copy statusline ──────────────────────────────────────────────
Write-Host "[3/5] Installing statusline..." -ForegroundColor Yellow

if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

$statuslineSrc = Join-Path $statuslineDir "statusline.sh"
$statuslineDst = Join-Path $claudeDir "statusline.sh"

Copy-Item $statuslineSrc $statuslineDst -Force
Write-Host "  Copied statusline.sh -> $statuslineDst" -ForegroundColor Green

# Merge settings.json
$settingsFile = Join-Path $claudeDir "settings.json"
$settings = @{}
if (Test-Path $settingsFile) {
    $settings = Get-Content $settingsFile -Raw | ConvertFrom-Json
}

# Convert to hashtable for easier manipulation
$settingsHash = @{}
$settings.PSObject.Properties | ForEach-Object { $settingsHash[$_.Name] = $_.Value }

# Set statusLine (use forward slashes for bash)
$bashPath = ($statuslineDst -replace '\\', '/')
$settingsHash["statusLine"] = @{
    type = "command"
    command = "bash $bashPath"
}

$settingsHash | ConvertTo-Json -Depth 10 | Set-Content $settingsFile -Encoding UTF8
Write-Host "  Updated settings.json" -ForegroundColor Green

# ── Startup shortcut ─────────────────────────────────────────────
Write-Host "[4/5] Creating startup shortcut..." -ForegroundColor Yellow

$ws = New-Object -ComObject WScript.Shell
$startup = $ws.SpecialFolders("Startup")
$shortcutPath = Join-Path $startup "Claude Monitor.lnk"
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $monitorDir "start.vbs"
$shortcut.WorkingDirectory = $monitorDir
$shortcut.Description = "Claude Code Session Memory Monitor"
$shortcut.Save()
Write-Host "  Shortcut created at: $shortcutPath" -ForegroundColor Green

# ── Start monitor ────────────────────────────────────────────────
Write-Host "[5/5] Starting monitor..." -ForegroundColor Yellow

$vbsPath = Join-Path $monitorDir "start.vbs"
cscript //nologo $vbsPath
Start-Sleep -Seconds 3

# Verify
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:19823/status" -TimeoutSec 3
    $sessions = ($response.PSObject.Properties | Measure-Object).Count
    Write-Host "  Monitor running! Tracking $sessions session(s)" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Monitor started but API not responding yet. It may need a moment." -ForegroundColor Yellow
}

# ── Done ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  What's next:" -ForegroundColor Cyan
Write-Host "    - Look for the orange circle icon in your system tray (bottom-right)"
Write-Host "    - Right-click it to toggle statusline items or exit"
Write-Host "    - Open a Claude Code session to see the statusline"
Write-Host "    - Monitor auto-starts on boot"
Write-Host ""
Write-Host "  To uninstall: .\uninstall.ps1" -ForegroundColor DarkGray
Write-Host ""
