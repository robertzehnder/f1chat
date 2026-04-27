#!/usr/bin/env bash
# scripts/loop/dispatch_claude.sh
# Headless invocation of Claude Code as the implementer agent.
# Usage: dispatch_claude.sh <slice_id>
#
# Item 2 (round-12): runs the agent in a per-slice worktree under
# WORKTREE_BASE/<slice_id>/ on branch slice/<slice_id>. The runner stays on
# integration/perf-roadmap in the main worktree. After the agent finishes,
# we mirror the slice file from the slice branch back onto integration so
# the runner observes the handoff (round-2 H-2).

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be exported by runner}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be exported by runner}"

cd "$LOOP_MAIN_WORKTREE"

# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/repo_lock.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/worktree_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/mirror_helper.sh"

slice_id="${1:?slice_id required}"
slice_file_main="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/claude_implementer.md"
LOG="$LOOP_STATE_DIR/runner.log"

[[ -f "$slice_file_main" ]] || { echo "missing $slice_file_main" >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH; install Claude Code first" >&2
  exit 3
fi

stamp=$(date -Iseconds)
echo "[$stamp] dispatch_claude $slice_id begin" >> "$LOG"

# 1. Ensure the slice's worktree exists (locked).
worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.$$"
trap 'rm -f "$worktree_path_file"' EXIT

with_repo_lock "dispatch_claude:$slice_id:worktree-prep" \
  _ensure_slice_worktree_to_file "$slice_id" "$worktree_path_file" || {
  echo "failed to ensure worktree for $slice_id" >&2
  exit 4
}
slice_worktree=$(cat "$worktree_path_file")

# 2. Run the agent inside the slice worktree (no main-worktree mutation).

# Run the agent in the slice worktree via subshell. Note: the working dir
# must be the slice worktree so claude sees the right git context.
(
  cd "$slice_worktree"
  claude --print \
    --model "${LOOP_CLAUDE_IMPL_MODEL:-claude-opus-4-7}" \
    --append-system-prompt "$(cat "$prompt_file")" \
    --permission-mode acceptEdits \
    --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
You are the Claude implementation agent in the OpenF1 perf-roadmap autonomous loop.

You are running in a dedicated git worktree at: ${slice_worktree}
The slice you are working on is: diagnostic/slices/${slice_id}.md

Read its frontmatter and "Steps" section. Execute the slice end-to-end:

1. Verify the frontmatter shows status=pending or status=revising; if not, exit immediately.
2. Update the frontmatter: status=in_progress, owner=claude, updated=$(date -Iseconds).
3. You are ALREADY on branch slice/${slice_id} in this worktree — do NOT switch branches.
4. Execute every numbered step in the slice's "Steps" section.
5. Run every command in the slice's "Gate commands" block. Record exit codes.
6. If all gates exit zero: fill in "Slice-completion note" with branch name, commit hashes, decisions, and self-check results. Set frontmatter status=awaiting_audit, owner=codex.
7. Commit your work with a message tagged: [slice:${slice_id}][awaiting-audit]
8. Push branch slice/${slice_id} to origin.

CRITICAL CONSTRAINTS:
- Do NOT modify any file not listed in "Changed files expected".
- Do NOT advance to a different slice — that is the runner's job.
- Do NOT push to integration/perf-roadmap or main.
- Do NOT touch ../<other-slice-worktrees> — you only own this worktree.
- If gates fail and you cannot fix them within scope, set status=blocked, owner=user, and document why.
EOF
)
agent_rc=$?

# 3. Mirror the slice file from slice branch back to integration under lock.
#    Expected terminal states for impl dispatch: awaiting_audit | blocked.
with_repo_lock "dispatch_claude:$slice_id:mirror" \
  mirror_slice_to_integration "$slice_id" "awaiting_audit|blocked" \
  || echo "[$stamp] dispatch_claude $slice_id mirror returned non-zero" >> "$LOG"

# Cost telemetry — best-effort token parse + estimated cost (round-12 Item 9).
"$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" claude || true

echo "[$(date -Iseconds)] dispatch_claude $slice_id end (agent_rc=$agent_rc)" >> "$LOG"
exit $agent_rc
