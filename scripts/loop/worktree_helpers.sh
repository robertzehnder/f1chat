#!/usr/bin/env bash
# scripts/loop/worktree_helpers.sh
# Per-slice git worktree management for the OpenF1 perf-roadmap loop.
#
# Each dispatched agent (plan-audit, plan-revise, impl, impl-audit, repair)
# runs in its own worktree at $WORKTREE_BASE/<slice_id>/, on branch
# slice/<slice_id>. The runner stays on integration/perf-roadmap in the main
# worktree. This eliminates the race where a user operating in the main
# worktree (or another dispatcher) finds the branch flipped under them.
#
# Source this file; do not exec it.
#
# Required env (exported by runner.sh):
#   LOOP_MAIN_WORKTREE  — absolute path to the main worktree (where runner runs)
#   LOOP_STATE_DIR      — absolute path to the runner's state dir
#   WORKTREE_BASE       — absolute path under which per-slice worktrees live
#   DISPATCH_TIMEOUT    — per-dispatch wall-clock budget (seconds, round-12 → 24h)

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be set (absolute path)}"

WORKTREE_BASE="${LOOP_WORKTREE_BASE:-$HOME/.openf1-loop-worktrees}"

# Per-dispatch wall-clock timeout (round-12 user-set: 24h).
# Asymmetric with LOCK_TIMEOUT (300s) because individual dispatches can
# legitimately run for hours; this is the catchall for hung agents.
DISPATCH_TIMEOUT="${LOOP_DISPATCH_TIMEOUT:-86400}"

# Source the lock helper for repo-mutating operations.
# shellcheck source=./repo_lock.sh
source "$LOOP_MAIN_WORKTREE/scripts/loop/repo_lock.sh"

# Ensure the slice's worktree exists and is on its slice branch.
# Reattaches to an existing slice branch instead of erroring with -b on
# re-entry (round-2 M-6). Detects orphan dirs not in `git worktree list` and
# prunes them.
#
# Args: <slice_id>
# Echoes: the worktree path on stdout.
ensure_slice_worktree() {
  local slice_id="$1"
  local slice_worktree="$WORKTREE_BASE/$slice_id"
  local slice_branch="slice/$slice_id"

  mkdir -p "$WORKTREE_BASE"

  # Round-3 H-1: a single locked call writes the path to a known temp file
  # so the caller can read it after the lock releases. (When this helper is
  # called via `with_repo_lock _ensure_slice_worktree_to_file`, the wrapper
  # below handles that path indirection.)

  # If the directory exists but git doesn't know about it, prune.
  if [[ -d "$slice_worktree" ]]; then
    if ! git -C "$LOOP_MAIN_WORKTREE" worktree list --porcelain \
        | grep -Fq "worktree $slice_worktree"; then
      ( cd "$LOOP_MAIN_WORKTREE" && git worktree prune ) >/dev/null 2>&1 || true
      rm -rf "$slice_worktree"
    fi
  fi

  if [[ ! -d "$slice_worktree" ]]; then
    # Branch may already exist on origin or locally (re-entry case).
    if git -C "$LOOP_MAIN_WORKTREE" show-ref --verify --quiet "refs/heads/$slice_branch" \
       || git -C "$LOOP_MAIN_WORKTREE" show-ref --verify --quiet "refs/remotes/origin/$slice_branch"; then
      git -C "$LOOP_MAIN_WORKTREE" worktree add "$slice_worktree" "$slice_branch" >/dev/null
    else
      git -C "$LOOP_MAIN_WORKTREE" worktree add "$slice_worktree" -b "$slice_branch" integration/perf-roadmap >/dev/null
    fi
  fi

  echo "$slice_worktree"
}

# Wrapper for callers that need to pass through with_repo_lock.
# Writes the path to a file because with_repo_lock returns rc, not stdout.
_ensure_slice_worktree_to_file() {
  local slice_id="$1" out_file="$2"
  ensure_slice_worktree "$slice_id" > "$out_file"
}

# Remove a slice's worktree (and any orphaned dirs). Idempotent.
# Does NOT delete the slice branch — the merger does that after merge.
cleanup_slice_worktree() {
  local slice_id="$1"
  local slice_worktree="$WORKTREE_BASE/$slice_id"
  if [[ -d "$slice_worktree" ]]; then
    ( cd "$LOOP_MAIN_WORKTREE" && git worktree remove "$slice_worktree" --force ) 2>/dev/null \
      || rm -rf "$slice_worktree"
  fi
  ( cd "$LOOP_MAIN_WORKTREE" && git worktree prune ) 2>/dev/null || true
}

# Round-11 L: on slice merge, purge per-slice state files AND any
# .approved-loop-infra-repair sentinels (across all attempt-N suffixes).
# Without this, a slice that merged after a prior repair cycle could leave
# stale sentinel files that would re-trigger the resume hook on the next
# runner start.
cleanup_slice_state() {
  local slice_id="$1"
  rm -f "$LOOP_STATE_DIR/repair_count_${slice_id}" \
        "$LOOP_STATE_DIR/plan_iter_count_${slice_id}" \
        "$LOOP_STATE_DIR/fail_count_${slice_id}"
  # Glob all attempt-N sentinels for this slice id.
  rm -f "$LOOP_MAIN_WORKTREE/diagnostic/slices/.approved-loop-infra-repair/${slice_id}__attempt-"* 2>/dev/null || true
}
