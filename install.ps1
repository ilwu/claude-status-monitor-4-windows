#Requires -Version 5.1
<#
.SYNOPSIS
    One-click installer for Claude Status Monitor on Windows.
.DESCRIPTION
    - Installs npm dependencies (includes better-sqlite3 for the Memory API)
    - Copies statusline script to ~/.claude/
    - Merges statusLine config into ~/.claude/settings.json
    - Creates startup shortcut for auto-launch
    - Starts the monitor
    - Verifies the Memory API (/api/health) and prints CLI setup hints
    Safe to re-run (idempotent): it stops any running monitor on port 19823,
    refreshes installed files, and starts the new build.
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitorDir = Join-Path $scriptDir "monitor"
$statuslineDir = Join-Path $scriptDir "statusline"
$binDir = Join-Path $scriptDir "bin"
$toolsDir = Join-Path $scriptDir "tools"
$claudeDir = Join-Path $env:USERPROFILE ".claude"

Write-Host ""
Write-Host "  Claude Status Monitor - Installer" -ForegroundColor Cyan
Write-Host "  ===================================" -ForegroundColor DarkGray
Write-Host ""

# ── Pre-checks ────────────────────────────────────────────────────
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

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
Write-Host "[2/6] Installing dependencies..." -ForegroundColor Yellow
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
Write-Host "[3/6] Installing statusline..." -ForegroundColor Yellow

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
Write-Host "[4/6] Creating startup shortcut..." -ForegroundColor Yellow

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
Write-Host "[5/6] Starting monitor..." -ForegroundColor Yellow

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

# ── Memory API check + mmsg CLI info ──────────────────────────────
Write-Host "[6/6] Verifying Memory API + setting up mmsg CLI..." -ForegroundColor Yellow

$memoryApiOk = $false
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:19823/api/health" -TimeoutSec 3
    if ($health.ok) {
        Write-Host "  Memory API ready. DB: $($health.db_path)" -ForegroundColor Green
        $memoryApiOk = $true
    } else {
        Write-Host "  WARNING: /api/health returned ok=false" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  WARNING: /api/health not reachable yet — try again in a few seconds." -ForegroundColor Yellow
}

$mmsgCmd = Join-Path $binDir "mmsg.cmd"
if (Test-Path $mmsgCmd) {
    Write-Host "  mmsg CLI wrapper: $mmsgCmd" -ForegroundColor Green
} else {
    Write-Host "  WARNING: bin/mmsg.cmd missing — the mmsg CLI shortcut isn't available." -ForegroundColor Yellow
}

