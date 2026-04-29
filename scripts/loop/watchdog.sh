#!/usr/bin/env bash
# scripts/loop/watchdog.sh
#
# Sidecar process for the OpenF1 loop runner. Polls runner state every
# WATCHDOG_INTERVAL seconds and auto-heals the deterministic-failure
# pathologies that have appeared in the wild without LLM cost or human
# intervention. Runs alongside runner.sh; exits when the runner exits.
#
# Auto-heals (deterministic, safe to perform without confirmation):
#   - Orphan PID file (file exists, process gone) -> rm.
#   - Stuck dispatcher (etime > 2x baseline AND no recent file activity in
#     the slice worktree AND no capture-file growth in last 5 min)
#     -> SIGTERM tree, then SIGKILL after grace period. Runner re-ticks.
#   - Stale `.next/` cache crash signal in the build error -> rm -rf .next
#     in the affected slice worktree before next dispatch retry.
#   - Stale claude/codex capture files older than 2h -> rm.
#
# Escalates to USER ATTENTION (logged but no automatic action):
#   - >=3 consecutive 'No such file or directory' errors for known binaries
#     (psql/node/codex/claude) within 5 min — likely a host-env regression
#     a watchdog can't safely fix.
#   - Watchdog-killed-the-same-slice >=3 times within 1 hour — root cause
#     is not transient.
#   - Hourly cost in cost_ledger.jsonl exceeds LOOP_HOURLY_COST_USD_CAP
#     (default $25) — possible runaway slice; user picks whether to kill.
#
# All actions are recorded in runner.log with a [watchdog] tag AND in a
# structured per-action JSONL feed at state/watchdog_actions.jsonl so the
# behavior is auditable.
#
# Disable with LOOP_WATCHDOG_DISABLE=1.
#
# Usage: invoked by runner.sh; can also be run standalone for testing.

set -euo pipefail

# Same PATH-hardening as runner.sh so kill / ps / find / git / python3 are
# always findable regardless of how the caller's shell was set up.
_wd_path_segments=(
  "$HOME/.nvm/versions/node/v22.12.0/bin"
  "/opt/homebrew/opt/postgresql@15/bin"
  "/opt/homebrew/opt/postgresql@16/bin"
  "/opt/homebrew/opt/postgresql@17/bin"
  "/opt/homebrew/bin"
  "/opt/homebrew/sbin"
  "/usr/local/bin"
  "/usr/bin"
  "/bin"
  "/usr/sbin"
  "/sbin"
)
for _seg in "${_wd_path_segments[@]}"; do
  case ":${PATH:-}:" in
    *":$_seg:"*) : ;;
    *) [[ -d "$_seg" ]] && PATH="$_seg:${PATH:-}" ;;
  esac
done
export PATH

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be exported}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be exported}"

LOG="$LOOP_STATE_DIR/runner.log"
ACTIONS_LOG="$LOOP_STATE_DIR/watchdog_actions.jsonl"
WATCHDOG_PIDFILE="$LOOP_STATE_DIR/watchdog.pid"
KILL_HISTORY="$LOOP_STATE_DIR/watchdog_kill_history.jsonl"

INTERVAL="${WATCHDOG_INTERVAL:-60}"
COST_CAP_USD="${LOOP_HOURLY_COST_USD_CAP:-25}"

# Per-dispatcher-type baseline wall-clock (seconds). The "stuck" threshold
# is 2x baseline AND no file activity in the worktree. (Bash 3.2 on macOS
# doesn't support associative arrays; case-based lookup instead.)
# Convert ps `etime` format ([[DD-]HH:]MM:SS) into seconds. macOS BSD ps
# doesn't support the `etimes` keyword, so we read the formatted etime
# and parse it.
_etime_to_seconds() {
  local s="$1"
  local d=0 h=0 m=0 sec=0
  if [[ "$s" == *-* ]]; then
    d="${s%%-*}"; s="${s#*-}"
  fi
  case "$s" in
    *:*:*) h="${s%%:*}"; s="${s#*:}"; m="${s%%:*}"; sec="${s#*:}" ;;
    *:*)   m="${s%%:*}"; sec="${s#*:}" ;;
    *)     sec="$s" ;;
  esac
  # Strip leading zeros so bash arithmetic doesn't interpret as octal.
  d=$((10#${d:-0})); h=$((10#${h:-0})); m=$((10#${m:-0})); sec=$((10#${sec:-0}))
  echo $(( d*86400 + h*3600 + m*60 + sec ))
}

_baseline_for() {
  case "$1" in
    dispatch_claude)       echo 900  ;;  # impl: 5-15 min typical -> stuck @ 30+ min
    dispatch_plan_revise)  echo 180  ;;  # 1-3 min typical
    dispatch_slice_audit)  echo 180  ;;
    dispatch_codex)        echo 240  ;;  # impl-audit 2-4 min typical
    dispatch_repair)       echo 600  ;;
    dispatch_merger)       echo 120  ;;
    *)                     echo 1800 ;;  # conservative default
  esac
}

