'use strict';

// Phase 4 smoke: spawn the real mmsg.js as a subprocess against an in-process
// test server. Uses a temp DB and an ephemeral port — no interaction with the
// production tray app on 19823.
//
// Run: node monitor/test/smoke-cli.js

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { spawn } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-smoke-cli-'));
process.env.MINITOR_DB_PATH = path.join(tempDir, 'memory.db');

const db = require('../db');
const api = require('../api');
const CLI_PATH = path.join(__dirname, '..', 'cli', 'mmsg.js');

db.init();

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/')) {
    if (api.dispatch(req, res)) return;
  }
  res.writeHead(404); res.end('{}');
});

function spawnMmsg(args, { stdin, port } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, MINITOR_PORT: String(port ?? server.address().port) },
      stdio: ['pipe', 'pipe', 'pipe'],
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
    if (stdin != null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

let fails = 0;
async function step(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { fails++; console.error(`  FAIL ${name}: ${e.message}`); }
}

async function runTests() {
  // ── help ───────────────────────────────────────────────────────
  await step('mmsg help → lists commands, exit 0', async () => {
    const r = await spawnMmsg(['help']);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /topic-new/);
    assert.match(r.stdout, /topic-add/);
    assert.match(r.stdout, /snapshot/);
    assert.match(r.stdout, /recovery/);
  });

  await step('mmsg (no args) → same as help, exit 0', async () => {
    const r = await spawnMmsg([]);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /Commands:/);
  });

  await step('mmsg help topic-new → single-command help', async () => {
    const r = await spawnMmsg(['help', 'topic-new']);
    assert.strictEqual(r.code, 0);
    assert.match(r.stdout, /mmsg topic-new --title/);
  });

  await step('mmsg bogus-cmd → exit 2 + suggests help', async () => {
    const r = await spawnMmsg(['bogus-cmd']);
    assert.strictEqual(r.code, 2);
    assert.match(r.stderr, /unknown command/);
  });

  // ── topic-new / topic-add / topic-show / topic-list ────────────
  let topicId = null;

  await step('topic-new --title=<s> → prints topic id', async () => {
    const r = await spawnMmsg(['topic-new', '--title=CLI smoke']);
    assert.strictEqual(r.code, 0, r.stderr);
    topicId = r.stdout.trim();
    assert.match(topicId, /^t-[0-9a-f]{8}$/);
  });

  await step('topic-new with stdin → first_message stored', async () => {
    const r = await spawnMmsg(
      ['topic-new', '--title=with-first', '--author=main'],
      { stdin: 'opening line from stdin' }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    const id = r.stdout.trim();
    // verify via API directly
    const got = await httpGet(`/api/topics/${id}`);
    assert.strictEqual(got.body.messages.length, 1);
    assert.strictEqual(got.body.messages[0].content, 'opening line from stdin');
    assert.strictEqual(got.body.messages[0].author, 'main');
  });

  await step('topic-add <id> (stdin) → ok seq=2', async () => {
    const r = await spawnMmsg(
      ['topic-add', topicId, '--author=sub'],
      { stdin: 'second message content' }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /ok seq=1/); // first message in topicA (no first_message at create)
  });

  await step('topic-add with no stdin → exit 2', async () => {
    const r = await spawnMmsg(['topic-add', topicId, '--author=x']);
    assert.strictEqual(r.code, 2);
    assert.match(r.stderr, /no content on stdin/);
  });

  await step('topic-add no id → exit 2', async () => {
    const r = await spawnMmsg(['topic-add'], { stdin: 'body' });
    assert.strictEqual(r.code, 2);
  });

  await step('topic-add unknown id → exit 1 + api error', async () => {
    const r = await spawnMmsg(['topic-add', 't-deadbeef'], { stdin: 'body' });
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /not_found/);
  });

  await step('topic-show <id> → human-readable thread', async () => {
    const r = await spawnMmsg(['topic-show', topicId]);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Topic:\\s+${topicId}`));
    assert.match(r.stdout, /second message content/);
  });

  await step('topic-show --latest=1 → only last message rendered', async () => {
    // add another so we have multiple
    await spawnMmsg(['topic-add', topicId], { stdin: 'third' });
    const r = await spawnMmsg(['topic-show', topicId, '--latest=1']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /third/);
    assert.doesNotMatch(r.stdout, /second message content/);
  });

  await step('topic-show --summary → truncated + marker', async () => {
    await spawnMmsg(['topic-add', topicId], { stdin: 'x'.repeat(200) });
    const r = await spawnMmsg(['topic-show', topicId, '--summary', '--latest=1']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /truncated from 200/);
  });

  await step('topic-list → tabular, includes our topic', async () => {
    const r = await spawnMmsg(['topic-list']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert(r.stdout.includes(topicId));
    assert.match(r.stdout, /CLI smoke/);
  });

  await step('topic-list --status=active → filters', async () => {
    const r = await spawnMmsg(['topic-list', '--status=active']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert(r.stdout.includes(topicId));
  });

  // ── snapshot / recovery ────────────────────────────────────────
  const SID = 'cli-smoke-session';
  // seed a session row so --session=<id> works (no live Claude session)
  await httpPost('/api/sessions', { session_id: SID, cwd: 'C:/cli/smoke', message_count: 5 });
  await httpPost(`/api/sessions/${SID}/prompts`, { prompt_seq: 1, text_preview: 'hi' });
  await httpPost(`/api/sessions/${SID}/file-edits`, { file_path: 'C:/x.js', operation: 'edit' });

  await step('snapshot requires stdin JSON → 2 without', async () => {
    const r = await spawnMmsg(['snapshot', `--session=${SID}`]);
    assert.strictEqual(r.code, 2);
    assert.match(r.stderr, /no JSON on stdin/);
  });

  await step('snapshot with bad JSON → 2', async () => {
    const r = await spawnMmsg(['snapshot', `--session=${SID}`], { stdin: 'not-json' });
    assert.strictEqual(r.code, 2);
    assert.match(r.stderr, /invalid JSON on stdin/);
  });

  await step('snapshot --session=<id> with JSON → ok snapshot_seq=1', async () => {
    const payload = JSON.stringify({
      current_task: 'testing', modified_files: ['a.js'], next_steps: ['ship'],
    });
    const r = await spawnMmsg(['snapshot', `--session=${SID}`, '--at-prompt=5'],
                             { stdin: payload });
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /snapshot_seq=1/);
  });

  await step('recovery --session=<id> → Markdown bundle', async () => {
    const r = await spawnMmsg(['recovery', `--session=${SID}`]);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`# Recovery for ${SID}`));
    assert.match(r.stdout, /Latest snapshot/);
    assert.match(r.stdout, /current_task/);
    assert.match(r.stdout, /Recent prompts/);
    assert.match(r.stdout, /Recent file edits/);
    assert.match(r.stdout, /a\.js|C:\/x\.js/);
  });

  await step('recovery --json → JSON instead of markdown', async () => {
    const r = await spawnMmsg(['recovery', `--session=${SID}`, '--json']);
    assert.strictEqual(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert(parsed.session);
    assert(parsed.latest_snapshot);
  });

  await step('recovery unknown session → exit 1', async () => {
    const r = await spawnMmsg(['recovery', '--session=nope-not-real']);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /session not found/);
  });

  // ── server unreachable → exit 3 ────────────────────────────────
  await step('server unreachable → exit 3 + friendly error', async () => {
    const r = await spawnMmsg(['topic-list'], { port: 1 });
    assert.strictEqual(r.code, 3);
    assert.match(r.stderr, /Minitor tray app not running/);
  });
}

// Helpers for direct API calls from the test (seeding etc.)
function httpGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
      });
    }).on('error', reject);
  });
}
function httpPost(p, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST', path: p,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

console.log('=== Phase 4 smoke: cli ===');
server.listen(0, '127.0.0.1', async () => {
  try { await runTests(); }
  catch (e) { fails++; console.error('fatal:', e); }
  finally {
    server.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
    console.log('\nALL OK');
  }
});
