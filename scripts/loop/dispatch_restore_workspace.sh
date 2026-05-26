#!/usr/bin/env bash
# scripts/loop/dispatch_restore_workspace.sh <slice-id>
# §B.3 — Cline `"workspace"` scope: revert code changes in the proposal
# worktree to integration; preserve the slice file's audit history.
# Re-runs with audit feedback in context.
set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be exported by runner}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be exported by runner}"

slice_id="${1:?slice_id required}"
LOG="$LOOP_STATE_DIR/runner.log"

cd "$LOOP_MAIN_WORKTREE"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/worktree_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/slice_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/lib/proposal_helpers.sh"

stamp() { date -Iseconds; }
logmsg() { printf '[%s] restore_workspace %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$LOG"; }

# Find the proposal worktree path via the slice's frontmatter (falls back to legacy slice/<id>).
proposal_branch="$(effective_proposal_branch "$slice_id")"
case "$proposal_branch" in
  slice/*/proposal-*)
    n="${proposal_branch##*-}"
    proposal_worktree="$(proposal_worktree_path "$slice_id" "$n")"
    ;;
  *)
    proposal_worktree="${WORKTREE_BASE:-$HOME/.openf1-loop-worktrees}/$slice_id"
    ;;
esac

[[ -d "$proposal_worktree" ]] || { logmsg "ERROR: proposal worktree missing: $proposal_worktree"; exit 2; }

# Read "Changed files expected" from the slice file and checkout integration's
# version of each (effectively undoes the implementer's changes). Leave the
# .loop-state/ and slice file itself untouched (Cline's CheckpointExclusions pattern).
logmsg "begin: reverting proposal-worktree code to integration"
(
  cd "$proposal_worktree"
  awk '
    /^## Changed files expected$/ { in_section = 1; next }
    /^## / && in_section { exit }
    in_section && /^- `[^`]+`/ {
      match($0, /`[^`]+`/);
      print substr($0, RSTART+1, RLENGTH-2);
    }
  ' "diagnostic/slices/${slice_id}.md" | while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    case "$path" in
      diagnostic/slices/*|.loop-state/*) continue ;;
    esac
    if git ls-tree integration/perf-roadmap -- "$path" >/dev/null 2>&1; then
      git checkout integration/perf-roadmap -- "$path"
      echo "  reverted: $path"
    fi
  done
)

# Flip status back to revising; mark restore-mode.
flip_slice_status "$slice_id" revising claude
append_slice_section "$slice_id" "## Restore action" "Mode: workspace ($(stamp))\nReverted code to integration; preserved audit history."

# Log to triage_actions.jsonl.
mkdir -p "$LOOP_STATE_DIR"
printf '{"ts":"%s","slice":"%s","action":"restore_workspace"}\n' "$(stamp)" "$slice_id" \
  >> "$LOOP_STATE_DIR/triage_actions.jsonl"

logmsg "done"
