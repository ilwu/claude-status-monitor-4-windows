'use strict';

// /api/* routes — cross-platform. All DB access via db.js; no wmic.
// Handlers return promises; router dispatcher wraps + catches errors.

const db = require('./db');
const resolver = require('./session-resolver');
const { createRouter } = require('./router');

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

// ── response helpers ─────────────────────────────────────────────────
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

// ── request body parser ──────────────────────────────────────────────
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('body too large');
        err.statusCode = 413;
        err.code = 'payload_too_large';
        reject(err);
        // Drain rest of the stream rather than req.destroy(): destroying tears
        // down the shared socket before the dispatcher's .catch has written
        // the 413 response, and the client sees a connection reset instead.
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('invalid JSON body');
        err.statusCode = 400;
        err.code = 'bad_json';
        reject(err);
      }
    });
    req.on('error', (e) => { if (!aborted) reject(e); });
  });
}

// ── routes ───────────────────────────────────────────────────────────
const router = createRouter();

// 5.3 system
router.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    db.getDb().prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch {}
  sendJson(res, dbOk ? 200 : 500, {
    ok: dbOk,
    db_path: db.resolveDbPath(),
    pid: process.pid,
    uptime_s: Math.round(process.uptime()),
  });
});

router.get('/api/stats', async (req, res) => {
  sendJson(res, 200, db.stats());
});

// 5.1 sessions — order matters: specific before :id
router.post('/api/sessions', async (req, res) => {
  const body = await readJsonBody(req);
  if (!body || !body.session_id) {
    return sendError(res, 400, 'missing_field', 'session_id required');
  }
  const row = db.upsertSession(body);
  sendJson(res, 200, row);
});

router.get('/api/sessions', async (req, res, _params, query) => {
  const limit = clampInt(query.get('limit'), 50, 1, 500);
  const order = query.get('order') === 'created' ? 'created' : 'recent';
  sendJson(res, 200, db.listSessions({ limit, order }));
});

router.get('/api/sessions/current', async (req, res, _params, query) => {
  const cwd = query.get('cwd');
  if (!cwd) return sendError(res, 400, 'missing_param', 'cwd query param required');
  const hit = resolver.findSessionByCwd(cwd);
  if (!hit) return sendError(res, 404, 'not_found', `no session for cwd: ${cwd}`);
  // Opportunistically upsert the session row so subsequent /api/sessions/:id works
  const indexed = db.upsertSession({
    session_id: hit.session_id,
    cwd: hit.cwd,
    custom_title: hit.custom_title,
  });
  sendJson(res, 200, {
    session_id: hit.session_id,
    cwd: hit.cwd,
    custom_title: hit.custom_title,
    git_branch: hit.git_branch,
    jsonl_path: hit.jsonl_path,
    directory: hit.directory,
    matched_via: hit.matched_via,
    indexed_at: indexed.indexed_at,
  });
});

// POST /api/sessions/:id/snapshots
router.post('/api/sessions/:id/snapshots', async (req, res, params) => {
  const body = await readJsonBody(req);
  if (!body || body.summary_json == null) {
    return sendError(res, 400, 'missing_field', 'summary_json required');
  }
  ensureSessionRow(params.id, body.cwd);
  const r = db.insertSnapshot({
    session_id: params.id,
    at_prompt_seq: body.at_prompt_seq ?? null,
    summary_json: body.summary_json,
    timestamp: body.timestamp ?? null,
  });
  sendJson(res, 201, r);
});

// GET /api/sessions/:id/snapshots/latest
router.get('/api/sessions/:id/snapshots/latest', async (req, res, params) => {
  const row = db.getLatestSnapshot(params.id);
  if (!row) return sendError(res, 404, 'not_found', `no snapshots for ${params.id}`);
  sendJson(res, 200, inflateSnapshot(row));
});

// GET /api/sessions/:id/snapshots
router.get('/api/sessions/:id/snapshots', async (req, res, params) => {
  const rows = db.listSnapshotsBySession(params.id);
  sendJson(res, 200, rows.map(inflateSnapshot));
});

// GET /api/sessions/:id/recovery — JSON bundle (Markdown is CLI's job in Phase 4)
router.get('/api/sessions/:id/recovery', async (req, res, params, query) => {
  const session = db.getSession(params.id);
  if (!session) return sendError(res, 404, 'not_found', `session: ${params.id}`);
  const promptsLimit = clampInt(query.get('prompts'), 10, 1, 100);
  const editsLimit = clampInt(query.get('edits'), 20, 1, 200);
  const snapshot = db.getLatestSnapshot(params.id);
  sendJson(res, 200, {
    session,
    latest_snapshot: snapshot ? inflateSnapshot(snapshot) : null,
    recent_prompts: db.listPromptsBySession(params.id, { limit: promptsLimit }),
    recent_file_edits: db.listFileEditsBySession(params.id, { limit: editsLimit }),
  });
});

// POST /api/sessions/:id/prompts
router.post('/api/sessions/:id/prompts', async (req, res, params) => {
  const body = await readJsonBody(req);
  ensureSessionRow(params.id);
  const r = db.insertPrompt({
    session_id: params.id,
    prompt_seq: body.prompt_seq ?? null,
    text_preview: body.text_preview ?? null,
    timestamp: body.timestamp ?? null,
  });
  sendJson(res, 201, r);
});

