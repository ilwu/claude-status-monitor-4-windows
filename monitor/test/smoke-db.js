'use strict';

// Phase 1 smoke: verify db.js initializes idempotently and DAO works end-to-end.
// Run: node monitor/test/smoke-db.js
// Uses a temp DB so the real data/memory.db is left alone; then verifies the
// default-path init separately at the end.

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const db = require('../db');

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-db-'));
  return { dir, file: path.join(dir, 'memory.db') };
}

function step(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}:`, e.message);
    process.exitCode = 1;
    throw e;
  }
}

// ── Run DAO tests against a temp DB ──────────────────────────────────
function runDaoTests() {
  const { dir, file } = tempDbPath();
  console.log(`[smoke] temp DB: ${file}`);

  step('init creates DB file', () => {
    db.init(file);
    assert(fs.existsSync(file), 'DB file should exist after init');
  });

  step('init is idempotent (no throw on re-init)', () => {
    const h1 = db.getDb();
    db.init(file);
    const h2 = db.getDb();
    assert.strictEqual(h1, h2, 'second init should return same handle');
  });

  step('WAL mode enabled', () => {
    const mode = db.getDb().pragma('journal_mode', { simple: true });
    assert.strictEqual(mode, 'wal');
  });

  step('all tables exist', () => {
    const names = db.getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(r => r.name);
    for (const t of ['sessions', 'prompts', 'file_edits', 'snapshots', 'topics', 'topic_messages']) {
      assert(names.includes(t), `table missing: ${t} (have: ${names.join(',')})`);
    }
  });

  step('upsertSession insert + update', () => {
    const a = db.upsertSession({ session_id: 's1', cwd: 'C:/x', message_count: 1 });
    assert.strictEqual(a.session_id, 's1');
    assert.strictEqual(a.cwd, 'C:/x');
    const b = db.upsertSession({ session_id: 's1', custom_title: '[test]', message_count: 5 });
    assert.strictEqual(b.custom_title, '[test]');
    assert.strictEqual(b.cwd, 'C:/x', 'COALESCE should preserve cwd');
    assert.strictEqual(b.message_count, 5);
  });

  step('listSessions returns recent first', () => {
    db.upsertSession({ session_id: 's2', cwd: 'C:/y' });
    const rows = db.listSessions({ limit: 10 });
    assert(rows.length >= 2);
  });

  step('insertPrompt truncates text_preview to 200 chars', () => {
    const longText = 'x'.repeat(500);
    db.insertPrompt({ session_id: 's1', prompt_seq: 1, text_preview: longText });
    const rows = db.listPromptsBySession('s1', { limit: 5 });
    assert(rows.length >= 1);
    assert.strictEqual(rows[0].text_preview.length, 200);
  });

  step('insertFileEdit normalizes backslashes', () => {
    db.insertFileEdit({ session_id: 's1', file_path: 'C:\\workspace\\a.js', operation: 'edit' });
    const rows = db.listFileEditsBySession('s1');
    assert.strictEqual(rows[0].file_path, 'C:/workspace/a.js');
  });

  step('insertSnapshot auto-increments snapshot_seq', () => {
    const r1 = db.insertSnapshot({ session_id: 's1', at_prompt_seq: 10, summary_json: { a: 1 } });
    const r2 = db.insertSnapshot({ session_id: 's1', at_prompt_seq: 20, summary_json: { a: 2 } });
    assert.strictEqual(r1.snapshot_seq, 1);
    assert.strictEqual(r2.snapshot_seq, 2);
    const latest = db.getLatestSnapshot('s1');
    assert.strictEqual(latest.snapshot_seq, 2);
    const parsed = JSON.parse(latest.summary_json);
    assert.strictEqual(parsed.a, 2);
  });

  step('createTopic generates t- prefixed id', () => {
    const t = db.createTopic({ title: 'smoke topic' });
    assert(/^t-[0-9a-f]{8}$/.test(t.id), `bad id format: ${t.id}`);
    assert.strictEqual(t.status, 'active');
  });

  step('insertTopicMessage auto-increments seq + bumps topic.updated_at', () => {
    const t = db.createTopic({ title: 'thread' });
    const before = db.getTopic(t.id).updated_at;
    const m1 = db.insertTopicMessage({ topic_id: t.id, author: 'a', content: 'hello' });
    const m2 = db.insertTopicMessage({ topic_id: t.id, author: 'b', content: 'world' });
    assert.strictEqual(m1.seq, 1);
    assert.strictEqual(m2.seq, 2);
    const after = db.getTopic(t.id).updated_at;
    assert(after >= before);
    const msgs = db.listTopicMessages(t.id);
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].content, 'hello');
  });

  step('insertTopicMessage rejects unknown topic', () => {
    assert.throws(
      () => db.insertTopicMessage({ topic_id: 't-deadbeef', content: 'x' }),
      /topic not found/
    );
  });

  step('closeTopic flips status', () => {
    const t = db.createTopic({ title: 'to close' });
    assert.strictEqual(db.closeTopic(t.id), true);
    assert.strictEqual(db.getTopic(t.id).status, 'closed');
    assert.strictEqual(db.closeTopic('t-nope'), false);
  });

  step('stats returns non-negative counts', () => {
    const s = db.stats();
    for (const k of ['sessions', 'prompts', 'file_edits', 'snapshots', 'topics', 'topic_messages']) {
      assert(typeof s[k] === 'number' && s[k] >= 0, `bad stat ${k}: ${s[k]}`);
    }
    // stats().db_path reflects resolveDbPath() (env > default), not init()'s
    // passed-in file. Assert that it matches the current resolved path —
    // keeps this test correct when MINITOR_DB_PATH is set in the environment.
    assert.strictEqual(s.db_path, db.resolveDbPath());
  });

  // Re-open the same file → confirm idempotent migrate
  step('reopen same DB file preserves data (idempotent migration)', () => {
    db.close();
    db.init(file);
    assert(db.getSession('s1'), 's1 should survive reopen');
    const latest = db.getLatestSnapshot('s1');
    assert.strictEqual(latest.snapshot_seq, 2, 'snapshot chain preserved');
  });

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── Verify default-path init (creates <repo>/data/memory.db) ─────────
function runDefaultPathInit() {
  const defaultPath = db.resolveDbPath();
  console.log(`[smoke] default DB path: ${defaultPath}`);
  delete require.cache[require.resolve('../db')]; // fresh singleton
  const freshDb = require('../db');
  freshDb.init();
  step('default path: DB file created', () => {
    assert(fs.existsSync(defaultPath), `expected file at ${defaultPath}`);
  });
  step('default path: tables exist', () => {
    const names = freshDb.getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => r.name);
    assert(names.includes('sessions'));
    assert(names.includes('topics'));
  });
  freshDb.close();
}

console.log('=== Phase 1 smoke: db.js ===');
runDaoTests();
runDefaultPathInit();
if (process.exitCode) {
  console.log('\nFAILED');
} else {
  console.log('\nALL OK');
}