# Phase 7 hook status check (read-only — we never mutate settings.json
# here, because safe-merging arbitrary user hook trees is fragile and
# one bad edit breaks every Claude Code session. Just show the counts
# so the user knows what's there, and print the snippet below so they
# can paste it themselves.)
$settingsGlobal = Join-Path $env:USERPROFILE ".claude\settings.json"
$hasUPS = 0
$hasStop = 0
$hasPTU = 0
$settingsReadable = $false
if (Test-Path $settingsGlobal) {
    try {
        $s = Get-Content $settingsGlobal -Raw | ConvertFrom-Json
        $settingsReadable = $true
        if ($s.hooks -and $s.hooks.UserPromptSubmit) { $hasUPS = @($s.hooks.UserPromptSubmit).Count }
        if ($s.hooks -and $s.hooks.Stop) { $hasStop = @($s.hooks.Stop).Count }
        if ($s.hooks -and $s.hooks.PostToolUse) { $hasPTU = @($s.hooks.PostToolUse).Count }
    } catch {
        Write-Host "  NOTE: ~/.claude/settings.json exists but isn't parseable as JSON." -ForegroundColor Yellow
    }
}
if ($settingsReadable) {
    Write-Host "  Phase 7 hook slots in ~/.claude/settings.json:"
    Write-Host "    UserPromptSubmit: $hasUPS entry(ies)"
    Write-Host "    Stop:             $hasStop entry(ies)"
    Write-Host "    PostToolUse:      $hasPTU entry(ies)"
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

if ($memoryApiOk) {
    Write-Host ""
    Write-Host "  Memory API + mmsg CLI:" -ForegroundColor Cyan
    Write-Host "    1. Put the wrapper on PATH, e.g.:"
    Write-Host "         setx PATH `"`$env:PATH;$binDir`"" -ForegroundColor DarkGray
    Write-Host "       Or copy $mmsgCmd into a directory already on PATH."
    Write-Host "    2. Try it:"
    Write-Host "         mmsg help"
    Write-Host "         mmsg topic-new --title=`"hello`""
    Write-Host ""
    Write-Host "  Optional UserPromptSubmit hook (reminds you to `mmsg snapshot` every 10 prompts):"
    $hookScript = Join-Path $toolsDir "session-prompt-reminder.js"
    $hookCmd = "node " + ($hookScript -replace '\\', '/')
    Write-Host "    Add the following snippet to ~/.claude/settings.local.json:"
    Write-Host ""
    Write-Host "      {" -ForegroundColor DarkGray
    Write-Host "        `"hooks`": {" -ForegroundColor DarkGray
    Write-Host "          `"UserPromptSubmit`": [" -ForegroundColor DarkGray
    Write-Host "            { `"matcher`": `"`"," -ForegroundColor DarkGray
    Write-Host "              `"hooks`": [" -ForegroundColor DarkGray
    Write-Host "                { `"type`": `"command`", `"command`": `"$hookCmd`" }" -ForegroundColor DarkGray
    Write-Host "              ] }" -ForegroundColor DarkGray
    Write-Host "          ]" -ForegroundColor DarkGray
    Write-Host "        }" -ForegroundColor DarkGray
    Write-Host "      }" -ForegroundColor DarkGray
    Write-Host "    (Not installed automatically — it's a per-project / per-user decision.)"

    Write-Host ""
    Write-Host "  Optional cross-session recording (Phase 7, required for ``mmsg recovery`` to have real content):" -ForegroundColor Cyan
    $forwardScript = Join-Path $toolsDir "hook-forward.sh"
    $forwardCmd = "bash " + ($forwardScript -replace '\\', '/')
    Write-Host "    Add all three of these hooks to ~/.claude/settings.json (alongside any existing hooks):"
    Write-Host ""
    Write-Host "      {" -ForegroundColor DarkGray
    Write-Host "        `"hooks`": {" -ForegroundColor DarkGray
    Write-Host "          `"UserPromptSubmit`": [" -ForegroundColor DarkGray
    Write-Host "            { `"matcher`": `"`"," -ForegroundColor DarkGray
    Write-Host "              `"hooks`": [{ `"type`": `"command`", `"command`": `"$forwardCmd`" }] }" -ForegroundColor DarkGray
    Write-Host "          ]," -ForegroundColor DarkGray
    Write-Host "          `"Stop`": [" -ForegroundColor DarkGray
    Write-Host "            { `"matcher`": `"`"," -ForegroundColor DarkGray
    Write-Host "              `"hooks`": [{ `"type`": `"command`", `"command`": `"$forwardCmd`" }] }" -ForegroundColor DarkGray
    Write-Host "          ]," -ForegroundColor DarkGray
    Write-Host "          `"PostToolUse`": [" -ForegroundColor DarkGray
    Write-Host "            { `"matcher`": `"Edit|Write|NotebookEdit|MultiEdit`"," -ForegroundColor DarkGray
    Write-Host "              `"hooks`": [{ `"type`": `"command`", `"command`": `"$forwardCmd`" }] }" -ForegroundColor DarkGray
    Write-Host "          ]" -ForegroundColor DarkGray
    Write-Host "        }" -ForegroundColor DarkGray
    Write-Host "      }" -ForegroundColor DarkGray
    Write-Host "    See docs/rules/multi-session-dispatch.md for when to use this (Type 1/2 topics, handoff)."
    Write-Host "    Not auto-merged — mutating a live settings.json from a script is too easy to get wrong."
}

Write-Host ""
Write-Host "  To uninstall: .\uninstall.ps1" -ForegroundColor DarkGray
Write-Host ""
