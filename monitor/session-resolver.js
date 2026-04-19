'use strict';

// Cross-platform resolver: cwd → session_id via ~/.claude/projects/*.jsonl.
// No wmic, no OS-specific process inspection — pure filesystem reads.
//
// Strategy:
//   1. Fast path: sanitize cwd to match Claude Code's project-dir naming
//      (non-[A-Za-z0-9-] → '-'), check that dir first.
//   2. Slow path: if fast path misses (sanitize rule drift or rename), scan
//      every project dir's latest .jsonl and compare normalized cwd.
//
// Returns null if no session found (caller should 404).

const fs = require('fs');
const path = require('path');
const os = require('os');

function projectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// ── cwd normalization ────────────────────────────────────────────────
// Accept: C:\workspace\x, C:/workspace/x, /c/workspace/x
// Produce: c:/workspace/x (Windows-lowercased on win32)
function normalizeCwd(cwd) {
  if (cwd == null) return '';
  let s = String(cwd).replace(/\\/g, '/');
  // MSYS/Git Bash drive: /c/foo → c:/foo
  const m = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (m) s = `${m[1]}:/${m[2]}`;
  // Lowercase drive letter
  s = s.replace(/^([a-zA-Z]):/, (_, d) => `${d.toLowerCase()}:`);
  // Collapse repeated slashes, drop trailing
  s = s.replace(/\/+/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

// Claude Code's project-dir naming observed on this machine:
//   C:\workspace\_plarform\Platform-BackendServer
//   → C--workspace--plarform-Platform-BackendServer
// Rule: every non-[A-Za-z0-9-] char → '-'.
function sanitizeCwdForDirName(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9-]/g, '-');
}

// ── .jsonl header reader ─────────────────────────────────────────────
// Reads up to `maxBytes` from the start of a jsonl, parses each complete
// line, and collects session_id / cwd / git_branch / custom_title.
// Discards the last (possibly truncated) line.
function readJsonlHeader(jsonlPath, maxBytes = 16384) {
  let fd;
  try {
    fd = fs.openSync(jsonlPath, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    if (n === 0) return null;
    const text = buf.slice(0, n).toString('utf8');
    const isFullRead = n < maxBytes;
    const lines = text.split('\n');
    const parseable = isFullRead ? lines : lines.slice(0, -1);

    let session_id = null, cwd = null, git_branch = null, custom_title = null;
    for (const line of parseable) {
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (!session_id && ev.sessionId) session_id = ev.sessionId;
      if (!cwd && ev.cwd) cwd = ev.cwd;
      if (!git_branch && ev.gitBranch) git_branch = ev.gitBranch;
      if (ev.type === 'custom-title' && ev.customTitle) custom_title = ev.customTitle;
      if (session_id && cwd && git_branch) break;
    }
    if (!session_id) return null;
    return { session_id, cwd, git_branch, custom_title };
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// ── latest jsonl in a project dir ────────────────────────────────────
function latestJsonlInDir(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return null;
  }
  let best = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dirPath, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtimeMs) {
      best = { path: full, mtimeMs: st.mtimeMs };
    }
  }
  return best;
}

function readLatestJsonlInDir(dirPath) {
  const latest = latestJsonlInDir(dirPath);
  if (!latest) return null;
  const meta = readJsonlHeader(latest.path);
  if (!meta) return null;
  return { ...meta, jsonl_path: latest.path, jsonl_mtime: latest.mtimeMs };
}

// ── main resolver ────────────────────────────────────────────────────
function findSessionByCwd(rawCwd) {
  if (!rawCwd) return null;
  const root = projectsRoot();
  let rootExists;
  try { rootExists = fs.statSync(root).isDirectory(); } catch { rootExists = false; }
  if (!rootExists) return null;

  const target = normalizeCwd(rawCwd);

  // Fast path: sanitize-guess
  const guessed = sanitizeCwdForDirName(rawCwd);
  const guessedPath = path.join(root, guessed);
  let guessedOk = false;
  try { guessedOk = fs.statSync(guessedPath).isDirectory(); } catch {}
  if (guessedOk) {
    const hit = readLatestJsonlInDir(guessedPath);
    if (hit && hit.cwd && normalizeCwd(hit.cwd) === target) {
      return { ...hit, directory: guessed, matched_via: 'fast_path' };
    }
  }

  // Slow path: scan all project dirs
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== guessed)
      .map(d => d.name);
  } catch {
    return null;
  }
  for (const name of dirs) {
    const hit = readLatestJsonlInDir(path.join(root, name));
    if (hit && hit.cwd && normalizeCwd(hit.cwd) === target) {
      return { ...hit, directory: name, matched_via: 'slow_path' };
    }
  }
  return null;
}

module.exports = {
  projectsRoot,
  normalizeCwd,
  sanitizeCwdForDirName,
  readJsonlHeader,
  readLatestJsonlInDir,
  findSessionByCwd,
};
