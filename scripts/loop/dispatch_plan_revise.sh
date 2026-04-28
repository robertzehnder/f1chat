#!/usr/bin/env bash
# scripts/loop/dispatch_plan_revise.sh
# Phase: PLAN REVISE (between plan-audit rounds).
# Claude reads the latest Codex audit's triaged action items from the slice
# file and edits ONLY the slice file to resolve them, then flips status back
# to pending_plan_audit so Codex can re-audit.
#
# Item 2 (round-12): runs in slice's worktree on slice/<id> (uniform model);
# dispatcher mirrors back to integration deterministically. Plan-iter cap
# raised from 4 to 10 (round-12).
#
# Usage: dispatch_plan_revise.sh <slice_id>

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
prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/claude_plan_reviser.md"
LOG="$LOOP_STATE_DIR/runner.log"
counter_file="$LOOP_STATE_DIR/plan_iter_count_${slice_id}"

# Plan-iteration cap. With the two-tier audit (cheap claude self-audit
# upstream of an expensive codex final audit), per-iteration cost is
# dominated by claude tokens, so the cap can be raised back to 10 without
# the codex-quota pressure that motivated the Tier C reduction. Historical
# data (loop_hardening_plan 2026-04-26) argues cap < 10 sometimes circuit-
# breaks legitimately-iterating plans. Override via LOOP_MAX_PLAN_ITERATIONS=N.
# At iteration MAX_ITERATIONS-1 the auditor may issue PASS-WITH-DEFERRED.
MAX_ITERATIONS="${LOOP_MAX_PLAN_ITERATIONS:-10}"

[[ -f "$slice_file_main" ]]  || { echo "missing $slice_file_main"  >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

stamp() { date -Iseconds; }
logmsg() { printf '[%s] dispatch_plan_revise %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$LOG"; }

mkdir -p "$(dirname "$counter_file")"
count=$(cat "$counter_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$counter_file"

logmsg "plan-revise iteration $count of $MAX_ITERATIONS"

if [[ "$count" -gt "$MAX_ITERATIONS" ]]; then
  logmsg "MAX_PLAN_ITERATIONS exceeded ($count > $MAX_ITERATIONS); escalating"

  # Ensure worktree exists for the escalation commit.
  worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.escalate.$$"
  with_repo_lock "dispatch_plan_revise:$slice_id:escalate-prep" \
    _ensure_slice_worktree_to_file "$slice_id" "$worktree_path_file" || {
    logmsg "failed to ensure worktree for escalation"
    rm -f "$worktree_path_file"
    exit 4
  }
  slice_worktree=$(cat "$worktree_path_file")
  rm -f "$worktree_path_file"

  with_repo_lock "dispatch_plan_revise:$slice_id:escalate-commit" bash -c "
    cd '$slice_worktree' && \
    awk -v ts='$(stamp)' '
      BEGIN { in_fm = 0 }
      /^---\$/ { in_fm = !in_fm; print; next }
      in_fm && /^status:/ { print \"status: blocked\"; next }
      in_fm && /^owner:/  { print \"owner: user\"; next }
      in_fm && /^updated:/ { print \"updated: \" ts; next }
      { print }
    ' diagnostic/slices/${slice_id}.md > diagnostic/slices/${slice_id}.md.tmp && \
    mv diagnostic/slices/${slice_id}.md.tmp diagnostic/slices/${slice_id}.md && \
    cat >> diagnostic/slices/${slice_id}.md <<ESC

## Plan-revise escalation

Hit \`LOOP_MAX_PLAN_ITERATIONS=$MAX_ITERATIONS\` without converging on APPROVED. Latest audit verdict still has open items. User intervention required.
ESC
    git add diagnostic/slices/${slice_id}.md && \
    git commit -m 'plan-revise: escalate $slice_id after $MAX_ITERATIONS iterations [slice:$slice_id][plan-escalate]' >/dev/null 2>&1 && \
    git push >/dev/null 2>&1 || true
  "

  with_repo_lock "dispatch_plan_revise:$slice_id:escalate-mirror" \
    mirror_slice_to_integration "$slice_id" "blocked" \
    || logmsg "escalation mirror returned non-zero"

  logmsg "escalated to blocked"
  exit 4
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH" >&2
  exit 3
fi

# Ensure worktree exists.
worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.$$"
trap 'rm -f "$worktree_path_file"' EXIT

with_repo_lock "dispatch_plan_revise:$slice_id:worktree-prep" \
  _ensure_slice_worktree_to_file "$slice_id" "$worktree_path_file" || {
  logmsg "failed to ensure worktree"
  exit 4
}
slice_worktree=$(cat "$worktree_path_file")

logmsg "begin"

(
  cd "$slice_worktree"
  claude --print \
    --model "${LOOP_CLAUDE_REVISE_MODEL:-claude-opus-4-7}" \
    --append-system-prompt "$(cat "$prompt_file")" \
    --permission-mode acceptEdits \
    --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
You are the Claude PLAN-REVISER. The slice's plan-audit returned a triaged list of action items.

Slice file: diagnostic/slices/${slice_id}.md
Iteration: ${count} of ${MAX_ITERATIONS}
Worktree: ${slice_worktree}
Branch: slice/${slice_id} (already checked out — do NOT switch branches)

Steps:
1. Read diagnostic/slices/${slice_id}.md. Find the latest \`## Plan-audit verdict (round N)\` section.
2. For each \`- [ ]\` item under High / Medium / Low, edit the slice's body (Steps, Gate commands, Required services / env, Changed files expected, Acceptance criteria, etc.) to address it. Tick the box \`- [x]\` after you've made the corresponding edit. For Low items you choose to skip, leave \`- [ ]\` and append \`DEFER: <reason>\`.
3. Notes section: read but do not act.
4. Refresh frontmatter \`updated:\` timestamp; set \`status: pending_plan_audit\`, \`owner: codex\`.
5. Commit on slice/${slice_id} with message tag \`[slice:${slice_id}][plan-revise]\`.
6. Push.

CRITICAL CONSTRAINTS:
- Operate ONLY on slice/${slice_id} in this worktree.
- Touch ONLY diagnostic/slices/${slice_id}.md.
- Do NOT modify previous rounds' verdict text (other than ticking checkboxes).
- Do NOT add new "Plan-audit verdict" sections — only Codex writes those.
- DO NOT mirror to integration — the dispatcher does that.
- After commit + push, exit. The runner will re-dispatch Codex for round $((count + 1)).
EOF
)
agent_rc=$?

# Mirror the slice file back to integration.
# Expected terminal states for plan-revise: pending_plan_audit | blocked.
with_repo_lock "dispatch_plan_revise:$slice_id:mirror" \
  mirror_slice_to_integration "$slice_id" "pending_plan_audit|blocked" \
  || logmsg "mirror returned non-zero"

"$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" claude-revise || true

logmsg "end (agent_rc=$agent_rc)"
exit $agent_rc
