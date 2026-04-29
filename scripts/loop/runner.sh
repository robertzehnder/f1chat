#!/usr/bin/env bash
# scripts/loop/runner.sh
# Long-running orchestrator for the OpenF1 perf-roadmap loop.
# See diagnostic/automation_2026-04_loop_runner.md §4 for spec.
#
# Item 2 (round-12) migration:
#  - Exports LOOP_MAIN_WORKTREE + LOOP_STATE_DIR (absolute paths) for all
#    helpers and dispatchers (round-2 H-3).
#  - Sources repo_lock.sh + worktree_helpers.sh + slice_helpers.sh +
#    state_transitions.sh.
#  - Resume hook for pending loop-infra repairs runs FIRST, BEFORE
#    preconditions.sh (round-6 H-1). Without this, ahead-of-origin state
#    or sentinel files would otherwise cause preconditions to refuse start.
#  - dispatch_with_guards uses is_valid_terminal_transition allow-list
#    (round-7 C-5 — verdict-landed-by-status detection).
#  - DISPATCH_TIMEOUT default 86400s (24h, round-12 user-set) for the long
#    autonomous run; per-dispatch overrides still honored.
#  - max-session and max-total-dispatches scaled up for multi-day runs.

set -euo pipefail

# Harden PATH so child dispatchers can find node, npm, codex, claude, etc.
# Without this the runner inherits whatever PATH the launching shell had,
# and codex's wrapper script — which calls `env node ...` on its first
# line — silently fails with rc=127 if the launching shell stripped the
# nvm path. (Observed 2026-04-28: 06-driver-swap-local-fallback impl-audit
# circuit-broke after 5 consecutive rc=127 dispatches.) This block makes
# the runner self-sufficient regardless of how it was launched.
_runner_path_segments=(
  "$HOME/.nvm/versions/node/v22.12.0/bin"
  "/opt/homebrew/bin"
  "/opt/homebrew/sbin"
  "/usr/local/bin"
  "/usr/bin"
  "/bin"
  "/usr/sbin"
  "/sbin"
)
for _seg in "${_runner_path_segments[@]}"; do
  case ":${PATH:-}:" in
    *":$_seg:"*) : ;;  # already there
    *) [[ -d "$_seg" ]] && PATH="$_seg:${PATH:-}" ;;
  esac
done
export PATH
unset _runner_path_segments _seg

# Resolve the main worktree's absolute path BEFORE anything else.
LOOP_MAIN_WORKTREE="$(git rev-parse --show-toplevel)"
export LOOP_MAIN_WORKTREE

cd "$LOOP_MAIN_WORKTREE"

LOOP_DIR="$LOOP_MAIN_WORKTREE/scripts/loop"
LOOP_STATE_DIR="$LOOP_DIR/state"
export LOOP_STATE_DIR

LOG="$LOOP_STATE_DIR/runner.log"
PIDFILE="$LOOP_STATE_DIR/runner.pid"

mkdir -p "$LOOP_STATE_DIR"

