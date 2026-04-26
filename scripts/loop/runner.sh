#!/usr/bin/env bash
# scripts/loop/runner.sh
# Long-running orchestrator for the OpenF1 perf-roadmap loop.
# See diagnostic/automation_2026-04_loop_runner.md §4 for spec.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

LOOP_DIR="scripts/loop"
STATE_DIR="$LOOP_DIR/state"
LOG="$STATE_DIR/runner.log"
PIDFILE="$STATE_DIR/runner.pid"

TICK="${LOOP_TICK:-30}"
MAX_SLICE_DURATION="${LOOP_MAX_SLICE_DURATION:-3600}"
DRY_RUN="${LOOP_DRY_RUN:-0}"

# Circuit breakers — graceful exits to avoid token-burning runaways.
MAX_SLICE_FAILURES="${LOOP_MAX_SLICE_FAILURES:-5}"     # consecutive non-zero dispatches on same slice
MAX_TOTAL_DISPATCHES="${LOOP_MAX_TOTAL_DISPATCHES:-50}" # total dispatches in this session
MAX_SESSION_SECONDS="${LOOP_MAX_SESSION_SECONDS:-14400}" # 4 hours
SESSION_START=$(date +%s)
TOTAL_DISPATCHES=0

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG"; }

mkdir -p "$STATE_DIR"
echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"; log "runner exit"; exit 0' INT TERM

log "runner start pid=$$ tick=$TICK dry_run=$DRY_RUN guards: max_slice_failures=$MAX_SLICE_FAILURES max_total_dispatches=$MAX_TOTAL_DISPATCHES max_session_seconds=$MAX_SESSION_SECONDS"

# --- circuit-breaker helpers ---
fail_counter_path() { echo "$STATE_DIR/fail_count_$1"; }

slice_fail_count() {
  local sid="$1"; local f
  f=$(fail_counter_path "$sid")
  cat "$f" 2>/dev/null || echo 0
}

slice_fail_increment() {
  local sid="$1"; local f n
  f=$(fail_counter_path "$sid")
  n=$(slice_fail_count "$sid")
  echo $((n + 1)) > "$f"
}

slice_fail_reset() {
  rm -f "$(fail_counter_path "$1")" 2>/dev/null || true
}

check_circuit_breakers() {
  # Returns 0 = keep going, 1 = trip and exit.
  local now elapsed
  now=$(date +%s)
  elapsed=$((now - SESSION_START))

  if [[ "$elapsed" -ge "$MAX_SESSION_SECONDS" ]]; then
    log "CIRCUIT BREAKER: session wall-clock exceeded ($elapsed s >= $MAX_SESSION_SECONDS s); exiting cleanly"
    return 1
  fi

  if [[ "$TOTAL_DISPATCHES" -ge "$MAX_TOTAL_DISPATCHES" ]]; then
    log "CIRCUIT BREAKER: total dispatches exceeded ($TOTAL_DISPATCHES >= $MAX_TOTAL_DISPATCHES); exiting cleanly"
    return 1
  fi

  return 0
}

# Wrap a dispatch invocation with bookkeeping: counts dispatch, tracks per-slice
# failures, trips the circuit breaker if a slice fails too many times in a row.
# Args: <slice_id> <command> [args...]
dispatch_with_guards() {
  local sid="$1"; shift
  TOTAL_DISPATCHES=$((TOTAL_DISPATCHES + 1))

  local fc rc
  fc=$(slice_fail_count "$sid")
  if [[ "$fc" -ge "$MAX_SLICE_FAILURES" ]]; then
    log "CIRCUIT BREAKER: slice=$sid has failed $fc times consecutively (limit $MAX_SLICE_FAILURES); exiting cleanly"
    return 2  # signal to outer loop to exit
  fi

  if "$@"; then
    rc=0
    slice_fail_reset "$sid"
  else
    rc=$?
    slice_fail_increment "$sid"
    log "dispatch failed slice=$sid rc=$rc consecutive_failures=$(slice_fail_count "$sid")"
  fi
  return 0  # bookkept; let outer loop continue
}

# Resolve a portable timeout command. macOS lacks both `timeout` (GNU) and
# `gtimeout` (coreutils brew) by default. Fall back to a `perl` alarm shim.
resolve_timeout() {
  if command -v timeout >/dev/null 2>&1; then echo "timeout"; return; fi
  if command -v gtimeout >/dev/null 2>&1; then echo "gtimeout"; return; fi
  echo ""
}
TIMEOUT_BIN="$(resolve_timeout)"