// POST /api/sessions/:id/file-edits
router.post('/api/sessions/:id/file-edits', async (req, res, params) => {
  const body = await readJsonBody(req);
  if (!body.file_path) return sendError(res, 400, 'missing_field', 'file_path required');
  ensureSessionRow(params.id);
  const r = db.insertFileEdit({
    session_id: params.id,
    file_path: body.file_path,
    operation: body.operation ?? null,
    timestamp: body.timestamp ?? null,
  });
  sendJson(res, 201, r);
});

// GET /api/sessions/:id — must be registered LAST among /api/sessions/:id*
router.get('/api/sessions/:id', async (req, res, params) => {
  const row = db.getSession(params.id);
  if (!row) return sendError(res, 404, 'not_found', `session: ${params.id}`);
  sendJson(res, 200, row);
});

// ── 5.2 topics — order matters: :id/messages + :id/close before bare :id ─
router.post('/api/topics', async (req, res) => {
  const body = await readJsonBody(req);
  const title = body.title ?? null;
  const author = body.author ?? null;
  const firstMessage = body.first_message;
  if (firstMessage != null) {
    const r = db.createTopicWithFirstMessage({ title, author, content: firstMessage });
    return sendJson(res, 201, { id: r.topic.id, topic: r.topic, first_message: r.message });
  }
  const topic = db.createTopic({ title });
  sendJson(res, 201, { id: topic.id, topic });
});

const VALID_TOPIC_STATUSES = new Set(['active', 'closed']);

router.get('/api/topics', async (req, res, _params, query) => {
  const statusRaw = query.get('status');
  if (statusRaw != null && !VALID_TOPIC_STATUSES.has(statusRaw)) {
    return sendError(res, 400, 'bad_param', `status must be one of: ${[...VALID_TOPIC_STATUSES].join(', ')}`);
  }
  const status = statusRaw || null;
  const limit = clampInt(query.get('limit'), 50, 1, 500);
  const recentRaw = query.get('recent');
  let since_ms = null;
  if (recentRaw) {
    const m = recentRaw.match(/^(\d+)([smhd])$/);
    if (!m) return sendError(res, 400, 'bad_param', 'recent must match \\d+[smhd]');
    const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
    since_ms = parseInt(m[1], 10) * mult;
  }
  sendJson(res, 200, db.listTopics({ status, limit, since_ms }));
});

router.post('/api/topics/:id/messages', async (req, res, params) => {
  const body = await readJsonBody(req);
  if (body.content == null) return sendError(res, 400, 'missing_field', 'content required');
  try {
    const r = db.insertTopicMessage({
      topic_id: params.id,
      author: body.author ?? null,
      content: body.content,
    });
    sendJson(res, 201, r);
  } catch (e) {
    if (/topic not found/.test(e.message)) {
      return sendError(res, 404, 'not_found', e.message);
    }
    throw e;
  }
});

router.post('/api/topics/:id/close', async (req, res, params) => {
  const ok = db.closeTopic(params.id);
  if (!ok) return sendError(res, 404, 'not_found', `topic: ${params.id}`);
  sendJson(res, 200, db.getTopic(params.id));
});

// GET /api/topics/:id — must be LAST among /api/topics/:id*
router.get('/api/topics/:id', async (req, res, params, query) => {
  const topic = db.getTopic(params.id);
  if (!topic) return sendError(res, 404, 'not_found', `topic: ${params.id}`);
  const opts = {};
  const latest = query.get('latest');
  const since = query.get('since');
  if (latest != null) opts.latest = clampInt(latest, 10, 1, 1000);
  if (since != null) {
    const n = parseInt(since, 10);
    if (!Number.isFinite(n)) return sendError(res, 400, 'bad_param', 'since must be integer');
    opts.since_seq = n;
  }
  let messages = db.listTopicMessages(params.id, opts);
  if (query.get('summary') === 'true') {
    messages = messages.map(m => {
      const c = m.content || '';
      return {
        ...m,
        content: c.length > 80 ? c.slice(0, 80) + '…' : c,
        content_length: c.length,
      };
    });
  }
  sendJson(res, 200, { topic, messages });
});

// ── helpers ──────────────────────────────────────────────────────────
function clampInt(raw, defaultVal, min, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.min(Math.max(n, min), max);
}

function ensureSessionRow(session_id, cwd) {
  if (!db.getSession(session_id)) {
    db.upsertSession({ session_id, cwd: cwd ?? null });
  }
}

function inflateSnapshot(row) {
  if (!row) return null;
  let summary = null;
  try { summary = JSON.parse(row.summary_json); } catch {}
  return { ...row, summary };
}

// ── dispatcher ───────────────────────────────────────────────────────
// Returns true if request was handled (including error cases).
// Returns false if no route matched → caller falls through to legacy handler.
function dispatch(req, res) {
  if (!req.url || !req.url.startsWith('/api/')) return false;
  const hit = router.match(req.method || 'GET', req.url);
  if (!hit) {
    sendError(res, 404, 'route_not_found', `${req.method} ${req.url}`);
    return true;
  }
  Promise.resolve()
    .then(() => hit.handler(req, res, hit.params, hit.query))
    .catch(err => {
      if (res.headersSent) return;
      const status = err.statusCode || 500;
      const code = err.code || 'internal_error';
      sendError(res, status, code, err.message || 'internal error');
      if (status >= 500) {
        console.error('[api]', req.method, req.url, err);
      }
    });
  return true;
}

module.exports = { dispatch, router };
