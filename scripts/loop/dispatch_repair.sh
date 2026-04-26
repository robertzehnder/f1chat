#!/usr/bin/env bash
# scripts/loop/dispatch_repair.sh
# Auto-repair: when a slice is status=blocked and LOOP_AUTO_REPAIR=1, dispatch
# Claude (repair agent) to either fix the protocol bug or just flip the slice
# back to revising for another implementer attempt.
#
# Usage: dispatch_repair.sh <slice_id>
# Bounded: at most LOOP_MAX_REPAIRS (default 3) attempts per slice. After that,
# falls through to USER ATTENTION even with LOOP_AUTO_REPAIR=1.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
prompt_file="scripts/loop/prompts/claude_repair.md"
log="scripts/loop/state/runner.log"
counter_file="scripts/loop/state/repair_count_${slice_id}"

MAX_REPAIRS="${LOOP_MAX_REPAIRS:-3}"

[[ -f "$slice_file" ]]    || { echo "missing $slice_file" >&2; exit 2; }
[[ -f "$prompt_file" ]]   || { echo "missing $prompt_file" >&2; exit 2; }

stamp() { date -Iseconds; }
logmsg() { printf '[%s] dispatch_repair %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$log"; }

mkdir -p "$(dirname "$counter_file")"
count=$(cat "$counter_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$counter_file"

logmsg "repair attempt $count of $MAX_REPAIRS"

if [[ "$count" -gt "$MAX_REPAIRS" ]]; then
  logmsg "MAX_REPAIRS exceeded ($count > $MAX_REPAIRS); escalating to USER ATTENTION"
  exit 4   # exit code 4 = give up, runner falls through
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH" >&2
  exit 3
fi

logmsg "begin"

claude --print \
  --append-system-prompt "$(cat "$prompt_file")" \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
You are the Claude REPAIR agent. The parent slice is blocked.

Slice file: ${slice_file}
Repair attempt: ${count} of ${MAX_REPAIRS}

Steps:
1. Read the parent slice's "Audit verdict" section verbatim.
2. Classify: protocol-level, implementation-level, or genuinely ambiguous (see your system prompt).
3. Verify you are on integration/perf-roadmap before editing anything (git checkout integration/perf-roadmap if needed).
4. Apply the appropriate action per the system prompt's decision tree:
   - Protocol-level: edit the relevant scripts/loop/* or prompts/* file, OR amend the parent slice file's gates / scope sections. Commit with [protocol-repair].
   - Implementation-level: just flip frontmatter status=revising, owner=claude. Commit with [repair-retry].
   - Ambiguous: append a short diagnosis to the slice's audit verdict, leave status=blocked. Commit with [repair-escalate].
5. Push integration/perf-roadmap.

CRITICAL CONSTRAINTS:
- Operate only on integration/perf-roadmap.
- Do not modify the implementer's actual code (that lives on slice/${slice_id}, not integration).
- Do not modify other slice files.
- Keep the commit subject one sentence.
- After you commit + push, exit. Do not start the next slice yourself.
EOF

logmsg "end"
