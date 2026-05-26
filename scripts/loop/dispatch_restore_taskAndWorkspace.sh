#!/usr/bin/env bash
# scripts/loop/dispatch_restore_taskAndWorkspace.sh <slice-id>
# §B.3 — Cline `"taskAndWorkspace"` scope: both restore_task + restore_workspace.
# Used when the slice has been stuck across multiple distinct REJECT verdicts
# (different complaint each time) — needs the agent to start from scratch.
set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be exported by runner}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be exported by runner}"

slice_id="${1:?slice_id required}"
LOG="$LOOP_STATE_DIR/runner.log"

cd "$LOOP_MAIN_WORKTREE"
stamp() { date -Iseconds; }
echo "[$(stamp)] restore_taskAndWorkspace $slice_id: dispatching restore_workspace + restore_task" >> "$LOG"

# Workspace first (revert code), then task (strip history). Both are idempotent.
"$LOOP_MAIN_WORKTREE/scripts/loop/dispatch_restore_workspace.sh" "$slice_id"
"$LOOP_MAIN_WORKTREE/scripts/loop/dispatch_restore_task.sh" "$slice_id"

printf '{"ts":"%s","slice":"%s","action":"restore_taskAndWorkspace"}\n' "$(stamp)" "$slice_id" \
  >> "$LOOP_STATE_DIR/triage_actions.jsonl"

echo "[$(stamp)] restore_taskAndWorkspace $slice_id: done" >> "$LOG"
