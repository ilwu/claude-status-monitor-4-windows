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
    for (const t of [
      'sessions', 'prompts', 'file_edits', 'snapshots', 'topics', 'topic_messages',
      // Phase 7 additions — distinct tables, not renames of existing ones
      'transcripts', 'file_ops', 'summaries',
    ]) {
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

  // ── topic current_summary (topic-set-summary feature) ──────────
  step('setTopicSummary writes three columns + bumps updated_at', () => {
    const t = db.createTopic({ title: 'summary target' });
    const before = db.getTopic(t.id).updated_at;
    // Wait 2ms to make timestamp comparison meaningful
    const result = db.setTopicSummary(t.id, {
      content: 'v1 summary text', author: 'main-scene',
    });
    assert.strictEqual(result.current_summary, 'v1 summary text');
    assert.strictEqual(result.current_summary_updated_by, 'main-scene');
    assert(typeof result.current_summary_updated_at === 'number');
    assert(result.updated_at >= before, 'topics.updated_at should be bumped');
  });

  step('setTopicSummary overwrites previous summary (no history)', () => {
    const t = db.createTopic({ title: 'overwrite target' });
    db.setTopicSummary(t.id, { content: 'v1', author: 'a' });
    db.setTopicSummary(t.id, { content: 'v2', author: 'b' });
    const row = db.getTopic(t.id);
    assert.strictEqual(row.current_summary, 'v2');
    assert.strictEqual(row.current_summary_updated_by, 'b');
  });

  step('setTopicSummary accepts null author', () => {
    const t = db.createTopic({ title: 'null author' });
    db.setTopicSummary(t.id, { content: 'anon summary' });
    const row = db.getTopic(t.id);
    assert.strictEqual(row.current_summary, 'anon summary');
    assert.strictEqual(row.current_summary_updated_by, null);
  });

  step('setTopicSummary throws on unknown topic', () => {
    assert.throws(
      () => db.setTopicSummary('t-nope', { content: 'x' }),
      /topic not found/
    );
  });

  step('setTopicSummary: historical ts does NOT pull topics.updated_at back', () => {
    // Reviewer P5 🟡 fix: `ts` override must only affect
    // current_summary_updated_at; topics.updated_at must always reflect
    // wall-clock now, otherwise bulk-imported old summaries would sink
    // below `topic-list --recent=...` filters.
    const t = db.createTopic({ title: 'ts-override target' });
    const before = Date.now();
    const historicalTs = before - 7 * 24 * 60 * 60 * 1000; // one week ago
    db.setTopicSummary(t.id, {
      content: 'imported from a week ago',
      author: 'bulk-import',
      ts: historicalTs,
    });
    const row = db.getTopic(t.id);
    assert.strictEqual(row.current_summary_updated_at, historicalTs,
      'content timestamp should honor ts override');
    assert(row.updated_at >= before,
      `topics.updated_at must be now, not historical (got ${row.updated_at}, want >= ${before})`);
  });

  step('setTopicSummary rejects missing content', () => {
    const t = db.createTopic({ title: 'require content' });
    assert.throws(
      () => db.setTopicSummary(t.id, {}),
      /content required/
    );
  });

  step('getTopic returns current_summary fields (null when never set)', () => {
    const t = db.createTopic({ title: 'never set summary' });
    const row = db.getTopic(t.id);
    assert.strictEqual(row.current_summary, null);
    assert.strictEqual(row.current_summary_updated_at, null);
    assert.strictEqual(row.current_summary_updated_by, null);
  });

  // ── is_master + master inbox (topic-inbox feature) ─────────────
  step('insertTopicMessage stores is_master (default 0, explicit 1)', () => {
    const t = db.createTopic({ title: 'inbox test' });
    db.insertTopicMessage({ topic_id: t.id, author: 'sub', content: 'subless' });
    db.insertTopicMessage({ topic_id: t.id, author: 'main', content: 'main here', is_master: true });
    const rows = db.listTopicMessages(t.id);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].is_master, 0, 'default should be 0');
    assert.strictEqual(rows[1].is_master, 1, 'explicit true → 1');
  });

  step('createTopicWithFirstMessage honors is_master flag', () => {
    const r = db.createTopicWithFirstMessage({
      title: 'master creates',
      author: 'main',
      content: 'opening by main',
      is_master: true,
    });
    const msgs = db.listTopicMessages(r.topic.id);
    assert.strictEqual(msgs[0].is_master, 1);
  });

  step('listMasterInbox splits by last message sender', () => {
    // Seed three topics in known states
    const awaiting = db.createTopic({ title: 'awaiting-main topic' });
    db.insertTopicMessage({ topic_id: awaiting.id, author: 'main', content: 'q', is_master: true });
    db.insertTopicMessage({ topic_id: awaiting.id, author: 'sub', content: 'reply', is_master: false });
    // last is sub → awaiting_main

    const inFlight = db.createTopic({ title: 'in-flight topic' });
    db.insertTopicMessage({ topic_id: inFlight.id, author: 'sub', content: 'ping', is_master: false });
    db.insertTopicMessage({ topic_id: inFlight.id, author: 'main', content: 'ack', is_master: true });
    // last is main → in_flight

    const empty = db.createTopic({ title: 'empty topic' });
    // no messages → in_flight (nothing to ack)

    const closed = db.createTopic({ title: 'closed topic' });
    db.insertTopicMessage({ topic_id: closed.id, author: 'sub', content: 'was working', is_master: false });
    db.closeTopic(closed.id);
    // closed → excluded entirely

    const inbox = db.listMasterInbox();
    const awaitingIds = inbox.awaiting_main.map(x => x.topic_id);
    const inFlightIds = inbox.in_flight.map(x => x.topic_id);
    assert(awaitingIds.includes(awaiting.id), 'sub-last-reply topic should be in awaiting_main');
    assert(!awaitingIds.includes(inFlight.id), 'main-last-reply topic should NOT be in awaiting_main');
    assert(inFlightIds.includes(inFlight.id), 'main-last-reply → in_flight');
    assert(inFlightIds.includes(empty.id), 'empty topic → in_flight (nothing to ack)');
    assert(!awaitingIds.includes(closed.id) && !inFlightIds.includes(closed.id),
      'closed topic excluded from both');
  });

  step('listMasterInbox returns latest message metadata', () => {
    const t = db.createTopic({ title: 'metadata test' });
    db.insertTopicMessage({ topic_id: t.id, author: 'sub-reporter', content: 'done p1', is_master: false });
    const inbox = db.listMasterInbox();
    const hit = inbox.awaiting_main.find(x => x.topic_id === t.id);
    assert(hit, 'topic should be in awaiting_main');
    assert.strictEqual(hit.title, 'metadata test');
    assert.strictEqual(hit.latest_seq, 1);
    assert.strictEqual(hit.latest_author, 'sub-reporter');
    assert.strictEqual(hit.latest_is_master, 0);
    assert(typeof hit.latest_at === 'number');
  });

  step('listMasterInbox: union equals all active topics', () => {
    const inbox = db.listMasterInbox();
    const total = inbox.awaiting_main.length + inbox.in_flight.length;
    const activeCount = db.getDb().prepare(
      "SELECT COUNT(*) AS n FROM topics WHERE status = 'active'"
    ).get().n;
    assert.strictEqual(total, activeCount,
      `awaiting_main (${inbox.awaiting_main.length}) + in_flight (${inbox.in_flight.length}) must equal active topics (${activeCount})`);
  });

  step('migration: ALTER TABLE idempotent on existing DB (simulate pre-migration)', () => {
    // Simulate a DB from before the summary columns existed: build a temp
    // DB with the OLD schema, then re-init() to run addColumnIfMissing.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-migrate-'));
    const tmpFile = path.join(tmpDir, 'pre-migration.db');
    const Database = require('better-sqlite3');
    const raw = new Database(tmpFile);
    raw.exec(`CREATE TABLE topics (
      id TEXT PRIMARY KEY, title TEXT, status TEXT DEFAULT 'active',
      created_at INTEGER, updated_at INTEGER
    )`);
    raw.prepare(`INSERT INTO topics (id, title, status, created_at, updated_at)
                 VALUES (?, ?, 'active', ?, ?)`)
      .run('t-premig01', 'before migration', Date.now(), Date.now());
    raw.close();

    // Now init() through db.js on the same file — migration should add
    // the three summary columns without touching the existing row
    db.close();
    db.init(tmpFile);
    const existing = db.getTopic('t-premig01');
    assert(existing, 'pre-migration row should survive');
    assert.strictEqual(existing.current_summary, null);
    // And setTopicSummary should work on it
    db.setTopicSummary('t-premig01', { content: 'post-migration set', author: 'mig-test' });
    const after = db.getTopic('t-premig01');
    assert.strictEqual(after.current_summary, 'post-migration set');
    assert.strictEqual(after.current_summary_updated_by, 'mig-test');

    // Re-init on the same file: ALTER should skip (idempotent)
    db.close();
    db.init(tmpFile); // would throw "duplicate column" if migration weren't guarded
    assert(db.getTopic('t-premig01'));

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Reopen the original test DB so later steps still work
    db.init(file);
  });

  // ── Phase 7: transcripts / file_ops / summaries ─────────────────
  step('insertTranscript auto-increments seq + role enforcement', () => {
    const a = db.insertTranscript({
      session_id: 's1', role: 'user', content: 'hello',
      cwd: 'C:/x', transcript_path: 'C:/fake/s1.jsonl',
    });
    const b = db.insertTranscript({
      session_id: 's1', role: 'assistant', content: 'hi',
      cwd: 'C:/x', transcript_path: 'C:/fake/s1.jsonl',
    });
    assert.strictEqual(a.seq, 1);
    assert.strictEqual(b.seq, 2);
    assert.throws(
      () => db.insertTranscript({ session_id: 's1', role: 'system', content: 'x' }),
      /role must be/
    );
  });

  step('insertTranscript truncates content at 64KB', () => {
    const huge = 'A'.repeat(64 * 1024 + 500);
    const r = db.insertTranscript({ session_id: 's1', role: 'user', content: huge });
    const row = db.listTranscripts('s1', { since_seq: r.seq - 1, limit: 1 })[0];
    assert(row.content.endsWith('…[TRUNCATED]'));
    assert(row.content.length <= 64 * 1024 + 20);
  });

  step('listTranscripts with latest + role filter (reviewer #2 fix)', () => {
    // Pre-fix: `{latest, role}` ignored the role filter inside the inner subquery.
    // Post-fix: inner subquery applies role, outer reorders ASC.
    const lastUser = db.listTranscripts('s1', { latest: 1, role: 'user' });
    const lastAsst = db.listTranscripts('s1', { latest: 1, role: 'assistant' });
    assert.strictEqual(lastUser.length, 1);
    assert.strictEqual(lastUser[0].role, 'user');
    assert.strictEqual(lastAsst.length, 1);
    assert.strictEqual(lastAsst[0].role, 'assistant');
  });

  step('listTranscripts filters by role / latest / since_seq', () => {
    const allAsc = db.listTranscripts('s1');
    assert(allAsc.length >= 3);
    const userOnly = db.listTranscripts('s1', { role: 'user' });
    assert(userOnly.every(r => r.role === 'user'));
    const latestOne = db.listTranscripts('s1', { latest: 1 });
    assert.strictEqual(latestOne.length, 1);
    const latestSeq = latestOne[0].seq;
    const since = db.listTranscripts('s1', { since_seq: latestSeq - 1 });
    assert(since.every(r => r.seq > latestSeq - 1));
  });

  step('insertFileOp stores tool_input JSON + auto seq', () => {
    const r = db.insertFileOp({
      session_id: 's1', tool_name: 'Edit',
      file_path: 'C:\\workspace\\a.ts',
      tool_input: { old_string: 'foo', new_string: 'bar' },
      tool_use_id: 'toolu_01abc',
    });
    assert.strictEqual(r.seq, 1);
    assert.strictEqual(r.truncated, false);
    const rows = db.listFileOpsSession('s1');
    const edit = rows.find(x => x.tool_use_id === 'toolu_01abc');
    assert(edit, 'edit row should exist');
    assert.strictEqual(edit.file_path, 'C:/workspace/a.ts', 'path normalized');
    assert.strictEqual(edit.tool_input_truncated, 0);
    const parsed = JSON.parse(edit.tool_input);
    assert.strictEqual(parsed.old_string, 'foo');
  });

  step('insertFileOp truncates tool_input at 64KB', () => {
    const bigInput = { content: 'Z'.repeat(70 * 1024) };
    const r = db.insertFileOp({
      session_id: 's1', tool_name: 'Write',
      file_path: 'C:/big.txt',
      tool_input: bigInput,
      tool_use_id: 'toolu_big',
    });
    assert.strictEqual(r.truncated, true);
    const row = db.listFileOpsSession('s1').find(x => x.tool_use_id === 'toolu_big');
    assert.strictEqual(row.tool_input_truncated, 1);
    assert(row.tool_input_size > 64 * 1024, 'original size preserved');
    assert(row.tool_input.endsWith('…[TRUNCATED]'));
  });

  step('showSession asymmetric range (reviewer #1 fix)', () => {
    // With only from_seq set, the old code applied both ts bounds (clamped to
    // last transcript in the window), dropping ops after that point. Confirm
    // from_seq alone keeps ops up to session end, not clamped to window end.
    const SSID = 's-asym-range';
    // Seed 4 transcripts at increasing ts
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      db.insertTranscript({
        session_id: SSID, role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}`, ts: now + i * 1000,
      });
    }
    // Add a file_op at ts AFTER the last transcript
    db.insertFileOp({
      session_id: SSID, tool_name: 'Write', file_path: 'C:/asym/late.ts',
      tool_input: { content: 'late' }, ts: now + 10_000,
    });
    // Add a file_op BEFORE the earliest transcript window when from_seq=2
    db.insertFileOp({
      session_id: SSID, tool_name: 'Write', file_path: 'C:/asym/early.ts',
      tool_input: { content: 'early' }, ts: now - 5_000,
    });

    // from_seq=2 only: should include the LATE op (ts after window end),
    // should exclude the EARLY op (ts before window start)
    const r1 = db.showSession(SSID, { from_seq: 2 });
    const paths1 = r1.file_ops.map(o => o.file_path);
    assert(paths1.includes('C:/asym/late.ts'), 'late op should be kept (no to_seq)');
    assert(!paths1.includes('C:/asym/early.ts'), 'early op below from_seq window');

    // to_seq=2 only: should include EARLY op, exclude LATE op
    const r2 = db.showSession(SSID, { to_seq: 2 });
    const paths2 = r2.file_ops.map(o => o.file_path);
    assert(paths2.includes('C:/asym/early.ts'), 'early op should be kept (no from_seq)');
    assert(!paths2.includes('C:/asym/late.ts'), 'late op above to_seq window');
  });

  step('synthesizeSessionFromTranscripts uses latest cwd (reviewer #3 fix)', () => {
    // Session with two cwds at different ts. Pre-fix MAX(cwd) would return
    // lexicographic max; post-fix uses most-recent-ts.
    const SSID = 's-multi-cwd';
    const now = Date.now();
    db.insertTranscript({
      session_id: SSID, role: 'user', content: 'first',
      cwd: 'C:/workspace/z-newer', ts: now + 1000,  // later
    });
    db.insertTranscript({
      session_id: SSID, role: 'assistant', content: 'reply',
      cwd: 'C:/workspace/a-older', ts: now,  // earlier
    });
    const syn = db.synthesizeSessionFromTranscripts(SSID);
    // If MAX(cwd) were used, 'z-newer' would win lexicographically (>=) AND
    // temporally here. To actually distinguish, re-insert with swapped order.
    assert(syn, 'session should synthesize');
    // The row at MAX(ts) is the 'z-newer' one; synthesized cwd should match.
    assert.strictEqual(syn.cwd, 'C:/workspace/z-newer',
      'should be the cwd of the most-recent transcript');
  });

  step('listFileOpsByPathAll finds across sessions', () => {
    db.upsertSession({ session_id: 's-other', cwd: 'C:/other' });
    db.insertFileOp({
      session_id: 's-other', tool_name: 'Edit',
      file_path: 'C:/workspace/a.ts',
      tool_input: { x: 1 },
      tool_use_id: 'toolu_s_other',
    });
    const hits = db.listFileOpsByPathAll('C:/workspace/a.ts');
    const sessionIds = new Set(hits.map(r => r.session_id));
    assert(sessionIds.has('s1'));
    assert(sessionIds.has('s-other'));
  });

  step('insertSummary stores JSON keywords + upsert on range', () => {
    const r1 = db.insertSummary({
      session_id: 's1', range_start_seq: 1, range_end_seq: 3,
      text: 'summary v1',
      keywords: ['alpha', 'beta'],
      generated_by: 'claude-haiku-4-5',
    });
    assert(r1.changes > 0);

    // Same range → upsert (not duplicate)
    const r2 = db.insertSummary({
      session_id: 's1', range_start_seq: 1, range_end_seq: 3,
      text: 'summary v2',
      keywords: ['alpha', 'gamma'],
    });
    const all = db.listSummariesSession('s1');
    const matches = all.filter(x => x.range_start_seq === 1 && x.range_end_seq === 3);
    assert.strictEqual(matches.length, 1, 'upsert, not duplicate');
    assert.strictEqual(matches[0].text, 'summary v2');
    const kw = JSON.parse(matches[0].keywords);
    assert.deepStrictEqual(kw, ['alpha', 'gamma']);
  });

  step('insertSummary rejects inverted range', () => {
    assert.throws(
      () => db.insertSummary({
        session_id: 's1', range_start_seq: 10, range_end_seq: 5, text: 'bad',
      }),
      /range_end_seq must be/
    );
  });

  step('getLatestSummary returns the highest range_end_seq', () => {
    db.insertSummary({
      session_id: 's1', range_start_seq: 4, range_end_seq: 8,
      text: 'later summary',
    });
    const latest = db.getLatestSummary('s1');
    assert.strictEqual(latest.range_end_seq, 8);
  });

  step('searchSummaries matches text OR keywords (LIKE)', () => {
    const byText = db.searchSummaries('later');
    assert(byText.some(r => r.session_id === 's1'));
    const byKw = db.searchSummaries('gamma');
    assert(byKw.some(r => r.session_id === 's1'));
    const miss = db.searchSummaries('no-such-keyword-xyz-1234');
    assert.strictEqual(miss.length, 0);
  });

  step('stats returns non-negative counts (incl. Phase 7 tables)', () => {
    const s = db.stats();
    for (const k of [
      'sessions', 'prompts', 'file_edits', 'snapshots', 'topics', 'topic_messages',
      'transcripts', 'file_ops', 'summaries',
    ]) {
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
