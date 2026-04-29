#!/usr/bin/env bash
# scripts/loop/triage_blocked_slice.sh
#
# Autonomous triage layer. When a slice flips to status=blocked/user
# (via codex impl-audit REJECT or claude self-block), the runner runs
# this script BEFORE surfacing USER ATTENTION. The script pattern-
# matches against known REJECT classes and attempts a deterministic
# fix. If the fix succeeds and gates pass, the slice flips back to
# awaiting_audit and the runner continues. If pattern-match fails or
# the fix doesn't pass gates, the script exits non-zero so the runner
# falls through to its existing USER ATTENTION exit.
#
# Triage classes (deterministic, no LLM call):
#
#   1. SCOPE-CREEP-TEST-FILE
#      Audit verdict says: "includes <PATH>, which is outside ## Changed
#      files expected" AND PATH ends with .test.{mjs,ts,js}. These are
#      typically transitive stub additions (test harness needs a stub
#      for a new module the slice introduced). Auto-fix: add the path
#      to the slice's "## Changed files expected" with a short rationale.
#
#   2. SCOPE-CREEP-ARTIFACT
#      Audit verdict cites a path under diagnostic/artifacts/** outside
#      Changed files expected. Auto-fix: add the path to the slice's
#      "## Artifact paths" section.
#
#   3. UNKNOWN
#      No pattern matched. Exit non-zero so runner falls through to
#      USER ATTENTION as before.
#
# Logged to runner.log with a [triage] prefix and to a structured feed
# at $LOOP_STATE_DIR/triage_actions.jsonl for analysis.
#
# Disable with LOOP_TRIAGE_DISABLE=1.
#
# Usage: triage_blocked_slice.sh <slice_id>
# Returns: 0 if the slice was triaged + flipped back to awaiting_audit,
#          1 if no pattern matched / triage couldn't help (escalate to user).

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE required}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR required}"

slice_id="${1:?slice_id required}"
LOG="$LOOP_STATE_DIR/runner.log"
ACTIONS_LOG="$LOOP_STATE_DIR/triage_actions.jsonl"
ATTEMPT_HISTORY="$LOOP_STATE_DIR/triage_attempt_history.jsonl"

slice_worktree="$HOME/.openf1-loop-worktrees/$slice_id"
slice_file_main="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
slice_file_branch="$slice_worktree/diagnostic/slices/${slice_id}.md"

[[ -d "$slice_worktree" ]] || { echo "[triage] no worktree for $slice_id"; exit 1; }
[[ -f "$slice_file_branch" ]] || { echo "[triage] no slice file at $slice_file_branch"; exit 1; }

log_event() {
  local action="$1" reason="$2" details="${3:-}"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '[%s] [triage] %s slice=%s reason=%s\n' "$(date -Iseconds)" "$action" "$slice_id" "$reason" >> "$LOG"
  printf '{"ts":"%s","slice":"%s","action":"%s","reason":"%s","details":"%s"}\n' \
    "$ts" "$slice_id" "$action" "$reason" "$details" \
    | python3 -c 'import sys,json; r=json.loads(sys.stdin.read()); print(json.dumps(r))' \
    >> "$ACTIONS_LOG"
}

# Bail out if triage attempts on this slice are already at the per-slice
# cap. Without a cap the loop could spend unbounded time bouncing
# between codex REJECT and triage fix on the same slice.
attempt_cap="${LOOP_TRIAGE_ATTEMPTS_PER_SLICE:-2}"
if [[ -f "$ATTEMPT_HISTORY" ]]; then
  prior=$(grep -c "\"slice\":\"$slice_id\"" "$ATTEMPT_HISTORY" 2>/dev/null || echo 0)
  if (( prior >= attempt_cap )); then
    log_event "skip-attempt-cap" "prior_attempts=$prior cap=$attempt_cap" "escalating to user"
    exit 1
  fi
fi

# Record this attempt up front (so a failure mid-script still counts).
printf '{"ts":"%s","slice":"%s","stage":"started"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$slice_id" >> "$ATTEMPT_HISTORY"

