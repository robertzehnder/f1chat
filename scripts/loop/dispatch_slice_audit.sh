#!/usr/bin/env bash
# scripts/loop/dispatch_slice_audit.sh
# Phase: PLAN AUDIT (before implementation).
#
# Redesign — plan audit is now CLAUDE-driven by default. Claude self-audits
# the plan iteratively until High and Medium findings are clear, then hands
# off to claude impl. Codex is invoked once per slice at impl-audit only,
# reducing pressure on the Codex Plan quota.
#
# Agent selection (precedence):
#   1. LOOP_PLAN_AUDIT_AGENT="codex"          → codex (legacy / explicit opt-in)
#                                                 (Tier B flags still apply
#                                                  inside the codex branch:
#                                                  LOOP_FORCE_CLAUDE_AUDIT and
#                                                  LOOP_AUTO_CLAUDE_FALLBACK
#                                                  override / fall-through to
#                                                  claude.)
#   2. (default) LOOP_PLAN_AUDIT_AGENT unset
#                or LOOP_PLAN_AUDIT_AGENT="claude" → claude (new default).
#
# Workflow:
#   - The plan auditor runs in the slice's worktree on slice/<id>.
#   - The dispatcher pre-loads the slice file inline so the auditor doesn't
#     burn tokens via tool-call re-reads.
#   - The dispatcher mirrors the resulting slice file back to integration
#     deterministically (independent of which agent ran).
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
claude_prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/claude_plan_auditor.md"
codex_prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/codex_slice_auditor.md"
LOG="$LOOP_STATE_DIR/runner.log"

[[ -f "$slice_file_main" ]] || { echo "missing $slice_file_main" >&2; exit 2; }
[[ -f "$claude_prompt_file" ]] || { echo "missing $claude_prompt_file" >&2; exit 2; }
[[ -f "$codex_prompt_file" ]] || { echo "missing $codex_prompt_file" >&2; exit 2; }

stamp=$(date -Iseconds)
echo "[$stamp] dispatch_slice_audit $slice_id begin" >> "$LOG"

LEDGER="$LOOP_STATE_DIR/cost_ledger.jsonl"
mkdir -p "$(dirname "$LEDGER")"

# Ensure the slice's worktree exists (locked).
worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.$$"
trap 'rm -f "$worktree_path_file"' EXIT

with_repo_lock "dispatch_slice_audit:$slice_id:worktree-prep" \
  _ensure_slice_worktree_to_file "$slice_id" "$worktree_path_file" || {
  echo "failed to ensure worktree for $slice_id" >&2
  exit 4
}
slice_worktree=$(cat "$worktree_path_file")

# Pre-load the slice file inline so the auditor doesn't burn tokens on tool
# calls re-reading it.
inline_payload=$(mktemp -t plan_audit_inline.XXXXXX)
trap 'rm -f "$worktree_path_file" "$inline_payload"' EXIT

(
  cd "$slice_worktree"
  {
    echo "### Slice file (diagnostic/slices/${slice_id}.md)"
    echo
    echo '```markdown'
    cat "diagnostic/slices/${slice_id}.md"
    echo '```'
    echo
    echo "### Audit context"
    echo
    echo "- slice_id: ${slice_id}"
    echo "- worktree: ${slice_worktree}"
    echo "- branch: slice/${slice_id} (already checked out)"
  } > "$inline_payload"
)