# ----- auto-load env from .env files -----
# Load order (later wins):
#   1. $LOOP_MAIN_WORKTREE/.env             (root: Postgres DB_* defaults)
#   2. $LOOP_MAIN_WORKTREE/web/.env.local   (web: ANTHROPIC_API_KEY, OPENF1_*)
# Existing env (caller's exports) wins over both — we only set vars that
# aren't already in the environment so explicit shell exports take priority.
# Lines starting with # are skipped; values are NOT shell-evaluated (no
# command substitution / no var expansion) so secrets stay literal.
_load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  local key val line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ''|'#'*) continue ;;
      *=*)
        key="${line%%=*}"
        val="${line#*=}"
        # Strip surrounding quotes from val if present.
        case "$val" in
          \"*\") val="${val%\"}"; val="${val#\"}" ;;
          \'*\') val="${val%\'}"; val="${val#\'}" ;;
        esac
        # Trim trailing whitespace from key.
        key="${key%"${key##*[![:space:]]}"}"
        # Skip if already set in env (caller's explicit export wins).
        if [[ -z "${!key:-}" ]]; then
          export "$key=$val"
        fi
        ;;
    esac
  done < "$f"
}
_load_env_file "$LOOP_MAIN_WORKTREE/.env"
_load_env_file "$LOOP_MAIN_WORKTREE/web/.env.local"

# Derive DATABASE_URL from DB_* parts if not set explicitly. db.ts expects
# either DATABASE_URL/NEON_DATABASE_URL or the full DB_HOST/USER/PASSWORD/
# NAME/PORT set; some agent dispatchers shell out to psql/etc. and want a
# single connection string.
if [[ -z "${DATABASE_URL:-}" && -z "${NEON_DATABASE_URL:-}" ]]; then
  if [[ -n "${DB_HOST:-}" && -n "${DB_USER:-}" && -n "${DB_NAME:-}" ]]; then
    : "${DB_PORT:=5432}"
    : "${DB_PASSWORD:=}"
    if [[ -n "$DB_PASSWORD" ]]; then
      export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    else
      export DATABASE_URL="postgres://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    fi
  fi
fi

# ----- runtime knobs -----
TICK="${LOOP_TICK:-30}"
DRY_RUN="${LOOP_DRY_RUN:-0}"

# Per-dispatch wall-clock budget (round-12 user-set 24h default).
# Asymmetric with LOCK_TIMEOUT (300s) — locks are short, dispatches can
# legitimately take hours.
DISPATCH_TIMEOUT="${LOOP_DISPATCH_TIMEOUT:-86400}"

# Optional per-dispatch overrides (most agents finish in minutes; some don't).
PLAN_AUDIT_TIMEOUT="${LOOP_PLAN_AUDIT_TIMEOUT:-1800}"      # 30 min
PLAN_REVISE_TIMEOUT="${LOOP_PLAN_REVISE_TIMEOUT:-1800}"    # 30 min
IMPL_AUDIT_TIMEOUT="${LOOP_IMPL_AUDIT_TIMEOUT:-3600}"      # 1 hour
MERGER_TIMEOUT="${LOOP_MERGER_TIMEOUT:-1200}"              # 20 min
REPAIR_TIMEOUT="${LOOP_REPAIR_TIMEOUT:-1800}"              # 30 min

# Circuit breakers — graceful exits to avoid token-burning runaways.
MAX_SLICE_FAILURES="${LOOP_MAX_SLICE_FAILURES:-5}"
MAX_TOTAL_DISPATCHES="${LOOP_MAX_TOTAL_DISPATCHES:-2000}"   # 86 slices × ~25 dispatches each
MAX_SESSION_SECONDS="${LOOP_MAX_SESSION_SECONDS:-345600}"   # 4 days
SESSION_START=$(date +%s)
TOTAL_DISPATCHES=0

log() {
  local msg
  msg="$(date -Iseconds) $*"
  printf '%s\n' "$msg" | tee -a "$LOG"
  # Webhook notify on key events (round-12 Item 11). LOOP_NOTIFY_WEBHOOK
  # is a generic JSON POST endpoint — any tool the user wires.
  case "$*" in
    *"CIRCUIT BREAKER"*|*"USER ATTENTION"*|*"merged and pushed"*|*"runner exit"*|*"REGRESSION"*|*"resume:"*"approved and pushed"*)
      _notify_webhook "$*"
      ;;
  esac
}

