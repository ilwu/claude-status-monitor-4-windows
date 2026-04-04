**English** | [繁體中文](README.zh-TW.md)

# Claude Status Monitor for Windows

Per-session memory monitoring for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on Windows.

![screenshot](screenshots/social-preview.png)

## The Problem

You're running 3-4 Claude Code sessions on Windows. System gets slow. You open Task Manager — all you see is multiple `claude.exe` processes. Which one is eating all the memory? No way to tell.

## The Solution

```
Claude 812M/1.5G (session/total)
       ↑              ↑
  This session    All sessions
```

**This is the core.** Each Claude Code session's statusline shows how much memory *this session* uses vs. the total across all sessions. See a heavy one? Close it. Problem solved.

Everything else — system memory %, context window, weekly usage, model name, cost — is bonus info you can toggle on/off from the system tray.

## Why a Separate Service? Why Not Just a Shell Script?

Good question. We tried that first. Here's why it doesn't work on Windows:

**Claude Code's statusline has a ~500ms timeout.** If your script doesn't finish in time, nothing shows.

On Windows, every process spawn is expensive:

| Operation | Time |
|-----------|------|
| `wmic` query (1 call) | ~150-300ms |
| `curl` to localhost | ~650ms (process spawn overhead) |
| `cat` via pipe | ~230ms |
| `bash` startup + pipe | ~250ms |

To display per-session memory, the statusline script would need to:

1. Walk the parent process chain to find which `claude.exe` owns this session — **multiple `wmic` calls, ~300ms each**
2. Query that process's memory — **another `wmic` call, ~150ms**
3. Query system memory — **another `wmic` call, ~150ms**

**Total: easily 1-2 seconds. Way over the 500ms limit.**

### Our solution: split the work

| | Heavy work (background) | Statusline (fast path) |
|---|---|---|
| **Who** | Tray app (Node.js) | Bash script |
| **When** | Every 5 seconds | On each assistant reply |
| **What** | `wmic` queries for all sessions | `/dev/tcp` to localhost |
| **Time** | ~300ms (doesn't matter) | **~60ms** (well under 500ms) |

The tray app does the slow `wmic` work in the background and caches results. The statusline just reads cached data via a fast local HTTP call (`/dev/tcp`, no `curl` spawn). First call caches the PID, subsequent calls are ~60ms.

**Bonus:** the tray app also gives us a visible process (not a ghost), configurable items via right-click menu, and a clean way to start/stop.

> **On macOS/Linux** this architecture wouldn't be necessary — process queries are fast and the statusline script could do everything inline. This is a Windows-specific solution for Windows-specific problems.

## Features

- **Per-session memory** — See exactly how much each Claude session uses
- **System tray icon** — Orange circle in your taskbar, right-click to manage
- **Configurable items** — Toggle what shows in the statusline from the tray menu
- **Color-coded bars** — Green (<50%), Yellow (50-75%), Red (>75%)
- **Two-level cache** — PID cache + memory cache, never miss a render
- **Auto-start** — Runs on boot, always ready
- **Zero dependencies** — Pure bash statusline, no curl needed (`/dev/tcp`)

### Statusline Items

| Item | Description | Default |
|------|-------------|---------|
| System Memory | RAM usage % with progress bar | On |
| Claude Memory | This session / all sessions total | On |
| Context Window | Context usage % with progress bar | On |
| Weekly Usage | 7-day API usage % with progress bar | On |
| Session ID | Full UUID for session resume | On |
| Project Path | Project root directory | On |
| Model Name | Current model (e.g., Opus 4.6) | Off |
| Session Cost | Cumulative cost in USD | Off |

Toggle items on/off from the tray icon — changes apply instantly.

## Quick Install

**Prerequisites:** Node.js 18+, Git Bash (comes with [Git for Windows](https://git-scm.com/))

```powershell
git clone https://github.com/user/claude-status-monitor-4-windows
cd claude-status-monitor-4-windows
.\install.ps1
```

That's it. The installer:
1. Installs npm dependencies
2. Copies the statusline script to `~/.claude/`
3. Configures Claude Code's `settings.json`
4. Creates a startup shortcut (auto-launch on boot)
5. Starts the monitor

Open a Claude Code session and you'll see the statusline at the bottom.

## How It Works

```
┌─ System Tray App (Node.js) ───────────────────────────┐
│                                                        │
│  Tray Icon (bottom-right)                              │
│    Right-click: toggle items, exit                     │
│                                                        │
│  Background Collector (every 5s)                       │
│    wmic → all claude.exe PIDs + memory                 │
│    wmic → system memory %                              │
│                                                        │
│  HTTP API (localhost:19823)                             │
│    GET /status/:pid → session mem + totals + config    │
│                                                        │
│  Config (~/.claude-monitor/config.json)                 │
│    Which items to display, persisted on toggle          │
│                                                        │
└────────────────────────────────────────────────────────┘
         ▲ /dev/tcp (~46ms)
         │
┌─ Statusline (bash) ──────────────────────────────────┐
│  1. Cached PID lookup (or one-time parent chain walk) │
│  2. Query API → get data + display config             │
│  3. Dynamically assemble only enabled items           │
│  4. Color-coded ANSI output                           │
└──────────────────────────────────────────────────────┘
```

## Configuration

### Toggle Items

Right-click the tray icon to check/uncheck statusline items. Changes are instant and persist across restarts.

### Manual Config

Config is stored at `~/.claude-monitor/config.json`:

```json
{
  "sys_mem": true,
  "claude_mem": true,
  "ctx": true,
  "week": true,
  "session_id": true,
  "path": true,
  "model": false,
  "cost": false
}
```

### Port

The monitor uses port `19823` on localhost. To change it, edit `monitor/app.js` line 7.

## Uninstall

```powershell
.\uninstall.ps1
```

Removes: startup shortcut, statusline config, monitor config. Project files remain for you to delete.

## Troubleshooting

**Statusline shows `?` or nothing**
- Check if the monitor is running (look for the orange tray icon)
- Start it manually: double-click `monitor/start.vbs`

**Statusline shows `offline`**
- The monitor API is not reachable. Restart it from the tray or `start.vbs`

**First statusline render is slow**
- Normal. The first call discovers your session's PID (~300ms). Subsequent calls are ~60ms (cached).

**Tray icon doesn't appear**
- It may be in the overflow area. Click the `^` arrow in your taskbar to check.

## Requirements

- Windows 10/11
- Node.js 18+
- Git Bash (Git for Windows)
- Claude Code CLI

## License

MIT
