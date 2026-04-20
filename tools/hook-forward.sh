#!/bin/bash
# Minitor Phase 7 hook forwarder.
#
# Wiring (add to ~/.claude/settings.local.json or per-project
# .claude/settings.local.json):
#
#   "hooks": {
#     "UserPromptSubmit": [{ "hooks": [{ "type": "command",
#       "command": "bash <repo>/tools/hook-forward.sh" }] }],
#     "Stop": [{ "hooks": [{ "type": "command",
#       "command": "bash <repo>/tools/hook-forward.sh" }] }],
#     "PostToolUse": [{ "matcher": "Edit|Write|NotebookEdit|MultiEdit",
#       "hooks": [{ "type": "command",
#         "command": "bash <repo>/tools/hook-forward.sh" }] }]
#   }
#
# Reads Claude Code's hook JSON from stdin and POSTs it verbatim to the
# tray app's /api/hook dispatcher. Does NOT parse the body in bash — prompts
# and assistant messages can contain any bytes (quotes, newlines, backslashes),
# and escaping them in shell is a minefield. The server-side Node handler
# parses the JSON safely and routes to insertTranscript / insertFileOp.
#
# Must never block the user's prompt: any failure (tray app down, port
# blocked, drain timeout) results in a silent exit 0.

set +e

body=$(cat)
host="127.0.0.1"
port="${MINITOR_PORT:-19823}"

# Byte-length is the only correct value for Content-Length when the body
# contains multi-byte UTF-8 (e.g. Chinese prompts). ${#body} would count
# characters, not bytes, and the server would see a truncated body.
len=$(printf '%s' "$body" | wc -c)
len="${len// /}"  # wc output may be right-padded with spaces on some shells

{
  exec 3<>"/dev/tcp/${host}/${port}" || exit 0
  printf 'POST /api/hook HTTP/1.0\r\nHost: l\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' \
    "$len" "$body" >&3
  # Close immediately. The server's handler is synchronous — the DB write
  # completed before res.end() was called, so we don't need to wait for the
  # response. A drain loop with `read -t 0.3` is only a per-read timeout and
  # could theoretically block on a pathologically slow stream; not worth the
  # risk when we don't use the response body anyway.
  exec 3<&-
} 2>/dev/null

exit 0
