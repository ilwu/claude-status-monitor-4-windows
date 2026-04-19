'use strict';

const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const api = require('./api');

const PORT = 19823;
const INTERVAL = 60000;
const CONFIG_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude-monitor');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// ── Item Registry ────────────────────────────────────────────────────
// Each item defines: id, label, default enabled, data key(s)
// Statusline reads `display` array from API to know what to render.
// To add a new item: just append to this array.
const ITEMS = [
  { id: 'sys_mem',    label: 'System Memory',    default: true  },
  { id: 'claude_mem', label: 'Claude Memory',    default: true  },
  { id: 'mcp_mem',   label: 'MCP Memory',       default: true  },
  { id: 'ctx',        label: 'Context Window',   default: true  },
  { id: 'week',       label: 'Weekly Usage',     default: true  },
  { id: 'session_id', label: 'Session ID',       default: true  },
  { id: 'path',       label: 'Project Path',     default: true  },
  { id: 'model',      label: 'Model Name',       default: false },
  { id: 'cost',       label: 'Session Cost ($)', default: false },
  { id: 'lines',      label: 'Lines +/-',        default: false },
  { id: 'duration',   label: 'Session Duration',  default: false },
];

// ── Config ───────────────────────────────────────────────────────────
let config = {};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  // Apply defaults for missing items
  for (const item of ITEMS) {
    if (config[item.id] === undefined) {
      config[item.id] = item.default;
    }
  }
}

function saveConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[config] save failed:', e.message);
  }
}

function getDisplay() {
  return ITEMS.filter(i => config[i.id]).map(i => i.id);
}

// ── State ────────────────────────────────────────────────────────────
const store = new Map(); // pid -> { mem, updatedAt }
let systemMemPct = null;
let mcpMemTotal = 0; // total MCP server memory in bytes
let mcpProcCount = 0; // number of MCP server processes
const windowCols = new Map(); // pid -> estimated terminal columns

// ── Icon: 16x16 orange circle (#D97757) ──────────────────────────────
function generateIconBase64() {
  const W = 16, H = 16;
  const R = 217, G = 119, B = 87;
  const pixels = Buffer.alloc(W * H * 4);
  let i = 0;

  for (let y = H - 1; y >= 0; y--) {
    for (let x = 0; x < W; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = d <= 6 ? 255 : d < 7.5 ? Math.round((7.5 - d) / 1.5 * 255) : 0;
      pixels[i++] = B;
      pixels[i++] = G;
      pixels[i++] = R;
      pixels[i++] = a;
    }
  }

  const maskRow = Math.ceil(Math.ceil(W / 8) / 4) * 4;
  const mask = Buffer.alloc(maskRow * H);
  const bmpSize = 40 + pixels.length + mask.length;
  const ico = Buffer.alloc(6 + 16 + bmpSize);
  let o = 0;

  ico.writeUInt16LE(0, o); o += 2;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(1, o); o += 2;
  ico[o++] = W; ico[o++] = H; ico[o++] = 0; ico[o++] = 0;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(32, o); o += 2;
  ico.writeUInt32LE(bmpSize, o); o += 4;
  ico.writeUInt32LE(22, o); o += 4;
  ico.writeUInt32LE(40, o); o += 4;
  ico.writeInt32LE(W, o); o += 4;
  ico.writeInt32LE(H * 2, o); o += 4;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(32, o); o += 2;
  ico.writeUInt32LE(0, o); o += 4;
  ico.writeUInt32LE(pixels.length + mask.length, o); o += 4;
  o += 16;
  pixels.copy(ico, o); o += pixels.length;
  mask.copy(ico, o);

  return ico.toString('base64');
}

// ── Helpers ──────────────────────────────────────────────────────────
function fmtMem(bytes) {
  const mb = bytes / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : Math.round(mb) + 'MB';
}