# Discover the runner PID (the process we live alongside). Empty if the
# runner is not currently running; the watchdog will exit in that case.
_runner_pid() {
  local pid
  pid=$(cat "$LOOP_STATE_DIR/runner.pid" 2>/dev/null || true)
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1 && echo "$pid"
}

# Strip JSON specials from a string so it can be inlined in a JSON value.
_jsonsafe() { printf '%s' "$1" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read())[1:-1])'; }

_log_event() {
  # _log_event <action> <reason> <subject> <details>
  local action="$1" reason="$2" subject="${3:-}" details="${4:-}"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '[%s] [watchdog] %s subject=%s reason=%s\n' \
    "$(date -Iseconds)" "$action" "$subject" "$reason" >> "$LOG"
  printf '{"ts":"%s","action":"%s","reason":"%s","subject":"%s","details":"%s"}\n' \
    "$ts" "$action" "$(_jsonsafe "$reason")" "$(_jsonsafe "$subject")" "$(_jsonsafe "$details")" \
    >> "$ACTIONS_LOG"
}

# ----------------------------------------------------------------------
# Pathology checks
# ----------------------------------------------------------------------

# 1) Orphan PID file: pidfile exists, process not in process table.
check_orphan_pidfile() {
  local pf="$LOOP_STATE_DIR/runner.pid" pid
  [[ -f "$pf" ]] || return 0
  pid=$(cat "$pf" 2>/dev/null || true)
  [[ -n "$pid" ]] || return 0
  if ! ps -p "$pid" >/dev/null 2>&1; then
    rm -f "$pf"
    _log_event "rm-orphan-pidfile" "pid_$pid_not_running" "runner.pid" "removed stale pidfile"
  fi
}

# 2) Stuck dispatcher: wall-clock > 2x baseline AND no slice-branch commit
#    in last 10 min AND capture file (if any) hasn't grown in last 5 min.
check_stuck_dispatcher() {
  # Find any in-flight dispatcher process.
  local line dispatcher_pid dispatcher_etime_str dispatcher_etime_s dispatcher_cmd dispatch_type slice_id
  while IFS= read -r line; do
    dispatcher_pid=$(echo "$line" | awk '{print $1}')
    dispatcher_etime_str=$(echo "$line" | awk '{print $2}')
    dispatcher_etime_s=$(_etime_to_seconds "$dispatcher_etime_str")
    dispatcher_cmd=$(echo "$line" | sed -E 's/^[ ]*[0-9]+ +[^ ]+ +//')
    # Only care about top-level dispatcher entrypoints (the bash invocation
    # of dispatch_*.sh, not the perl timeout shim or the agent itself).
    [[ "$dispatcher_cmd" == bash*scripts/loop/dispatch_*.sh* ]] || continue
    # Extract dispatch_type and slice_id.
    dispatch_type=$(echo "$dispatcher_cmd" | sed -E 's|.*scripts/loop/(dispatch_[a-z_]+)\.sh.*|\1|')
    slice_id=$(echo "$dispatcher_cmd" | awk '{for(i=1;i<=NF;i++) if($i~/dispatch_/) {print $(i+1); exit}}')
    [[ -n "$slice_id" ]] || continue
    local baseline
    baseline=$(_baseline_for "$dispatch_type")
    local stuck_threshold=$(( baseline * 2 ))
    if (( dispatcher_etime_s < stuck_threshold )); then
      continue
    fi

    # Check for slice-branch commit activity in the last 10 min.
    local slice_worktree="$HOME/.openf1-loop-worktrees/$slice_id"
    local recent_commit_age=99999
    if [[ -d "$slice_worktree/.git" || -f "$slice_worktree/.git" ]]; then
      local last_commit
      last_commit=$(git -C "$slice_worktree" log -1 --format=%ct 2>/dev/null || echo 0)
      recent_commit_age=$(( $(date +%s) - last_commit ))
    fi

    # Check capture-file growth.
    local capture_age=99999 capture_file=""
    local cf
    while IFS= read -r cf; do
      [[ -f "$cf" ]] || continue
      capture_file="$cf"
      local cmt
      cmt=$(stat -f %m "$cf" 2>/dev/null || stat -c %Y "$cf" 2>/dev/null || echo 0)
      capture_age=$(( $(date +%s) - cmt ))
      break
    done < <(find "$LOOP_STATE_DIR" -maxdepth 1 \
              \( -name ".claude_result_*_${slice_id}.json" \
              -o -name ".codex_capture*_${slice_id}.*" \) 2>/dev/null)

    # Stuck = past threshold AND no commit in 10 min AND no capture growth in 5 min.
    local capture_idle="false"
    if [[ -z "$capture_file" ]] || (( capture_age > 300 )); then
      capture_idle="true"
    fi
    if (( recent_commit_age > 600 )) && [[ "$capture_idle" == "true" ]]; then
      _log_event "kill-stuck-dispatcher" \
        "etime_${dispatcher_etime_s}s_baseline_${baseline}s_no_commit_${recent_commit_age}s" \
        "$slice_id ($dispatch_type)" \
        "kill-tree pid=$dispatcher_pid"
      _kill_dispatcher_tree "$dispatcher_pid" "$slice_id"
      _record_kill "$slice_id" "stuck_dispatcher"
      _check_kill_repeat "$slice_id"
    fi
  done < <(ps -axo pid,etime,command | grep "scripts/loop/dispatch_" | grep -v grep)
}

