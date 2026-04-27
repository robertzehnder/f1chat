#!/usr/bin/env bash
# scripts/loop/repo_lock.sh
# Repo-level mutation lock for the OpenF1 perf-roadmap loop.
#
# All repo-mutating operations (worktree add/remove, mirror commits, merge,
# push, state-update commits) MUST run under with_repo_lock so that two
# dispatchers — or a dispatcher + the merger — never race on .git/index.lock
# or simultaneous pushes.
#
# Implementation notes:
#  - mkdir-based lock (NOT flock — macOS lacks it).
#  - Reentrant: nested with_repo_lock calls from the same PID just increment
#    a depth counter; release only happens when the outermost call returns.
#  - Stale-PID detection: if the lock owner PID is dead, force-release.
#  - EXIT trap STACKS the prior trap instead of clobbering (round-2 M-5).
#  - Owner identification uses BASHPID when available (bash 4+); on macOS's
#    bash 3.2 where BASHPID is unset, falls back to a lazy-initialized
#    per-process nonce ($$.$RANDOM.$RANDOM). The nonce is initialized on
#    first call and stable across calls within the same process; forked
#    subshells get a fresh init because $RANDOM is reseeded per process
#    (round-5 H-1 + bash-3.2 portability).
#
# Source this file; do not exec it.
#
#   source "$(git rev-parse --show-toplevel)/scripts/loop/repo_lock.sh"
#   with_repo_lock "owner-tag" some_command arg1 arg2

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"

# Use Git's common-dir with --path-format=absolute so the result is always an
# absolute path regardless of the caller's cwd (round-4 M-4 fix).
LOCK_DIR="$(git -C "$LOOP_MAIN_WORKTREE" rev-parse --path-format=absolute --git-common-dir)/openf1-loop.lock"
LOCK_TIMEOUT="${LOOP_LOCK_TIMEOUT:-300}"
LOCK_POLL="${LOOP_LOCK_POLL:-1}"

# Reentrant-lock counter for the current owner PID (round-4 H-1).
_REPO_LOCK_DEPTH=0
_REPO_LOCK_PRIOR_TRAP=""

# Owner-PID resolver. Bash 4+ has BASHPID; bash 3.2 (macOS default) does not.
# Fallback strategy: lazily generate a per-process nonce on first call and
# cache it in a shell variable that survives subsequent function calls
# within the same process. Forked subshells get fresh $RANDOM seeds, so the
# nonce will differ per fork — preventing parallel forks from false-matching
# each other's lock entries.
_LOCK_OWNER_NONCE=""
_lock_owner_pid() {
  if [[ -n "${BASHPID:-}" ]]; then
    echo "$BASHPID"
    return
  fi
  if [[ -z "$_LOCK_OWNER_NONCE" ]]; then
    _LOCK_OWNER_NONCE="$$.$RANDOM.$RANDOM"
  fi
  echo "$_LOCK_OWNER_NONCE"
}

# Acquire the lock. Blocks until acquired or LOCK_TIMEOUT exceeded.
# If the existing lock's owner PID is dead, force-release and re-acquire.
acquire_repo_lock() {
  local tag="${1:-}"
  local me; me=$(_lock_owner_pid)

  # Reentrant case: this PID already holds the lock.
  if [[ -d "$LOCK_DIR" ]]; then
    local stored_pid stored_owner
    stored_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
    stored_owner=$(cat "$LOCK_DIR/owner" 2>/dev/null || echo "?")
    if [[ "$stored_pid" == "$me" ]]; then
      _REPO_LOCK_DEPTH=$((_REPO_LOCK_DEPTH + 1))
      return 0
    fi
  fi

  # Try to acquire.
  local start; start=$(date +%s)
  while true; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "$me" > "$LOCK_DIR/pid"
      echo "${tag:-unknown}" > "$LOCK_DIR/owner"
      date -u +%Y-%m-%dT%H:%M:%SZ > "$LOCK_DIR/acquired_at"
      _REPO_LOCK_DEPTH=1
      return 0
    fi

    # Lock exists. Stale-check: is the owner PID still alive?
    # Owner ID is either a bare PID (BASHPID path) or "$$.RAND.RAND" (nonce
    # fallback for bash 3.2). For staleness, extract the leading numeric PID.
    local stored_pid stored_owner stored_pid_check
    stored_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
    stored_owner=$(cat "$LOCK_DIR/owner" 2>/dev/null || echo "?")
    stored_pid_check="${stored_pid%%.*}"
    if [[ -n "$stored_pid_check" ]] && ! kill -0 "$stored_pid_check" 2>/dev/null; then
      echo "lock: stale owner pid=$stored_pid (tag=$stored_owner) — force-releasing" >&2
      rm -rf "$LOCK_DIR"
      continue
    fi

    local now elapsed
    now=$(date +%s); elapsed=$((now - start))
    if [[ $elapsed -ge $LOCK_TIMEOUT ]]; then
      echo "lock timeout: held by $stored_owner (pid $stored_pid)" >&2
      return 1
    fi
    sleep "$LOCK_POLL"
  done
}

release_repo_lock() {
  if [[ $_REPO_LOCK_DEPTH -le 0 ]]; then return 0; fi
  _REPO_LOCK_DEPTH=$((_REPO_LOCK_DEPTH - 1))
  if [[ $_REPO_LOCK_DEPTH -eq 0 ]]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
  fi
}

# Stack onto any pre-existing EXIT trap rather than clobber it (round-2 M-5).
_stack_exit_trap_for_lock() {
  local current_trap
  current_trap=$(trap -p EXIT | sed -nE "s/^trap -- '(.+)' EXIT$/\1/p")
  if [[ -z "$current_trap" || "$current_trap" == *release_repo_lock* ]]; then
    # Already stacked or empty — install once.
    trap 'release_repo_lock; '"$current_trap" EXIT
  fi
}

# Run a command under the lock.
# Toggles set +e around the user command so that `set -e` in the caller
# doesn't kill us before we can release the lock and capture rc (round-2 M-5).
with_repo_lock() {
  local tag="$1"; shift
  acquire_repo_lock "$tag" || return $?
  _stack_exit_trap_for_lock

  local rc=0
  set +e
  "$@"
  rc=$?
  set -e

  release_repo_lock
  return $rc
}
