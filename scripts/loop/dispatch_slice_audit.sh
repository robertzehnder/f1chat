#!/usr/bin/env bash
# scripts/loop/dispatch_slice_audit.sh
# Phase: PLAN AUDIT (before implementation).
# Codex reviews the slice file itself for plan bugs (gate order, scope rules,
# missing services, etc.). Either approves and flips status=pending so Claude
# can implement, or fixes the slice file and approves, or escalates as
# status=blocked for user attention.
#
# Usage: dispatch_slice_audit.sh <slice_id>

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
prompt_file="scripts/loop/prompts/codex_slice_auditor.md"
log="scripts/loop/state/runner.log"

[[ -f "$slice_file" ]]  || { echo "missing $slice_file"  >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

stamp=$(date -Iseconds)
echo "[$stamp] dispatch_slice_audit $slice_id begin" >> "$log"

LEDGER="scripts/loop/state/cost_ledger.jsonl"
mkdir -p "$(dirname "$LEDGER")"

append_ledger() {
  local agent="${1:-codex-slice-audit}" cost="${2:-0}"
  printf '{"ts":"%s","slice":"%s","agent":"%s","cost_usd":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slice_id" "$agent" "$cost" \
    >> "$LEDGER"
}

run_codex_native() {
  {
    cat "$prompt_file"
    echo
    echo "---"
    echo
    cat <<EOF
You are the Codex SLICE-PLAN auditor. Slice file: ${slice_file}.

Audit the SLICE PLAN ONLY. Do NOT touch any other file. Do NOT switch branches.
Do NOT check out a slice branch (none exists yet). You are on integration/perf-roadmap.

Steps:
1. Read ${slice_file} carefully — frontmatter, Goal, Inputs, Required services / env, Steps, Changed files expected, Gate commands, Acceptance criteria, Out of scope.
2. Look for plan bugs per your system prompt's audit principles.
3. If you find fixable issues, edit ${slice_file} directly. Keep the goal intact.
4. Update frontmatter:
   - PASS or PASS-WITH-FIXES → status=pending, owner=claude, refresh updated timestamp
   - REJECT → status=blocked, owner=user, refresh updated timestamp; append a "Plan-audit verdict" section explaining the architectural issue
5. Commit on integration/perf-roadmap with message tag [slice:${slice_id}][plan-pass|plan-pass-with-fixes|plan-reject].
6. Push integration/perf-roadmap.

CRITICAL CONSTRAINTS:
- Operate ONLY on integration/perf-roadmap.
- Touch ONLY ${slice_file}.
- Do NOT run npm / web / build commands. The implementer audit later checks those.
EOF
  } | codex exec --sandbox danger-full-access -
}

run_claude_fallback() {
  claude --print \
    --append-system-prompt "$(cat "$prompt_file")" \
    --permission-mode acceptEdits \
    --allowed-tools "Read,Edit,Bash,Grep,Glob" <<EOF
You are the SLICE-PLAN auditor (claude-fallback because Codex CLI was not found).

Slice file: ${slice_file}

Steps: same as the Codex prompt above. Operate only on integration/perf-roadmap. Touch only the slice file. Commit + push with [slice:${slice_id}][plan-pass|plan-pass-with-fixes|plan-reject][fallback] tag.
EOF
}

if command -v codex >/dev/null 2>&1; then
  run_codex_native
  append_ledger codex-slice-audit 0
elif command -v claude >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] codex CLI not found; using claude fallback for slice audit" >> "$log"
  run_claude_fallback
  append_ledger codex-slice-audit-claude-fallback 0
else
  echo "neither codex nor claude CLI available" >&2
  exit 3
fi

echo "[$(date -Iseconds)] dispatch_slice_audit $slice_id end" >> "$log"
