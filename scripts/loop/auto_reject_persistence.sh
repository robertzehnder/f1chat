#!/usr/bin/env bash
# scripts/loop/auto_reject_persistence.sh
#
# Force a plan-audit REJECT when check_iteration_quality.sh has detected an
# item that has been re-flagged across the persistence threshold without
# resolution. Appends a `## Plan-audit verdict (round N+1)` block to the
# slice file with status=REJECT, sets frontmatter status=blocked,
# owner=user, commits on slice/<id>, and pushes.
#
# The dispatcher invokes this AS A REPLACEMENT for the auditor dispatch
# when persistence is detected, saving the cost of another auditor run.
#
# Usage: auto_reject_persistence.sh <slice_id> <slice_worktree> <persistence_summary>

set -euo pipefail

slice_id="${1:?slice_id required}"
slice_worktree="${2:?slice_worktree required}"
summary="${3:?persistence_summary required}"

slice_file="$slice_worktree/diagnostic/slices/${slice_id}.md"
[[ -f "$slice_file" ]] || { echo "missing $slice_file" >&2; exit 1; }

# Compute the next round number = max existing round + 1.
next_round=$(python3 -c "
import re
text = open('$slice_file').read()
nums = [int(n) for n in re.findall(r'^## Plan-audit verdict \(round (\d+)\)', text, re.M)]
print(max(nums) + 1 if nums else 1)
")

today=$(date -Iseconds)

# Append the auto-reject verdict block.
cat >> "$slice_file" <<EOF

## Plan-audit verdict (round ${next_round})

**Status: REJECT**
**Auditor: auto-reject-persistence (script-issued, not an LLM call)**

### High
- [ ] User intervention required: persistence detected. ${summary}.

### Medium
_None._

### Low
_None._

### Notes (informational only — no action)
- This verdict was issued by \`scripts/loop/check_iteration_quality.sh\` after detecting that the same audit-item text recurred across the configured persistence threshold (\`LOOP_PERSISTENCE_HIGH_ROUNDS\` / \`LOOP_PERSISTENCE_MEDIUM_ROUNDS\`).
- The plan iteration loop is stalled — the auditor and reviser are not converging on the surfaced item(s). User should either (a) edit the plan to resolve them directly, (b) reword the slice's gates so the auditor stops surfacing the same concern, or (c) accept the deferred items and unblock manually.
- After user adjudication, flip frontmatter to \`status: pending_plan_audit, owner: codex\` (or whichever next state is appropriate) to resume the loop.
EOF

# Flip frontmatter atomically.
python3 - "$slice_file" "$today" <<'PY'
import sys, re
path, ts = sys.argv[1], sys.argv[2]
text = open(path).read()
# Operate only inside the leading frontmatter block (between the first two `---` lines).
parts = text.split('---', 2)
if len(parts) < 3:
    sys.exit(1)
fm = parts[1]
fm = re.sub(r'^status:.*$', 'status: blocked', fm, count=1, flags=re.M)
fm = re.sub(r'^owner:.*$',  'owner: user',     fm, count=1, flags=re.M)
fm = re.sub(r'^updated:.*$', f'updated: {ts}', fm, count=1, flags=re.M)
open(path, 'w').write(parts[0] + '---' + fm + '---' + parts[2])
PY

(
  cd "$slice_worktree"
  git add "diagnostic/slices/${slice_id}.md"
  git commit -m "[slice:${slice_id}][plan-reject] auto-reject: persistence detected" \
             -m "$summary" >/dev/null
  git push >/dev/null 2>&1 || true
)

echo "auto-rejected $slice_id (round ${next_round}); summary: $summary"
