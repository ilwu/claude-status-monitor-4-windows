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

function spawnMmsg(args, { stdin, port, enforceTitle = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, MINITOR_PORT: String(port ?? server.address().port) };
    // Most smoke tests predate the topic-add title-format enforcement and
    // use short ad-hoc stdin ('body', 'third', etc.). Skip the check by
    // default so those tests keep validating the protocol/API shape; pass
    // enforceTitle=true in new tests that specifically exercise the check.
    if (!enforceTitle) env.MINITOR_SKIP_TITLE_CHECK = '1';
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env,
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

  await step('topic-add enforces title format by default → rejects plain content', async () => {
    const r = await spawnMmsg(
      ['topic-add', topicId, '--author=x'],
      { stdin: 'no title line here', enforceTitle: true }
    );
    assert.strictEqual(r.code, 2);
    assert.match(r.stderr, /first line must follow/);
    assert.match(r.stderr, /Expected: # \[t-/);
  });

  await step('topic-add accepts content with compliant title', async () => {
    const r = await spawnMmsg(
      ['topic-add', topicId, '--author=x'],
      { stdin: `# [${topicId}] title-compliant body\nactual content here`,
        enforceTitle: true }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /ok seq=/);
  });

  await step('topic-add bypasses title check when MINITOR_SKIP_TITLE_CHECK=1', async () => {
    // Default spawnMmsg already sets the skip env; this exercises that path
    const r = await spawnMmsg(
      ['topic-add', topicId, '--author=x'],
      { stdin: 'still not a compliant title' }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /ok seq=/);
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

  await step('recovery --session=<id> → Markdown bundle (Phase 7 sections)', async () => {
    const r = await spawnMmsg(['recovery', `--session=${SID}`]);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`# Recovery for ${SID}`));
    assert.match(r.stdout, /Latest snapshot/);
    assert.match(r.stdout, /current_task/);
    // Phase 7 sections always rendered (even when empty)
    assert.match(r.stdout, /Recent transcripts/);
    assert.match(r.stdout, /Recent file ops/);
    assert.match(r.stdout, /Latest summary/);
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

  // ── Phase 7: record + session subcommands ──────────────────────
  const P7SID = 'cli-p7-session';
  const P7CWD = 'C:/cli-p7/workspace';

  await step('record-transcript (missing flags) → exit 2', async () => {
    const r = await spawnMmsg(['record-transcript'], { stdin: 'x' });
    assert.strictEqual(r.code, 2);
  });

  await step('record-transcript (bad role) → exit 2', async () => {
    const r = await spawnMmsg(
      ['record-transcript', `--session=${P7SID}`, '--role=system'],
      { stdin: 'x' }
    );
    assert.strictEqual(r.code, 2);
  });

  await step('record-transcript (no stdin) → exit 2', async () => {
    const r = await spawnMmsg(
      ['record-transcript', `--session=${P7SID}`, '--role=user']
    );
    assert.strictEqual(r.code, 2);
  });

  await step('record-transcript user → ok seq=1', async () => {
    const r = await spawnMmsg(
      ['record-transcript', `--session=${P7SID}`, '--role=user', `--cwd=${P7CWD}`],
      { stdin: 'CLI phase-7 test prompt' }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /seq=1/);
  });

  await step('record-transcript assistant → ok seq=2', async () => {
    const r = await spawnMmsg(
      ['record-transcript', `--session=${P7SID}`, '--role=assistant', `--cwd=${P7CWD}`],
      { stdin: 'CLI phase-7 test response' }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /seq=2/);
  });

  await step('record-file-op → ok seq', async () => {
    const r = await spawnMmsg(
      ['record-file-op', `--session=${P7SID}`, '--tool=Edit',
       '--file=C:/cli-p7/x.ts', '--tool-use-id=toolu_cli_p7_1'],
      { stdin: '{"old_string":"a","new_string":"b"}' }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /seq=1/);
  });

  await step('record-file-op (bad stdin JSON) → exit 2', async () => {
    const r = await spawnMmsg(
      ['record-file-op', `--session=${P7SID}`, '--tool=Edit'],
      { stdin: 'not-json' }
    );
    assert.strictEqual(r.code, 2);
  });

  await step('summary (no stdin) → exit 2', async () => {
    const r = await spawnMmsg([
      'summary', `--session=${P7SID}`, '--from-seq=1', '--to-seq=2',
    ]);
    assert.strictEqual(r.code, 2);
  });

  await step('summary (no text in JSON) → exit 2', async () => {
    const r = await spawnMmsg(
      ['summary', `--session=${P7SID}`, '--from-seq=1', '--to-seq=2'],
      { stdin: '{"keywords":["x"]}' }
    );
    assert.strictEqual(r.code, 2);
  });

  await step('summary → ok', async () => {
    const r = await spawnMmsg(
      ['summary', `--session=${P7SID}`, '--from-seq=1', '--to-seq=2',
       '--generated-by=cli-smoke'],
      { stdin: '{"text":"CLI summary for range 1-2","keywords":["cli","p7"]}' }
    );
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /range=1:2/);
  });

  await step('session-list → includes our P7 session', async () => {
    const r = await spawnMmsg(['session-list']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert(r.stdout.includes(P7SID));
  });

  await step('session-list --cwd filters', async () => {
    const r = await spawnMmsg(['session-list', `--cwd=${P7CWD}`]);
    assert.strictEqual(r.code, 0, r.stderr);
    assert(r.stdout.includes(P7SID));
  });

  await step('session-search → finds summary', async () => {
    const r = await spawnMmsg(['session-search', 'cli']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert(r.stdout.includes(P7SID));
  });

  await step('session-search (no hits) → friendly', async () => {
    const r = await spawnMmsg(['session-search', 'no-such-keyword-xyz-1234']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /no summary matches/);
  });

  await step('session-show → transcripts + file_ops interleaved', async () => {
    const r = await spawnMmsg(['session-show', P7SID]);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /Session: cli-p7-session/);
    assert.match(r.stdout, /USER/);
    assert.match(r.stdout, /ASSISTANT/);
    assert.match(r.stdout, /Edit.*x\.ts/);
  });

  await step('session-show (unknown) → empty message', async () => {
    const r = await spawnMmsg(['session-show', 'no-such-session']);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.match(r.stdout, /no transcripts or file_ops/);
  });

  // ── rules subcommand (no HTTP; reads MINITOR_RULES_DIR) ────────
  const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-rules-'));
  fs.writeFileSync(path.join(rulesDir, 'alpha.md'), [
    '---',
    'name: alpha',
    'scope: all-projects',
    'status: active',
    'updated: 2026-04-20',
    'applies-to: [smoke, alpha-tag]',
    'summary: First rule for smoke test.',
    '---',
    '',
    '# Alpha rule body',
    'content goes here',
  ].join('\n'));
  fs.writeFileSync(path.join(rulesDir, 'beta.md'), [
    '---',
    'name: beta',
    'scope: single-project',
    'status: deprecated',
    'updated: 2026-04-19',
    'applies-to: [smoke, beta-tag]',
    'summary: Deprecated rule for filter test.',
    '---',
    '',
    '# Beta',
  ].join('\n'));
  // File without frontmatter — should be ignored
  fs.writeFileSync(path.join(rulesDir, 'README.md'), '# index page\n');
  fs.writeFileSync(path.join(rulesDir, 'loose.md'), '# no frontmatter here\n');

  function spawnMmsgWithRulesDir(args, opts = {}) {
    return spawnMmsg(args, {
      ...opts,
      env: { ...(opts.env || {}), MINITOR_RULES_DIR: rulesDir },
    });
  }

  await step('rules list (default) → active only, excludes README + no-frontmatter', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'rules', 'list'], {
      env: { ...process.env, MINITOR_PORT: String(server.address().port),
             MINITOR_RULES_DIR: rulesDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    await new Promise(res => child.on('close', res));
    const stdout = Buffer.concat(out).toString('utf8');
    assert(stdout.includes('alpha'));
    assert(!stdout.includes('beta'), 'deprecated hidden by default');
    assert(!stdout.includes('index page'), 'README ignored');
    assert(!stdout.includes('no frontmatter here'), 'loose file ignored');
  });

  await step('rules list --all → includes deprecated', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'rules', 'list', '--all'], {
      env: { ...process.env, MINITOR_RULES_DIR: rulesDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    await new Promise(res => child.on('close', res));
    const stdout = Buffer.concat(out).toString('utf8');
    assert(stdout.includes('alpha'));
    assert(stdout.includes('beta'));
  });

  await step('rules list --tag=alpha-tag → only alpha', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'rules', 'list', '--tag=alpha-tag'], {
      env: { ...process.env, MINITOR_RULES_DIR: rulesDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    await new Promise(res => child.on('close', res));
    const stdout = Buffer.concat(out).toString('utf8');
    assert(stdout.includes('alpha'));
    assert(!stdout.includes('beta'));
  });

  await step('rules show <name> → body without frontmatter', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'rules', 'show', 'alpha'], {
      env: { ...process.env, MINITOR_RULES_DIR: rulesDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    await new Promise(res => child.on('close', res));
    const stdout = Buffer.concat(out).toString('utf8');
    assert(stdout.includes('Alpha rule body'));
    assert(!stdout.includes('name: alpha'), 'frontmatter stripped');
  });

  await step('rules show <name> --raw → includes frontmatter', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'rules', 'show', 'alpha', '--raw'], {
      env: { ...process.env, MINITOR_RULES_DIR: rulesDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    await new Promise(res => child.on('close', res));
    const stdout = Buffer.concat(out).toString('utf8');
    assert(stdout.includes('name: alpha'));
    assert(stdout.includes('Alpha rule body'));
  });

  await step('rules show (unknown) → exit 1', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'rules', 'show', 'nope'], {
      env: { ...process.env, MINITOR_RULES_DIR: rulesDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const err = [];
    child.stderr.on('data', c => err.push(c));
    const code = await new Promise(res => child.on('close', res));
    assert.strictEqual(code, 1);
    assert.match(Buffer.concat(err).toString('utf8'), /rule not found/);
  });

  await step('rules (no op) → exit 2', async () => {
    const r = await spawnMmsg(['rules']);
    assert.strictEqual(r.code, 2);
  });

  // ── mmsg init (setup checklist) ────────────────────────────────
  await step('mmsg init (tray up, no settings.json) → shows ✗ hooks + snippet', async () => {
    const initHome = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-init-'));
    const child = spawn(process.execPath, [CLI_PATH, 'init'], {
      env: {
        ...process.env,
        MINITOR_PORT: String(server.address().port),
        MINITOR_RULES_DIR: rulesDir,
        USERPROFILE: initHome,
        HOME: initHome,
        ANTHROPIC_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    const code = await new Promise(res => child.on('close', res));
    assert.strictEqual(code, 0, 'init always exits 0 so scripts can parse');
    const stdout = Buffer.concat(out).toString('utf8');
    assert.match(stdout, /Minitor multi-session setup checklist/);
    assert.match(stdout, /\[1\/5\] Tray app\s+✓/);
    assert.match(stdout, /\[3\/5\] Phase 7 hooks\s+✗/);
    assert.match(stdout, /\[5\/5\] Rules discoverable ✓/);
    assert.match(stdout, /Hook snippet for ~\/\.claude\/settings\.json/);
    assert.match(stdout, /hook-forward\.sh/);
    fs.rmSync(initHome, { recursive: true, force: true });
  });

  await step('mmsg init (tray down) → shows ✗ tray', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'init'], {
      env: {
        ...process.env,
        MINITOR_PORT: '1',  // unreachable
        MINITOR_RULES_DIR: rulesDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    const code = await new Promise(res => child.on('close', res));
    assert.strictEqual(code, 0, 'init stays exit 0 even when tray is down');
    const stdout = Buffer.concat(out).toString('utf8');
    assert.match(stdout, /\[1\/5\] Tray app\s+✗/);
    assert.match(stdout, /unreachable/);
  });

  await step('mmsg init (hooks already configured) → ✓ hooks, no snippet', async () => {
    const initHome = fs.mkdtempSync(path.join(os.tmpdir(), 'minitor-init-'));
    fs.mkdirSync(path.join(initHome, '.claude'));
    const wiredSettings = {
      hooks: {
        UserPromptSubmit: [
          { matcher: '', hooks: [{ type: 'command', command: 'bash /x/tools/hook-forward.sh' }] }
        ],
        Stop: [
          { matcher: '', hooks: [{ type: 'command', command: 'bash /x/tools/hook-forward.sh' }] }
        ],
        PostToolUse: [
          { matcher: 'Edit|Write|NotebookEdit|MultiEdit',
            hooks: [{ type: 'command', command: 'bash /x/tools/hook-forward.sh' }] }
        ],
      },
    };
    fs.writeFileSync(path.join(initHome, '.claude', 'settings.json'),
      JSON.stringify(wiredSettings, null, 2));
    const child = spawn(process.execPath, [CLI_PATH, 'init'], {
      env: {
        ...process.env,
        MINITOR_PORT: String(server.address().port),
        MINITOR_RULES_DIR: rulesDir,
        USERPROFILE: initHome,
        HOME: initHome,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    const code = await new Promise(res => child.on('close', res));
    assert.strictEqual(code, 0);
    const stdout = Buffer.concat(out).toString('utf8');
    assert.match(stdout, /\[3\/5\] Phase 7 hooks\s+✓/);
    assert.doesNotMatch(stdout, /Hook snippet for/, 'no snippet when already wired');
    fs.rmSync(initHome, { recursive: true, force: true });
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
