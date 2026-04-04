#!/bin/bash
# Claude Status Monitor — dynamic statusline for Claude Code on Windows
# Reads display config from monitor API, only renders enabled items.
input=$(cat)

# ── Parse JSON (pure bash regex, zero process spawning) ──────────
[[ "$input" =~ \"used_percentage\":([0-9]+) ]]           && ctx="${BASH_REMATCH[1]}"
[[ "$input" =~ \"session_id\":\"([^\"]+)\" ]]             && sid="${BASH_REMATCH[1]}"
[[ "$input" =~ \"project_dir\":\"([^\"]+)\" ]]            && proj="${BASH_REMATCH[1]}"
[[ "$input" =~ seven_day.*used_percentage\":([0-9]+) ]]  && week="${BASH_REMATCH[1]}"
[[ "$input" =~ \"display_name\":\"([^\"]+)\" ]]           && model="${BASH_REMATCH[1]}"
[[ "$input" =~ \"total_cost_usd\":([0-9.]+) ]]           && cost="${BASH_REMATCH[1]}"

# ── Format project path ─────────────────────────────────────────
proj="${proj//\\\\/\/}"
if   [[ "$proj" =~ ^[Cc]:/workspace(.*) ]]; then proj="~${BASH_REMATCH[1]}"
elif [[ "$proj" =~ ^[Cc]:/Users/[^/]+(.*) ]]; then proj="~${BASH_REMATCH[1]}"
fi
proj="${proj%/}"
[[ -z "$proj" ]] && proj="~"

# ── HTTP GET via /dev/tcp (no curl, ~46ms) ───────────────────────
http_get() {
  exec 3<>/dev/tcp/127.0.0.1/19823 2>/dev/null || return 1
  printf "GET %s HTTP/1.0\r\nHost: l\r\n\r\n" "$1" >&3
  while read -r -t 0.5 line; do [[ "${line//$'\r'/}" == "" ]] && break; done <&3
  read -r -t 0.5 body <&3; exec 3<&-
  echo "${body//$'\r'/}"
}

# ── Resolve PID (cached per session) ─────────────────────────────
cache="/tmp/claude-sl-${sid}.pid"
if [[ -f "$cache" ]]; then
  my_pid=$(<"$cache")
else
  all_json=$(http_get /status)
  all_pids=""
  rest="$all_json"
  while [[ "$rest" =~ \"([0-9]+)\": ]]; do
    all_pids+="${BASH_REMATCH[1]}"$'\n'
    rest="${rest#*\"${BASH_REMATCH[1]}\":}"
  done
  if [[ -n "$all_pids" ]]; then
    pid=$(cat /proc/$$/winpid 2>/dev/null || echo $PPID)
    my_pid=""
    for i in 1 2 3 4 5 6 7 8; do
      if [[ $'\n'"$all_pids" == *$'\n'"$pid"$'\n'* ]]; then
        my_pid=$pid; break
      fi
      ppid=$(wmic process where "ProcessId=$pid" get ParentProcessId /FORMAT:CSV 2>/dev/null)
      ppid="${ppid##*,}"; ppid="${ppid%%[[:space:]]*}"
      [[ -z "$ppid" || "$ppid" == "0" ]] && break
      pid=$ppid
    done
  fi
  [[ -n "$my_pid" ]] && echo "$my_pid" > "$cache"
fi

# ── Query monitor API ────────────────────────────────────────────
mem_cache="/tmp/claude-sl-${sid}.mem"
resp=""
if [[ -n "$my_pid" ]]; then
  resp=$(http_get "/status/$my_pid")
fi

# Parse API response
sys_pct="" cld_total="" sess_mem="" display=""
if [[ -n "$resp" ]]; then
  [[ "$resp" =~ \"system_pct\":([0-9]+) ]]    && sys_pct="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"claude_total\":([0-9]+) ]]   && cld_total="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"mem\":([0-9]+) ]]            && sess_mem="${BASH_REMATCH[1]}"
  [[ "$resp" =~ \"display\":\[([^\]]*)\] ]]    && display="${BASH_REMATCH[1]}"
fi

# Format bytes
fmt() {
  local raw=$1
  if [[ -z "$raw" || "$raw" == "0" ]]; then echo "-"; return; fi
  local mb=$((raw / 1048576))
  if ((mb > 1024)); then
    local gb=$((mb * 10 / 1024))
    echo "${gb:0:${#gb}-1}.${gb: -1}G"
  else
    echo "${mb}M"
  fi
}

cld_fmt=$(fmt "$cld_total")
sess_fmt=$(fmt "$sess_mem")

# Cache for fallback
if [[ -n "$sess_mem" ]]; then
  echo "${sys_pct:-?} ${cld_fmt} ${sess_fmt}" > "$mem_cache"
elif [[ -f "$mem_cache" ]]; then
  read -r sys_pct_c cld_fmt_c sess_fmt_c < "$mem_cache"
  sys_pct="${sys_pct:-$sys_pct_c}"
  cld_fmt="${cld_fmt:-$cld_fmt_c}"
  sess_fmt="${sess_fmt:-$sess_fmt_c}"
fi

# Default display if API didn't return config
if [[ -z "$display" ]]; then
  display='"sys_mem","claude_mem","ctx","week","session_id","path"'
fi

# Check if item is enabled
has() { [[ "$display" == *"\"$1\""* ]]; }

# ── ANSI colors ──────────────────────────────────────────────────
R='\033[0m'
DIM='\033[90m'
GRN='\033[32m'
YLW='\033[33m'
RED='\033[31m'
CYN='\033[36m'
BLU='\033[34m'
MAG='\033[35m'

pct_color() {
  local v=${1:-0}
  if ((v >= 75)); then echo -ne "$RED"
  elif ((v >= 50)); then echo -ne "$YLW"
  else echo -ne "$GRN"; fi
}

bar() {
  local pct=${1:-0}
  local filled=$((pct / 10)) empty=$((10 - pct / 10))
  local c; c=$(pct_color "$pct")
  local s="${c}"
  for ((i=0; i<filled; i++)); do s+="▊"; done
  s+="${DIM}"
  for ((i=0; i<empty; i++)); do s+="░"; done
  s+="${R}"
  echo -ne "$s"
}

sep="${DIM} │ ${R}"

# ── Dynamic output ───────────────────────────────────────────────
out=""

if has sys_mem; then
  sys_bar=$(bar "${sys_pct:-0}")
  sys_c=$(pct_color "${sys_pct:-0}")
  out+="${sys_c}Sys${R} ${sys_bar} ${sys_c}${sys_pct:-?}%${R}"
fi

if has claude_mem; then
  [[ -n "$out" ]] && out+="${sep}"
  out+="${CYN}Claude${R} ${sess_fmt}/${DIM}${cld_fmt}${R}"
fi

if has ctx; then
  [[ -n "$out" ]] && out+="${sep}"
  ctx_bar=$(bar "${ctx:-0}")
  out+="Ctx ${ctx_bar} ${ctx:-?}%"
fi

if has week; then
  [[ -n "$out" ]] && out+="${sep}"
  week_bar=$(bar "${week:-0}")
  week_c=$(pct_color "${week:-0}")
  out+="${week_c}Week${R} ${week_bar} ${week_c}${week:-?}%${R}"
fi

if has model; then
  [[ -n "$out" ]] && out+="${sep}"
  out+="${MAG}${model:-?}${R}"
fi

if has cost; then
  [[ -n "$out" ]] && out+="${sep}"
  # Format cost to 2 decimal places using bash
  if [[ -n "$cost" && "$cost" != "0" ]]; then
    cost_int="${cost%%.*}"
    cost_dec="${cost#*.}"
    cost_dec="${cost_dec:0:2}"
    cost_fmt="\$$cost_int.$cost_dec"
  else
    cost_fmt="\$0"
  fi
  out+="${YLW}${cost_fmt}${R}"
fi

if has session_id; then
  [[ -n "$out" ]] && out+="${sep}"
  out+="${DIM}${sid:-?}${R}"
fi

if has path; then
  [[ -n "$out" ]] && out+="${sep}"
  out+="${BLU}${proj}${R}"
fi

echo -e "$out"
