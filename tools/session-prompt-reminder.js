#!/usr/bin/env node
'use strict';

// UserPromptSubmit hook for Claude Code.
// Goal: every N user prompts, inject a gentle reminder to `mmsg snapshot`.
//
// Wiring (copy into .claude/settings.local.json, see README):
//   { "hooks": { "UserPromptSubmit": [{ "matcher": "",
//       "hooks": [{ "type": "command",
//         "command": "node <repo>/tools/session-prompt-reminder.js" }] }] } }
//
// Design constraints:
//   • Claude Code hooks have a 500ms soft budget — keep fast path <200ms.
//   • Must NEVER block the prompt: every error path exits 0 and silent.
//   • Independent of tray app: talks only to .jsonl + local state file.
//
// Counting:
//   • Uses count of `"type":"last-prompt"` occurrences (== user prompts sent).
//   • NOT messageCount (that's turn_duration field, counts every internal
//     message — jumps by tens per turn, unsuitable for modular reminders).
//
// Deduplication:
//   • State at ~/.claude-monitor/reminder-state.json tracks last reminded
//     count per session_id. We remind when (count - last >= THRESHOLD), not
//     `count % N == 0` — so jsonl gaps (crash, partial write) can't silently
//     skip a reminder, and we never double-remind on the same prompt.

const fs = require('fs');
const path = require('path');
const os = require('os');

const THRESHOLD = 10;
const STATE_FILE = path.join(os.homedir(), '.claude-monitor', 'reminder-state.json');
const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

function safely(fn) { try { return fn(); } catch { return null; } }

function sanitizeCwd(cwd) { return String(cwd).replace(/[^A-Za-z0-9-]/g, '-'); }

function latestJsonl(dir) {
  const entries = safely(() => fs.readdirSync(dir)) || [];
  let best = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const p = path.join(dir, name);
    const st = safely(() => fs.statSync(p));
    if (!st || !st.isFile()) continue;
    if (!best || st.mtimeMs > best.m) best = { p, m: st.mtimeMs };
  }
  return best;
}

function countPromptsAndSession(jsonlPath) {
  const raw = safely(() => fs.readFileSync(jsonlPath, 'utf8'));
  if (!raw) return null;
  let count = 0;
  let sessionId = null;
  // Split once; line-level scan. Typical jsonl is a few MB at most per
  // session; readFileSync here is ~20–80ms. No regex on the hot path.
  for (const line of raw.split('\n')) {
    if (line.length < 20 || line.charCodeAt(0) !== 0x7b) continue;
    if (line.indexOf('"type":"last-prompt"') === -1) continue;
    count++;
    if (!sessionId) {
      const m = line.match(/"sessionId":"([^"]+)"/);
      if (m) sessionId = m[1];
    }
  }
  return { count, sessionId };
}

function loadState() {
  if (!safely(() => fs.existsSync(STATE_FILE))) return {};
  const raw = safely(() => fs.readFileSync(STATE_FILE, 'utf8'));
  if (!raw) return {};
  return safely(() => JSON.parse(raw)) || {};
}

function saveState(state) {
  safely(() => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  });
}

function resolveProjectDir(cwd) {
  const guessed = path.join(PROJECTS_ROOT, sanitizeCwd(cwd));
  if (safely(() => fs.statSync(guessed).isDirectory())) return guessed;
  return null;
}

function main() {
  const cwd = process.env.CLAUDE_CWD || process.cwd();
  const dir = resolveProjectDir(cwd);
  if (!dir) return;
  const latest = latestJsonl(dir);
  if (!latest) return;
  const info = countPromptsAndSession(latest.p);
  if (!info || info.count === 0 || !info.sessionId) return;

  const state = loadState();
  const prev = state[info.sessionId] || 0;

  // Two guards: threshold reached AND we haven't already reminded at this count
  if (info.count - prev < THRESHOLD) return;
  if (prev === info.count) return;

  state[info.sessionId] = info.count;
  saveState(state);

  process.stdout.write(
    `⏰ 已對話 ${info.count} 次，建議 \`mmsg snapshot < summary.json\` 備份當前進度。\n` +
    `   (此提醒來自 session-prompt-reminder hook；要關閉請刪除 .claude/settings.local.json 裡的 UserPromptSubmit 設定)\n`
  );
}

// All failure modes must exit 0 silently — never block the user's prompt.
try { main(); } catch {}
process.exit(0);
