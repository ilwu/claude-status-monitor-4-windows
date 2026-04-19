'use strict';

// Phase 2 smoke: spin up a test HTTP server on an ephemeral port, hit every
// /api/* endpoint, assert status + payload. Uses a temp DB so production
// data/memory.db is untouched. Does NOT touch the running Minitor tray app.
//
// Run: node monitor/test/smoke-api.js

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

// Force DB to a temp path BEFORE requiring db/api.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-smoke-api-'));
process.env.MINITOR_DB_PATH = path.join(tempDir, 'memory.db');

const db = require('../db');
const api = require('../api');

db.init();

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/')) {
    if (api.dispatch(req, res)) return;
  }
  res.writeHead(404);
  res.end('{}');
});

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port, method, path: p,
      headers: {
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = raw; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let fails = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    fails++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

function run() {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      try {
        await runTests();
      } catch (e) {
        console.error('fatal:', e);
        fails++;
      } finally {
        server.close();
        db.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
        resolve();
      }
    });
    server.on('error', reject);
  });
}

async function runTests() {
  // ── 5.3 system ─────────────────────────────────────────────────
  await step('GET /api/health → 200 + ok=true', async () => {
    const r = await request('GET', '/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert(typeof r.body.db_path === 'string');
  });

  await step('GET /api/stats → 200 + schema', async () => {
    const r = await request('GET', '/api/stats');
    assert.strictEqual(r.status, 200);
    for (const k of ['sessions', 'prompts', 'file_edits', 'snapshots', 'topics', 'topic_messages']) {
      assert(typeof r.body[k] === 'number', `missing stat: ${k}`);
    }
  });

  // ── 5.1 sessions ───────────────────────────────────────────────
  await step('POST /api/sessions (missing session_id) → 400', async () => {
    const r = await request('POST', '/api/sessions', { cwd: 'C:/tmp' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'missing_field');
  });

  await step('POST /api/sessions → 200 + row', async () => {
    const r = await request('POST', '/api/sessions', {
      session_id: 'smoke-a', cwd: 'C:/smoke/a', custom_title: '[A]', message_count: 1,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.session_id, 'smoke-a');
    assert.strictEqual(r.body.custom_title, '[A]');
  });

  await step('POST /api/sessions upsert preserves cwd (COALESCE)', async () => {
    const r = await request('POST', '/api/sessions', {
      session_id: 'smoke-a', message_count: 5,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.cwd, 'C:/smoke/a');
    assert.strictEqual(r.body.message_count, 5);
  });

  await step('GET /api/sessions → 200 + array', async () => {
    const r = await request('GET', '/api/sessions');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body));
    assert(r.body.some(s => s.session_id === 'smoke-a'));
  });

  await step('GET /api/sessions/:id (exists) → 200', async () => {
    const r = await request('GET', '/api/sessions/smoke-a');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.session_id, 'smoke-a');
  });

  await step('GET /api/sessions/:id (missing) → 404', async () => {
    const r = await request('GET', '/api/sessions/does-not-exist');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'not_found');
  });

  await step('GET /api/sessions/current (no cwd) → 400', async () => {
    const r = await request('GET', '/api/sessions/current');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'missing_param');
  });

  await step('GET /api/sessions/current (unknown cwd) → 404', async () => {
    const r = await request('GET', '/api/sessions/current?cwd=' +
      encodeURIComponent('C:/definitely/not/a/real/cwd/xyz-' + Date.now()));
    assert.strictEqual(r.status, 404);
  });

  await step('GET /api/sessions/current (known cwd) → 200 + session_id', async () => {
    const probe = require('../session-resolver');
    const root = probe.projectsRoot();
    if (!fs.existsSync(root)) return console.log('  (skipped: no ~/.claude/projects)');
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory());
    let realCwd = null, expectedId = null;
    for (const d of dirs) {
      const meta = probe.readLatestJsonlInDir(path.join(root, d.name));
      if (meta && meta.cwd && meta.session_id) {
        realCwd = meta.cwd; expectedId = meta.session_id; break;
      }
    }
    if (!realCwd) return console.log('  (skipped: no readable jsonl)');
    const r = await request('GET', '/api/sessions/current?cwd=' + encodeURIComponent(realCwd));
    assert.strictEqual(r.status, 200, `status was ${r.status}: ${JSON.stringify(r.body)}`);
    assert.strictEqual(r.body.session_id, expectedId);
    assert(r.body.matched_via === 'fast_path' || r.body.matched_via === 'slow_path');
  });

  // ── snapshots ──────────────────────────────────────────────────
  await step('POST /api/sessions/:id/snapshots (missing body) → 400', async () => {
    const r = await request('POST', '/api/sessions/smoke-a/snapshots', {});
    assert.strictEqual(r.status, 400);
  });

  await step('POST /api/sessions/:id/snapshots → 201 + seq', async () => {
    const r1 = await request('POST', '/api/sessions/smoke-a/snapshots', {
      at_prompt_seq: 10, summary_json: { current_task: 'smoke' },
    });
    assert.strictEqual(r1.status, 201);
    assert.strictEqual(r1.body.snapshot_seq, 1);
    const r2 = await request('POST', '/api/sessions/smoke-a/snapshots', {
      at_prompt_seq: 20, summary_json: { current_task: 'smoke2' },
    });
    assert.strictEqual(r2.body.snapshot_seq, 2);
  });

  await step('GET /api/sessions/:id/snapshots/latest → 200 + summary inflated', async () => {
    const r = await request('GET', '/api/sessions/smoke-a/snapshots/latest');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.snapshot_seq, 2);
    assert.strictEqual(r.body.summary.current_task, 'smoke2');
  });

  await step('GET /api/sessions/:id/snapshots → 200 + array asc', async () => {
    const r = await request('GET', '/api/sessions/smoke-a/snapshots');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.length, 2);
    assert.strictEqual(r.body[0].snapshot_seq, 1);
  });

  await step('GET /api/sessions/:id/snapshots/latest (none) → 404', async () => {
    const r = await request('GET', '/api/sessions/nobody/snapshots/latest');
    assert.strictEqual(r.status, 404);
  });

  // ── prompts + file-edits ───────────────────────────────────────
  await step('POST /api/sessions/:id/prompts → 201', async () => {
    const r = await request('POST', '/api/sessions/smoke-a/prompts', {
      prompt_seq: 10, text_preview: 'hello from smoke',
    });
    assert.strictEqual(r.status, 201);
  });

  await step('POST /api/sessions/:id/file-edits (no path) → 400', async () => {
    const r = await request('POST', '/api/sessions/smoke-a/file-edits', {});
    assert.strictEqual(r.status, 400);
  });

  await step('POST /api/sessions/:id/file-edits → 201', async () => {
    const r = await request('POST', '/api/sessions/smoke-a/file-edits', {
      file_path: 'C:\\workspace\\x.js', operation: 'edit',
    });
    assert.strictEqual(r.status, 201);
  });

  // ── recovery ───────────────────────────────────────────────────
  await step('GET /api/sessions/:id/recovery → 200 + bundle', async () => {
    const r = await request('GET', '/api/sessions/smoke-a/recovery');
    assert.strictEqual(r.status, 200);
    assert(r.body.session);
    assert(r.body.latest_snapshot);
    assert(Array.isArray(r.body.recent_prompts));
    assert(Array.isArray(r.body.recent_file_edits));
    assert(r.body.recent_prompts.length >= 1);
    assert(r.body.recent_file_edits.length >= 1);
  });

  await step('GET /api/sessions/:id/recovery (missing session) → 404', async () => {
    const r = await request('GET', '/api/sessions/not-real/recovery');
    assert.strictEqual(r.status, 404);
  });

  // ── routing / error handling ───────────────────────────────────
  await step('Unknown /api route → 404 with error shape', async () => {
    const r = await request('GET', '/api/totally-unknown');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'route_not_found');
  });

  // ── 5.2 topics ─────────────────────────────────────────────────
  let topicA = null, topicB = null;

  await step('POST /api/topics (no body) → 201 + t- id', async () => {
    const r = await request('POST', '/api/topics', {});
    assert.strictEqual(r.status, 201);
    assert(/^t-[0-9a-f]{8}$/.test(r.body.id), `bad id: ${r.body.id}`);
    topicA = r.body.id;
  });

  await step('POST /api/topics with title → stored', async () => {
    const r = await request('POST', '/api/topics', { title: 'TODO-19 拔除計畫' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.topic.title, 'TODO-19 拔除計畫');
  });

  await step('POST /api/topics with first_message → atomic topic + seq 1', async () => {
    const r = await request('POST', '/api/topics', {
      title: 'atomic test',
      author: 'main',
      first_message: 'opening message',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.first_message.seq, 1);
    topicB = r.body.id;
    // Verify message visible via GET
    const g = await request('GET', `/api/topics/${topicB}`);
    assert.strictEqual(g.body.messages.length, 1);
    assert.strictEqual(g.body.messages[0].content, 'opening message');
    assert.strictEqual(g.body.messages[0].author, 'main');
  });

  await step('POST /api/topics/:id/messages (existing) → 201 + seq 2', async () => {
    const r = await request('POST', `/api/topics/${topicB}/messages`, {
      author: '0201', content: 'response from 0201',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.seq, 2);
  });

  await step('POST /api/topics/:id/messages (missing content) → 400', async () => {
    const r = await request('POST', `/api/topics/${topicB}/messages`, { author: 'x' });
    assert.strictEqual(r.status, 400);
  });

  await step('POST /api/topics/:id/messages (unknown topic) → 404', async () => {
    const r = await request('POST', '/api/topics/t-deadbeef/messages', { content: 'x' });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'not_found');
  });

  await step('GET /api/topics/:id → 200 + topic + messages asc', async () => {
    const r = await request('GET', `/api/topics/${topicB}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.topic.id, topicB);
    assert.strictEqual(r.body.messages.length, 2);
    assert.strictEqual(r.body.messages[0].seq, 1);
    assert.strictEqual(r.body.messages[1].seq, 2);
  });

  await step('GET /api/topics/:id?latest=1 → only last message', async () => {
    const r = await request('GET', `/api/topics/${topicB}?latest=1`);
    assert.strictEqual(r.body.messages.length, 1);
    assert.strictEqual(r.body.messages[0].seq, 2);
  });

  await step('GET /api/topics/:id?since=1 → seq > 1 only', async () => {
    const r = await request('GET', `/api/topics/${topicB}?since=1`);
    assert.strictEqual(r.body.messages.length, 1);
    assert.strictEqual(r.body.messages[0].seq, 2);
  });

  await step('GET /api/topics/:id?summary=true → content truncated + content_length', async () => {
    await request('POST', `/api/topics/${topicB}/messages`, {
      content: 'x'.repeat(200), author: 'long',
    });
    const r = await request('GET', `/api/topics/${topicB}?summary=true&latest=1`);
    assert.strictEqual(r.body.messages[0].content.length, 81); // 80 chars + '…'
    assert.strictEqual(r.body.messages[0].content_length, 200);
  });

  await step('GET /api/topics/:id (unknown) → 404', async () => {
    const r = await request('GET', '/api/topics/t-nothere');
    assert.strictEqual(r.status, 404);
  });

  await step('GET /api/topics → 200 + array + our topics present', async () => {
    const r = await request('GET', '/api/topics');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body));
    const ids = r.body.map(t => t.id);
    assert(ids.includes(topicA));
    assert(ids.includes(topicB));
  });

  await step('GET /api/topics?status=active → only active', async () => {
    const r = await request('GET', '/api/topics?status=active');
    assert(r.body.every(t => t.status === 'active'));
  });

  await step('GET /api/topics?recent=1h → filter by updated_at', async () => {
    const r = await request('GET', '/api/topics?recent=1h');
    assert.strictEqual(r.status, 200);
    assert(r.body.length >= 2); // all smoke topics updated within 1h
  });

  await step('GET /api/topics?recent=bad → 400 bad_param', async () => {
    const r = await request('GET', '/api/topics?recent=forever');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'bad_param');
  });

  await step('GET /api/topics?status=invalid → 400 bad_param (enum check)', async () => {
    const r = await request('GET', '/api/topics?status=hacked');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'bad_param');
    assert.match(r.body.error.message, /active|closed/);
  });

  await step('POST /api/topics/:id/close → status=closed', async () => {
    const r = await request('POST', `/api/topics/${topicA}/close`, {});
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.status, 'closed');
  });

  await step('POST /api/topics/:id/close (unknown) → 404', async () => {
    const r = await request('POST', '/api/topics/t-nothere/close', {});
    assert.strictEqual(r.status, 404);
  });

  await step('GET /api/topics?status=active excludes closed one', async () => {
    const r = await request('GET', '/api/topics?status=active');
    const ids = r.body.map(t => t.id);
    assert(!ids.includes(topicA));
    assert(ids.includes(topicB));
  });

  // ── routing / error handling ───────────────────────────────────
  await step('POST with invalid JSON body → 400 bad_json', async () => {
    // Send a malformed body manually
    const port = server.address().port;
    const r = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/sessions',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 5 },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body; try { body = JSON.parse(raw); } catch { body = raw; }
          resolve({ status: res.statusCode, body });
        });
      });
      req.on('error', reject);
      req.write('not{}');
      req.end();
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'bad_json');
  });

  await step('POST body > 1MB → 413 JSON actually received (not conn reset)', async () => {
    // Stream a 2MB JSON body chunk by chunk. The server should detect overflow
    // on the first chunks, reject the promise, and the dispatcher should
    // still write a 413 JSON response to the same socket — NOT tear it down.
    const port = server.address().port;
    const big = 'x'.repeat(2 * 1024 * 1024); // 2MB payload
    const payload = `{"session_id":"oversize","note":"${big}"}`;
    const r = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/sessions',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body; try { body = JSON.parse(raw); } catch { body = raw; }
          resolve({ status: res.statusCode, body });
        });
      });
      req.on('error', reject);
      // Write in chunks so the server sees multiple 'data' events
      const step = 128 * 1024;
      let offset = 0;
      (function writeNext() {
        if (offset >= payload.length) return req.end();
        const slice = payload.slice(offset, offset + step);
        offset += step;
        if (req.write(slice)) setImmediate(writeNext);
        else req.once('drain', writeNext);
      })();
    });
    assert.strictEqual(r.status, 413, `expected 413, got ${r.status}`);
    assert.strictEqual(r.body.error.code, 'payload_too_large');
  });
}

console.log('=== Phase 2 smoke: api ===');
run().then(() => {
  if (fails > 0) {
    console.log(`\n${fails} test(s) FAILED`);
    process.exit(1);
  }
  console.log('\nALL OK');
});
