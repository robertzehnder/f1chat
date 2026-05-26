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

# §A.2 tool surface — registry-emitted allowlist + docstrings. Default ON; flip
# LOOP_TOOL_SURFACE=permissive to disable (§12 rollback).
loop_tool_surface="${LOOP_TOOL_SURFACE:-restricted}"
registry="$LOOP_MAIN_WORKTREE/scripts/loop/lib/tool_registry.sh"

# §C.3 trajectory.
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/lib/trajectory.sh"

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
claude_result_capture="$LOOP_STATE_DIR/.claude_result_impl_${slice_id}.json"

# §A.2 — pick allowlist + docstrings via the registry, or fall back to permissive.
if [[ "$loop_tool_surface" == "restricted" ]] && [[ -x "$registry" ]]; then
  allowed_tools="$("$registry" bundle_allowed_tools_flag --role=implementer)"
  disallowed_tools="Edit,Write,MultiEdit,NotebookEdit,Bash(rm:*),Bash(sudo:*),Bash(git push:*),Bash(npm publish:*)"
  tool_docs="$("$registry" bundle_docstrings --role=implementer)"
else
  allowed_tools="Read,Edit,Write,Bash,Grep,Glob"
  disallowed_tools=""
  tool_docs="(legacy mode: full Claude Code tool surface available; no wrapper docs)"
fi

(
  cd "$slice_worktree"
  claude_args=(
    --print
    --model "${LOOP_MODEL_IMPLEMENTER:-${LOOP_CLAUDE_IMPL_MODEL:-claude-opus-4-7}}"
    --output-format json
    --append-system-prompt "$(cat "$prompt_file")"
    --permission-mode acceptEdits
    --allowed-tools "$allowed_tools"
  )
  [[ -n "$disallowed_tools" ]] && claude_args+=(--disallowed-tools "$disallowed_tools")
  claude "${claude_args[@]}" <<EOF
You are the Claude implementation agent in the OpenF1 perf-roadmap autonomous loop.

You are running in a dedicated git worktree at: ${slice_worktree}
The slice you are working on is: diagnostic/slices/${slice_id}.md

Your available tools (wrappers under .loop/tools/ — invoke via Bash):

${tool_docs}

Read the slice file's frontmatter and "Steps" section first. Then execute end-to-end:

1. Verify the frontmatter shows status=pending or status=revising; if not, exit immediately.
2. Use slice_read_state to inspect frontmatter + Steps + Acceptance criteria.
3. You are ALREADY on the proposal branch in this worktree — do NOT switch branches.
4. Execute every numbered step in the slice's "Steps" section.
5. To apply code changes, prepare a unified diff file and call slice_propose_change <slice-id> <patch-file>. The policy check runs automatically.
6. Run gate commands via slice_run_typecheck / slice_run_adapter_tests.
7. If all gates pass: fill in "Slice-completion note" by editing the slice file via slice_propose_change (the patch should add the note section); then call slice_request_audit <slice-id> to flip status to awaiting_audit + commit on this branch.
8. Do NOT push — pushes happen at merge time via the merger's ff-only flow.

CRITICAL CONSTRAINTS:
- Do NOT modify any file not listed in "Changed files expected" (slice_propose_change's policy check enforces this).
- Do NOT advance to a different slice — that is the runner's job.
- Do NOT push to integration/perf-roadmap or main.
- Do NOT touch ../<other-slice-worktrees> — you only own this worktree.
- If gates fail and you cannot fix them within scope, document why in the slice file via slice_propose_change; the runner's classifier will route to repair or block.
EOF
) > "$claude_result_capture"
agent_rc=$?

# §C.3 — record this dispatch's trajectory artifact for triage.
record_trajectory "$slice_id" impl "$claude_result_capture" >/dev/null 2>&1 || true

# 3. Mirror the slice file from slice branch back to integration under lock.
#    Expected terminal states for impl dispatch: awaiting_audit | blocked.
with_repo_lock "dispatch_claude:$slice_id:mirror" \
  mirror_slice_to_integration "$slice_id" "awaiting_audit|blocked" \
  || echo "[$stamp] dispatch_claude $slice_id mirror returned non-zero" >> "$LOG"

# Cost telemetry — best-effort token parse + estimated cost (round-12 Item 9).
"$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" claude || true

echo "[$(date -Iseconds)] dispatch_claude $slice_id end (agent_rc=$agent_rc)" >> "$LOG"
exit $agent_rc
