#!/usr/bin/env bash
# scripts/loop/reject_loop_infra_repair.sh
# Safely rejects a pending loop-infra repair by verifying the top two commits
# on integration are the expected [loop-infra-pending] / [loop-infra-repair]
# pair for the given slice (with matching [attempt:N] tag), then resetting to
# origin only if both checks pass.
#
# Round-6 H-2: replaces raw `git reset --hard` instruction in the slice file
# with a dedicated, defensive script.
# Round-7 L-answer + round-8 M-3: refuses if the bad commits are already on
# origin (a destructive local reset doesn't undo origin).
# Round-10 H-1: HEAD must include [attempt:N] tag (cannot identify attempt
# without it).
#
# Usage: scripts/loop/reject_loop_infra_repair.sh <slice_id> [--offline-local-only]

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"

# Round-10 H-1: HEAD must include the [attempt:N] tag so we don't false-match
# a historical reverted attempt. The attempt number is taken from HEAD's
# subject (single source of truth at this point).
head_attempt=$(git log -1 --pretty=%s HEAD | sed -nE 's/.*\[attempt:([0-9]+)\].*/\1/p' | head -1)
if [[ -z "$head_attempt" ]]; then
  echo "FAIL: HEAD subject does not contain [attempt:N] tag — cannot identify the repair attempt." >&2
  echo "  HEAD subject: $(git log -1 --pretty=%s HEAD)" >&2
  exit 1
fi
expected_top="\\[loop-infra-pending\\]\\[slice:${slice_id}\\]\\[attempt:${head_attempt}\\]"
expected_below="\\[loop-infra-repair\\]\\[slice:${slice_id}\\]\\[attempt:${head_attempt}\\]"

# 1. Verify HEAD is on integration/perf-roadmap (won't reset other branches).
current=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current" != "integration/perf-roadmap" ]]; then
  echo "FAIL: not on integration/perf-roadmap (current: $current)"
  exit 1
fi

# 1b. Round-7 L-answer + round-8 M-3: refuse if the bad commits are already
#     on origin. Fail closed if `git fetch` fails. Override only via explicit
#     --offline-local-only flag.
OFFLINE_OVERRIDE=0
if [[ "${2:-}" == "--offline-local-only" ]]; then
  OFFLINE_OVERRIDE=1
  echo "WARNING: --offline-local-only set; skipping origin fetch. Reset will" >&2
  echo "         be local-only; bad commits already pushed will REMAIN on origin." >&2
fi

if [[ $OFFLINE_OVERRIDE -eq 0 ]]; then
  if ! git fetch origin integration/perf-roadmap >/dev/null 2>&1; then
    cat <<EOF >&2
FAIL: git fetch origin integration/perf-roadmap failed.

This script's safety check requires a fresh origin view to confirm the
[loop-infra-pending][slice:${slice_id}] commits have NOT already been
pushed. Stale origin state could mask a push that already happened.

Resolve the network issue and re-run. If you absolutely cannot reach
origin and have verified locally that nothing was pushed, override with:
  $0 ${slice_id} --offline-local-only
EOF
    exit 2
  fi
fi

# 2. HEAD must be exactly 2 commits ahead of origin (the pending + repair pair).
if [[ $OFFLINE_OVERRIDE -eq 0 ]]; then
  ahead=$(git rev-list --count origin/integration/perf-roadmap..HEAD)
  if [[ "$ahead" != "2" ]]; then
    echo "FAIL: HEAD is $ahead commits ahead of origin; expected exactly 2."
    echo "  Refusing to reset — manual investigation required."
    exit 1
  fi
fi

# 3. Verify HEAD and HEAD~1 are the expected loop-infra commits for THIS slice.
top_msg=$(git log -1 --pretty=%s HEAD)
below_msg=$(git log -1 --pretty=%s HEAD~1)

if ! echo "$top_msg" | grep -Eq "$expected_top"; then
  echo "FAIL: HEAD commit is not [loop-infra-pending][slice:${slice_id}][attempt:${head_attempt}]"
  echo "  HEAD subject: $top_msg"
  exit 1
fi
if ! echo "$below_msg" | grep -Eq "$expected_below"; then
  echo "FAIL: HEAD~1 commit is not [loop-infra-repair][slice:${slice_id}][attempt:${head_attempt}]"
  echo "  HEAD~1 subject: $below_msg"
  exit 1
fi

# 4. Capture SHAs before reset for the audit trail.
pending_sha=$(git rev-parse HEAD)
repair_sha=$(git rev-parse HEAD~1)

# 5. Perform the reset.
echo "Verified pair for ${slice_id} attempt ${head_attempt}:"
echo "  HEAD     [loop-infra-pending] $pending_sha"
echo "  HEAD~1   [loop-infra-repair]  $repair_sha"

if [[ $OFFLINE_OVERRIDE -eq 1 ]]; then
  git reset --hard HEAD~2
else
  git reset --hard origin/integration/perf-roadmap
fi

# 6. Clean up the approval sentinel for THIS attempt if it exists.
sentinel_to_clean="diagnostic/slices/.approved-loop-infra-repair/${slice_id}__attempt-${head_attempt}"
if [[ -f "$sentinel_to_clean" ]]; then
  rm -f "$sentinel_to_clean"
  echo "Cleaned up sentinel: $sentinel_to_clean"
fi

cat <<EOF

REJECTED loop-infra repair for ${slice_id} attempt ${head_attempt}.
Both local commits have been reset. The slice's repair_count_<id> is
preserved so the next repair attempt is N+1 (not 1) — preventing a stale
sentinel from a prior cycle from colliding with a fresh repair.

Next steps:
  - Restart the runner to continue the loop.
  - The slice will re-enter blocked state on next selection;
    auto-repair will trigger if LOOP_AUTO_REPAIR=1 (now at attempt $((head_attempt + 1))).
EOF
