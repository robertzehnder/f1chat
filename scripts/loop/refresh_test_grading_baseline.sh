#!/usr/bin/env bash
# scripts/loop/refresh_test_grading_baseline.sh
#
# Captures integration/perf-roadmap's currently-failing test:grading set
# into $LOOP_STATE_DIR/test_grading_baseline.txt. test_grading_gate.sh
# uses this as the "no new failures" reference.
#
# Called automatically by dispatch_merger.sh after every successful merge
# to integration so the baseline tracks integration's evolving state.
# Can also be run manually to seed or refresh the baseline.
#
# Usage: refresh_test_grading_baseline.sh [--quiet]

set -euo pipefail

QUIET="${1:-}"

LOOP_MAIN_WORKTREE="${LOOP_MAIN_WORKTREE:-$(git rev-parse --show-toplevel)}"
LOOP_STATE_DIR="${LOOP_STATE_DIR:-$LOOP_MAIN_WORKTREE/scripts/loop/state}"
BASELINE="$LOOP_STATE_DIR/test_grading_baseline.txt"

mkdir -p "$LOOP_STATE_DIR"

cd "$LOOP_MAIN_WORKTREE/web"

[[ "$QUIET" == "--quiet" ]] || echo "[refresh-baseline] running test:grading on integration ($(git -C "$LOOP_MAIN_WORKTREE" rev-parse --short HEAD))..."

out=$(mktemp -t baseline_run.XXXXXX)
trap 'rm -f "$out"' EXIT

set +e
npm run test:grading > "$out" 2>&1
set -e

# Extract failing test names. Empty file = no failures = healthy baseline.
grep -E "^not ok [0-9]+ - " "$out" | sed -E 's/^not ok [0-9]+ - //' | sort -u > "$BASELINE.tmp"
mv "$BASELINE.tmp" "$BASELINE"

n=$(wc -l < "$BASELINE" | tr -d ' ')
[[ "$QUIET" == "--quiet" ]] || {
  echo "[refresh-baseline] captured $n failing test(s) -> $BASELINE"
  if (( n > 0 )); then
    head -5 "$BASELINE" | sed 's/^/  - /'
    (( n > 5 )) && echo "  - ... ($n total)"
  fi
}
