#!/usr/bin/env bash
# scripts/loop/dispatch_slice_audit.sh
# Phase: PLAN AUDIT (before implementation).
#
# Plan-audit dispatcher — two-tier model:
#
#   1. Claude self-audit phase (cheap, iterative): claude reviews + revises
#      its own plan until all High/Medium findings clear. Runs on Claude
#      quota, not Codex.
#   2. Codex final plan audit (gatekeeper): once claude self-approves, the
#      slice hands off to codex for an external check. If codex finds
#      issues, the slice goes back through the claude reviser + self-audit
#      loop. If codex approves, claude implements.
#
# This dispatcher serves BOTH phases. Routing is by the slice's `owner`
# frontmatter field (passed as $2 by the runner):
#
#   owner=claude  → run_claude_native (claude self-audit)
#   owner=codex   → run_codex_native  (codex final plan audit)
#
# `LOOP_PLAN_AUDIT_AGENT` env var, when set, overrides the owner-based
# routing for force-mode testing:
#   LOOP_PLAN_AUDIT_AGENT=claude  → always claude (skip codex final audit)
#   LOOP_PLAN_AUDIT_AGENT=codex   → always codex (legacy codex-only flow)
#
# Tier B fallback flags apply only inside the codex branch:
#   LOOP_FORCE_CLAUDE_AUDIT=1     → force claude even when routing to codex
#   LOOP_AUTO_CLAUDE_FALLBACK=1   → fall back to claude on codex usage limit
#
# Workflow:
#   - The plan auditor runs in the slice's worktree on slice/<id>.
#   - The dispatcher pre-loads the slice file inline so the auditor doesn't
#     burn tokens via tool-call re-reads.
#   - The dispatcher mirrors the resulting slice file back to integration
#     deterministically (independent of which agent ran).
#
# Usage: dispatch_slice_audit.sh <slice_id> [owner]
#   owner defaults to the slice file's frontmatter owner if not provided.

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
owner_arg="${2:-}"
slice_file_main="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
claude_prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/claude_plan_auditor.md"
codex_prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/codex_slice_auditor.md"
LOG="$LOOP_STATE_DIR/runner.log"

# Read the slice's owner from frontmatter as the fallback for $2.
_read_slice_owner() {
  awk '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == "owner:" { sub(/^[^:]+: */, ""); print; exit }
  ' "$slice_file_main"
}
[[ -z "$owner_arg" ]] && owner_arg=$(_read_slice_owner)
[[ -z "$owner_arg" ]] && owner_arg="claude"

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

# ----------------------------------------------------------------------
# Pre-dispatch quality gate: auto-REJECT if the same item has persisted
# across the threshold number of rounds (calibration-mismatch oscillation).
# When this fires, we skip the auditor dispatch entirely and write the
# REJECT verdict ourselves. The exit codes from check_iteration_quality:
#   0 → no persistence, proceed with normal audit.
#   2 → persistence detected, auto-REJECT; stdout is the summary.
#   1 → usage error (treat as "no persistence detected" — fail open).
# ----------------------------------------------------------------------
slice_branch_file="$slice_worktree/diagnostic/slices/${slice_id}.md"
if [[ -f "$slice_branch_file" ]]; then
  set +e
  persistence_summary=$("$LOOP_MAIN_WORKTREE/scripts/loop/check_iteration_quality.sh" "$slice_branch_file" 2>/dev/null)
  qrc=$?
  set -e
  if [[ "$qrc" -eq 2 ]]; then
    echo "[$(date -Iseconds)] dispatch_slice_audit $slice_id auto-REJECT (persistence detected): $persistence_summary" >> "$LOG"
    with_repo_lock "dispatch_slice_audit:$slice_id:auto-reject" \
      "$LOOP_MAIN_WORKTREE/scripts/loop/auto_reject_persistence.sh" \
        "$slice_id" "$slice_worktree" "$persistence_summary" >> "$LOG" 2>&1 \
      || echo "[$(date -Iseconds)] auto-reject failed for $slice_id" >> "$LOG"

    # Cost ledger row for the (zero-token) auto-reject so the slice's
    # accounting is complete.
    "$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" "auto-reject-persistence" 2>/dev/null || true

    # Mirror the slice file (now status=blocked) back to integration so
    # the runner sees the new state on its next tick.
    with_repo_lock "dispatch_slice_audit:$slice_id:auto-reject-mirror" \
      mirror_slice_to_integration "$slice_id" "blocked" \
      || echo "[$(date -Iseconds)] dispatch_slice_audit $slice_id auto-reject mirror returned non-zero" >> "$LOG"

    echo "[$(date -Iseconds)] dispatch_slice_audit $slice_id end (auto-rejected)" >> "$LOG"
    exit 0
  fi
fi

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
  local claude_result_capture="$LOOP_STATE_DIR/.claude_result_plan_audit_${slice_id}.json"
  (
    cd "$slice_worktree"
    # System prompt is the role file (cache-friendly stable prefix). The
    # inline payload (slice body + context) is the variable suffix sent on
    # stdin. Cold-context: --print starts a fresh session every call.
    # LOOP_CLAUDE_PLAN_AUDIT_MODEL lets the user opt for a cheaper model
    # (e.g. claude-sonnet-4-6) since the plan audit doesn't write code,
    # only triages.
    claude --print \
      --model "${LOOP_CLAUDE_PLAN_AUDIT_MODEL:-claude-opus-4-7}" \
      --output-format json \
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
  ) > "$claude_result_capture"
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
  local claude_result_capture="$LOOP_STATE_DIR/.claude_result_plan_audit_${slice_id}.json"
  (
    cd "$slice_worktree"
    claude --print \
      --model "${LOOP_CLAUDE_PLAN_AUDIT_MODEL:-claude-opus-4-7}" \
      --output-format json \
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
  ) > "$claude_result_capture"
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

# Resolve the routing decision:
#   - LOOP_PLAN_AUDIT_AGENT explicitly set → forced override
#   - else owner=codex     → codex final plan audit (gatekeeper)
#   - else owner=claude    → claude self-audit (iterative)
#   - else (unrecognized)  → claude (default)
if [[ -n "${LOOP_PLAN_AUDIT_AGENT:-}" ]]; then
  PLAN_AGENT="$LOOP_PLAN_AUDIT_AGENT"
  echo "[$(date -Iseconds)] LOOP_PLAN_AUDIT_AGENT='$PLAN_AGENT' override applied (slice owner='$owner_arg')" >> "$LOG"
elif [[ "$owner_arg" == "codex" ]]; then
  PLAN_AGENT="codex"
elif [[ "$owner_arg" == "claude" ]]; then
  PLAN_AGENT="claude"
else
  PLAN_AGENT="claude"
fi

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
  # pending_plan_audit is also a valid post-audit terminal state when the
  # claude self-audit tier hands off to the codex final-audit tier
  # (status stays pending_plan_audit, owner flips claude→codex).
  with_repo_lock "dispatch_slice_audit:$slice_id:mirror" \
    mirror_slice_to_integration "$slice_id" "pending|revising_plan|blocked|pending_plan_audit" \
    || echo "[$stamp] dispatch_slice_audit $slice_id mirror returned non-zero" >> "$LOG"
fi

echo "[$(date -Iseconds)] dispatch_slice_audit $slice_id end (agent_rc=$agent_rc agent=$agent_kind)" >> "$LOG"
exit $agent_rc
