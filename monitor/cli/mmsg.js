#!/usr/bin/env node
'use strict';

// mmsg — CLI for Minitor Memory API. Zero external deps (node built-ins only).
// Named `mmsg` (minitor message) rather than `msg` because Windows ships a
// built-in `msg.exe` (Remote Desktop Services message tool) that shadows any
// `msg` on PATH and would confuse users.
//
// Commands:
//   mmsg topic-new    --title=<s> [--author=<s>] [<<< first message]
//   mmsg topic-add    <topic-id> [--author=<s>] [<<< content]
//   mmsg topic-show   <topic-id> [--latest=N] [--since=<seq>] [--summary]
//   mmsg topic-list   [--status=active] [--recent=24h] [--limit=50]
//   mmsg snapshot     [--session=<id>] [--at-prompt=<n>] <<< summary JSON
//   mmsg recovery     [--session=<id>] [--prompts=10] [--edits=20] [--json]
//   mmsg help [command]
//
// Exit codes: 0 ok / 1 api error / 2 usage / 3 server unreachable.

const http = require('http');
const path = require('path');
const process_ = process;

const PORT = parseInt(process_.env.MINITOR_PORT, 10) || 19823;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

// ── arg parsing ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        args.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          args.flags[name] = next;
          i++;
        } else {
          args.flags[name] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ── stdin ────────────────────────────────────────────────────────────
function readStdin() {
  return new Promise((resolve) => {
    if (process_.stdin.isTTY) return resolve('');
    const chunks = [];
    process_.stdin.on('data', c => chunks.push(c));
    process_.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// ── http client ──────────────────────────────────────────────────────
function apiRequest(method, pathUrl, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: HOST, port: PORT, method, path: pathUrl,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : {},
      timeout: 5000,
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
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        err.serverDown = true;
      }
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── formatting helpers ───────────────────────────────────────────────
function fmtTs(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function die(code, msg) {
  if (msg) process_.stderr.write(msg.endsWith('\n') ? msg : msg + '\n');
  process_.exit(code);
}

function apiErr(r, context) {
  const msg = r.body && r.body.error
    ? `${context}: ${r.body.error.code} — ${r.body.error.message}`
    : `${context}: HTTP ${r.status}`;
  die(1, msg);
}

function requireArg(args, name, usage) {
  if (!args.flags[name] && typeof args.flags[name] !== 'string') {
    die(2, `missing --${name}\n${usage}`);
  }
  return args.flags[name];
}

// ── session resolution (for snapshot / recovery) ─────────────────────
async function resolveSessionId(args) {
  if (args.flags.session && typeof args.flags.session === 'string') {
    return args.flags.session;
  }
  const cwd = process_.cwd();
  const r = await apiRequest('GET', `/api/sessions/current?cwd=${encodeURIComponent(cwd)}`);
  if (r.status === 200 && r.body.session_id) return r.body.session_id;
  if (r.status === 404) {
    die(2, `no session found for cwd=${cwd}\n` +
          `  Start a Claude Code session here, or pass --session=<id>.`);
  }
  apiErr(r, 'resolve session');
}

// ── commands ─────────────────────────────────────────────────────────
const COMMANDS = {};

COMMANDS['topic-new'] = {
  help: 'mmsg topic-new --title=<s> [--author=<s>] [<stdin first message>]',
  describe: 'Create a new topic. Prints the topic id on stdout.',
  async run(args) {
    const title = args.flags.title && typeof args.flags.title === 'string'
      ? args.flags.title
      : null;
    const author = typeof args.flags.author === 'string' ? args.flags.author : null;
    const stdin = (await readStdin()).trim();
    const body = { title, author };
    if (stdin) body.first_message = stdin;
    const r = await apiRequest('POST', '/api/topics', body);
    if (r.status !== 201) return apiErr(r, 'topic-new');
    process_.stdout.write(r.body.id + '\n');
  },
};

COMMANDS['topic-add'] = {
  help: 'mmsg topic-add <topic-id> [--author=<s>] <stdin content>',
  describe: 'Append a message to a topic. Content comes from stdin.',
  async run(args) {
    const topicId = args._[1];
    if (!topicId) die(2, COMMANDS['topic-add'].help);
    const author = typeof args.flags.author === 'string' ? args.flags.author : null;
    const content = (await readStdin()).replace(/\s+$/, '');
    if (!content) die(2, `no content on stdin\n${COMMANDS['topic-add'].help}`);
    const r = await apiRequest('POST', `/api/topics/${encodeURIComponent(topicId)}/messages`, {
      author, content,
    });
    if (r.status !== 201) return apiErr(r, 'topic-add');
    process_.stdout.write(`ok seq=${r.body.seq}\n`);
  },
};

COMMANDS['topic-show'] = {
  help: 'mmsg topic-show <topic-id> [--latest=N] [--since=<seq>] [--summary]',
  describe: 'Print the full thread (or a slice of it).',
  async run(args) {
    const topicId = args._[1];
    if (!topicId) die(2, COMMANDS['topic-show'].help);
    const q = new URLSearchParams();
    if (args.flags.latest) q.set('latest', String(args.flags.latest));
    if (args.flags.since)  q.set('since',  String(args.flags.since));
    if (args.flags.summary) q.set('summary', 'true');
    const suffix = q.toString() ? '?' + q.toString() : '';
    const r = await apiRequest('GET', `/api/topics/${encodeURIComponent(topicId)}${suffix}`);
    if (r.status === 404) return die(1, `topic not found: ${topicId}`);
    if (r.status !== 200) return apiErr(r, 'topic-show');
    const { topic, messages } = r.body;
    const out = [];
    out.push(`Topic:   ${topic.id}   [${topic.status}]`);
    if (topic.title) out.push(`Title:   ${topic.title}`);
    out.push(`Created: ${fmtTs(topic.created_at)}   Updated: ${fmtTs(topic.updated_at)}`);
    out.push(`Messages: ${messages.length}` + (args.flags.latest ? ` (latest ${args.flags.latest})` : ''));
    out.push('---');
    for (const m of messages) {
      const authorStr = m.author ? `[${m.author}]` : '[-]';
      const tLen = m.content_length != null && m.content_length > (m.content || '').length
        ? `  (…truncated from ${m.content_length})` : '';
      out.push(`#${m.seq} ${authorStr} ${fmtTs(m.created_at)}${tLen}`);
      for (const line of String(m.content || '').split('\n')) {
        out.push('  ' + line);
      }
      out.push('');
    }
    process_.stdout.write(out.join('\n'));
  },
};

COMMANDS['topic-list'] = {
  help: 'mmsg topic-list [--status=active] [--recent=24h] [--limit=50]',
  describe: 'List topics, most-recently-updated first.',
  async run(args) {
    const q = new URLSearchParams();
    if (args.flags.status) q.set('status', String(args.flags.status));
    if (args.flags.recent) q.set('recent', String(args.flags.recent));
    if (args.flags.limit)  q.set('limit',  String(args.flags.limit));
    const suffix = q.toString() ? '?' + q.toString() : '';
    const r = await apiRequest('GET', `/api/topics${suffix}`);
    if (r.status !== 200) return apiErr(r, 'topic-list');
    if (r.body.length === 0) {
      process_.stdout.write('(no topics)\n');
      return;
    }
    const lines = [];
    for (const t of r.body) {
      const status = (t.status + '      ').slice(0, 7);
      lines.push(
        `${t.id}  ${status}  ${fmtTs(t.updated_at)}  ${t.title || ''}`
      );
    }
    process_.stdout.write(lines.join('\n') + '\n');
  },
};

COMMANDS['snapshot'] = {
  help: 'mmsg snapshot [--session=<id>] [--at-prompt=<n>] <stdin summary JSON>',
  describe: 'Write a recovery snapshot. Summary JSON comes from stdin.',
  async run(args) {
    const raw = (await readStdin()).trim();
    if (!raw) die(2, `no JSON on stdin\n${COMMANDS['snapshot'].help}`);
    let summary;
    try { summary = JSON.parse(raw); }
    catch (e) { die(2, `invalid JSON on stdin: ${e.message}`); }
    const sessionId = await resolveSessionId(args);
    const body = { summary_json: summary };
    if (args.flags['at-prompt']) {
      const n = parseInt(args.flags['at-prompt'], 10);
      if (Number.isFinite(n)) body.at_prompt_seq = n;
    }
    const r = await apiRequest('POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/snapshots`, body);
    if (r.status !== 201) return apiErr(r, 'snapshot');
    process_.stdout.write(`ok session=${sessionId} snapshot_seq=${r.body.snapshot_seq}\n`);
  },
};

COMMANDS['recovery'] = {
  help: 'mmsg recovery [--session=<id>] [--prompts=10] [--edits=20] [--json]',
  describe: 'Produce a recovery report. Markdown by default, JSON with --json.',
  async run(args) {
    const sessionId = await resolveSessionId(args);
    const q = new URLSearchParams();
    if (args.flags.prompts) q.set('prompts', String(args.flags.prompts));
    if (args.flags.edits)   q.set('edits',   String(args.flags.edits));
    const suffix = q.toString() ? '?' + q.toString() : '';
    const r = await apiRequest('GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/recovery${suffix}`);
    if (r.status === 404) return die(1, `session not found: ${sessionId}`);
    if (r.status !== 200) return apiErr(r, 'recovery');
    if (args.flags.json) {
      process_.stdout.write(JSON.stringify(r.body, null, 2) + '\n');
      return;
    }
    process_.stdout.write(renderRecoveryMarkdown(r.body));
  },
};

function renderRecoveryMarkdown(bundle) {
  const {
    session, synthetic_session,
    latest_snapshot, latest_summary,
    recent_transcripts = [], recent_file_ops = [],
    recent_prompts = [], recent_file_edits = [],
  } = bundle;
  const out = [];
  const title = session.custom_title ? ` ${session.custom_title}` : '';
  out.push(`# Recovery for ${session.session_id}${title}`);
  out.push('');
  if (session.cwd) out.push(`- cwd: \`${session.cwd}\``);
  if (session.message_count) out.push(`- message_count: ${session.message_count}`);
  if (session.transcript_path) out.push(`- transcript_path: \`${session.transcript_path}\``);
  out.push(`- last_active_at: ${fmtTs(session.last_active_at)}`);
  if (synthetic_session) {
    out.push('- _(session metadata reconstructed from transcripts — no sessions row)_');
  }
  out.push('');

  // Latest snapshot (Phase 1 mechanism, user-written via `mmsg snapshot`)
  if (latest_snapshot) {
    out.push(`## Latest snapshot (seq #${latest_snapshot.snapshot_seq}` +
             (latest_snapshot.at_prompt_seq ? ` at prompt #${latest_snapshot.at_prompt_seq}` : '') +
             `, ${fmtTs(latest_snapshot.timestamp)})`);
    out.push('');
    const s = latest_snapshot.summary;
    if (s && typeof s === 'object') {
      for (const [k, v] of Object.entries(s)) {
        if (Array.isArray(v)) {
          out.push(`**${k}**`);
          for (const item of v) out.push(`- ${typeof item === 'object' ? JSON.stringify(item) : item}`);
          out.push('');
        } else if (typeof v === 'object' && v != null) {
          out.push(`**${k}**`);
          out.push('```json');
          out.push(JSON.stringify(v, null, 2));
          out.push('```');
        } else {
          out.push(`- **${k}**: ${v}`);
        }
      }
    } else {
      out.push('```');
      out.push(String(latest_snapshot.summary_json));
      out.push('```');
    }
    out.push('');
  } else {
    out.push('## Latest snapshot');
    out.push('(none recorded yet — use `mmsg snapshot` to write one)');
    out.push('');
  }

  // Phase 7 transcripts (user + assistant interleaved, ascending seq)
  out.push(`## Recent transcripts (${recent_transcripts.length})`);
  if (recent_transcripts.length === 0) {
    out.push('(none — no hook-recorded transcripts for this session)');
  } else {
    for (const t of recent_transcripts) {
      out.push(`### #${t.seq} [${t.role}] ${fmtTs(t.ts)}`);
      for (const line of String(t.content || '').split('\n')) {
        out.push('> ' + line);
      }
      out.push('');
    }
  }
  out.push('');

  // Phase 7 file ops
  out.push(`## Recent file ops (${recent_file_ops.length})`);
  if (recent_file_ops.length === 0) {
    out.push('(none)');
  } else {
    for (const op of recent_file_ops) {
      const trunc = op.tool_input_truncated
        ? ` *(truncated from ${op.tool_input_size} bytes)*`
        : '';
      out.push(`- [${fmtTs(op.ts)}] **${op.tool_name}** \`${op.file_path || '(no path)'}\`${trunc}`);
      if (op.tool_input && !op.tool_input_truncated) {
        try {
          const parsed = JSON.parse(op.tool_input);
          const keys = Object.keys(parsed).filter(k => k !== 'file_path');
          if (keys.length > 0) {
            const brief = keys.map(k => {
              const v = parsed[k];
              if (typeof v === 'string') {
                const line1 = v.split('\n')[0].slice(0, 60);
                return `${k}="${line1}${v.length > line1.length ? '…' : ''}"`;
              }
              return `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : v}`;
            }).join(', ');
            out.push(`  - ${brief}`);
          }
        } catch { /* truncated or not valid JSON — skip brief */ }
      }
    }
  }
  out.push('');

  // Phase 7 summary (populated by P4 generator; blank until then)
  out.push('## Latest summary');
  if (latest_summary) {
    out.push(`_(range ${latest_summary.range_start_seq}–${latest_summary.range_end_seq}, ${fmtTs(latest_summary.ts)}` +
             (latest_summary.generated_by ? `, by ${latest_summary.generated_by}` : '') + ')_');
    out.push('');
    out.push(latest_summary.text);
    if (latest_summary.keywords) {
      try {
        const kw = JSON.parse(latest_summary.keywords);
        if (Array.isArray(kw) && kw.length > 0) {
          out.push('');
          out.push(`**keywords**: ${kw.join(', ')}`);
        }
      } catch { /* ignore bad JSON */ }
    }
  } else {
    out.push('(not yet — `mmsg summary` or run the summary generator)');
  }
  out.push('');

  // Legacy Phase 1 fields — only render if the new sources are empty AND legacy has content
  if (recent_transcripts.length === 0 && recent_prompts.length > 0) {
    out.push('## Legacy prompts (Phase 1, 200-char preview)');
    for (const p of recent_prompts) {
      out.push(`- #${p.prompt_seq ?? '?'} [${fmtTs(p.timestamp)}] ${p.text_preview || ''}`);
    }
    out.push('');
  }
  if (recent_file_ops.length === 0 && recent_file_edits.length > 0) {
    out.push('## Legacy file edits (Phase 1)');
    for (const e of recent_file_edits) {
      out.push(`- [${fmtTs(e.timestamp)}] ${e.operation || 'edit'} \`${e.file_path}\``);
    }
    out.push('');
  }

  return out.join('\n') + '\n';
}

// ── Phase 7: record / session subcommands ───────────────────────────

COMMANDS['record-transcript'] = {
  help: 'mmsg record-transcript --session=<id> --role=user|assistant [--cwd=<p>] [--transcript-path=<p>] <stdin content>',
  describe: 'Record a transcript entry (manual / hook forwarder). Content comes from stdin.',
  async run(args) {
    const session = requireArg(args, 'session', COMMANDS['record-transcript'].help);
    const role = requireArg(args, 'role', COMMANDS['record-transcript'].help);
    if (role !== 'user' && role !== 'assistant') {
      die(2, `role must be "user" or "assistant" (got: ${role})`);
    }
    const content = (await readStdin()).replace(/\s+$/, '');
    if (!content) die(2, 'no content on stdin');
    const body = {
      session_id: session,
      role,
      content,
      cwd: args.flags.cwd || null,
      transcript_path: args.flags['transcript-path'] || null,
    };
    const r = await apiRequest('POST', '/api/record/transcript', body);
    if (r.status !== 201) return apiErr(r, 'record-transcript');
    process_.stdout.write(`ok session=${session} seq=${r.body.seq}\n`);
  },
};

COMMANDS['record-file-op'] = {
  help: 'mmsg record-file-op --session=<id> --tool=<name> [--file=<path>] [--tool-use-id=<id>] <stdin tool_input JSON>',
  describe: 'Record a file-op entry (manual / hook forwarder). tool_input JSON from stdin.',
  async run(args) {
    const session = requireArg(args, 'session', COMMANDS['record-file-op'].help);
    const tool = requireArg(args, 'tool', COMMANDS['record-file-op'].help);
    const raw = (await readStdin()).trim();
    let toolInput = null;
    if (raw) {
      try { toolInput = JSON.parse(raw); }
      catch (e) { die(2, `invalid JSON on stdin: ${e.message}`); }
    }
    const body = {
      session_id: session,
      tool_name: tool,
      file_path: args.flags.file || null,
      tool_input: toolInput,
      tool_use_id: args.flags['tool-use-id'] || null,
    };
    const r = await apiRequest('POST', '/api/record/file-op', body);
    if (r.status !== 201) return apiErr(r, 'record-file-op');
    const trunc = r.body.truncated ? ' (truncated)' : '';
    process_.stdout.write(`ok session=${session} seq=${r.body.seq}${trunc}\n`);
  },
};

COMMANDS['summary'] = {
  help: 'mmsg summary --session=<id> --from-seq=<a> --to-seq=<b> [--generated-by=<s>] <stdin JSON {text, keywords?}>',
  describe: 'Upsert a range summary. stdin must be JSON {text, keywords?}.',
  async run(args) {
    const session = requireArg(args, 'session', COMMANDS['summary'].help);
    const fromSeq = parseInt(requireArg(args, 'from-seq', COMMANDS['summary'].help), 10);
    const toSeq = parseInt(requireArg(args, 'to-seq', COMMANDS['summary'].help), 10);
    if (!Number.isFinite(fromSeq) || !Number.isFinite(toSeq)) {
      die(2, '--from-seq and --to-seq must be integers');
    }
    const raw = (await readStdin()).trim();
    if (!raw) die(2, 'no JSON on stdin');
    let payload;
    try { payload = JSON.parse(raw); }
    catch (e) { die(2, `invalid JSON on stdin: ${e.message}`); }
    if (!payload.text) die(2, 'stdin JSON must include "text"');
    const body = {
      session_id: session,
      range_start_seq: fromSeq,
      range_end_seq: toSeq,
      text: payload.text,
      keywords: payload.keywords ?? null,
      generated_by: args.flags['generated-by'] || null,
    };
    const r = await apiRequest('POST', '/api/summary', body);
    if (r.status !== 201) return apiErr(r, 'summary');
    process_.stdout.write(`ok session=${session} range=${fromSeq}:${toSeq}\n`);
  },
};

COMMANDS['session-list'] = {
  help: 'mmsg session-list [--cwd=<path>] [--limit=<n>]',
  describe: 'List sessions that have transcripts recorded, most-recent first.',
  async run(args) {
    const q = new URLSearchParams();
    if (args.flags.cwd) q.set('cwd', String(args.flags.cwd));
    if (args.flags.limit) q.set('limit', String(args.flags.limit));
    const suffix = q.toString() ? '?' + q.toString() : '';
    const r = await apiRequest('GET', `/api/session/list${suffix}`);
    if (r.status !== 200) return apiErr(r, 'session-list');
    if (r.body.length === 0) {
      process_.stdout.write('(no sessions with transcripts)\n');
      return;
    }
    const lines = [];
    for (const s of r.body) {
      const id = s.session_id.length > 36 ? s.session_id.slice(0, 33) + '…' : s.session_id.padEnd(36);
      lines.push(`${id}  ${fmtTs(s.last_ts)}  ${String(s.entry_count).padStart(4)} entries  ${s.cwd || '-'}`);
    }
    process_.stdout.write(lines.join('\n') + '\n');
  },
};

COMMANDS['session-search'] = {
  help: 'mmsg session-search <keyword> [--limit=<n>]',
  describe: 'Search summaries by keyword (LIKE against text + keywords).',
  async run(args) {
    const q = args._[1];
    if (!q) die(2, COMMANDS['session-search'].help);
    const params = new URLSearchParams();
    params.set('q', q);
    if (args.flags.limit) params.set('limit', String(args.flags.limit));
    const r = await apiRequest('GET', `/api/session/search?${params.toString()}`);
    if (r.status !== 200) return apiErr(r, 'session-search');
    if (r.body.length === 0) {
      process_.stdout.write(`(no summary matches "${q}")\n`);
      return;
    }
    const out = [];
    for (const s of r.body) {
      out.push(`${s.session_id}  [${s.range_start_seq}–${s.range_end_seq}]  ${fmtTs(s.ts)}`);
      out.push(`  ${s.text.replace(/\n/g, ' ')}`);
      if (s.keywords) {
        try { out.push(`  keywords: ${JSON.parse(s.keywords).join(', ')}`); }
        catch { out.push(`  keywords: ${s.keywords}`); }
      }
      out.push('');
    }
    process_.stdout.write(out.join('\n'));
  },
};

COMMANDS['session-show'] = {
  help: 'mmsg session-show <session-id> [--from-seq=<a>] [--to-seq=<b>]',
  describe: 'Print transcripts + file_ops for a session (chronological, interleaved).',
  async run(args) {
    const session = args._[1];
    if (!session) die(2, COMMANDS['session-show'].help);
    const q = new URLSearchParams();
    q.set('session_id', session);
    if (args.flags['from-seq']) q.set('from_seq', String(args.flags['from-seq']));
    if (args.flags['to-seq']) q.set('to_seq', String(args.flags['to-seq']));
    const r = await apiRequest('GET', `/api/session/show?${q.toString()}`);
    if (r.status !== 200) return apiErr(r, 'session-show');
    const { transcripts, file_ops } = r.body;
    if (transcripts.length === 0 && file_ops.length === 0) {
      process_.stdout.write(`(no transcripts or file_ops for ${session})\n`);
      return;
    }
    // Interleave by ts
    const all = [
      ...transcripts.map(t => ({ kind: 'transcript', ...t })),
      ...file_ops.map(f => ({ kind: 'file_op', ...f })),
    ].sort((a, b) => a.ts - b.ts);
    const out = [];
    out.push(`Session: ${session}`);
    out.push(`Entries: ${transcripts.length} transcripts + ${file_ops.length} file_ops`);
    out.push('---');
    for (const e of all) {
      if (e.kind === 'transcript') {
        const head = `[${fmtTs(e.ts)}] #${e.seq} ${e.role.toUpperCase()}`;
        out.push(head);
        for (const line of String(e.content || '').split('\n')) out.push('  ' + line);
      } else {
        const head = `[${fmtTs(e.ts)}] #${e.seq} ${e.tool_name} ${e.file_path || '(no path)'}`;
        const trunc = e.tool_input_truncated ? ` (truncated, ${e.tool_input_size} bytes)` : '';
        out.push(head + trunc);
      }
      out.push('');
    }
    process_.stdout.write(out.join('\n'));
  },
};

// ── help ─────────────────────────────────────────────────────────────
COMMANDS['help'] = {
  help: 'mmsg help [command]',
  describe: 'Show help. With no argument, lists all commands.',
  async run(args) {
    const target = args._[1];
    if (target && COMMANDS[target]) {
      const c = COMMANDS[target];
      process_.stdout.write(`${c.help}\n\n${c.describe}\n`);
      return;
    }
    const lines = [
      'mmsg — Minitor memory CLI',
      '',
      `API: ${BASE}  (override with MINITOR_PORT env)`,
      '',
      'Commands:',
    ];
    const order = ['topic-new', 'topic-add', 'topic-show', 'topic-list',
                   'snapshot', 'recovery',
                   'record-transcript', 'record-file-op', 'summary',
                   'session-list', 'session-search', 'session-show',
                   'help'];
    for (const name of order) {
      lines.push(`  ${name.padEnd(12)} ${COMMANDS[name].describe}`);
    }
    lines.push('');
    lines.push('Run `mmsg help <command>` for details.');
    lines.push('Exit codes: 0 ok / 1 api error / 2 usage / 3 server unreachable');
    process_.stdout.write(lines.join('\n') + '\n');
  },
};

// ── main ─────────────────────────────────────────────────────────────
(async () => {
  const args = parseArgs(process_.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || args.flags.help === true || cmd === '--help' || cmd === '-h') {
    await COMMANDS.help.run({ _: [], flags: {} });
    return;
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    process_.stderr.write(`unknown command: ${cmd}\n\n`);
    await COMMANDS.help.run({ _: [], flags: {} });
    process_.exit(2);
  }

  if (args.flags.help === true) {
    process_.stdout.write(`${handler.help}\n\n${handler.describe}\n`);
    return;
  }

  try {
    await handler.run(args);
  } catch (err) {
    if (err.serverDown) {
      die(3,
        `Error: Minitor tray app not running (${BASE} unreachable).\n` +
        `  Start it: double-click monitor/start.vbs\n` +
        `           or run  .\\install.ps1`);
    }
    if (err.message === 'timeout') {
      die(3, `Error: request to ${BASE} timed out after 5s.`);
    }
    die(1, `Error: ${err.message}`);
  }
})();
