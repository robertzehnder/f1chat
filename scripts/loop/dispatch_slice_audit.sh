#!/usr/bin/env bash
# scripts/loop/dispatch_slice_audit.sh
# Phase: PLAN AUDIT (before implementation).
# Codex reviews the slice file itself for plan bugs.
#
# Item 2 (round-12) — uniform worktree model (round-2 H-1):
# the plan auditor runs in the slice's worktree on slice/<id> branch (same
# as impl/impl-audit). The dispatcher mirrors the resulting slice file
# back to integration deterministically.
#
# Usage: dispatch_slice_audit.sh <slice_id>

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
prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/codex_slice_auditor.md"
LOG="$LOOP_STATE_DIR/runner.log"

[[ -f "$slice_file_main" ]]  || { echo "missing $slice_file_main"  >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

stamp=$(date -Iseconds)
echo "[$stamp] dispatch_slice_audit $slice_id begin" >> "$LOG"

LEDGER="$LOOP_STATE_DIR/cost_ledger.jsonl"
mkdir -p "$(dirname "$LEDGER")"

append_ledger() {
  local agent="${1:-codex-slice-audit}" cost="${2:-0}"
  printf '{"ts":"%s","slice":"%s","agent":"%s","cost_usd":%s,"estimated":true}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slice_id" "$agent" "$cost" \
    >> "$LEDGER"
}

# Ensure the slice's worktree exists (locked).
worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.$$"
trap 'rm -f "$worktree_path_file"' EXIT

with_repo_lock "dispatch_slice_audit:$slice_id:worktree-prep" \
  _ensure_slice_worktree_to_file "$slice_id" "$worktree_path_file" || {
  echo "failed to ensure worktree for $slice_id" >&2
  exit 4
}
slice_worktree=$(cat "$worktree_path_file")

run_codex_native() {
  (
    cd "$slice_worktree"
    {
      cat "$prompt_file"
      echo
      echo "---"
      echo
      cat <<EOF
You are the Codex SLICE-PLAN auditor. Slice file: diagnostic/slices/${slice_id}.md.

You are running in a dedicated worktree at: ${slice_worktree}
You are on branch slice/${slice_id} — do NOT switch branches.

Audit the SLICE PLAN ONLY. Do NOT touch any other file.

Steps:
1. Read diagnostic/slices/${slice_id}.md carefully — frontmatter, Goal, Inputs, Required services / env, Steps, Changed files expected, Gate commands, Acceptance criteria, Out of scope.
2. Look for plan bugs per your system prompt's audit principles.
3. If you find fixable issues, edit the slice file directly. Keep the goal intact.
4. Update frontmatter:
   - PASS or PASS-WITH-FIXES → status=pending, owner=claude, refresh updated timestamp
   - PASS-WITH-DEFERRED (only allowed at iteration ≥9 per round-12 cap of 10) → status=pending, owner=claude, document deferred Mediums/Lows
   - REVISE (issues that need plan-revise) → status=revising_plan, owner=claude, append High/Medium/Low triage
   - REJECT (architectural ambiguity) → status=blocked, owner=user, refresh updated timestamp; append a "Plan-audit verdict" section explaining the architectural issue
5. Commit on slice/${slice_id} with message tag [slice:${slice_id}][plan-pass|plan-pass-with-fixes|plan-pass-with-deferred|plan-revise|plan-reject].
6. Push slice/${slice_id}.

DO NOT mirror to integration — the dispatcher does that deterministically.
DO NOT run npm / web / build commands. The implementer audit later checks those.
EOF
    } | codex exec --sandbox danger-full-access -
  )
}

run_claude_fallback() {
  (
    cd "$slice_worktree"
    claude --print \
      --append-system-prompt "$(cat "$prompt_file")" \
      --permission-mode acceptEdits \
      --allowed-tools "Read,Edit,Bash,Grep,Glob" <<EOF
You are the SLICE-PLAN auditor (claude-fallback because Codex CLI was not found).

Slice file: diagnostic/slices/${slice_id}.md
Worktree: ${slice_worktree}
Branch: slice/${slice_id} (already checked out — do NOT switch branches)

Steps: same as the Codex prompt. Operate only on this worktree's slice/${slice_id}. Touch only the slice file. Commit + push with [slice:${slice_id}][plan-pass|plan-pass-with-fixes|plan-pass-with-deferred|plan-revise|plan-reject][fallback] tag.

DO NOT mirror to integration — the dispatcher does that deterministically.
EOF
  )
}

agent_rc=0
if command -v codex >/dev/null 2>&1; then
  run_codex_native || agent_rc=$?
  append_ledger codex-slice-audit 0
elif command -v claude >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] codex CLI not found; using claude fallback for slice audit" >> "$LOG"
  run_claude_fallback || agent_rc=$?
  append_ledger codex-slice-audit-claude-fallback 0
else
  echo "neither codex nor claude CLI available" >&2
  exit 3
fi

# Mirror the slice file from slice branch back to integration under lock.
# Expected terminal states for plan-audit: pending | revising_plan | blocked.
with_repo_lock "dispatch_slice_audit:$slice_id:mirror" \
  mirror_slice_to_integration "$slice_id" "pending|revising_plan|blocked" \
  || echo "[$stamp] dispatch_slice_audit $slice_id mirror returned non-zero" >> "$LOG"

echo "[$(date -Iseconds)] dispatch_slice_audit $slice_id end (agent_rc=$agent_rc)" >> "$LOG"
exit $agent_rc
