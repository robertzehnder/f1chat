#!/usr/bin/env bash
# scripts/loop/dispatch_codex.sh
# Headless invocation of OpenAI Codex CLI as the impl-audit agent.
# Falls back to Claude in adversarial-auditor mode if Codex CLI is unavailable.
# Usage: dispatch_codex.sh <slice_id>
#
# Item 2 (round-12): runs the auditor in a per-slice worktree under
# WORKTREE_BASE/<slice_id>/ on branch slice/<slice_id>. Mirror onto
# integration is performed by THIS dispatcher (round-2 H-3 + C-6) — no
# longer the agent's responsibility.

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
prompt_file="$LOOP_MAIN_WORKTREE/scripts/loop/prompts/codex_auditor.md"
LOG="$LOOP_STATE_DIR/runner.log"

[[ -f "$slice_file_main" ]] || { echo "missing $slice_file_main" >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

stamp=$(date -Iseconds)
echo "[$stamp] dispatch_codex $slice_id begin" >> "$LOG"

LEDGER="$LOOP_STATE_DIR/cost_ledger.jsonl"
mkdir -p "$(dirname "$LEDGER")"

# 1. Ensure the slice's worktree exists (locked).
worktree_path_file="$LOOP_STATE_DIR/.worktree_path_${slice_id}.$$"
trap 'rm -f "$worktree_path_file"' EXIT

with_repo_lock "dispatch_codex:$slice_id:worktree-prep" \
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
You are the Codex audit agent. Slice: diagnostic/slices/${slice_id}.md.

You are running in a dedicated worktree at: ${slice_worktree}
You are ALREADY on branch slice/${slice_id} — do NOT switch branches.

Audit:
1. Run every command in the slice's "Gate commands" block; record exit codes verbatim in the audit verdict.
2. Verify only files listed under "Changed files expected" were modified. Use: git diff --name-only integration/perf-roadmap...HEAD
3. Run each "Acceptance criteria" check.
4. Write the slice's "Audit verdict" section with PASS, REVISE, or REJECT.
5. Update frontmatter:
   - PASS  → status=ready_to_merge; owner=user (Phase 0) or owner=codex (Phase 1+ post sign-off)
   - REVISE → status=revising, owner=claude
   - REJECT → status=blocked, owner=user
6. Commit on slice/${slice_id} with message tag [slice:${slice_id}][pass|revise|reject].
7. Push slice/${slice_id}.

DO NOT mirror the slice file to integration. The dispatcher (this wrapper)
mirrors deterministically AFTER you exit, regardless of your exit code.
DO NOT touch any other worktree on disk.

Be skeptical. Substantive correctness over cosmetic compliance.
EOF
    } | codex exec --sandbox danger-full-access -
  )
}

run_claude_fallback() {
  (
    cd "$slice_worktree"
    claude --print \
      --append-system-prompt "$(cat "$prompt_file")
ROLEPLAY: You are the Codex audit agent. You did NOT implement this slice. Be more skeptical than usual. Assume the implementer cut corners. Read the diff with fresh eyes; do not trust 'Slice-completion note' claims without re-running the gate commands yourself." \
      --permission-mode acceptEdits \
      --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
Audit slice diagnostic/slices/${slice_id}.md.

You are in a dedicated worktree at: ${slice_worktree}
You are ALREADY on branch slice/${slice_id} — do NOT switch branches.

Steps:
1. Run every command in the slice's "Gate commands" block; record exit codes.
2. git diff --name-only integration/perf-roadmap...HEAD must match "Changed files expected".
3. Run each "Acceptance criteria" check.
4. Write "Audit verdict" with PASS / REVISE / REJECT and exit codes observed.
5. Update frontmatter status + owner per outcome:
   - PASS  → status=ready_to_merge; owner=user (Phase 0) or owner=codex (Phase 1+)
   - REVISE → status=revising, owner=claude
   - REJECT → status=blocked, owner=user
6. Note in the audit verdict: "AUDITED IN CLAUDE-FALLBACK MODE (Codex CLI unavailable)".
7. Commit on slice/${slice_id} with [slice:${slice_id}][pass|revise|reject][fallback].
8. Push slice/${slice_id}.

DO NOT mirror to integration — the dispatcher does that.
DO NOT touch any other worktree on disk.
EOF
  )
}

# Run the agent. Capture rc but do NOT abort on non-zero — Codex frequently
# exits rc=1 even on successful audits (round-7 C-5).
agent_rc=0
agent_kind=""
if command -v codex >/dev/null 2>&1; then
  run_codex_native || agent_rc=$?
  agent_kind="codex"
elif command -v claude >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] codex CLI not found; using claude fallback" >> "$LOG"
  run_claude_fallback || agent_rc=$?
  agent_kind="codex-claude-fallback"
else
  echo "neither codex nor claude CLI available" >&2
  exit 3
fi

# Cost telemetry (round-12 Item 9).
"$LOOP_MAIN_WORKTREE/scripts/loop/post_dispatch_cost.sh" "$slice_id" "$agent_kind" || true

# Mirror the slice file from slice branch back to integration under lock.
# Expected terminal states for impl-audit: ready_to_merge | revising | blocked.
with_repo_lock "dispatch_codex:$slice_id:mirror" \
  mirror_slice_to_integration "$slice_id" "ready_to_merge|revising|blocked" \
  || echo "[$stamp] dispatch_codex $slice_id mirror returned non-zero" >> "$LOG"

echo "[$(date -Iseconds)] dispatch_codex $slice_id end (agent_rc=$agent_rc)" >> "$LOG"
exit $agent_rc