// ── Collector ────────────────────────────────────────────────────────
function collect() {
  exec(
    'wmic process where "name=\'claude.exe\'" get ProcessId,WorkingSetSize /FORMAT:CSV',
    { timeout: 4000 },
    (err, stdout) => {
      if (err) return;
      const now = Date.now();
      const alive = new Set();

      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(',');
        if (parts.length < 3 || parts[1] === 'ProcessId') continue;
        const pid = parseInt(parts[1]), ws = parseInt(parts[2]);
        if (isNaN(pid) || isNaN(ws)) continue;
        store.set(pid, { mem: ws, updatedAt: now });
        alive.add(pid);
      }

      for (const pid of store.keys()) {
        if (!alive.has(pid)) store.delete(pid);
      }

      updateTray();
    }
  );

  exec(
    'wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /FORMAT:CSV',
    { timeout: 4000 },
    (err, stdout) => {
      if (err) return;
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(',');
        if (parts.length < 3 || parts[1] === 'FreePhysicalMemory') continue;
        const freeKB = parseInt(parts[1]), totalKB = parseInt(parts[2]);
        if (!isNaN(freeKB) && !isNaN(totalKB) && totalKB > 0) {
          systemMemPct = Math.round((1 - freeKB / totalKB) * 100);
        }
      }
    }
  );

  // MCP server processes (node.exe with *-mcp* in command line)
  exec(
    'wmic process where "name=\'node.exe\' AND CommandLine LIKE \'%-mcp%\'" get WorkingSetSize /FORMAT:CSV',
    { timeout: 4000 },
    (err, stdout) => {
      if (err) return;
      let total = 0, count = 0;
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(',');
        if (parts.length < 2 || parts[1] === 'WorkingSetSize') continue;
        const ws = parseInt(parts[1]);
        if (!isNaN(ws) && ws > 0) { total += ws; count++; }
      }
      mcpMemTotal = total;
      mcpProcCount = count;
    }
  );

  // Terminal window width per session (walk parent chain to find terminal host)
  collectWindowCols();
}

// Write the window-cols PowerShell script once on startup
const COLS_SCRIPT = path.join(CONFIG_DIR, 'get-cols.ps1');

