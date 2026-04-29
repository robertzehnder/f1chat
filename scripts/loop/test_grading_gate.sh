#!/usr/bin/env bash
# scripts/loop/test_grading_gate.sh
#
# Baseline-aware wrapper around `npm run test:grading`. Existing slice
# plans assume the gate exits 0, but integration/perf-roadmap itself
# accumulates pre-existing test failures (cross-slice cascades that
# weren't fully resolved at merge time). A naive `exit 0` gate would
# block every Phase 7+ slice on integration's pre-existing breakage,
# even when the slice itself adds zero new failures.
#
# This wrapper:
#   1. Runs `npm run test:grading` from the caller's cwd (slice worktree).
#   2. Diffs the failing-test set against the cached integration baseline
#      at $LOOP_STATE_DIR/test_grading_baseline.txt.
#   3. Exits 0 iff no NEW failures appear (i.e. the slice did not
#      regress anything that was passing on integration).
#   4. If new failures exist, prints them and exits non-zero so the
#      auditor REJECTs.
#
# Refresh the baseline with scripts/loop/refresh_test_grading_baseline.sh
# (called automatically by dispatch_merger.sh after every merge so it
# tracks integration's current state).
#
# If the baseline file is missing, this wrapper falls back to the strict
# "exit 0 only" semantics (so slices added before the baseline is
# created don't silently pass with broken tests).

set -euo pipefail

REPO_ROOT="${LOOP_MAIN_WORKTREE:-$(git rev-parse --show-toplevel)}"
LOOP_STATE_DIR="${LOOP_STATE_DIR:-$REPO_ROOT/scripts/loop/state}"
BASELINE="$LOOP_STATE_DIR/test_grading_baseline.txt"

LOG_PREFIX="[test_grading_gate]"

# Run the gate. The wrapper cd's into web/ so callers can invoke this
# from any cwd inside the worktree (slice plans usually invoke it from
# repo root, but a slice worktree at $REPO_ROOT/web is the cwd Node
# expects). Capture both stdout (TAP output) and exit code; we need the
# slice's actual failing test set regardless of whether the suite exits
# 0 or 1.
out=$(mktemp -t test_grading_gate.XXXXXX)
trap 'rm -f "$out"' EXIT

cd "$REPO_ROOT/web"
set +e
npm run test:grading > "$out" 2>&1
suite_rc=$?
set -e

# Extract failing test names ("not ok N - <name>") from the TAP output.
# Strip the "not ok N - " prefix so we compare names not numbers (test
# numbers shift when the test list grows or shrinks).
slice_fails=$(grep -E "^not ok [0-9]+ - " "$out" | sed -E 's/^not ok [0-9]+ - //' | sort -u)

if [[ -z "$slice_fails" ]] && (( suite_rc == 0 )); then
  echo "$LOG_PREFIX all tests passed"
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "$LOG_PREFIX baseline file missing at $BASELINE — falling back to strict mode"
  echo "$LOG_PREFIX (refresh with scripts/loop/refresh_test_grading_baseline.sh)"
  if (( suite_rc != 0 )); then
    echo "$LOG_PREFIX FAIL — npm run test:grading exited $suite_rc; fails:"
    echo "$slice_fails" | sed 's/^/  - /'
    exit "$suite_rc"
  fi
  exit 0
fi

baseline_fails=$(sort -u "$BASELINE")

# Diff: tests that fail on slice but NOT on integration baseline = NEW failures.
new_fails=$(comm -23 <(echo "$slice_fails") <(echo "$baseline_fails"))

if [[ -z "$new_fails" ]]; then
  s_count=$(echo "$slice_fails" | grep -c . 2>/dev/null || echo 0)
  b_count=$(echo "$baseline_fails" | grep -c . 2>/dev/null || echo 0)
  fixed_list=$(comm -13 <(echo "$slice_fails") <(echo "$baseline_fails"))
  f_count=$(echo "$fixed_list" | grep -c . 2>/dev/null || echo 0)
  echo "$LOG_PREFIX PASS (no new failures vs integration baseline) slice_fails=$s_count baseline_fails=$b_count baseline_failures_fixed=$f_count"
  exit 0
fi

# Otherwise: report and fail.
n_new=$(echo "$new_fails" | grep -c .)
echo "$LOG_PREFIX FAIL — $n_new new test failure(s) vs integration baseline:"
echo "$new_fails" | sed 's/^/  - /'
exit 1
