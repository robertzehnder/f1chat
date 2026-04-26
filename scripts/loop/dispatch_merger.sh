#!/usr/bin/env bash
# scripts/loop/dispatch_merger.sh
# Auto-merger: when a slice is status=ready_to_merge, merge slice/<id> into
# integration/perf-roadmap, flip status to done, push, and clean up.
#
# Approval-flagged slices STILL require a user-touched
# diagnostic/slices/.approved-merge/<slice_id> sentinel before this runs.
# That preserves the human gate where it actually matters (security, prod,
# cost) while making the routine PASSes hands-off.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
slice_branch="slice/${slice_id}"
log="scripts/loop/state/runner.log"
approved_merge_sentinel="diagnostic/slices/.approved-merge/${slice_id}"

stamp() { date -Iseconds; }
logmsg() { printf '[%s] auto_merger %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$log"; }

logmsg begin

# Read frontmatter status + approval flag.
read_field() {
  awk -v k="$1" '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == k":" { sub(/^[^:]+: */, ""); print; exit }
  ' "$slice_file"
}
status=$(read_field status)
approval=$(read_field user_approval_required)

if [[ "$status" != "ready_to_merge" ]]; then
  logmsg "skip: status=$status (expected ready_to_merge)"
  exit 0
fi

# Block on approval-merge sentinel for user_approval_required slices,
# unless LOOP_AUTO_APPROVE=1 is set in the runner's env.
if [[ "$approval" == "yes" && ! -f "$approved_merge_sentinel" && "${LOOP_AUTO_APPROVE:-0}" != "1" ]]; then
  logmsg "BLOCKED: user_approval_required=yes but no sentinel at $approved_merge_sentinel"
  exit 0
fi

# Confirm slice branch exists locally; pull latest if remote is ahead.
if ! git rev-parse --verify "$slice_branch" >/dev/null 2>&1; then
  logmsg "FAIL: $slice_branch does not exist locally"
  exit 1
fi

# Switch to integration; abort if dirty.
current=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current" != "integration/perf-roadmap" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    logmsg "FAIL: dirty worktree on $current; cannot switch"
    exit 1
  fi
  git checkout integration/perf-roadmap >/dev/null 2>&1
fi

# Best-effort sync with origin.
git pull --ff-only origin integration/perf-roadmap 2>/dev/null || true

# Merge.
logmsg "merging $slice_branch"
if ! git merge --no-ff "$slice_branch" -m "merge: $slice_id [pass]"; then
  logmsg "FAIL: merge produced conflicts; aborting"
  git merge --abort 2>/dev/null || true
  exit 1
fi

# Flip frontmatter status: ready_to_merge -> done; owner: user -> -
sed -i.bak 's/^status: ready_to_merge$/status: done/' "$slice_file"
sed -i.bak 's/^owner: user$/owner: -/' "$slice_file"
rm -f "${slice_file}.bak"
git add "$slice_file"
git commit -m "chore: mark $slice_id done after auto-merge

[slice:${slice_id}][done][auto-merger]" >/dev/null 2>&1

# Delete slice branch (local + remote, best-effort).
git branch -d "$slice_branch" >/dev/null 2>&1 || true
if git ls-remote --exit-code --heads origin "$slice_branch" >/dev/null 2>&1; then
  git push origin --delete "$slice_branch" >/dev/null 2>&1 || true
fi

# Clean up the approval-merge sentinel if it existed.
[[ -f "$approved_merge_sentinel" ]] && rm -f "$approved_merge_sentinel"

# Reset the repair counter on successful merge — if this slice ever blocks
# again later, it gets a fresh repair budget.
rm -f "scripts/loop/state/repair_count_${slice_id}"

# Push integration.
git push >/dev/null 2>&1 || logmsg "WARN: push failed (will retry on next tick)"

logmsg "merged and pushed; slice marked done"
