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
[[ "$input" =~ \"total_lines_added\":([0-9]+) ]]         && lines_add="${BASH_REMATCH[1]}"
[[ "$input" =~ \"total_lines_removed\":([0-9]+) ]]       && lines_del="${BASH_REMATCH[1]}"
[[ "$input" =~ \"total_duration_ms\":([0-9]+) ]]         && duration_ms="${BASH_REMATCH[1]}"

# ── Format project path (keep full path, just fix slashes) ───────
proj="${proj//\\\\/\/}"
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

sep=" ${DIM}│${R} "
sep_plain=" │ "

# ── Terminal width (from monitor API, fallback no-wrap) ──────────
# tput cols is unreliable in pipe context (always 80).
# Monitor detects actual window width via Win32 API.
api_cols=""
if [[ -n "$resp" ]] && [[ "$resp" =~ \"cols\":([0-9]+) ]]; then
  api_cols="${BASH_REMATCH[1]}"
fi
cols=${api_cols:-9999}

# ── Build all enabled items (always full content) ────────────────
items=()       # array of ANSI-colored segments
items_len=()   # array of visible lengths (no ANSI)

add_item() {
  local colored="$1" plain="$2"
  items+=("$colored")
  items_len+=("${#plain}")
}

if has sys_mem; then
  sys_c=$(pct_color "${sys_pct:-0}")
  add_item "${sys_c}Sys${R} $(bar "${sys_pct:-0}") ${sys_c}${sys_pct:-?}%${R}" "Sys ▊▊▊▊▊░░░░░ ${sys_pct:-?}%"
fi
if has claude_mem; then
  add_item "${CYN}Claude${R} ${sess_fmt}/${DIM}${cld_fmt} (session/total)${R}" "Claude ${sess_fmt}/${cld_fmt} (session/total)"
fi
if has ctx; then
  add_item "Ctx $(bar "${ctx:-0}") ${ctx:-?}%" "Ctx ▊▊▊▊▊░░░░░ ${ctx:-?}%"
fi
if has week; then
  week_c=$(pct_color "${week:-0}")
  add_item "${week_c}Week${R} $(bar "${week:-0}") ${week_c}${week:-?}%${R}" "Week ▊▊▊▊▊░░░░░ ${week:-?}%"
fi
if has model; then
  add_item "${MAG}${model:-?}${R}" "${model:-?}"
fi
if has cost; then
  if [[ -n "$cost" && "$cost" != "0" ]]; then
    cost_int="${cost%%.*}"; cost_dec="${cost#*.}"; cost_dec="${cost_dec:0:2}"
    add_item "${YLW}\$$cost_int.$cost_dec${R}" "\$$cost_int.$cost_dec"
  fi
fi
if has lines; then
  la="${lines_add:-0}"; ld="${lines_del:-0}"
  add_item "${GRN}+${la}${R}/${RED}-${ld}${R}" "+${la}/-${ld}"
fi
if has duration; then
  if [[ -n "$duration_ms" && "$duration_ms" != "0" ]]; then
    total_s=$((duration_ms / 1000))
    hrs=$((total_s / 3600)); mins=$(( (total_s % 3600) / 60 ))
    if ((hrs > 0)); then
      dur_fmt="${hrs}h${mins}m"
    else
      dur_fmt="${mins}m"
    fi
    add_item "${DIM}${dur_fmt}${R}" "${dur_fmt}"
  fi
fi
if has session_id; then
  add_item "${DIM}${sid:-?}${R}" "${sid:-?}"
fi
if has path; then
  add_item "${BLU}${proj}${R}" "${proj}"
fi

# ── Auto-wrap: pack items into lines that fit terminal width ─────
sep_len=3  # " │ " = 3 chars
lines=()
cur_line=""
cur_len=0

for i in "${!items[@]}"; do
  item_len=${items_len[$i]}
  # Calculate width if we add this item to current line
  if ((cur_len == 0)); then
    need=$item_len
  else
    need=$((cur_len + sep_len + item_len))
  fi

  if ((need <= cols)) || ((cur_len == 0)); then
    # Fits on current line (or first item on line — always add)
    if ((cur_len > 0)); then
      cur_line+="${sep}"
      cur_len=$((cur_len + sep_len))
    fi
    cur_line+="${items[$i]}"
    cur_len=$((cur_len + item_len))
  else
    # Doesn't fit — start new line
    lines+=("$cur_line")
    cur_line="${items[$i]}"
    cur_len=$item_len
  fi
done
[[ -n "$cur_line" ]] && lines+=("$cur_line")

# ── Output all lines ─────────────────────────────────────────────
for line in "${lines[@]}"; do
  echo -e "$line"
done
