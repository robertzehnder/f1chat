#!/usr/bin/env bash
# scripts/loop/mirror_helper.sh
# Deterministic post-dispatch mirror of a slice's slice file from its slice
# branch back onto integration/perf-roadmap.
#
# After every dispatcher (plan-audit, plan-revise, impl, impl-audit) finishes,
# the agent has committed its work on slice/<id>. The runner reads slice
# state from integration/perf-roadmap, so the slice file's new frontmatter
# (and any appended sections — audit verdicts, slice-completion notes) must
# be replicated onto integration so the runner observes the handoff.
#
# This helper is invoked under with_repo_lock by the dispatcher AFTER the
# agent returns. The dispatcher reads the slice file from the slice branch
# via `git show`, writes it to the integration worktree, and commits +
# pushes — all under one lock.
#
# Round-2 H-2 (impl mirror): impl dispatch must also call this so the
# `pending|revising → awaiting_audit` transition lands on integration.
# Round-2 H-3 (uniform model): every state-changing dispatcher uses this.
# Round-3 M-3 (idempotent re-runs): no-op if content is identical.
# Round-3 H-2 (terminal-state validation): rejects in_progress and other
# non-terminal mirror attempts (the agent didn't actually finish).
#
# Source this file; do not exec it.

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"

# Args: <slice_id> <expected_terminal_states_pipe_separated>
# Example: mirror_slice_to_integration "01-foo" "pending|revising_plan|blocked"
mirror_slice_to_integration() {
  local slice_id="$1" terminal_states="$2"
  local slice_branch="slice/$slice_id"
  local rel="diagnostic/slices/${slice_id}.md"
  local main_path="$LOOP_MAIN_WORKTREE/$rel"

  # Pull the slice-branch version of the slice file. If git show fails,
  # the slice branch doesn't exist yet — that's a no-op (agent didn't run).
  local slice_branch_content
  if ! slice_branch_content=$(git -C "$LOOP_MAIN_WORKTREE" show "${slice_branch}:${rel}" 2>/dev/null); then
    echo "mirror: no $rel on $slice_branch; nothing to mirror" >&2
    return 0
  fi

  # Extract the new status from the slice-branch version.
  local new_status
  new_status=$(echo "$slice_branch_content" \
    | awk '
        /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
        fm && $1 == "status:" {
          sub(/^[^:]+: */, "");
          print;
          exit
        }
      ')
  if [[ -z "$new_status" ]]; then
    echo "mirror: could not parse status from $slice_branch:$rel; refusing to mirror" >&2
    return 1
  fi

  # Validate against the expected terminal states for this dispatch type.
  if ! echo "$new_status" | grep -Eq "^(${terminal_states})$"; then
    echo "mirror: slice status='$new_status' is NOT in expected terminal set ($terminal_states); refusing to mirror" >&2
    return 1
  fi

  # Ensure we're on integration in the main worktree.
  ( cd "$LOOP_MAIN_WORKTREE" && git checkout -q integration/perf-roadmap )
  ( cd "$LOOP_MAIN_WORKTREE" && git pull --ff-only --quiet ) || true

  # Idempotent: no-op if content already matches.
  if [[ -f "$main_path" ]] && diff -q <(echo "$slice_branch_content") "$main_path" >/dev/null 2>&1; then
    echo "mirror: $rel already in sync on integration; nothing to commit" >&2
    return 0
  fi

  echo "$slice_branch_content" > "$main_path"

  ( cd "$LOOP_MAIN_WORKTREE" && \
    git add "$rel" && \
    git commit -m "mirror: $slice_id status → $new_status

[slice:$slice_id][protocol-mirror]" >/dev/null 2>&1 ) || {
      echo "mirror: commit failed for $slice_id (perhaps no change?)" >&2
      return 0
  }

  # Push with one retry-on-rebase for the case where another dispatcher
  # just pushed.
  if ! ( cd "$LOOP_MAIN_WORKTREE" && git push --quiet ) 2>/dev/null; then
    ( cd "$LOOP_MAIN_WORKTREE" && git pull --rebase --quiet ) 2>/dev/null || true
    if ! ( cd "$LOOP_MAIN_WORKTREE" && git push --quiet ) 2>/dev/null; then
      echo "mirror: push failed for $slice_id after rebase retry" >&2
      return 1
    fi
  fi

  echo "mirror: $rel mirrored to integration (status=$new_status)" >&2
  return 0
}