run_with_timeout() {
  local secs="$1"; shift
  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" "$secs" "$@"
  else
    # perl alarm shim — works on stock macOS.
    perl -e '
      use POSIX ":sys_wait_h";
      my $secs = shift;
      my $pid = fork();
      if ($pid == 0) { exec @ARGV; exit 127; }
      local $SIG{ALRM} = sub { kill 15, $pid; sleep 2; kill 9, $pid; exit 124; };
      alarm $secs;
      waitpid($pid, 0);
      exit ($? >> 8);
    ' "$secs" "$@"
  fi
}
log "timeout backend: ${TIMEOUT_BIN:-perl-alarm-shim}"

while true; do
  if ! check_circuit_breakers; then
    rm -f "$PIDFILE"
    exit 0
  fi

  if ! "$LOOP_DIR/preconditions.sh" >>"$LOG" 2>&1; then
    log "preconditions failed; sleeping"
    sleep "$TICK"; continue
  fi

  read -r slice_id owner status <<<"$("$LOOP_DIR/select_next_slice.sh" || true)"
  if [[ -z "${slice_id:-}" ]]; then
    log "no actionable slice; sleeping"
    sleep "$TICK"; continue
  fi

  log "tick: slice=$slice_id owner=$owner status=$status"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY_RUN: would dispatch $owner for $slice_id"
    sleep "$TICK"; continue
  fi

  guard_rc=0
  case "$owner:$status" in
    claude:pending|claude:revising)
      dispatch_with_guards "$slice_id" \
        run_with_timeout "$MAX_SLICE_DURATION" "$LOOP_DIR/dispatch_claude.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    codex:pending_plan_audit)
      # Plan-audit phase: Codex reviews the slice file for plan bugs BEFORE
      # any Claude implementation runs. Returns triaged High/Medium/Low
      # action items. Iterates with claude:revising_plan until the triage
      # list is empty (Codex returns APPROVED).
      dispatch_with_guards "$slice_id" \
        run_with_timeout 900 "$LOOP_DIR/dispatch_slice_audit.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    claude:revising_plan)
      # Plan-revise phase: Claude addresses the triaged items, edits the
      # slice file only, flips status back to pending_plan_audit for the
      # next Codex round. Bounded by LOOP_MAX_PLAN_ITERATIONS (default 4).
      dispatch_with_guards "$slice_id" \
        run_with_timeout 900 "$LOOP_DIR/dispatch_plan_revise.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    codex:awaiting_audit)
      dispatch_with_guards "$slice_id" \
        run_with_timeout "$MAX_SLICE_DURATION" "$LOOP_DIR/dispatch_codex.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    user:ready_to_merge)
      # Auto-merge by default. Approval-flagged slices still require a sentinel
      # at diagnostic/slices/.approved-merge/<slice_id>; the merger checks that
      # itself and exits 0 (no-op) if not present.
      log "auto-merging slice=$slice_id"
      dispatch_with_guards "$slice_id" \
        run_with_timeout 600 "$LOOP_DIR/dispatch_merger.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    user:blocked)
      # If LOOP_AUTO_REPAIR=1, try to autonomously repair the protocol or
      # flip the slice back to revising. Bounded by LOOP_MAX_REPAIRS (default 3).
      # If the repair dispatcher exits 4, give up and fall through to USER ATTENTION.
      if [[ "${LOOP_AUTO_REPAIR:-0}" == "1" ]]; then
        log "auto-repair attempt for slice=$slice_id"
        TOTAL_DISPATCHES=$((TOTAL_DISPATCHES + 1))
        if run_with_timeout 600 "$LOOP_DIR/dispatch_repair.sh" "$slice_id"; then
          # Dispatcher succeeded; status should now be revising or escalated.
          # Loop continues; selector will pick up whatever the new state is.
          continue
        else
          rc=$?
          if [[ "$rc" == "4" ]]; then
            log "auto-repair gave up (max attempts); USER ATTENTION: slice=$slice_id"
            log "CIRCUIT BREAKER: max repairs reached; exiting cleanly"
            rm -f "$PIDFILE"; exit 0
          else
            log "auto-repair failed (rc=$rc) for slice=$slice_id"
          fi
          # fall through to USER ATTENTION
        fi
      fi
      log "USER ATTENTION: slice=$slice_id status=blocked"
      log "CIRCUIT BREAKER: surfacing user attention; exiting cleanly so user can intervene"
      printf '\a'
      rm -f "$PIDFILE"; exit 0
      ;;
    *)
      log "unhandled owner:status pair $owner:$status"
      ;;
  esac

  # If a guard tripped (rc=2 from dispatch_with_guards), exit cleanly.
  if [[ $guard_rc -eq 2 ]]; then
    rm -f "$PIDFILE"; exit 0
  fi

  sleep "$TICK"
done
