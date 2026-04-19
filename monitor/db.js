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

  stats,
};