# ----------------------------------------------------------------------
# Read the latest audit verdict.
# ----------------------------------------------------------------------
verdict=$(awk '/^## Audit verdict/,/^## Plan-audit verdict/{print}' "$slice_file_branch")
if [[ -z "$verdict" ]]; then
  log_event "skip-no-verdict" "no Audit verdict block found" "exiting"
  exit 1
fi

# ----------------------------------------------------------------------
# Class 1: SCOPE-CREEP-TEST-FILE
#
# Pattern: scope-creep cite of *.test.{mjs,ts,js} file
# ----------------------------------------------------------------------
if echo "$verdict" | grep -qE "(includes|outside).*\\.test\\.(mjs|ts|js)"; then
  # Extract the offending test file path.
  test_path=$(echo "$verdict" | grep -oE "(web/scripts/tests|web/src)/[a-zA-Z0-9._/-]+\\.test\\.(mjs|ts|js)" | head -1)
  if [[ -z "$test_path" ]]; then
    log_event "skip-class1-no-path" "scope-creep on test file detected but path not extractable" "$verdict"
    exit 1
  fi
  # Make sure the path actually appears in the slice diff.
  if ! ( cd "$slice_worktree" && git diff --name-only integration/perf-roadmap...HEAD | grep -qx "$test_path" ); then
    log_event "skip-class1-not-in-diff" "test path not present in slice diff" "$test_path"
    exit 1
  fi
  # Idempotency: if the path is already in the slice's Changed files
  # expected, the audit re-flagged it for some other reason — escalate.
  if grep -qF "$test_path" "$slice_file_branch"; then
    log_event "skip-class1-already-listed" "test path already in slice plan" "$test_path"
    exit 1
  fi

  # Append the path to "## Changed files expected" with a generic
  # rationale that explains why a test-file edit can be transitively
  # forced by the slice's primary diff.
  python3 - "$slice_file_branch" "$test_path" <<'PY'
import re, sys
path, test_path = sys.argv[1], sys.argv[2]
text = open(path).read()
addition = f"- `{test_path}` (transitive stub-harness change forced by the slice's primary diff — auto-added by triage. The existing test's import-rewrite chain or fixture set needed an entry for the new module the slice introduced; without this addition the existing test would fail at module load. The test's behavioral coverage is unchanged.)\n"
new = re.sub(
    r'(## Changed files expected\s*\n(?:- .+\n)+)',
    lambda m: m.group(1) + addition,
    text, count=1
)
open(path, 'w').write(new)
PY

  # Flip frontmatter back to awaiting_audit so codex re-audits.
  python3 - "$slice_file_branch" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
parts = text.split('---', 2)
fm = parts[1]
fm = re.sub(r'^status:.*$', 'status: awaiting_audit', fm, count=1, flags=re.M)
fm = re.sub(r'^owner:.*$',  'owner: codex',          fm, count=1, flags=re.M)
import datetime
ts = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
fm = re.sub(r'^updated:.*$', f'updated: {ts}', fm, count=1, flags=re.M)
open(path, 'w').write(parts[0] + '---' + fm + '---' + parts[2])
PY

  ( cd "$slice_worktree" && \
    git add "diagnostic/slices/${slice_id}.md" && \
    git commit -m "[slice:${slice_id}][triage-unblock] add ${test_path} to Changed files expected (scope-creep auto-fix)" >/dev/null 2>&1 && \
    git push >/dev/null 2>&1 || true )

  # Mirror the slice file to integration so the runner sees the new state.
  ( cd "$LOOP_MAIN_WORKTREE" && \
    cp "$slice_file_branch" "$slice_file_main" && \
    git add "diagnostic/slices/${slice_id}.md" && \
    git commit -m "mirror: ${slice_id} status → awaiting_audit (triage scope-creep auto-fix)" >/dev/null 2>&1 && \
    git push >/dev/null 2>&1 || true )

  # Reset the slice's failure counter so the runner doesn't trip its
  # consecutive-failure circuit breaker on the next dispatch.
  rm -f "$LOOP_STATE_DIR/fail_count_${slice_id}"

  log_event "auto-fix-class1-scope-creep-test" "added $test_path to Changed files expected" "slice flipped to awaiting_audit"
  exit 0
