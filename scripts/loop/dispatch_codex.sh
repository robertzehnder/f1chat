#!/usr/bin/env bash
# scripts/loop/dispatch_codex.sh
# Headless invocation of OpenAI Codex CLI as the auditor agent.
# Falls back to Claude in adversarial-auditor mode if Codex CLI is unavailable.
# Usage: dispatch_codex.sh <slice_id>

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
prompt_file="scripts/loop/prompts/codex_auditor.md"
log="scripts/loop/state/runner.log"

[[ -f "$slice_file" ]] || { echo "missing $slice_file" >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

stamp=$(date -Iseconds)
echo "[$stamp] dispatch_codex $slice_id begin" >> "$log"

LEDGER="scripts/loop/state/cost_ledger.jsonl"
mkdir -p "$(dirname "$LEDGER")"

append_ledger() {
  local agent="${1:-codex}" cost="${2:-0}"
  printf '{"ts":"%s","slice":"%s","agent":"%s","cost_usd":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slice_id" "$agent" "$cost" \
    >> "$LEDGER"
}

run_codex_native() {
  # Codex CLI doesn't accept --system. Inject the static auditor prompt as the
  # first part of the user message instead. The CLI prints a verdict to stdout;
  # the audit-side commit/push is performed by codex itself per the prompt.
  {
    cat "$prompt_file"
    echo
    echo "---"
    echo
    cat <<EOF
You are the Codex audit agent. Slice: ${slice_file}, branch: slice/${slice_id}.

Audit:
1. Pull branch slice/${slice_id}.
2. Run every command in the slice's "Gate commands" block; record exit codes verbatim in the audit verdict.
3. Verify only files listed under "Changed files expected" were modified. Use: git diff --name-only integration/perf-roadmap...HEAD
4. Run each "Acceptance criteria" check.
5. Write the slice's "Audit verdict" section with PASS, REVISE, or REJECT.
6. Update frontmatter:
   - PASS  → status=ready_to_merge; owner=user (Phase 0) or owner=codex (Phase 1+ post sign-off)
   - REVISE → status=revising, owner=claude
   - REJECT → status=blocked, owner=user
7. Commit on slice/${slice_id} with message tag [slice:${slice_id}][pass|revise|reject].
8. Push slice/${slice_id}.

9. CRITICAL — mirror the slice file onto integration/perf-roadmap so the runner sees the new state:
     git checkout integration/perf-roadmap
     git pull --ff-only origin integration/perf-roadmap || true
     git show slice/${slice_id}:${slice_file} > ${slice_file}
     git add ${slice_file}
     git commit -m "audit: mirror $verdict_lower verdict for ${slice_id} onto integration

[slice:${slice_id}][\$verdict_lower][protocol-mirror]"
     git push
   Without this, the runner reads stale frontmatter from integration's worktree
   and re-dispatches Claude on a slice that has already been audited.

Be skeptical. Substantive correctness over cosmetic compliance.
EOF
  } | codex exec -
}

run_claude_fallback() {
  claude --print \
    --append-system-prompt "$(cat "$prompt_file")
ROLEPLAY: You are the Codex audit agent. You did NOT implement this slice. Be more skeptical than usual. Assume the implementer cut corners. Read the diff with fresh eyes; do not trust 'Slice-completion note' claims without re-running the gate commands yourself." \
    --permission-mode acceptEdits \
    --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
Audit slice ${slice_file} on branch slice/${slice_id}.

Steps:
1. git checkout slice/${slice_id}
2. Run every command in the slice's "Gate commands" block; record exit codes.
3. git diff --name-only integration/perf-roadmap...HEAD must match "Changed files expected".
4. Run each "Acceptance criteria" check.
5. Write "Audit verdict" with PASS / REVISE / REJECT and exit codes observed.
6. Update frontmatter status + owner per outcome:
   - PASS  → status=ready_to_merge; owner=user (Phase 0) or owner=codex (Phase 1+)
   - REVISE → status=revising, owner=claude
   - REJECT → status=blocked, owner=user
7. Note in the audit verdict: "AUDITED IN CLAUDE-FALLBACK MODE (Codex CLI unavailable)".
8. Commit on slice/${slice_id} with [slice:${slice_id}][pass|revise|reject][fallback].
9. Push slice/${slice_id}.

10. CRITICAL — mirror the updated slice file onto integration/perf-roadmap so the runner sees the new state:
      git checkout integration/perf-roadmap
      git pull --ff-only origin integration/perf-roadmap || true
      git show slice/${slice_id}:${slice_file} > ${slice_file}
      git add ${slice_file}
      git commit -m "audit: mirror <verdict> verdict for ${slice_id} onto integration

[slice:${slice_id}][<verdict>][protocol-mirror][fallback]"
      git push
    Without this, the runner reads stale frontmatter from integration's worktree
    and re-dispatches the implementer on a slice that has already been audited.
EOF
}

# TELEMETRY SCAFFOLD ONLY: cost_usd=0 placeholder until real usage capture is
# wired (Codex CLI does not surface token usage in `codex exec` mode). Daily
# cap in check_budget.sh is therefore advisory. See dispatch_claude.sh for
# the full TODO context.
if command -v codex >/dev/null 2>&1; then
  run_codex_native
  append_ledger codex 0
elif command -v claude >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] codex CLI not found; using claude fallback" >> "$log"
  run_claude_fallback
  append_ledger codex-claude-fallback 0
else
  echo "neither codex nor claude CLI available" >&2
  exit 3
fi

echo "[$(date -Iseconds)] dispatch_codex $slice_id end" >> "$log"
