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

  // ── P5: recovery integrates Phase 7 transcripts/file_ops/summary ────
  await step('GET /api/sessions/:id/recovery now includes Phase 7 fields', async () => {
    const r = await request('GET', '/api/sessions/smoke-a/recovery');
    assert.strictEqual(r.status, 200);
    assert('recent_transcripts' in r.body, 'recent_transcripts field present');
    assert('recent_file_ops' in r.body, 'recent_file_ops field present');
    assert('latest_summary' in r.body, 'latest_summary field present');
    assert('synthetic_session' in r.body, 'synthetic_session flag present');
    assert.strictEqual(r.body.synthetic_session, false,
      'smoke-a has a real sessions row, not synthetic');
  });

  await step('recovery works for hook-only session (synthetic metadata)', async () => {
    const HID = 'phase7-hook-only';
    // Record via /api/hook, never call upsertSession
    await request('POST', '/api/hook', {
      hook_event_name: 'UserPromptSubmit',
      session_id: HID,
      cwd: 'C:/hook-only/cwd',
      transcript_path: 'C:/fake/hook-only.jsonl',
      prompt: 'first hook-only prompt',
    });
    await request('POST', '/api/hook', {
      hook_event_name: 'Stop',
      session_id: HID,
      cwd: 'C:/hook-only/cwd',
      last_assistant_message: 'first hook-only response',
    });
    await request('POST', '/api/hook', {
      hook_event_name: 'PostToolUse',
      session_id: HID,
      tool_name: 'Write',
      tool_input: { file_path: 'C:/hook-only/x.txt', content: 'hi' },
      tool_use_id: 'toolu_hookonly_1',
    });
    const r = await request('GET', `/api/sessions/${HID}/recovery`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.synthetic_session, true);
    assert.strictEqual(r.body.session.session_id, HID);
    assert.strictEqual(r.body.session.cwd, 'C:/hook-only/cwd');
    assert.strictEqual(r.body.session.message_count, 2, '2 transcripts recorded');
    assert.strictEqual(r.body.recent_transcripts.length, 2);
    assert.strictEqual(r.body.recent_file_ops.length, 1);
    assert.strictEqual(r.body.recent_file_ops[0].tool_name, 'Write');
  });

  await step('recovery prompts/edits limit params flow to Phase 7 queries', async () => {
    const r = await request('GET',
      '/api/sessions/smoke-a/recovery?prompts=2&edits=3');
    assert.strictEqual(r.status, 200);
    // prompts limit×2 applies to transcripts (user+assistant), so ≤ 4
    assert(r.body.recent_transcripts.length <= 4);
    // edits limit caps file_ops
    assert(r.body.recent_file_ops.length <= 3);
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

  // ── PUT /api/topics/:id/summary (topic-set-summary) ────────────
  let summaryTopic = null;

  await step('PUT /api/topics/:id/summary → 200 + all 3 summary columns', async () => {
    const created = await request('POST', '/api/topics', { title: 'summary target' });
    summaryTopic = created.body.id;
    const r = await request('PUT', `/api/topics/${summaryTopic}/summary`, {
      content: 'first summary content', author: 'main-scene',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.current_summary, 'first summary content');
    assert.strictEqual(r.body.current_summary_updated_by, 'main-scene');
    assert(typeof r.body.current_summary_updated_at === 'number');
  });

  await step('PUT summary overwrites previous (no history)', async () => {
    const r = await request('PUT', `/api/topics/${summaryTopic}/summary`, {
      content: 'second summary', author: 'other-author',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.current_summary, 'second summary');
    assert.strictEqual(r.body.current_summary_updated_by, 'other-author');
    // GET should reflect the overwrite too
    const get = await request('GET', `/api/topics/${summaryTopic}`);
    assert.strictEqual(get.body.topic.current_summary, 'second summary');
  });

  await step('PUT summary with null author (omit field) → stored null', async () => {
    const r = await request('PUT', `/api/topics/${summaryTopic}/summary`, {
      content: 'anonymous summary',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.current_summary_updated_by, null);
  });

  await step('PUT summary missing content → 400', async () => {
    const r = await request('PUT', `/api/topics/${summaryTopic}/summary`, {
      author: 'no-content',
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'missing_field');
  });

  await step('PUT summary on unknown topic → 404', async () => {
    const r = await request('PUT', '/api/topics/t-nosuch/summary', {
      content: 'whatever',
    });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.error.code, 'not_found');
  });

  // ── GET /api/topics/master/inbox (inbox dashboard) ─────────────
  await step('POST message with is_master=true stores is_master flag', async () => {
    const created = await request('POST', '/api/topics', { title: 'inbox api master tag' });
    const tid = created.body.id;
    const r = await request('POST', `/api/topics/${tid}/messages`, {
      content: 'master message', author: 'main', is_master: true,
    });
    assert.strictEqual(r.status, 201);
    // Verify via GET (topic-show returns messages array)
    const show = await request('GET', `/api/topics/${tid}`);
    const msg = show.body.messages.find(m => m.content === 'master message');
    assert(msg);
    assert.strictEqual(msg.is_master, 1);
  });

  await step('POST /api/topics with is_master on first_message', async () => {
    const r = await request('POST', '/api/topics', {
      title: 'master opens',
      first_message: 'opening by master',
      author: 'main',
      is_master: true,
    });
    assert.strictEqual(r.status, 201);
    const show = await request('GET', `/api/topics/${r.body.id}`);
    assert.strictEqual(show.body.messages[0].is_master, 1);
  });

  await step('GET /api/topics/master/inbox → two-section response', async () => {
    const r = await request('GET', '/api/topics/master/inbox');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.awaiting_main), 'awaiting_main should be array');
    assert(Array.isArray(r.body.in_flight), 'in_flight should be array');
    // Must be zero-parameter — no query string needed
    // (a filter param would create noise; the business view must stay simple)
  });

  await step('inbox: topic whose last message is sub → awaiting_main', async () => {
    const created = await request('POST', '/api/topics', { title: 'inbox-awaiting' });
    const tid = created.body.id;
    await request('POST', `/api/topics/${tid}/messages`, {
      content: 'master q', author: 'main', is_master: true,
    });
    await request('POST', `/api/topics/${tid}/messages`, {
      content: 'sub reply', author: 'sub', is_master: false,
    });
    const inbox = await request('GET', '/api/topics/master/inbox');
    const awaitingIds = inbox.body.awaiting_main.map(x => x.topic_id);
    const inFlightIds = inbox.body.in_flight.map(x => x.topic_id);
    assert(awaitingIds.includes(tid));
    assert(!inFlightIds.includes(tid));
  });

  await step('inbox: topic whose last message is master → in_flight', async () => {
    const created = await request('POST', '/api/topics', { title: 'inbox-inflight' });
    const tid = created.body.id;
    await request('POST', `/api/topics/${tid}/messages`, {
      content: 'sub ping', author: 'sub', is_master: false,
    });
    await request('POST', `/api/topics/${tid}/messages`, {
      content: 'master ack', author: 'main', is_master: true,
    });
    const inbox = await request('GET', '/api/topics/master/inbox');
    const inFlightIds = inbox.body.in_flight.map(x => x.topic_id);
    const awaitingIds = inbox.body.awaiting_main.map(x => x.topic_id);
    assert(inFlightIds.includes(tid));
    assert(!awaitingIds.includes(tid));
  });

  await step('inbox: closed topic excluded from both sections', async () => {
    const created = await request('POST', '/api/topics', { title: 'inbox-closed' });
    const tid = created.body.id;
    await request('POST', `/api/topics/${tid}/messages`, {
      content: 'done', author: 'sub', is_master: false,
    });
    await request('POST', `/api/topics/${tid}/close`, {});
    const inbox = await request('GET', '/api/topics/master/inbox');
    const all = [...inbox.body.awaiting_main, ...inbox.body.in_flight].map(x => x.topic_id);
    assert(!all.includes(tid), 'closed topic must not appear in inbox');
  });

  await step('inbox: each entry carries latest message metadata', async () => {
    const created = await request('POST', '/api/topics', { title: 'inbox-metadata' });
    const tid = created.body.id;
    await request('POST', `/api/topics/${tid}/messages`, {
      content: 'from reporter', author: 'test-reporter', is_master: false,
    });
    const inbox = await request('GET', '/api/topics/master/inbox');
    const entry = inbox.body.awaiting_main.find(x => x.topic_id === tid);
    assert(entry);
    assert.strictEqual(entry.title, 'inbox-metadata');
    assert.strictEqual(entry.latest_author, 'test-reporter');
    assert.strictEqual(entry.latest_is_master, 0);
    assert(typeof entry.latest_at === 'number');
  });

  await step('PUT summary bumps topics.updated_at', async () => {
    const before = await request('GET', `/api/topics/${summaryTopic}`);
    const beforeTs = before.body.topic.updated_at;
    // ≥2ms wait so timestamp compare is meaningful
    await new Promise(r => setTimeout(r, 5));
    await request('PUT', `/api/topics/${summaryTopic}/summary`, {
      content: 'timestamp bump test',
    });
    const after = await request('GET', `/api/topics/${summaryTopic}`);
    assert(after.body.topic.updated_at > beforeTs,
      `updated_at should advance (${before.body.topic.updated_at} → ${after.body.topic.updated_at})`);
  });

  // ── Phase 7: record + session endpoints ────────────────────────
  const PSID = 'phase7-session-a';
  const PCWD = 'C:/phase7/workspace/a';

  await step('POST /api/record/transcript (missing session_id) → 400', async () => {
    const r = await request('POST', '/api/record/transcript', { role: 'user', content: 'x' });
    assert.strictEqual(r.status, 400);
  });

  await step('POST /api/record/transcript (bad role) → 400', async () => {
    const r = await request('POST', '/api/record/transcript',
      { session_id: PSID, role: 'system', content: 'x' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'bad_field');
  });

  await step('POST /api/record/transcript → 201 + seq', async () => {
    const a = await request('POST', '/api/record/transcript', {
      session_id: PSID, role: 'user', content: 'hello from phase7',
      cwd: PCWD, transcript_path: 'C:/fake/phase7.jsonl',
    });
    assert.strictEqual(a.status, 201);
    assert.strictEqual(a.body.seq, 1);
    const b = await request('POST', '/api/record/transcript', {
      session_id: PSID, role: 'assistant', content: 'acknowledged',
      cwd: PCWD, transcript_path: 'C:/fake/phase7.jsonl',
    });
    assert.strictEqual(b.body.seq, 2);
  });

  await step('POST /api/record/file-op (missing tool_name) → 400', async () => {
    const r = await request('POST', '/api/record/file-op',
      { session_id: PSID, file_path: 'C:/x' });
    assert.strictEqual(r.status, 400);
  });

  await step('POST /api/record/file-op → 201 + truncated flag', async () => {
    const r = await request('POST', '/api/record/file-op', {
      session_id: PSID, tool_name: 'Edit',
      file_path: 'C:\\phase7\\main.ts',
      tool_input: { old_string: 'a', new_string: 'b' },
      tool_use_id: 'toolu_p7_1',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.truncated, false);
    assert.strictEqual(r.body.seq, 1);
  });

  await step('POST /api/summary (missing fields) → 400', async () => {
    const r = await request('POST', '/api/summary', { session_id: PSID, text: 'oops' });
    assert.strictEqual(r.status, 400);
  });

  await step('POST /api/summary (inverted range) → 400', async () => {
    const r = await request('POST', '/api/summary', {
      session_id: PSID, range_start_seq: 5, range_end_seq: 2, text: 'bad',
    });
    assert.strictEqual(r.status, 400);
  });

  await step('POST /api/summary → 201 + upsert on same range', async () => {
    const r1 = await request('POST', '/api/summary', {
      session_id: PSID, range_start_seq: 1, range_end_seq: 2,
      text: 'first', keywords: ['a'], generated_by: 'manual',
    });
    assert.strictEqual(r1.status, 201);
    const r2 = await request('POST', '/api/summary', {
      session_id: PSID, range_start_seq: 1, range_end_seq: 2,
      text: 'second', keywords: ['b'],
    });
    assert.strictEqual(r2.status, 201);
    // Verify via search (should hit "second", not both)
    const s = await request('GET', '/api/session/search?q=second');
    assert(s.body.some(x => x.session_id === PSID && x.text === 'second'));
    const s1 = await request('GET', '/api/session/search?q=first');
    assert(!s1.body.some(x => x.session_id === PSID && x.text === 'first'),
      'upsert should have replaced the first row');
  });

  await step('GET /api/session/list (cwd filter) → only matching cwd', async () => {
    const r = await request('GET',
      '/api/session/list?cwd=' + encodeURIComponent(PCWD));
    assert.strictEqual(r.status, 200);
    assert(r.body.some(s => s.session_id === PSID));
    assert(r.body.every(s => s.cwd === PCWD));
  });

  await step('GET /api/session/list (no filter) → all sessions w/ transcripts', async () => {
    const r = await request('GET', '/api/session/list');
    assert(r.body.some(s => s.session_id === PSID));
  });

  await step('GET /api/session/search (missing q) → 400', async () => {
    const r = await request('GET', '/api/session/search');
    assert.strictEqual(r.status, 400);
  });

  await step('GET /api/session/show (missing session_id) → 400', async () => {
    const r = await request('GET', '/api/session/show');
    assert.strictEqual(r.status, 400);
  });

  await step('GET /api/session/show → 200 + transcripts + file_ops', async () => {
    const r = await request('GET',
      '/api/session/show?session_id=' + encodeURIComponent(PSID));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.session_id, PSID);
    assert(r.body.transcripts.length >= 2);
    assert(r.body.file_ops.length >= 1);
    assert.strictEqual(r.body.transcripts[0].role, 'user');
  });

  await step('GET /api/session/show (seq range) → filters transcripts', async () => {
    const r = await request('GET',
      '/api/session/show?session_id=' + encodeURIComponent(PSID) + '&from_seq=2&to_seq=2');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.transcripts.length, 1);
    assert.strictEqual(r.body.transcripts[0].seq, 2);
  });

  // ── Hook dispatcher ────────────────────────────────────────────
  const HSID = 'phase7-hook-session';
  const HPATH = 'C:/fake/hook-session.jsonl';

  await step('POST /api/hook UserPromptSubmit → transcript role=user', async () => {
    const r = await request('POST', '/api/hook', {
      hook_event_name: 'UserPromptSubmit',
      session_id: HSID,
      transcript_path: HPATH,
      cwd: 'C:/hook/cwd',
      prompt: 'hook-forwarded user prompt',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.dispatched, 'transcript');
    const show = await request('GET',
      '/api/session/show?session_id=' + encodeURIComponent(HSID));
    assert(show.body.transcripts.some(t => t.role === 'user' && t.content === 'hook-forwarded user prompt'));
  });

  await step('POST /api/hook Stop → transcript role=assistant', async () => {
    const r = await request('POST', '/api/hook', {
      hook_event_name: 'Stop',
      session_id: HSID,
      transcript_path: HPATH,
      cwd: 'C:/hook/cwd',
      last_assistant_message: 'hook-forwarded assistant response',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.dispatched, 'transcript');
  });

  await step('POST /api/hook PostToolUse Edit → file-op', async () => {
    const r = await request('POST', '/api/hook', {
      hook_event_name: 'PostToolUse',
      session_id: HSID,
      transcript_path: HPATH,
      cwd: 'C:/hook/cwd',
      tool_name: 'Edit',
      tool_input: { file_path: 'C:/hook/edited.ts', old_string: 'x', new_string: 'y' },
      tool_use_id: 'toolu_hook_edit_1',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.dispatched, 'file-op');
  });

  await step('POST /api/hook PostToolUse Bash → ignored', async () => {
    const r = await request('POST', '/api/hook', {
      hook_event_name: 'PostToolUse',
      session_id: HSID,
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.dispatched, 'ignored');
  });

  await step('POST /api/hook SessionStart → ignored', async () => {
    const r = await request('POST', '/api/hook', {
      hook_event_name: 'SessionStart',
      session_id: HSID,
      source: 'startup',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.dispatched, 'ignored');
  });

  await step('POST /api/hook missing session_id → 200 ignored (no crash)', async () => {
    const r = await request('POST', '/api/hook', {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'orphan',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.dispatched, 'ignored');
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
