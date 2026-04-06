# Claude Status Monitor for Windows

## Project Overview

Windows system tray app + statusline script for per-session memory monitoring of Claude Code.
Core value: **show `Claude 812M/1.5G (session/total)` so users know which session to close.**

## Architecture

Two components work together:

### 1. Monitor (`monitor/app.js`) — Node.js background service
- **System tray icon** via `systray2` (Go binary + JSON stdin/stdout protocol)
- **HTTP API** on `localhost:19823`
- **Background collector** every 5s: `wmic` for claude.exe memory + system memory
- **Window width detection**: PowerShell script walks parent process chain from claude.exe → terminal host (WindowsTerminal.exe), uses Win32 `GetWindowRect` to estimate columns
- **Config persistence**: `~/.claude-monitor/config.json` — which statusline items to display
- **Item registry**: `ITEMS` array in app.js — add new items here, tray menu auto-updates

### 2. Statusline (`statusline/statusline.sh`) — Bash script
- Runs after each Claude Code assistant reply (Claude Code pipes JSON to stdin)
- **500ms timeout** — must complete within this or nothing displays
- Uses `/dev/tcp` for HTTP calls (~46ms) — `curl` is too slow on Windows (~650ms spawn overhead)
- **Two-level cache**: PID cache (`/tmp/claude-sl-{sid}.pid`) + memory cache (`/tmp/claude-sl-{sid}.mem`)
- **Dynamic assembly**: reads `display` array from API, only renders enabled items
- **Auto-wrap**: uses `cols` from API to wrap lines when terminal is narrow
- **ANSI colors**: green (<50%), yellow (50-75%), red (>75%) for percentage-based items

## Why This Architecture (Windows-Specific Constraints)

Claude Code statusline has a **500ms timeout**. On Windows:
- `wmic` call: ~150-300ms each
- `curl` spawn: ~650ms (process creation overhead)
- `cat` via pipe: ~230ms
- `bash` startup + pipe: ~250ms

Doing memory queries directly in the statusline script would take 1-2s → timeout.
Solution: monitor does heavy work in background, statusline does fast API read.

**On macOS/Linux this architecture is unnecessary** — process queries are fast enough for inline execution.

## Key Files

```
monitor/
  app.js          — Main: tray + API + collector + config + window width detection
  start.vbs       — Hidden launcher (no console window, just tray icon)
  package.json    — Dependency: systray2

statusline/
  statusline.sh   — Dynamic statusline with auto-wrap and ANSI colors

install.ps1       — One-click installer (npm install, copy statusline, merge settings.json, startup shortcut)
uninstall.ps1     — Reverses all install actions
```

## API Endpoints

- `GET /status` — All sessions: `{ "1700": { mem, updatedAt }, ... }`
- `GET /status/:pid` — Single session + summary: `{ mem, claude_total, system_pct, cols, display }`
- `GET /config` — Item registry + current config + active display list

## Adding a New Display Item

1. **monitor/app.js** — Add to `ITEMS` array:
   ```js
   { id: 'my_item', label: 'My Item', default: false },
   ```
   Tray menu auto-generates checkbox. Config auto-persists.

2. **statusline/statusline.sh** — Add parsing + rendering:
   ```bash
   # Parse (near top, with other regex)
   [[ "$input" =~ \"my_field\":([0-9]+) ]] && my_val="${BASH_REMATCH[1]}"

   # Render (in the item assembly section, before session_id)
   if has my_item; then
     add_item "${CYN}${my_val}${R}" "${my_val}"
   fi
   ```

3. Done. No other files need changes.

## Current Display Items (10)

| ID | Label | Default | Source |
|----|-------|---------|--------|
| sys_mem | System Memory | on | Monitor (wmic OS) |
| claude_mem | Claude Memory | on | Monitor (wmic process) |
| ctx | Context Window | on | Statusline JSON `context_window.used_percentage` |
| week | Weekly Usage | on | Statusline JSON `rate_limits.seven_day.used_percentage` |
| session_id | Session ID | on | Statusline JSON `session_id` |
| path | Project Path | on | Statusline JSON `workspace.project_dir` |
| model | Model Name | off | Statusline JSON `model.display_name` |
| cost | Session Cost | off | Statusline JSON `cost.total_cost_usd` |
| lines | Lines +/- | off | Statusline JSON `cost.total_lines_added/removed` |
| duration | Session Duration | off | Statusline JSON `cost.total_duration_ms` |

Items sourced from "Monitor" require the tray app running. Items sourced from "Statusline JSON" are parsed directly from Claude Code's input.

## Available Fields in Statusline JSON (Not Yet Used)

```
rate_limits.five_hour.used_percentage  — 5-hour API usage %
rate_limits.five_hour.resets_at        — 5h reset timestamp
rate_limits.seven_day.resets_at        — 7d reset timestamp
version                                — Claude Code version (e.g. 2.1.88)
cost.total_api_duration_ms             — API processing time
context_window.context_window_size     — Total context size (1M)
workspace.cwd                          — Current working directory (vs project_dir)
```

## Performance Budget

Statusline must complete in <500ms. Typical timing:
- First call (no PID cache): ~300ms (parent chain walk via wmic)
- Subsequent calls (cached): ~60ms (/dev/tcp + bash overhead)
- `/dev/tcp` to localhost: ~46ms
- `tput cols` in pipe context: returns 80 (unreliable) — use API `cols` field instead

## Config Locations

- `~/.claude-monitor/config.json` — Display item toggles
- `~/.claude-monitor/get-cols.ps1` — Auto-generated PowerShell script for window width detection
- `~/.claude/settings.json` — Claude Code statusline command (set by install.ps1)
- `~/.claude/statusline.sh` — Copied by install.ps1
- `/tmp/claude-sl-{session_id}.pid` — Cached PID per session
- `/tmp/claude-sl-{session_id}.mem` — Cached memory value per session

## Conventions

- Pure bash in statusline — no external commands except `wmic` (first-time PID discovery only)
- Process spawning is expensive on Windows (~50-150ms each) — minimize in statusline
- ANSI color codes for terminal output — verified working in Claude Code statusline
- systray2 `onClick` matches items by reference identity (`action.item === exitItem`)
- systray2 `update-item` for dynamic content, not `update-menu` (avoids stale internalIdMap)
