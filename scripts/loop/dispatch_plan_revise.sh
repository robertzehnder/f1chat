#!/usr/bin/env bash
# scripts/loop/dispatch_plan_revise.sh
# Phase: PLAN REVISE (between plan-audit rounds).
# Claude reads the latest plan-audit's triaged action items from the slice
# file and edits ONLY the slice file to resolve them, then flips status back
# to pending_plan_audit so the matching auditor can re-audit.
#
# Two-tier audit context: the latest verdict may be from either claude-plan-
# audit (cheap, iterative self-audit) OR codex-slice-audit (expensive final
# gatekeeper). The reviser detects which one wrote the latest verdict by
# looking for `**Auditor: claude-plan-audit ...**` in that section's header,
# and sets owner accordingly so the slice returns to the SAME tier for re-
# audit (rather than re-running an unnecessary claude self-audit when codex
# is the one waiting on a fix).
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

# Plan-iteration cap. Empirical observation (06-cu-rightsize 2026-04-28):
# at cap=10 codex peel-the-onion'd through 11 rounds finding progressively
# finer contract refinements that mostly didn't matter and burned ~$5+
# in claude reviser tokens. The original lowered-default of 6 surfaced
# escalations sooner but proved too tight in Phase 8 — slices like
# 08-validators-strategy-evidence had legitimate substantive findings at
# rounds 6-7 (codex grounding plans against real contract code) and
# escalated mechanically rather than converging. Raising the default to
# 10 (2026-04-30) gives those slices room to converge without triggering
# the peel-the-onion runaway, since persistence detection
# (check_iteration_quality.sh) handles the stuck-on-same-item pathology
# separately. Override via LOOP_MAX_PLAN_ITERATIONS=N for slices that
# legitimately need more depth or for cost-constrained runs.
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

claude_result_capture="$LOOP_STATE_DIR/.claude_result_revise_${slice_id}.json"
(
  cd "$slice_worktree"
  claude --print \
    --model "${LOOP_CLAUDE_REVISE_MODEL:-claude-opus-4-7}" \
    --output-format json \
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
2. **Determine the post-revise owner.** Apply the cap rule first; only fall through to the auditor-match rule if the cap rule does NOT fire.
   - **Cap rule (LOOP_CLAUDE_PLAN_AUDIT_CAP=${LOOP_CLAUDE_PLAN_AUDIT_CAP:-3}, takes precedence):** count the verdict blocks whose header contains \`**Auditor: claude-plan-audit ...**\`. If that count is **≥ ${LOOP_CLAUDE_PLAN_AUDIT_CAP:-3}**, the claude self-audit tier has hit its cap and you must set \`owner: codex\` regardless of who wrote the latest verdict. Skip step 2 below.
   - **Auditor-match rule (only if cap did not fire):** inspect the latest verdict header.
     - Contains \`**Auditor: claude-plan-audit ...**\` → latest is from claude self-audit tier; set the post-revise \`owner: claude\` (next round is another claude self-audit).
     - Otherwise (no \`Auditor:\` field, or it says codex / codex-slice-audit) → latest is from codex final-audit tier; set the post-revise \`owner: codex\` (next round is codex re-audit).
3. For each \`- [ ]\` item under High / Medium / Low, edit the slice's body (Steps, Gate commands, Required services / env, Changed files expected, Acceptance criteria, etc.) to address it. Tick the box \`- [x]\` after you've made the corresponding edit. For Low items you choose to skip, leave \`- [ ]\` and append \`DEFER: <reason>\`.
4. Notes section: read but do not act.
5. Refresh frontmatter \`updated:\` timestamp; set \`status: pending_plan_audit\` and \`owner\` per step 2.
6. Commit on slice/${slice_id} with message tag \`[slice:${slice_id}][plan-revise]\`. Mention in the commit body which auditor your revise targets, e.g. "addresses claude-plan-audit round N items, hands back to claude" OR "addresses codex round N items, hands back to codex".
7. Push.

CRITICAL CONSTRAINTS:
- Operate ONLY on slice/${slice_id} in this worktree.
- Touch ONLY diagnostic/slices/${slice_id}.md.
- Do NOT modify previous rounds' verdict text (other than ticking checkboxes).
- Do NOT add new "Plan-audit verdict" sections — only the auditors (claude-plan-audit and codex-slice-audit) write those.
- DO NOT mirror to integration — the dispatcher does that.
- After commit + push, exit. The runner will re-dispatch the matching auditor (per step 2) for round $((count + 1)).
EOF
) > "$claude_result_capture"
agent_rc=$?

# Mirror the slice file back to integration.
# Expected terminal states for plan-revise: pending_plan_audit | blocked.
with_repo_lock "dispatch_plan_revise:$slice_id:mirror" \
  mirror_slice_to_integration "$slice_id" "pending_plan_audit|blocked" \
  || logmsg "mirror returned non-zero"

"$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" claude-revise || true

logmsg "end (agent_rc=$agent_rc)"
exit $agent_rc
