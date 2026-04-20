#!/usr/bin/env node
'use strict';

// O1 probe: one-shot hook that captures everything Claude Code hands to a
// hook (stdin JSON + CLAUDE_* env vars + cwd + argv) into a log file. Used
// to verify which fields are actually available for the Phase-7 transcripts
// recorder hooks, since documentation and behavior may have drifted.
//
// Silent: writes no stdout, so it does not pollute the model's context.

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG = process.env.HOOK_PROBE_LOG
  || path.join(os.tmpdir(), 'hook-env-probe.log');

let stdinRaw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { stdinRaw += c; });
process.stdin.on('end', () => {
  let stdinParsed = null;
  try { stdinParsed = JSON.parse(stdinRaw); } catch {}

  const claudeEnv = Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => /^CLAUDE/i.test(k))
  );

  const entry = {
    ts: new Date().toISOString(),
    cwd: process.cwd(),
    argv: process.argv,
    claude_env: claudeEnv,
    stdin: stdinParsed || { _raw_truncated: stdinRaw.slice(0, 2000) },
  };

  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  } catch {}

  process.exit(0);
});
process.stdin.resume();
