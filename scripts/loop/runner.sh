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

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG"; }

mkdir -p "$STATE_DIR"
echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"; log "runner exit"; exit 0' INT TERM

log "runner start pid=$$ tick=$TICK dry_run=$DRY_RUN"

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

  case "$owner:$status" in
    claude:pending|claude:revising)
      run_with_timeout "$MAX_SLICE_DURATION" "$LOOP_DIR/dispatch_claude.sh" "$slice_id" \
        || log "claude timeout/fail $slice_id"
      ;;
    codex:awaiting_audit)
      run_with_timeout "$MAX_SLICE_DURATION" "$LOOP_DIR/dispatch_codex.sh" "$slice_id" \
        || log "codex timeout/fail $slice_id"
      ;;
    user:ready_to_merge)
      # Auto-merge by default. Approval-flagged slices still require a sentinel
      # at diagnostic/slices/.approved-merge/<slice_id>; the merger checks that
      # itself and exits 0 (no-op) if not present.
      log "auto-merging slice=$slice_id"
      run_with_timeout 600 "$LOOP_DIR/dispatch_merger.sh" "$slice_id" \
        || log "merger fail $slice_id"
      ;;
    user:blocked)
      log "USER ATTENTION: slice=$slice_id status=blocked"
      printf '\a'
      sleep $((TICK * 4))
      continue
      ;;
    *)
      log "unhandled owner:status pair $owner:$status"
      ;;
  esac

  sleep "$TICK"
done
