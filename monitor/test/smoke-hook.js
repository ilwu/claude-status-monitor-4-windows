'use strict';

// Phase 5 smoke: spawn session-prompt-reminder.js against a fake HOME with
// synthetic jsonl. Validates count math, state dedup, and the mandatory
// silent-on-error contract.
//
// Run: node monitor/test/smoke-hook.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const HOOK = path.resolve(__dirname, '..', '..', 'tools', 'session-prompt-reminder.js');
if (!fs.existsSync(HOOK)) {
  console.error('hook script missing:', HOOK);
  process.exit(1);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-hook-'));
const CWD = 'C:/fake/hook/smoke/project';
const sanitized = CWD.replace(/[^A-Za-z0-9-]/g, '-');
const projectDir = path.join(tempHome, '.claude', 'projects', sanitized);
fs.mkdirSync(projectDir, { recursive: true });
const jsonlPath = path.join(projectDir, 'hook-smoke.jsonl');
const SID = 'sid-hook-smoke';
const STATE_FILE = path.join(tempHome, '.claude-monitor', 'reminder-state.json');

function writeJsonlWithNPrompts(n, sessionId = SID) {
  const lines = [];
  lines.push(JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId }));
  // minimal user event so sessionId / cwd are present too
  lines.push(JSON.stringify({ type: 'user', sessionId, cwd: CWD.replace(/\//g, '\\') }));
  for (let i = 1; i <= n; i++) {
    lines.push(JSON.stringify({
      type: 'last-prompt', sessionId,
      lastPrompt: `prompt ${i}`,
    }));
  }
  fs.writeFileSync(jsonlPath, lines.join('\n') + '\n');
}

function runHook() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome, // Windows
        CLAUDE_CWD: CWD,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [], err = [];
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    child.on('error', reject);
  });
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

let fails = 0;
async function step(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { fails++; console.error(`  FAIL ${name}: ${e.message}`); }
}

async function run() {
  // ── no project dir at all → silent ─────────────────────────────
  await step('no project dir → silent, exit 0', async () => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    const r = await runHook();
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.stderr, '');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  // ── empty project dir → silent ─────────────────────────────────
  await step('empty project dir → silent, exit 0', async () => {
    const r = await runHook();
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, '');
  });

  // ── 9 prompts → below threshold, silent ────────────────────────
  await step('9 prompts → no reminder', async () => {
    writeJsonlWithNPrompts(9);
    const r = await runHook();
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(loadState()[SID], undefined);
  });

  // ── exactly 10 → reminder fires, state updated ─────────────────
  await step('10 prompts → reminder fires + state=10', async () => {
    writeJsonlWithNPrompts(10);
    const r = await runHook();
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /已對話 10 次/);
    assert.match(r.stdout, /mmsg snapshot/);
    assert.strictEqual(loadState()[SID], 10);
  });

  // ── rerun unchanged → no double remind ─────────────────────────
  await step('rerun at count=10 → dedup, no output', async () => {
    const r = await runHook();
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(loadState()[SID], 10);
  });

  // ── 15 prompts (diff=5) → still no remind ──────────────────────
  await step('15 prompts (diff=5) → no reminder', async () => {
    writeJsonlWithNPrompts(15);
    const r = await runHook();
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(loadState()[SID], 10);
  });

  // ── 20 prompts (diff=10) → reminder fires ──────────────────────
  await step('20 prompts (diff=10) → reminder fires', async () => {
    writeJsonlWithNPrompts(20);
    const r = await runHook();
    assert.match(r.stdout, /已對話 20 次/);
    assert.strictEqual(loadState()[SID], 20);
  });

  // ── simulated jsonl gap: jump 20 → 35 (diff=15) → remind once ──
  await step('gap 20→35 (diff=15 ≥ 10) → reminder fires at 35, not at 30', async () => {
    writeJsonlWithNPrompts(35);
    const r = await runHook();
    assert.match(r.stdout, /已對話 35 次/);
    assert.strictEqual(loadState()[SID], 35);
  });

  // ── two sessions, independent counters ─────────────────────────
  await step('second session → independent threshold tracking', async () => {
    const SID2 = 'sid-hook-smoke-2';
    // Write a separate jsonl (different name, same dir) — latest by mtime wins.
    const altPath = path.join(projectDir, 'other.jsonl');
    const alt = [];
    alt.push(JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: SID2 }));
    alt.push(JSON.stringify({ type: 'user', sessionId: SID2, cwd: CWD }));
    for (let i = 1; i <= 10; i++) alt.push(JSON.stringify({
      type: 'last-prompt', sessionId: SID2, lastPrompt: `p${i}`,
    }));
    fs.writeFileSync(altPath, alt.join('\n') + '\n');
    // Bump its mtime beyond hook-smoke.jsonl
    const future = Date.now() + 10_000;
    fs.utimesSync(altPath, future / 1000, future / 1000);

    const r = await runHook();
    assert.match(r.stdout, /已對話 10 次/);
    const state = loadState();
    assert.strictEqual(state[SID], 35); // unchanged
    assert.strictEqual(state[SID2], 10);
  });

  // ── corrupt jsonl → silent exit 0 ──────────────────────────────
  await step('corrupt jsonl → silent, exit 0', async () => {
    fs.writeFileSync(jsonlPath, 'not valid jsonl at all\n{bad\n');
    // bump mtime so it beats the other session jsonl
    const future = Date.now() + 20_000;
    fs.utimesSync(jsonlPath, future / 1000, future / 1000);
    const r = await runHook();
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.stderr, '');
  });

  // ── performance smoke: 100 prompts should be fast ──────────────
  await step('100 prompts → hook completes <2s (loose bound)', async () => {
    writeJsonlWithNPrompts(100);
    const future = Date.now() + 30_000;
    fs.utimesSync(jsonlPath, future / 1000, future / 1000);
    // reset state so we get a reminder
    fs.rmSync(STATE_FILE, { force: true });
    const t0 = Date.now();
    const r = await runHook();
    const elapsed = Date.now() - t0;
    assert.match(r.stdout, /已對話 100 次/);
    assert(elapsed < 2000, `took ${elapsed}ms`);
    console.log(`       (elapsed ${elapsed}ms — includes node startup)`);
  });
}

console.log('=== Phase 5 smoke: session-prompt-reminder ===');
run()
  .catch(e => { console.error('fatal:', e); fails++; })
  .finally(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
    console.log('\nALL OK');
  });
