'use strict';

// Minitor memory API — SQLite layer.
// Idempotent init + DAO for sessions, prompts, file edits, snapshots, topics.
// Cross-platform: no wmic/OS-specific calls here. better-sqlite3 sync API.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'memory.db');

let db = null;

function resolveDbPath() {
  return process.env.MINITOR_DB_PATH || DEFAULT_DB_PATH;
}

function init(dbPath) {
  if (db) return db;
  const p = dbPath || resolveDbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  migrate();
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

function getDb() {
  if (!db) throw new Error('db not initialized; call init() first');
  return db;
}

// ── Schema (idempotent) ──────────────────────────────────────────────
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id     TEXT PRIMARY KEY,
      custom_title   TEXT,
      cwd            TEXT,
      created_at     INTEGER,
      last_active_at INTEGER,
      message_count  INTEGER,
      indexed_at     INTEGER
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT REFERENCES sessions(session_id),
      prompt_seq   INTEGER,
      text_preview TEXT,
      timestamp    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id, prompt_seq);

    CREATE TABLE IF NOT EXISTS file_edits (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(session_id),
      file_path  TEXT,
      operation  TEXT,
      timestamp  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_file_edits_path ON file_edits(file_path);
    CREATE INDEX IF NOT EXISTS idx_file_edits_session ON file_edits(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT REFERENCES sessions(session_id),
      snapshot_seq  INTEGER,
      at_prompt_seq INTEGER,
      summary_json  TEXT,
      timestamp     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_session_seq ON snapshots(session_id, snapshot_seq);

    CREATE TABLE IF NOT EXISTS topics (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      status     TEXT DEFAULT 'active',
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_topics_updated ON topics(updated_at DESC);

    CREATE TABLE IF NOT EXISTS topic_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id   TEXT REFERENCES topics(id),
      seq        INTEGER,
      author     TEXT,
      content    TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_topic_messages ON topic_messages(topic_id, seq);

    -- Phase 7: transcripts / file_ops / summaries.
    -- Distinct from the Phase 1 'prompts' + 'file_edits' tables (which store
    -- 200-char preview metadata only). These new tables are populated by
    -- Claude Code hooks (UserPromptSubmit / Stop / PostToolUse) and hold the
    -- full per-session event stream needed for cross-session recovery.

    CREATE TABLE IF NOT EXISTS transcripts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      seq             INTEGER NOT NULL,
      role            TEXT NOT NULL,
      content         TEXT,
      cwd             TEXT,
      transcript_path TEXT,
      ts              INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_session_seq
      ON transcripts(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_transcripts_session_ts
      ON transcripts(session_id, ts);

    CREATE TABLE IF NOT EXISTS file_ops (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id           TEXT NOT NULL,
      seq                  INTEGER NOT NULL,
      tool_name            TEXT NOT NULL,
      file_path            TEXT,
      tool_input           TEXT,
      tool_input_size      INTEGER NOT NULL DEFAULT 0,
      tool_input_truncated INTEGER NOT NULL DEFAULT 0,
      tool_use_id          TEXT,
      ts                   INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_ops_session_seq
      ON file_ops(session_id, seq);
    CREATE INDEX IF NOT EXISTS idx_file_ops_file ON file_ops(file_path);
    CREATE INDEX IF NOT EXISTS idx_file_ops_tool_use ON file_ops(tool_use_id);

    CREATE TABLE IF NOT EXISTS summaries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      range_start_seq INTEGER NOT NULL,
      range_end_seq   INTEGER NOT NULL,
      text            TEXT NOT NULL,
      keywords        TEXT,
      generated_by    TEXT,
      ts              INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_summaries_session_range
      ON summaries(session_id, range_start_seq, range_end_seq);
    CREATE INDEX IF NOT EXISTS idx_summaries_session_end
      ON summaries(session_id, range_end_seq);
  `);
}

// ── sessions DAO ─────────────────────────────────────────────────────
function upsertSession({ session_id, custom_title = null, cwd = null, created_at = null, last_active_at = null, message_count = null }) {
  if (!session_id) throw new Error('session_id required');
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (session_id, custom_title, cwd, created_at, last_active_at, message_count, indexed_at)
    VALUES (@session_id, @custom_title, @cwd, @created_at, @last_active_at, @message_count, @indexed_at)
    ON CONFLICT(session_id) DO UPDATE SET
      custom_title   = COALESCE(excluded.custom_title, sessions.custom_title),
      cwd            = COALESCE(excluded.cwd, sessions.cwd),
      last_active_at = COALESCE(excluded.last_active_at, sessions.last_active_at),
      message_count  = COALESCE(excluded.message_count, sessions.message_count),
      indexed_at     = excluded.indexed_at
  `).run({
    session_id,
    custom_title,
    cwd,
    created_at: created_at ?? now,
    last_active_at: last_active_at ?? now,
    message_count,
    indexed_at: now,
  });
  return getSession(session_id);
}

function getSession(session_id) {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session_id) || null;
}

function listSessions({ limit = 50, order = 'recent' } = {}) {
  const orderBy = order === 'created' ? 'created_at DESC' : 'last_active_at DESC';
  return db.prepare(`SELECT * FROM sessions ORDER BY ${orderBy} LIMIT ?`).all(limit);
}

// ── prompts DAO ──────────────────────────────────────────────────────
function insertPrompt({ session_id, prompt_seq, text_preview = null, timestamp = null }) {
  if (!session_id) throw new Error('session_id required');
  const preview = text_preview ? String(text_preview).slice(0, 200) : null;
  const r = db.prepare(`
    INSERT INTO prompts (session_id, prompt_seq, text_preview, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(session_id, prompt_seq ?? null, preview, timestamp ?? Date.now());
  return { id: r.lastInsertRowid };
}

function listPromptsBySession(session_id, { limit = 10 } = {}) {
  return db.prepare(`
    SELECT * FROM prompts WHERE session_id = ?
    ORDER BY prompt_seq DESC, id DESC LIMIT ?
  `).all(session_id, limit);
}

// ── file_edits DAO ───────────────────────────────────────────────────
function normalizeFilePath(p) {
  if (!p) return null;
  let s = String(p).slice(0, 1024);
  s = s.replace(/\\/g, '/');
  return s;
}

function insertFileEdit({ session_id, file_path, operation = null, timestamp = null }) {
  if (!session_id) throw new Error('session_id required');
  const r = db.prepare(`
    INSERT INTO file_edits (session_id, file_path, operation, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(session_id, normalizeFilePath(file_path), operation, timestamp ?? Date.now());
  return { id: r.lastInsertRowid };
}

function listFileEditsBySession(session_id, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM file_edits WHERE session_id = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(session_id, limit);
}

function listFileEditsByPath(file_path, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM file_edits WHERE file_path = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(normalizeFilePath(file_path), limit);
}

// ── snapshots DAO ────────────────────────────────────────────────────
function insertSnapshot({ session_id, at_prompt_seq = null, summary_json, timestamp = null }) {
  if (!session_id) throw new Error('session_id required');
  if (summary_json == null) throw new Error('summary_json required');
  const payload = typeof summary_json === 'string' ? summary_json : JSON.stringify(summary_json);
  // Same SELECT MAX+1 / INSERT pattern as insertTopicMessage — wrap in a
  // transaction so the two statements stay atomic if we ever introduce
  // concurrent writers (workers / async wrapper).
  const tx = db.transaction(() => {
    const nextSeq = db.prepare(
      'SELECT COALESCE(MAX(snapshot_seq), 0) + 1 AS next FROM snapshots WHERE session_id = ?'
    ).get(session_id).next;
    const r = db.prepare(`
      INSERT INTO snapshots (session_id, snapshot_seq, at_prompt_seq, summary_json, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(session_id, nextSeq, at_prompt_seq, payload, timestamp ?? Date.now());
    return { id: r.lastInsertRowid, snapshot_seq: nextSeq };
  });
  return tx();
}

function getLatestSnapshot(session_id) {
  return db.prepare(`
    SELECT * FROM snapshots WHERE session_id = ?
    ORDER BY snapshot_seq DESC LIMIT 1
  `).get(session_id) || null;
}

function listSnapshotsBySession(session_id) {
  return db.prepare(`
    SELECT * FROM snapshots WHERE session_id = ?
    ORDER BY snapshot_seq ASC
  `).all(session_id);
}

// ── topics DAO ───────────────────────────────────────────────────────
function generateTopicId() {
  return 't-' + crypto.randomBytes(4).toString('hex');
}

function createTopic({ title = null, status = 'active' } = {}) {
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateTopicId();
    try {
      db.prepare(`
        INSERT INTO topics (id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, title, status, now, now);
      return getTopic(id);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') continue;
      throw e;
    }
  }
  throw new Error('failed to generate unique topic id after 5 attempts');
}

function getTopic(id) {
  return db.prepare('SELECT * FROM topics WHERE id = ?').get(id) || null;
}

function listTopics({ status = null, limit = 50, since_ms = null } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (since_ms != null) {
    where.push('updated_at >= ?');
    params.push(Date.now() - since_ms);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(limit);
  return db.prepare(
    `SELECT * FROM topics ${whereSql} ORDER BY updated_at DESC LIMIT ?`
  ).all(...params);
}

// Create topic + first message atomically (both live or neither).
function createTopicWithFirstMessage({ title = null, author = null, content, status = 'active' }) {
  if (content == null) throw new Error('content required');
  const tx = db.transaction(() => {
    const now = Date.now();
    let id = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateTopicId();
      try {
        db.prepare(`
          INSERT INTO topics (id, title, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(candidate, title, status, now, now);
        id = candidate;
        break;
      } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') continue;
        throw e;
      }
    }
    if (!id) throw new Error('failed to generate unique topic id after 5 attempts');
    const r = db.prepare(`
      INSERT INTO topic_messages (topic_id, seq, author, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, 1, author, String(content), now);
    return {
      topic: getTopic(id),
      message: { id: r.lastInsertRowid, seq: 1 },
    };
  });
  return tx();
}

function closeTopic(id) {
  const r = db.prepare(`
    UPDATE topics SET status = 'closed', updated_at = ? WHERE id = ?
  `).run(Date.now(), id);
  return r.changes > 0;
}

// ── topic_messages DAO ───────────────────────────────────────────────
function insertTopicMessage({ topic_id, author = null, content, created_at = null }) {
  if (!topic_id) throw new Error('topic_id required');
  if (content == null) throw new Error('content required');
  const now = created_at ?? Date.now();
  const tx = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM topics WHERE id = ?').get(topic_id)) {
      throw new Error(`topic not found: ${topic_id}`);
    }
    const nextSeq = db.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM topic_messages WHERE topic_id = ?'
    ).get(topic_id).next;
    const r = db.prepare(`
      INSERT INTO topic_messages (topic_id, seq, author, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(topic_id, nextSeq, author, String(content), now);
    db.prepare('UPDATE topics SET updated_at = ? WHERE id = ?').run(now, topic_id);
    return { id: r.lastInsertRowid, seq: nextSeq };
  });
  return tx();
}

function listTopicMessages(topic_id, { limit = null, since_seq = null, latest = null } = {}) {
  // latest=N → last N messages, returned in ASC order.
  if (latest != null) {
    return db.prepare(`
      SELECT * FROM (
        SELECT * FROM topic_messages WHERE topic_id = ?
        ORDER BY seq DESC LIMIT ?
      ) ORDER BY seq ASC
    `).all(topic_id, latest);
  }
  let sql = 'SELECT * FROM topic_messages WHERE topic_id = ?';
  const params = [topic_id];
  if (since_seq != null) {
    sql += ' AND seq > ?';
    params.push(since_seq);
  }
  sql += ' ORDER BY seq ASC';
  if (limit != null) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  return db.prepare(sql).all(...params);
}

// ── transcripts DAO (Phase 7) ────────────────────────────────────────
// Populated by UserPromptSubmit / Stop hooks. Stores the condensed per-turn
// text (user's prompt; assistant's final message) — not the tool_use stream.
// Hard size cap so a pathological pasted file can't swell the DB.
const TRANSCRIPT_CONTENT_MAX = 64 * 1024;

function insertTranscript({ session_id, role, content = null, cwd = null, transcript_path = null, ts = null }) {
  if (!session_id) throw new Error('session_id required');
  if (role !== 'user' && role !== 'assistant') {
    throw new Error('role must be "user" or "assistant"');
  }
  let stored = content == null ? null : String(content);
  if (stored && stored.length > TRANSCRIPT_CONTENT_MAX) {
    stored = stored.slice(0, TRANSCRIPT_CONTENT_MAX) + '…[TRUNCATED]';
  }
  const tx = db.transaction(() => {
    const nextSeq = db.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM transcripts WHERE session_id = ?'
    ).get(session_id).next;
    const r = db.prepare(`
      INSERT INTO transcripts (session_id, seq, role, content, cwd, transcript_path, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(session_id, nextSeq, role, stored, cwd, transcript_path, ts ?? Date.now());
    return { id: r.lastInsertRowid, seq: nextSeq };
  });
  return tx();
}

function listTranscripts(session_id, { limit = null, since_seq = null, role = null, latest = null } = {}) {
  if (latest != null) {
    // Apply role filter inside the inner DESC query; otherwise
    // `{latest: 5, role: 'user'}` silently returned 5 mixed-role rows.
    const roleClause = role ? ' AND role = ?' : '';
    const inner = `
      SELECT * FROM transcripts WHERE session_id = ?${roleClause}
      ORDER BY seq DESC LIMIT ?
    `;
    const innerParams = role ? [session_id, role, latest] : [session_id, latest];
    return db.prepare(`SELECT * FROM (${inner}) ORDER BY seq ASC`).all(...innerParams);
  }
  let sql = 'SELECT * FROM transcripts WHERE session_id = ?';
  const params = [session_id];
  if (role) { sql += ' AND role = ?'; params.push(role); }
  if (since_seq != null) { sql += ' AND seq > ?'; params.push(since_seq); }
  sql += ' ORDER BY seq ASC';
  if (limit != null) { sql += ' LIMIT ?'; params.push(limit); }
  return db.prepare(sql).all(...params);
}

// ── file_ops DAO (Phase 7) ───────────────────────────────────────────
// Populated by PostToolUse(Edit|Write|NotebookEdit) hooks. Stores the raw
// tool_input JSON (may be truncated above cap) — no before-state, no diff
// computation. Git history is the authoritative "before".
const FILE_OP_TOOL_INPUT_MAX = 64 * 1024;

function insertFileOp({ session_id, tool_name, file_path = null, tool_input = null, tool_use_id = null, ts = null }) {
  if (!session_id) throw new Error('session_id required');
  if (!tool_name) throw new Error('tool_name required');
  const normalizedPath = file_path ? normalizeFilePath(file_path) : null;

  // Serialize tool_input (accept object or pre-stringified)
  let raw = null;
  if (tool_input != null) {
    raw = typeof tool_input === 'string' ? tool_input : JSON.stringify(tool_input);
  }
  const originalSize = raw == null ? 0 : Buffer.byteLength(raw, 'utf8');
  let truncated = 0;
  if (raw && originalSize > FILE_OP_TOOL_INPUT_MAX) {
    // Truncate by byte count; Buffer.toString('utf8') handles mid-char bytes
    // by emitting the replacement char for the trailing partial sequence —
    // acceptable (the stored value is no longer valid JSON anyway; consumers
    // check tool_input_truncated before JSON.parse).
    const buf = Buffer.from(raw, 'utf8').slice(0, FILE_OP_TOOL_INPUT_MAX);
    raw = buf.toString('utf8') + '…[TRUNCATED]';
    truncated = 1;
  }

  const tx = db.transaction(() => {
    const nextSeq = db.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM file_ops WHERE session_id = ?'
    ).get(session_id).next;
    const r = db.prepare(`
      INSERT INTO file_ops
        (session_id, seq, tool_name, file_path, tool_input,
         tool_input_size, tool_input_truncated, tool_use_id, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session_id, nextSeq, tool_name, normalizedPath, raw,
      originalSize, truncated, tool_use_id, ts ?? Date.now()
    );
    return { id: r.lastInsertRowid, seq: nextSeq, truncated: !!truncated };
  });
  return tx();
}

function listFileOpsSession(session_id, { limit = null, since_seq = null, latest = null } = {}) {
  if (latest != null) {
    return db.prepare(`
      SELECT * FROM (
        SELECT * FROM file_ops WHERE session_id = ?
        ORDER BY seq DESC LIMIT ?
      ) ORDER BY seq ASC
    `).all(session_id, latest);
  }
  let sql = 'SELECT * FROM file_ops WHERE session_id = ?';
  const params = [session_id];
  if (since_seq != null) { sql += ' AND seq > ?'; params.push(since_seq); }
  sql += ' ORDER BY seq ASC';
  if (limit != null) { sql += ' LIMIT ?'; params.push(limit); }
  return db.prepare(sql).all(...params);
}

function listFileOpsByPathAll(file_path, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM file_ops WHERE file_path = ?
    ORDER BY ts DESC LIMIT ?
  `).all(normalizeFilePath(file_path), limit);
}

// Session listing derived from transcripts — sessions show up here only
// after the hook has recorded at least one turn. Filters by cwd if given.
// Synthesize session metadata purely from transcripts — for sessions the
// hook recorded without anyone ever calling upsertSession. Returns null
// when the session has no transcripts either.
//
// cwd and transcript_path use the most-recent entry (ORDER BY ts DESC LIMIT 1)
// rather than SQL MAX(), because MAX() is lexicographic and would return
// 'C:/workspace/b' over 'C:/workspace/a' regardless of chronology.
function synthesizeSessionFromTranscripts(session_id) {
  const agg = db.prepare(`
    SELECT
      session_id,
      MIN(ts)    AS created_at,
      MAX(ts)    AS last_active_at,
      COUNT(*)   AS entry_count
    FROM transcripts
    WHERE session_id = ?
    GROUP BY session_id
  `).get(session_id);
  if (!agg || !agg.session_id) return null;
  const latest = db.prepare(`
    SELECT cwd, transcript_path
    FROM transcripts WHERE session_id = ?
    ORDER BY ts DESC LIMIT 1
  `).get(session_id);
  return {
    session_id: agg.session_id,
    custom_title: null,
    cwd: latest ? latest.cwd : null,
    created_at: agg.created_at,
    last_active_at: agg.last_active_at,
    message_count: agg.entry_count,
    transcript_path: latest ? latest.transcript_path : null,
    indexed_at: null,
  };
}

function listTranscriptSessions({ cwd = null, limit = 20 } = {}) {
  const hasCwd = cwd != null;
  const sql = `
    SELECT
      session_id,
      MAX(ts)    AS last_ts,
      MIN(ts)    AS first_ts,
      COUNT(*)   AS entry_count,
      MAX(cwd)   AS cwd
    FROM transcripts
    ${hasCwd ? 'WHERE cwd = ?' : ''}
    GROUP BY session_id
    ORDER BY last_ts DESC
    LIMIT ?
  `;
  const params = hasCwd ? [cwd, limit] : [limit];
  return db.prepare(sql).all(...params);
}

// Return transcripts + file_ops for a session, optionally windowed by
// transcript seq. file_ops are aligned to the transcript window's ts range
// (seqs are independent between the two tables; ts is the cross-table key).
function showSession(session_id, { from_seq = null, to_seq = null } = {}) {
  let tranSql = 'SELECT * FROM transcripts WHERE session_id = ?';
  const tranParams = [session_id];
  if (from_seq != null) { tranSql += ' AND seq >= ?'; tranParams.push(from_seq); }
  if (to_seq != null)   { tranSql += ' AND seq <= ?'; tranParams.push(to_seq); }
  tranSql += ' ORDER BY seq ASC';
  const transcripts = db.prepare(tranSql).all(...tranParams);

  // File-ops windowing: align only the bounds the caller actually specified.
  // Previously we applied both bounds whenever either was set, which silently
  // dropped ops before the first matching transcript (when only `to_seq` was
  // given) or after the last (when only `from_seq` was given).
  let opsSql = 'SELECT * FROM file_ops WHERE session_id = ?';
  const opsParams = [session_id];
  if (transcripts.length > 0) {
    if (from_seq != null) {
      opsSql += ' AND ts >= ?';
      opsParams.push(transcripts[0].ts);
    }
    if (to_seq != null) {
      opsSql += ' AND ts <= ?';
      opsParams.push(transcripts[transcripts.length - 1].ts);
    }
  }
  opsSql += ' ORDER BY seq ASC';
  const file_ops = db.prepare(opsSql).all(...opsParams);

  return { session_id, transcripts, file_ops };
}

// ── summaries DAO (Phase 7) ──────────────────────────────────────────
// Populated by LLM summary generation (Phase 7 P4+). Each row covers a
// contiguous range of transcript seqs for a given session.

function insertSummary({ session_id, range_start_seq, range_end_seq, text, keywords = null, generated_by = null, ts = null }) {
  if (!session_id) throw new Error('session_id required');
  if (range_start_seq == null || range_end_seq == null) {
    throw new Error('range_start_seq and range_end_seq required');
  }
  if (range_end_seq < range_start_seq) {
    throw new Error('range_end_seq must be >= range_start_seq');
  }
  if (!text) throw new Error('text required');
  const kw = keywords == null
    ? null
    : (typeof keywords === 'string' ? keywords : JSON.stringify(keywords));
  // ON CONFLICT REPLACE: re-generating the same range updates in place
  const r = db.prepare(`
    INSERT INTO summaries
      (session_id, range_start_seq, range_end_seq, text, keywords, generated_by, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, range_start_seq, range_end_seq) DO UPDATE SET
      text         = excluded.text,
      keywords     = excluded.keywords,
      generated_by = excluded.generated_by,
      ts           = excluded.ts
  `).run(session_id, range_start_seq, range_end_seq, text, kw, generated_by, ts ?? Date.now());
  return { id: r.lastInsertRowid || null, changes: r.changes };
}

function getLatestSummary(session_id) {
  return db.prepare(`
    SELECT * FROM summaries WHERE session_id = ?
    ORDER BY range_end_seq DESC LIMIT 1
  `).get(session_id) || null;
}

function listSummariesSession(session_id) {
  return db.prepare(`
    SELECT * FROM summaries WHERE session_id = ?
    ORDER BY range_start_seq ASC
  `).all(session_id);
}

// Naive full-text search across summary text + keywords. LIKE is plenty at
// the scale we expect (thousands of summaries, not millions). FTS5 is a
// future option if this ever becomes the bottleneck.
function searchSummaries(q, { limit = 10 } = {}) {
  if (!q) return [];
  const pattern = `%${q}%`;
  return db.prepare(`
    SELECT * FROM summaries
    WHERE text LIKE ? OR keywords LIKE ?
    ORDER BY ts DESC LIMIT ?
  `).all(pattern, pattern, limit);
}

// ── stats DAO ────────────────────────────────────────────────────────
function stats() {
  const row = (q, ...a) => db.prepare(q).get(...a);
  return {
    sessions:       row('SELECT COUNT(*) AS n FROM sessions').n,
    prompts:        row('SELECT COUNT(*) AS n FROM prompts').n,
    file_edits:     row('SELECT COUNT(*) AS n FROM file_edits').n,
    snapshots:      row('SELECT COUNT(*) AS n FROM snapshots').n,
    topics:         row('SELECT COUNT(*) AS n FROM topics').n,
    topics_active:  row("SELECT COUNT(*) AS n FROM topics WHERE status = 'active'").n,
    topic_messages: row('SELECT COUNT(*) AS n FROM topic_messages').n,
    transcripts:    row('SELECT COUNT(*) AS n FROM transcripts').n,
    file_ops:       row('SELECT COUNT(*) AS n FROM file_ops').n,
    summaries:      row('SELECT COUNT(*) AS n FROM summaries').n,
    db_path:        resolveDbPath(),
  };
}

module.exports = {
  init,
  close,
  getDb,
  resolveDbPath,

  upsertSession,
  getSession,
  listSessions,

  insertPrompt,
  listPromptsBySession,

  insertFileEdit,
  listFileEditsBySession,
  listFileEditsByPath,

  insertSnapshot,
  getLatestSnapshot,
  listSnapshotsBySession,

  generateTopicId,
  createTopic,
  createTopicWithFirstMessage,
  getTopic,
  listTopics,
  closeTopic,

  insertTopicMessage,
  listTopicMessages,

  // Phase 7: transcripts / file_ops / summaries
  insertTranscript,
  listTranscripts,

  insertFileOp,
  listFileOpsSession,
  listFileOpsByPathAll,
  listTranscriptSessions,
  showSession,
  synthesizeSessionFromTranscripts,

  insertSummary,
  getLatestSummary,
  listSummariesSession,
  searchSummaries,

  stats,
};