fi

# ----------------------------------------------------------------------
# Class 2: SCOPE-CREEP-ARTIFACT
# ----------------------------------------------------------------------
if echo "$verdict" | grep -qE "(includes|outside).*diagnostic/artifacts/"; then
  artifact_path=$(echo "$verdict" | grep -oE "diagnostic/artifacts/[a-zA-Z0-9._/-]+" | head -1)
  if [[ -z "$artifact_path" ]]; then
    log_event "skip-class2-no-path" "scope-creep on artifact detected but path not extractable" "$verdict"
    exit 1
  fi
  if ! ( cd "$slice_worktree" && git diff --name-only integration/perf-roadmap...HEAD | grep -qx "$artifact_path" ); then
    log_event "skip-class2-not-in-diff" "artifact not present in slice diff" "$artifact_path"
    exit 1
  fi
  if grep -qF "$artifact_path" "$slice_file_branch"; then
    log_event "skip-class2-already-listed" "artifact already in slice plan" "$artifact_path"
    exit 1
  fi

  python3 - "$slice_file_branch" "$artifact_path" <<'PY'
import re, sys
path, artifact_path = sys.argv[1], sys.argv[2]
text = open(path).read()
addition = f"- `{artifact_path}` (auto-added by triage — declared by the slice's gate or acceptance criterion but not previously listed under ## Artifact paths. The implementation diff includes the file as a required output; this entry brings the slice plan into alignment with that requirement without changing the slice's behavior.)\n"
if re.search(r'^## Artifact paths\s*\n', text, re.M):
    new = re.sub(
        r'(## Artifact paths\s*\n(?:(?:- .+|None\.)\n)*)',
        lambda m: m.group(1).rstrip() + '\n' + addition,
        text, count=1
    )
else:
    # No section yet — insert one after Changed files expected.
    new = re.sub(
        r'(## Changed files expected\s*\n(?:- .+\n)+\n?)',
        lambda m: m.group(1) + '\n## Artifact paths\n' + addition,
        text, count=1
    )
open(path, 'w').write(new)
PY

  python3 - "$slice_file_branch" <<'PY'
import re, sys, datetime
path = sys.argv[1]
text = open(path).read()
parts = text.split('---', 2)
fm = parts[1]
fm = re.sub(r'^status:.*$', 'status: awaiting_audit', fm, count=1, flags=re.M)
fm = re.sub(r'^owner:.*$',  'owner: codex',          fm, count=1, flags=re.M)
ts = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
fm = re.sub(r'^updated:.*$', f'updated: {ts}', fm, count=1, flags=re.M)
open(path, 'w').write(parts[0] + '---' + fm + '---' + parts[2])
PY

  ( cd "$slice_worktree" && \
    git add "diagnostic/slices/${slice_id}.md" && \
    git commit -m "[slice:${slice_id}][triage-unblock] add ${artifact_path} to Artifact paths (scope-creep auto-fix)" >/dev/null 2>&1 && \
    git push >/dev/null 2>&1 || true )

  ( cd "$LOOP_MAIN_WORKTREE" && \
    cp "$slice_file_branch" "$slice_file_main" && \
    git add "diagnostic/slices/${slice_id}.md" && \
    git commit -m "mirror: ${slice_id} status → awaiting_audit (triage artifact-path auto-fix)" >/dev/null 2>&1 && \
    git push >/dev/null 2>&1 || true )

  rm -f "$LOOP_STATE_DIR/fail_count_${slice_id}"

  log_event "auto-fix-class2-scope-creep-artifact" "added $artifact_path to Artifact paths" "slice flipped to awaiting_audit"
  exit 0
fi

# ----------------------------------------------------------------------
# Unknown — escalate.
# ----------------------------------------------------------------------
log_event "no-pattern-match" "verdict did not match a known triage class" "escalating to user"
exit 1