function ensureColsScript() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
"@
function GW($s) {
  $p = $s
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $pr = Get-Process -Id $p -EA Stop
      if ($pr.MainWindowHandle -ne [IntPtr]::Zero) {
        $r = New-Object W32+RECT
        [W32]::GetWindowRect($pr.MainWindowHandle, [ref]$r) | Out-Null
        return [math]::Floor(($r.R - $r.L) / 8)
      }
      $w = Get-WmiObject Win32_Process -Filter "ProcessId=$p" -EA Stop
      $p = $w.ParentProcessId
      if ($p -eq 0) { return 0 }
    } catch { return 0 }
  }
  return 0
}
$args | ForEach-Object { Write-Host "$_,$(GW $_)" }
`.trim();
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(COLS_SCRIPT, script);
  } catch {}
}

function collectWindowCols() {
  const pids = [...store.keys()];
  if (pids.length === 0) return;

  const pidArgs = pids.join(' ');
  exec(
    `powershell -NoProfile -File "${COLS_SCRIPT}" ${pidArgs}`,
    { timeout: 8000 },
    (err, stdout) => {
      if (err) return;
      for (const line of stdout.split('\n')) {
        const [pidStr, colsStr] = line.trim().split(',');
        const pid = parseInt(pidStr), cols = parseInt(colsStr);
        if (!isNaN(pid) && !isNaN(cols) && cols > 0) {
          windowCols.set(pid, cols);
        }
      }
      for (const pid of windowCols.keys()) {
        if (!store.has(pid)) windowCols.delete(pid);
      }
    }
  );
}

// ── HTTP API ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Memory API — /api/* handled by api.js (cross-platform, DB-backed).
  // Falls through to legacy /status* routes when no /api route matches.
  if (req.url && req.url.startsWith('/api/')) {
    if (api.dispatch(req, res)) return;
  }

  res.setHeader('Content-Type', 'application/json');

  // GET /status — all sessions
  if (req.url === '/status') {
    const obj = {};
    for (const [pid, d] of store) obj[pid] = d;
    return res.end(JSON.stringify(obj));
  }

  // GET /status/:pid — single session + summary + display config
  const m = req.url.match(/^\/status\/(\d+)$/);
  if (m) {
    const d = store.get(parseInt(m[1]));
    let claudeTotal = 0;
    for (const v of store.values()) claudeTotal += v.mem;
    const reqPid = parseInt(m[1]);
    return res.end(JSON.stringify({
      ...(d || { mem: null }),
      claude_total: claudeTotal,
      system_pct: systemMemPct,
      mcp_total: mcpMemTotal,
      mcp_count: mcpProcCount,
      cols: windowCols.get(reqPid) || null,
      display: getDisplay(),
    }));
  }

  // GET /config — current display config
  if (req.url === '/config') {
    return res.end(JSON.stringify({ items: ITEMS, config, display: getDisplay() }));
  }

  res.writeHead(404);
  res.end('{}');
});

// ── System Tray ──────────────────────────────────────────────────────
let systray = null;
const iconBase64 = generateIconBase64();

const statusItem = { title: 'Collecting...', tooltip: 'Collecting...', checked: false, enabled: false };
// Item toggle menu entries — built from ITEMS registry
const toggleItems = ITEMS.map(item => ({
  title: item.label,
  tooltip: `Toggle ${item.label}`,
  checked: !!config[item.id],
  enabled: true,
}));
const exitItem = { title: 'Exit', tooltip: 'Exit Claude Monitor', checked: false, enabled: true };

function updateTray() {
  if (!systray) return;
  const n = store.size;
  let text;
  if (n === 0) {
    text = 'No active sessions';
  } else {
    text = [...store.entries()]
      .sort((a, b) => b[1].mem - a[1].mem)
      .map(([pid, d]) => `PID ${pid}: ${fmtMem(d.mem)}`)
      .join('  |  ');
  }
  statusItem.title = text;
  statusItem.tooltip = text;
  try {
    systray.sendAction({ type: 'update-item', item: statusItem });
  } catch {}
}

async function startTray() {
  let SysTray;
  try {
    SysTray = require('systray2').default;
  } catch {
    console.log('[tray] systray2 not installed, running headless');
    return;
  }

  // Sync toggle states with loaded config
  for (let i = 0; i < ITEMS.length; i++) {
    toggleItems[i].checked = !!config[ITEMS[i].id];
  }

  try {
    systray = new SysTray({
      menu: {
        icon: iconBase64,
        title: '',
        tooltip: 'Claude Monitor',
        items: [
          statusItem,
          SysTray.separator,
          ...toggleItems,
          SysTray.separator,
          exitItem,
        ],
      },
      debug: false,
      copyDir: false,
    });

    await systray.ready();
    console.log('[tray] ready');

    systray.onClick(action => {
      // Exit
      if (action.item === exitItem) {
        systray.kill(false);
        server.close();
        process.exit(0);
      }
      // Toggle items
      const idx = toggleItems.indexOf(action.item);
      if (idx >= 0) {
        const itemDef = ITEMS[idx];
        config[itemDef.id] = !config[itemDef.id];
        toggleItems[idx].checked = config[itemDef.id];
        saveConfig();
        try {
          systray.sendAction({ type: 'update-item', item: toggleItems[idx] });
        } catch {}
        console.log(`[config] ${itemDef.id} = ${config[itemDef.id]}`);
      }
    });
  } catch (e) {
    console.error('[tray] failed:', e.message);
    systray = null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────
loadConfig();
saveConfig();
ensureColsScript();

try {
  db.init();
  console.log(`[db] ready  ${db.resolveDbPath()}`);
} catch (e) {
  console.error('[db] init failed:', e.message);
}

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Claude Monitor  http://127.0.0.1:${PORT}`);
  await startTray();
  collect();
  setInterval(collect, INTERVAL);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} in use, already running?`);
    process.exit(1);
  }
  throw err;
});