# Convert dispatcher-tree subprocesses + the main process into TERM, then
# escalate to KILL after a 10s grace period.
_kill_dispatcher_tree() {
  local top="$1" slice_id="$2"
  # Find descendants (perl shim, child bash, agent process).
  local pids
  pids=$(pgrep -P "$top" 2>/dev/null; echo "$top")
  pids+=" $(pgrep -f "scripts/loop/dispatch_.*\.sh.*$slice_id" 2>/dev/null || true)"
  pids+=" $(pgrep -f "claude --print" 2>/dev/null || true)"
  pids+=" $(pgrep -f "codex exec" 2>/dev/null || true)"
  pids=$(echo "$pids" | tr ' ' '\n' | sort -u | grep -v '^$')
  for p in $pids; do
    kill -TERM "$p" 2>/dev/null || true
  done
  sleep 10
  for p in $pids; do
    if kill -0 "$p" 2>/dev/null; then
      kill -KILL "$p" 2>/dev/null || true
    fi
  done
  # Clear stale capture files for this slice so next dispatch starts fresh.
  rm -f "$LOOP_STATE_DIR"/.claude_result_*"_${slice_id}".json
  rm -f "$LOOP_STATE_DIR"/.codex_capture*"_${slice_id}".* 2>/dev/null || true
}

_record_kill() {
  local slice_id="$1" reason="$2"
  printf '{"ts":"%s","slice":"%s","reason":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(_jsonsafe "$slice_id")" "$(_jsonsafe "$reason")" \
    >> "$KILL_HISTORY"
}

# Count watchdog-kills on the same slice within the last hour. >=3 means
# the underlying issue isn't transient; surface USER ATTENTION.
_check_kill_repeat() {
  local slice_id="$1"
  [[ -f "$KILL_HISTORY" ]] || return 0
  local recent_count
  recent_count=$(python3 - "$KILL_HISTORY" "$slice_id" <<'PY'
import json, sys, datetime
path, slice_id = sys.argv[1], sys.argv[2]
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
n = 0
try:
    with open(path) as f:
        for line in f:
            try:
                r = json.loads(line)
                if r.get("slice") != slice_id: continue
                ts = datetime.datetime.fromisoformat(r["ts"].replace("Z","+00:00"))
                if ts >= cutoff:
                    n += 1
            except Exception:
                pass
except FileNotFoundError:
    pass
print(n)
PY
)
  if (( recent_count >= 3 )); then
    _log_event "USER-ATTENTION-kill-repeat" \
      "watchdog has killed slice ${recent_count} times in last hour" \
      "$slice_id" "underlying issue not transient; pause for adjudication"
  fi
}

# 3) Stale .next/ cache crash signal: runner.log shows "Cannot find module
#    './<n>.js'" from .next/server. Wipe .next/ in the affected slice
#    worktree so the next build regenerates it.
check_stale_next_cache() {
  # Look at last 80 lines of runner.log for the signal.
  local recent
  recent=$(tail -200 "$LOG" 2>/dev/null || true)
  echo "$recent" | grep -qE "Cannot find module '\./[0-9]+\.js'" || return 0
  # If we already cleaned in the last 30 min, don't repeat.
  local marker="$LOOP_STATE_DIR/watchdog_next_clean_marker"
  if [[ -f "$marker" ]]; then
    local marker_age=$(( $(date +%s) - $(stat -f %m "$marker" 2>/dev/null || echo 0) ))
    (( marker_age < 1800 )) && return 0
  fi
  # Find slice mentioned in the log (best-effort).
  local slice_id
  slice_id=$(echo "$recent" | grep -oE "slice/[a-z0-9-]+" | head -1 | sed 's|slice/||')
  if [[ -n "$slice_id" ]]; then
    local wt="$HOME/.openf1-loop-worktrees/$slice_id"
    if [[ -d "$wt/web/.next" ]]; then
      rm -rf "$wt/web/.next"
      touch "$marker"
      _log_event "rm-stale-next-cache" "Cannot find module pattern in runner.log" \
        "$slice_id" "rm -rf $wt/web/.next"
    fi
  fi
}