_notify_webhook() {
  [[ -z "${LOOP_NOTIFY_WEBHOOK:-}" ]] && return 0
  local raw="$1" event slice short_sha payload
  case "$raw" in
    *"CIRCUIT BREAKER"*) event="circuit_breaker" ;;
    *"USER ATTENTION"*)  event="user_attention" ;;
    *"merged and pushed"*) event="merged" ;;
    *"runner exit"*)     event="runner_exit" ;;
    *"REGRESSION"*)      event="regression" ;;
    *"resume:"*)         event="loop_infra_resumed" ;;
    *)                   event="info" ;;
  esac
  slice=$(echo "$raw" | sed -nE 's/.*slice=([^ ]+).*/\1/p' | head -1)
  short_sha=$(git -C "$LOOP_MAIN_WORKTREE" rev-parse --short HEAD 2>/dev/null || echo unknown)
  payload=$(printf '{"ts":"%s","event":"%s","slice_id":"%s","commit":"%s","message":%s}' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$event" "$slice" "$short_sha" \
    "$(printf '%s' "$raw" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')")
  curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$LOOP_NOTIFY_WEBHOOK" >/dev/null 2>&1 || true
}

# ----- source helpers -----
# repo_lock.sh provides with_repo_lock; worktree_helpers.sh provides
# WORKTREE_BASE + ensure_slice_worktree + cleanup_slice_state.
# shellcheck disable=SC1091
source "$LOOP_DIR/repo_lock.sh"
# shellcheck disable=SC1091
source "$LOOP_DIR/worktree_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_DIR/slice_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_DIR/state_transitions.sh"

echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"; log "runner exit"; exit 0' INT TERM

log "runner start pid=$$ tick=$TICK dry_run=$DRY_RUN main_worktree=$LOOP_MAIN_WORKTREE"
log "guards: max_slice_failures=$MAX_SLICE_FAILURES max_total_dispatches=$MAX_TOTAL_DISPATCHES max_session_seconds=$MAX_SESSION_SECONDS"
log "timeouts: dispatch=${DISPATCH_TIMEOUT}s plan_audit=${PLAN_AUDIT_TIMEOUT}s plan_revise=${PLAN_REVISE_TIMEOUT}s impl_audit=${IMPL_AUDIT_TIMEOUT}s merger=${MERGER_TIMEOUT}s"

# ============================================================
# RESUME HOOK — runs BEFORE preconditions.sh (round-6 H-1)
# ============================================================
# Scans for pending loop-infra repairs via approval sentinels (round-8 H-1).
# Each sentinel has the form `<slice_id>__attempt-<N>` (round-10 H-1).
# Idempotent: safe to re-run from any partial-failure state.

resume_pending_loop_infra_repair() {
  cd "$LOOP_MAIN_WORKTREE"
  local sentinel_dir="diagnostic/slices/.approved-loop-infra-repair"
  [[ -d "$sentinel_dir" ]] || return 0

  local sentinel sentinel_basename slice_id attempt_n
  for sentinel in "$sentinel_dir"/*; do
    [[ -f "$sentinel" ]] || continue
    sentinel_basename=$(basename "$sentinel")
    [[ "$sentinel_basename" == ".gitkeep" ]] && continue

    if [[ "$sentinel_basename" != *__attempt-* ]]; then
      log "resume: sentinel '$sentinel_basename' missing __attempt-N suffix; skipping (legacy/malformed)"
      continue
    fi
    slice_id="${sentinel_basename%__attempt-*}"
    attempt_n="${sentinel_basename##*__attempt-}"
    if ! [[ "$attempt_n" =~ ^[0-9]+$ ]]; then
      log "resume: sentinel '$sentinel_basename' has non-numeric attempt '$attempt_n'; skipping"
      continue
    fi

    # Round-10 L-4: stale-cleanup decisions need fresh origin view.
    if ! git fetch origin integration/perf-roadmap >/dev/null 2>&1; then
      log "resume: git fetch failed for $slice_id (attempt $attempt_n); sentinel preserved"
      continue
    fi

    local attempt_tag="\\[loop-infra-pending\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
    local resumed_attempt_tag="\\[loop-infra-resumed\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
    local pending_anywhere resumed_anywhere
    pending_anywhere=$( {
      git log "origin/integration/perf-roadmap..HEAD" --grep="$attempt_tag" --pretty=format:%H 2>/dev/null
      git log "origin/integration/perf-roadmap"       --grep="$attempt_tag" --pretty=format:%H 2>/dev/null
    } | grep -m1 . || true)
    resumed_anywhere=$( {
      git log "origin/integration/perf-roadmap..HEAD" --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null
      git log "origin/integration/perf-roadmap"       --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null
    } | grep -m1 . || true)

    if [[ -n "$pending_anywhere" || -n "$resumed_anywhere" ]]; then
      with_repo_lock "resume:loop-infra:$slice_id:$attempt_n" \
        _do_resume_loop_infra "$slice_id" "$sentinel" "$attempt_n" || true
      continue
    fi

    # No pending/resumed for THIS attempt anywhere. Stronger stale rule:
    # preserve when slice is blocked (user pre-approved a future attempt).
    local current_status
    current_status=$(read_slice_field "$slice_id" "status" 2>/dev/null || true)
    if [[ "$current_status" == "blocked" ]]; then
      log "resume: sentinel preserved for $slice_id attempt $attempt_n (slice blocked, awaiting repair)"
      continue
    fi

    rm -f "$sentinel"
    log "resume: stale sentinel removed for $slice_id attempt $attempt_n (status=$current_status)"
  done
}

_do_resume_loop_infra() {
  local slice_id="$1" sentinel="$2" attempt_n="$3"
  cd "$LOOP_MAIN_WORKTREE"

  local repair_attempt_tag="\\[loop-infra-repair\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
  local pending_attempt_tag="\\[loop-infra-pending\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"
  local resumed_attempt_tag="\\[loop-infra-resumed\\]\\[slice:${slice_id}\\]\\[attempt:${attempt_n}\\]"

  # 1. Idempotency check 1 — has [loop-infra-resumed][attempt:N] already
  #    been committed locally OR landed on origin?
  local resumed_local resumed_on_origin
  resumed_local=$(git log "origin/integration/perf-roadmap..HEAD" --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null | head -c1)
  resumed_on_origin=$(git log "origin/integration/perf-roadmap" --grep="$resumed_attempt_tag" --pretty=format:%H 2>/dev/null | head -c1)

  if [[ -n "$resumed_on_origin" ]]; then
    rm -f "$sentinel"
    log "resume: [loop-infra-resumed][attempt:$attempt_n] already on origin for $slice_id; sentinel cleaned up"
    return 0
  fi

  if [[ -n "$resumed_local" ]]; then
    log "resume: [loop-infra-resumed][attempt:$attempt_n] commit already exists locally for $slice_id; retrying push"
  else
    # 2. Idempotency check 2 — has the FIRST push (of pending+repair)
    #    already happened? If origin already has [loop-infra-pending]
    #    for this attempt, skip the first push.
    local pending_on_origin
    pending_on_origin=$(git log "origin/integration/perf-roadmap" --grep="$pending_attempt_tag" --pretty=format:%H 2>/dev/null | head -c1)

    if [[ -z "$pending_on_origin" ]]; then
      if ! git push >/dev/null 2>&1; then
        log "resume: initial push failed for $slice_id attempt $attempt_n; sentinel retained for retry"
        return 1
      fi
    else
      log "resume: [loop-infra-pending][attempt:$attempt_n] already on origin for $slice_id; skipping initial push"
    fi

    # FAULT INJECTION POINT (round-11 M-2): after_initial_push_before_resumed_commit
    if [[ "${LOOP_TEST_MODE:-0}" == "1" && "${LOOP_TEST_INJECT_FAULT:-}" == "after_initial_push_before_resumed_commit" ]]; then
      log "TEST FAULT: injecting exit 137 at after_initial_push_before_resumed_commit"
      exit 137
    fi

    # 3. Flip slice file back to its pre-block state. Resume-as: trailer
    #    is dispatcher-injected (round-10 M-2) — required, fail closed.
    local repair_commit resume_status
    repair_commit=$(git log "origin/integration/perf-roadmap" --grep="$repair_attempt_tag" --pretty=format:%H 2>/dev/null | head -1)
    [[ -z "$repair_commit" ]] && repair_commit=$(git log --grep="$repair_attempt_tag" --pretty=format:%H 2>/dev/null | head -1)
    if [[ -z "$repair_commit" ]]; then
      log "resume: FAIL — no [loop-infra-repair][attempt:$attempt_n] commit found for $slice_id"
      return 1
    fi
    resume_status=$(git log -1 --pretty=%B "$repair_commit" 2>/dev/null | sed -nE 's/^Resume-as: (.+)$/\1/p' | head -1)
    if [[ -z "$resume_status" ]]; then
      log "resume: FAIL — Resume-as: trailer missing on repair commit $repair_commit for $slice_id"
      return 1
    fi
    case "$resume_status" in
      revising_plan|revising) ;;
      *)
        log "resume: FAIL — Resume-as: '$resume_status' invalid; sentinel retained"
        return 1
        ;;
    esac
    flip_slice_status "$slice_id" "$resume_status" "claude"
    git add "diagnostic/slices/${slice_id}.md"
    git commit -m "[loop-infra-resumed][slice:${slice_id}][attempt:${attempt_n}] resume after user-approved repair" >/dev/null
  fi

  # FAULT INJECTION POINT (round-11 M-2): after_resumed_commit_before_final_push
  if [[ "${LOOP_TEST_MODE:-0}" == "1" && "${LOOP_TEST_INJECT_FAULT:-}" == "after_resumed_commit_before_final_push" ]]; then
    log "TEST FAULT: injecting exit 137 at after_resumed_commit_before_final_push"
    exit 137
  fi

  # 4. Push the resumed commit. Sentinel only removed AFTER push succeeds.
  if ! git push >/dev/null 2>&1; then
    log "resume: post-flip push failed for $slice_id; sentinel retained for retry on next runner start"
    return 1
  fi

  rm -f "$sentinel"
  log "resume: loop-infra repair approved and pushed for $slice_id attempt $attempt_n"
}

# Resume FIRST (round-6 H-1).
log "running loop-infra resume hook"
resume_pending_loop_infra_repair || log "resume hook returned non-zero (sentinels preserved); continuing"

# ============================================================
# circuit-breaker / dispatch helpers
# ============================================================

fail_counter_path() { echo "$LOOP_STATE_DIR/fail_count_$1"; }

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

# Per-slice claude-dispatch counter (separate from the consecutive-failure
# counter). Increments on every claude-side dispatch (impl, plan_revise,
# plan_audit-by-claude). When the count exceeds LOOP_CLAUDE_DISPATCH_CAP_PER_SLICE
# (default 12 — ~6 plan iterations + 1 impl), the slice is escalated to
# user attention and the runner exits cleanly.
claude_count_path() { echo "$LOOP_STATE_DIR/claude_dispatch_count_$1"; }

slice_claude_count() {
  cat "$(claude_count_path "$1")" 2>/dev/null || echo 0
}

slice_claude_increment() {
  local f n
  f=$(claude_count_path "$1")
  n=$(slice_claude_count "$1")
  echo $((n + 1)) > "$f"
}

# Reset the claude counter whenever the slice cleanly advances out of
# claude territory (impl→awaiting_audit, or plan→pending after final
# codex APPROVED). Called from dispatch_with_guards after any successful
# transition that moves owner away from claude.
slice_claude_reset() {
  rm -f "$(claude_count_path "$1")" 2>/dev/null || true
}

check_circuit_breakers() {
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

# Wrap a dispatch invocation with bookkeeping + verdict-landed-by-status
# detection (round-7 C-5). The dispatch is treated as success ONLY if the
# slice frontmatter transitioned from `before` to a known terminal state for
# `dispatch_type` — regardless of the dispatcher's exit code.
#
# Args: <dispatch_type> <slice_id> <command> [args...]
dispatch_with_guards() {
  local dispatch_type="$1"; shift
  local sid="$1"; shift
  TOTAL_DISPATCHES=$((TOTAL_DISPATCHES + 1))

  local fc rc
  fc=$(slice_fail_count "$sid")
  if [[ "$fc" -ge "$MAX_SLICE_FAILURES" ]]; then
    log "CIRCUIT BREAKER: slice=$sid has failed $fc times consecutively (limit $MAX_SLICE_FAILURES); exiting cleanly"
    return 2
  fi

  # Per-slice claude-dispatch budget cap. Counts claude calls (impl,
  # plan_revise, plan_audit-by-claude) for THIS slice and exits cleanly
  # if the slice has consumed too many — catches slow/oscillating slices
  # that pass the consecutive-failure check (because they technically
  # transition each round) but burn the user's claude quota anyway.
  local CLAUDE_CAP="${LOOP_CLAUDE_DISPATCH_CAP_PER_SLICE:-12}"
  local is_claude_dispatch="false"
  case "$dispatch_type" in
    impl|plan_revise) is_claude_dispatch="true" ;;
    plan_audit)
      # Plan-audit can be either claude (default) or codex (legacy). The
      # dispatcher selects based on slice-owner; mirror that here using
      # the same env-knob precedence.
      if [[ -n "${LOOP_PLAN_AUDIT_AGENT:-}" ]]; then
        [[ "$LOOP_PLAN_AUDIT_AGENT" == "claude" ]] && is_claude_dispatch="true"
      else
        local owner
        owner=$(read_slice_field "$sid" "owner" 2>/dev/null || echo "")
        [[ "$owner" == "claude" ]] && is_claude_dispatch="true"
      fi
      ;;
  esac
  if [[ "$is_claude_dispatch" == "true" ]]; then
    local claude_n
    claude_n=$(slice_claude_count "$sid")
    if (( claude_n >= CLAUDE_CAP )); then
      log "CIRCUIT BREAKER: slice=$sid has consumed $claude_n claude dispatches (cap $CLAUDE_CAP); USER ATTENTION; exiting cleanly"
      return 2
    fi
    slice_claude_increment "$sid"
  fi

  local status_before status_after owner_before owner_after
  status_before=$(read_slice_field "$sid" "status" 2>/dev/null || echo "")
  owner_before=$(read_slice_field "$sid" "owner" 2>/dev/null || echo "")

  set +e
  "$@"
  rc=$?
  set -e

  # rc=42 = sentinel for codex usage-limit (set by dispatch_codex.sh /
  # dispatch_slice_audit.sh via codex_usage_limit.sh). The slice's status
  # didn't change because codex never produced work — do NOT increment the
  # slice failure counter (this isn't the slice's fault) and signal the
  # main loop to exit cleanly. The cooldown gate at loop top will respect
  # codex_not_before on next start.
  if [[ "$rc" -eq 42 ]]; then
    log "CIRCUIT BREAKER: codex usage limit (slice=$sid type=$dispatch_type rc=42); exiting cleanly"
    return 3
  fi

  status_after=$(read_slice_field "$sid" "status" 2>/dev/null || echo "")
  owner_after=$(read_slice_field "$sid" "owner" 2>/dev/null || echo "")

  # The plan-audit phase has a status-only-stays / owner-flips transition
  # (claude self-audit APPROVED hands off to codex by flipping owner from
  # claude→codex while keeping status=pending_plan_audit). Detect a real
  # transition as: status changed OR owner changed at the same status.
  local transitioned="false"
  if [[ "$status_before" != "$status_after" ]]; then
    transitioned="true"
  elif [[ "$owner_before" != "$owner_after" ]]; then
    transitioned="true"
  fi

  if [[ -n "$status_before" && -n "$status_after" && "$transitioned" == "true" ]] \
     && is_valid_terminal_transition "$dispatch_type" "$status_before" "$status_after"; then
    slice_fail_reset "$sid"
    # Reset the per-slice claude budget when the slice hands off out of
    # claude's hands (e.g. plan APPROVED → owner=codex, or impl done →
    # awaiting_audit). The counter is meant to catch claude-side
    # oscillation, not accumulated lifetime use.
    if [[ "$owner_after" != "claude" ]]; then
      slice_claude_reset "$sid"
    fi
    log "dispatch ok slice=$sid type=$dispatch_type ${status_before}/${owner_before} → ${status_after}/${owner_after} (rc=$rc)"
  else
    slice_fail_increment "$sid"
    log "dispatch failed slice=$sid type=$dispatch_type rc=$rc before='$status_before/$owner_before' after='$status_after/$owner_after' consecutive_failures=$(slice_fail_count "$sid")"
  fi
  return 0
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

# ============================================================
# main loop
# ============================================================

while true; do
  if ! check_circuit_breakers; then
    rm -f "$PIDFILE"
    exit 0
  fi

  # Codex cooldown gate (Tier A.A3 + Tier B.B3). codex_usage_limit.sh
  # writes codex_not_before when a usage-limit error is observed; default
  # behavior is to sleep until the parsed retry-time (bounded by TICK so a
  # stale/clock-corrupted file can't strand the runner). When
  # LOOP_AUTO_CLAUDE_FALLBACK=1 is set, we DON'T sleep — the dispatcher
  # checks the same sentinel and routes to claude instead, so the runner
  # should keep ticking. Missing or unreadable file = no cooldown.
  if [[ -r "$LOOP_STATE_DIR/codex_not_before" ]]; then
    not_before=$(cat "$LOOP_STATE_DIR/codex_not_before" 2>/dev/null || echo 0)
    if [[ "$not_before" =~ ^[0-9]+$ ]] && (( $(date +%s) < not_before )); then
      if [[ "${LOOP_AUTO_CLAUDE_FALLBACK:-0}" == "1" ]]; then
        # Don't sleep: dispatcher will route to claude. Just log once and
        # continue to dispatch normally.
        :
      else
        remaining=$(( not_before - $(date +%s) ))
        sleep_for=$(( remaining < TICK ? remaining : TICK ))
        log "codex cooldown active; remaining=${remaining}s sleep=${sleep_for}s"
        sleep "$sleep_for"
        continue
      fi
    else
      # Cooldown expired (or junk in the file) — clear it.
      rm -f "$LOOP_STATE_DIR/codex_not_before"
      log "codex cooldown cleared; resuming dispatch"
    fi
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
      dispatch_with_guards "impl" "$slice_id" \
        run_with_timeout "$DISPATCH_TIMEOUT" "$LOOP_DIR/dispatch_claude.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    claude:pending_plan_audit|codex:pending_plan_audit)
      # Plan-audit phase, two-tier:
      #   owner=claude → claude self-audit (cheap, iterative)
      #   owner=codex  → codex final plan audit (external gatekeeper)
      # The dispatcher receives owner as $2 and routes accordingly. Both
      # owner values are accepted by this case match so a single status
      # carries the slice through both audit tiers and through any in-
      # flight legacy slices that still have owner=codex from prior runs.
      dispatch_with_guards "plan_audit" "$slice_id" \
        run_with_timeout "$PLAN_AUDIT_TIMEOUT" "$LOOP_DIR/dispatch_slice_audit.sh" "$slice_id" "$owner" \
        || guard_rc=$?
      ;;
    claude:revising_plan)
      dispatch_with_guards "plan_revise" "$slice_id" \
        run_with_timeout "$PLAN_REVISE_TIMEOUT" "$LOOP_DIR/dispatch_plan_revise.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    codex:awaiting_audit)
      dispatch_with_guards "impl_audit" "$slice_id" \
        run_with_timeout "$IMPL_AUDIT_TIMEOUT" "$LOOP_DIR/dispatch_codex.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    user:ready_to_merge)
      log "auto-merging slice=$slice_id"
      dispatch_with_guards "merger" "$slice_id" \
        run_with_timeout "$MERGER_TIMEOUT" "$LOOP_DIR/dispatch_merger.sh" "$slice_id" \
        || guard_rc=$?
      ;;
    user:blocked)
      if [[ "${LOOP_AUTO_REPAIR:-0}" == "1" ]]; then
        log "auto-repair attempt for slice=$slice_id"
        TOTAL_DISPATCHES=$((TOTAL_DISPATCHES + 1))
        if run_with_timeout "$REPAIR_TIMEOUT" "$LOOP_DIR/dispatch_repair.sh" "$slice_id"; then
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

  # guard_rc=2 — slice consecutive-failure cap; guard_rc=3 — codex usage
  # limit (Tier A). Both are clean-exit signals. The cooldown gate at loop
  # top will pick up codex_not_before on next runner start.
  if [[ $guard_rc -eq 2 || $guard_rc -eq 3 ]]; then
    rm -f "$PIDFILE"; exit 0
  fi

  sleep "$TICK"
done
