#!/usr/bin/env bash
# scripts/loop/dispatch_plan_revise.sh
# Phase: PLAN REVISE (between plan-audit rounds).
# Claude reads the latest Codex audit's triaged action items from the slice
# file and edits ONLY the slice file to resolve them, then flips status back
# to pending_plan_audit so Codex can re-audit.
#
# Bounded: at most LOOP_MAX_PLAN_ITERATIONS (default 4) per slice. After that,
# the runner / next audit will escalate to blocked.
#
# Usage: dispatch_plan_revise.sh <slice_id>

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
prompt_file="scripts/loop/prompts/claude_plan_reviser.md"
log="scripts/loop/state/runner.log"
counter_file="scripts/loop/state/plan_iter_count_${slice_id}"

MAX_ITERATIONS="${LOOP_MAX_PLAN_ITERATIONS:-4}"

[[ -f "$slice_file" ]]  || { echo "missing $slice_file"  >&2; exit 2; }
[[ -f "$prompt_file" ]] || { echo "missing $prompt_file" >&2; exit 2; }

stamp() { date -Iseconds; }
logmsg() { printf '[%s] dispatch_plan_revise %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$log"; }

mkdir -p "$(dirname "$counter_file")"
count=$(cat "$counter_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$counter_file"

logmsg "plan-revise iteration $count of $MAX_ITERATIONS"

if [[ "$count" -gt "$MAX_ITERATIONS" ]]; then
  logmsg "MAX_PLAN_ITERATIONS exceeded ($count > $MAX_ITERATIONS); escalating"
  # Flip slice to blocked so the runner surfaces USER ATTENTION.
  awk -v ts="$(stamp)" '
    BEGIN { in_fm = 0 }
    /^---$/ { in_fm = !in_fm; print; next }
    in_fm && /^status:/ { print "status: blocked"; next }
    in_fm && /^owner:/  { print "owner: user"; next }
    in_fm && /^updated:/ { print "updated: " ts; next }
    { print }
  ' "$slice_file" > "$slice_file.tmp" && mv "$slice_file.tmp" "$slice_file"

  cat >> "$slice_file" <<EOF

## Plan-revise escalation

Hit \`LOOP_MAX_PLAN_ITERATIONS=$MAX_ITERATIONS\` without converging on APPROVED. Latest audit verdict still has open items. User intervention required.
EOF

  git add "$slice_file"
  git commit -m "plan-revise: escalate $slice_id after $MAX_ITERATIONS iterations" >/dev/null 2>&1
  git push >/dev/null 2>&1 || true
  logmsg "escalated to blocked"
  exit 4   # signals to runner: max iterations reached
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH" >&2
  exit 3
fi

logmsg "begin"

claude --print \
  --model "${LOOP_CLAUDE_REVISE_MODEL:-claude-opus-4-7}" \
  --append-system-prompt "$(cat "$prompt_file")" \
  --permission-mode acceptEdits \
  --allowed-tools "Read,Edit,Write,Bash,Grep,Glob" <<EOF
You are the Claude PLAN-REVISER. The slice's plan-audit returned a triaged list of action items.

Slice file: ${slice_file}
Iteration: ${count} of ${MAX_ITERATIONS}

Steps:
1. Verify you are on integration/perf-roadmap. \`git checkout integration/perf-roadmap\` if needed.
2. Read ${slice_file}. Find the latest \`## Plan-audit verdict (round N)\` section.
3. For each \`- [ ]\` item under High / Medium / Low, edit the slice's body (Steps, Gate commands, Required services / env, Changed files expected, Acceptance criteria, etc.) to address it. Tick the box \`- [x]\` after you've made the corresponding edit. For Low items you choose to skip, leave \`- [ ]\` and append \`DEFER: <reason>\`.
4. Notes section: read but do not act.
5. Refresh frontmatter \`updated:\` timestamp; set \`status: pending_plan_audit\`, \`owner: codex\`.
6. Commit on integration/perf-roadmap with message tag \`[slice:${slice_id}][plan-revise]\`.
7. Push.

CRITICAL CONSTRAINTS:
- Operate ONLY on integration/perf-roadmap.
- Touch ONLY ${slice_file}.
- Do NOT modify previous rounds' verdict text (other than ticking checkboxes).
- Do NOT add new "Plan-audit verdict" sections — only Codex writes those.
- After commit + push, exit. The runner will re-dispatch Codex for round $((count + 1)).
EOF

logmsg "end"