# ----------------------------------------------------------------------
# Claude (primary plan auditor — new default)
# ----------------------------------------------------------------------
run_claude_native() {
  (
    cd "$slice_worktree"
    # System prompt is the role file (cache-friendly stable prefix). The
    # inline payload (slice body + context) is the variable suffix sent on
    # stdin. Cold-context: --print starts a fresh session every call.
    claude --print \
      --append-system-prompt "$(cat "$claude_prompt_file")" \
      --permission-mode acceptEdits \
      --allowed-tools "Read,Edit,Bash,Grep,Glob" <<EOF
$(cat "$inline_payload")

---

You are the Claude PLAN AUDITOR. Apply the audit principles in your role
prompt. Operate only in this worktree. Touch only the slice file (and
optionally diagnostic/_state.md's Notes-for-auditors single-line append).

Per your role prompt's verdict semantics, commit + push on slice/${slice_id}
with the appropriate \`[slice:${slice_id}][plan-approved|plan-revise|plan-reject|plan-pass-with-deferred]\` tag.

DO NOT mirror to integration — the dispatcher mirrors deterministically
after you exit.
EOF
  )
}

# ----------------------------------------------------------------------
# Codex (legacy / opt-in plan auditor)
# Retained behind LOOP_PLAN_AUDIT_AGENT=codex. All Tier A+B+C codex
# guards (usage-limit detection, claude fallback) preserved.
# ----------------------------------------------------------------------
run_codex_native() {
  local capture="$LOOP_STATE_DIR/.codex_capture_plan_${slice_id}.$$"
  local rc=0
  (
    cd "$slice_worktree"
    {
      cat "$codex_prompt_file"
      echo
      echo "---"
      echo
      cat "$inline_payload"
    } | codex exec \
        --sandbox danger-full-access \
        --ignore-user-config \
        -c "model=\"${CODEX_AUDIT_MODEL:-gpt-5.4}\"" \
        -c "model_reasoning_effort=\"${CODEX_AUDIT_REASONING:-medium}\"" \
        -c model_reasoning_summary=none \
        -c model_verbosity=low \
        -o "$LOOP_STATE_DIR/.last_msg_plan_${slice_id}.txt" \
        - 2>&1 | tee "$capture"
  ) || rc=$?
  if [[ -f "$capture" ]] && \
     "$LOOP_MAIN_WORKTREE/scripts/loop/codex_usage_limit.sh" "$capture" 2>/dev/null; then
    rm -f "$capture"
    return 42
  fi
  rm -f "$capture"
  return "$rc"
}

# Codex's "claude fallback" path (used only inside the codex branch when
# codex is unavailable or quota-throttled). This is the legacy fallback
# prompt; for the new default path, use run_claude_native instead.
run_codex_path_claude_fallback() {
  (
    cd "$slice_worktree"
    claude --print \
      --append-system-prompt "$(cat "$codex_prompt_file")
ROLEPLAY (adversarial self-audit, Tier B): You are auditing a plan you did NOT write. Be ruthlessly skeptical. Find at least 2-3 concrete concerns or you have not done your job. Cold-context discipline: do NOT use any inherited conversation context." \
      --permission-mode acceptEdits \
      --allowed-tools "Read,Edit,Bash,Grep,Glob" <<EOF
$(cat "$inline_payload")

---

You are the SLICE-PLAN auditor (claude-fallback inside the codex code path).
Apply the audit principles strictly. Touch only the slice file. Commit + push
with [slice:${slice_id}][plan-approved|plan-revise|plan-reject][fallback] tag.

DO NOT mirror to integration — the dispatcher does that deterministically.
EOF
  )
}

# ----------------------------------------------------------------------
# Agent selection
# ----------------------------------------------------------------------
_codex_quota_active() {
  local nb_file="$LOOP_STATE_DIR/codex_not_before"
  [[ -r "$nb_file" ]] || return 1
  local nb
  nb=$(cat "$nb_file" 2>/dev/null || echo 0)
  [[ "$nb" =~ ^[0-9]+$ ]] || return 1
  (( $(date +%s) < nb ))
}

agent_rc=0
agent_kind=""
PLAN_AGENT="${LOOP_PLAN_AUDIT_AGENT:-claude}"

if [[ "$PLAN_AGENT" == "codex" ]]; then
  # Legacy / opt-in codex path. Tier B flags still respected here.
  if [[ "${LOOP_FORCE_CLAUDE_AUDIT:-0}" == "1" ]]; then
    echo "[$(date -Iseconds)] LOOP_PLAN_AUDIT_AGENT=codex but LOOP_FORCE_CLAUDE_AUDIT=1; routing to claude" >> "$LOG"
    if command -v claude >/dev/null 2>&1; then
      run_codex_path_claude_fallback || agent_rc=$?
      agent_kind="codex-slice-audit-fallback-forced"
    else
      echo "FORCE_CLAUDE_AUDIT set but claude CLI not available" >&2; exit 3
    fi
  elif [[ "${LOOP_AUTO_CLAUDE_FALLBACK:-0}" == "1" ]] && _codex_quota_active && command -v claude >/dev/null 2>&1; then
    echo "[$(date -Iseconds)] codex quota cooldown active + LOOP_AUTO_CLAUDE_FALLBACK=1; routing slice audit to claude" >> "$LOG"
    run_codex_path_claude_fallback || agent_rc=$?
    agent_kind="codex-slice-audit-fallback-on-quota"
  elif command -v codex >/dev/null 2>&1; then
    run_codex_native || agent_rc=$?
    if [[ "$agent_rc" -eq 42 ]] && [[ "${LOOP_AUTO_CLAUDE_FALLBACK:-0}" == "1" ]] && command -v claude >/dev/null 2>&1; then
      echo "[$(date -Iseconds)] codex hit usage limit + LOOP_AUTO_CLAUDE_FALLBACK=1; falling through to claude for slice audit" >> "$LOG"
      agent_rc=0
      run_codex_path_claude_fallback || agent_rc=$?
      agent_kind="codex-slice-audit-fallback-on-quota"
    else
      agent_kind="codex-slice-audit"
    fi
  elif command -v claude >/dev/null 2>&1; then
    echo "[$(date -Iseconds)] codex CLI not found; using claude fallback for slice audit" >> "$LOG"
    run_codex_path_claude_fallback || agent_rc=$?
    agent_kind="codex-slice-audit-claude-fallback"
  else
    echo "neither codex nor claude CLI available" >&2
    exit 3
  fi
else
  # New default path: claude is the primary plan auditor. Codex is NOT
  # invoked for plan audit in this branch, regardless of CLI availability.
  if command -v claude >/dev/null 2>&1; then
    echo "[$(date -Iseconds)] LOOP_PLAN_AUDIT_AGENT=${PLAN_AGENT}; running claude as primary plan auditor" >> "$LOG"
    run_claude_native || agent_rc=$?
    agent_kind="claude-plan-audit"
  elif command -v codex >/dev/null 2>&1; then
    echo "[$(date -Iseconds)] claude CLI not available; falling back to codex for plan audit" >> "$LOG"
    run_codex_native || agent_rc=$?
    agent_kind="claude-plan-audit-codex-fallback"
  else
    echo "neither claude nor codex CLI available" >&2
    exit 3
  fi
fi

# Cost telemetry. Always run, even on rc=42 (codex path), so the ledger
# reflects every dispatch attempt.
"$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" "$agent_kind" || true

# Skip mirror on rc=42 (codex usage limit) — agent didn't modify the slice
# file and a failed mirror would only generate misleading log noise.
if [[ "$agent_rc" -ne 42 ]]; then
  with_repo_lock "dispatch_slice_audit:$slice_id:mirror" \
    mirror_slice_to_integration "$slice_id" "pending|revising_plan|blocked" \
    || echo "[$stamp] dispatch_slice_audit $slice_id mirror returned non-zero" >> "$LOG"
fi

echo "[$(date -Iseconds)] dispatch_slice_audit $slice_id end (agent_rc=$agent_rc agent=$agent_kind)" >> "$LOG"
exit $agent_rc
