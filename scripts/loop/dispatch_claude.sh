#!/usr/bin/env bash
# scripts/loop/dispatch_claude.sh
# Headless invocation of Claude Code as the implementer agent.
# Usage: dispatch_claude.sh <slice_id>

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
prompt_file="scripts/loop/prompts/claude_implementer.md"
log="scripts/loop/state/runner.log"

[[ -f "$slice_file" ]] || { echo "missing $slice_file" >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH; install Claude Code first" >&2
  exit 3
fi

stamp=$(date -Iseconds)
echo "[$stamp] dispatch_claude $slice_id begin" >> "$log"

LEDGER="scripts/loop/state/cost_ledger.jsonl"
mkdir -p "$(dirname "$LEDGER")"
ANTHROPIC_LOG="scripts/loop/state/.last_claude_response.json"

append_ledger() {
  local in_tok="${1:-0}" out_tok="${2:-0}" cache_tok="${3:-0}" cost="${4:-0}" model="${5:-unknown}"
  printf '{"ts":"%s","slice":"%s","agent":"claude","model":"%s","input_tokens":%s,"output_tokens":%s,"cache_read_tokens":%s,"cost_usd":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slice_id" "$model" "$in_tok" "$out_tok" "$cache_tok" "$cost" \
    >> "$LEDGER"
}

claude --print \
  --model "${LOOP_CLAUDE_IMPL_MODEL:-claude-opus-4-7}" \
  --append-system-prompt "$(cat "$prompt_file")" \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
You are the Claude implementation agent in the OpenF1 perf-roadmap autonomous loop.

The slice you are working is at: ${slice_file}

Read its frontmatter and "Steps" section. Execute the slice end-to-end:

1. Verify the frontmatter shows status=pending or status=revising; if not, exit immediately.
2. Update the frontmatter: status=in_progress, owner=claude, updated=$(date -Iseconds).
3. Create branch slice/${slice_id} from integration/perf-roadmap (use git checkout -b unless it already exists).
4. Execute every numbered step in the slice's "Steps" section.
5. Run every command in the slice's "Gate commands" block. Record exit codes.
6. If all gates exit zero: fill in "Slice-completion note" with branch name, commit hashes, decisions, and self-check results. Set frontmatter status=awaiting_audit, owner=codex.
7. Commit your work with a message tagged: [slice:${slice_id}][awaiting-audit]
8. Push branch slice/${slice_id} to origin.

CRITICAL CONSTRAINTS:
- Do NOT modify any file not listed in "Changed files expected".
- Do NOT advance to a different slice — that is the runner's job.
- Do NOT push to integration/perf-roadmap or main.
- If gates fail and you cannot fix them within scope, set status=blocked, owner=user, and document why.
EOF

# TELEMETRY SCAFFOLD ONLY — not yet enforcing spend.
# The Claude CLI's --print mode does not expose token usage or USD cost.
# We append a placeholder row so check_budget.sh has a ledger to read; real
# cost capture requires either (a) parsing `~/.claude/logs/`, (b) wrapping
# the call with the SDK to read response.usage, or (c) querying the
# Anthropic console export. Until then the daily cap is advisory only.
append_ledger 0 0 0 0 "claude-cli"

echo "[$(date -Iseconds)] dispatch_claude $slice_id end" >> "$log"