# 4) Stale capture files older than 2h.
check_stale_captures() {
  local n cutoff_ts
  cutoff_ts=$(( $(date +%s) - 7200 ))
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    local mt
    mt=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
    if (( mt < cutoff_ts )); then
      rm -f "$f"
      _log_event "rm-stale-capture" "older than 2h" "$(basename "$f")" "removed"
    fi
  done < <(find "$LOOP_STATE_DIR" -maxdepth 1 -name '.claude_result_*' -o -name '.codex_capture*' 2>/dev/null)
}

# 5) Missing-binary loop: log shows >=3 'No such file or directory' for
#    known binaries within last 5 min. Escalate (no auto-fix because we
#    don't know which segment to add safely).
check_missing_binary() {
  local recent
  recent=$(tail -300 "$LOG" 2>/dev/null || true)
  local count
  count=$(echo "$recent" | grep -cE "(env: (psql|node|codex|claude): No such file|: command not found: (psql|node|codex|claude))" || true)
  if (( count >= 3 )); then
    # De-dup escalations within the same hour.
    local marker="$LOOP_STATE_DIR/watchdog_missing_binary_marker"
    if [[ -f "$marker" ]]; then
      local marker_age=$(( $(date +%s) - $(stat -f %m "$marker" 2>/dev/null || echo 0) ))
      (( marker_age < 3600 )) && return 0
    fi
    touch "$marker"
    _log_event "USER-ATTENTION-missing-binary" \
      "${count} 'No such file or directory' lines in last 300 log lines" \
      "host-env" "expected binary not on PATH; manual fix required"
  fi
}

# 6) Cost spike: hourly cost in ledger > cap.
check_cost_spike() {
  [[ -f "$LOOP_STATE_DIR/cost_ledger.jsonl" ]] || return 0
  local hourly
  hourly=$(python3 - "$LOOP_STATE_DIR/cost_ledger.jsonl" <<'PY'
import json, sys, datetime
path = sys.argv[1]
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
total = 0.0
try:
    with open(path) as f:
        for line in f:
            try:
                r = json.loads(line)
                ts = datetime.datetime.fromisoformat(r["ts"].replace("Z","+00:00"))
                if ts >= cutoff:
                    total += float(r.get("cost_usd", 0) or 0)
            except Exception:
                pass
except FileNotFoundError:
    pass
print(f"{total:.4f}")
PY
)
  if python3 -c "import sys; sys.exit(0 if float('$hourly') > float('$COST_CAP_USD') else 1)"; then
    local marker="$LOOP_STATE_DIR/watchdog_cost_spike_marker"
    if [[ -f "$marker" ]]; then
      local marker_age=$(( $(date +%s) - $(stat -f %m "$marker" 2>/dev/null || echo 0) ))
      (( marker_age < 3600 )) && return 0
    fi
    touch "$marker"
    _log_event "USER-ATTENTION-cost-spike" \
      "hourly_cost=\$${hourly}_>_cap_\$${COST_CAP_USD}" \
      "cost-ledger" "consider pausing the runner"
  fi
}

# ----------------------------------------------------------------------
# Lifecycle
# ----------------------------------------------------------------------

_log_event "watchdog-start" "interval=${INTERVAL}s cost_cap=\$${COST_CAP_USD}" "watchdog" "pid=$$"
echo "$$" > "$WATCHDOG_PIDFILE"
trap 'rm -f "$WATCHDOG_PIDFILE"; _log_event watchdog-stop interval=${INTERVAL}s watchdog "pid=$$"; exit 0' INT TERM EXIT

while true; do
  # Self-terminate if runner is gone (parent-aware lifecycle).
  if [[ -z "$(_runner_pid)" ]]; then
    # Give the runner one full poll cycle to come back (e.g. brief restart).
    sleep "$INTERVAL"
    if [[ -z "$(_runner_pid)" ]]; then
      _log_event "watchdog-stop" "runner not running" "watchdog" "exiting"
      exit 0
    fi
  fi

  # Run all pathology checks. Each is best-effort and silent on no-op.
  check_orphan_pidfile      || true
  check_stuck_dispatcher    || true
  check_stale_next_cache    || true
  check_stale_captures      || true
  check_missing_binary      || true
  check_cost_spike          || true

  sleep "$INTERVAL"
done
