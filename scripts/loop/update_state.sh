#!/usr/bin/env bash
# scripts/loop/update_state.sh
# Post-merge: regenerate diagnostic/_state.md so future plan-audits and
# implementations have accumulated project context across slices.
#
# Sections this script REGENERATES every run (overwriting prior content):
#   - top-line `last updated:` timestamp
#   - Phases status table (from loop_status.sh)
#   - Latest benchmark headline (from latest diagnostic/artifacts/healthcheck/*.json)
#   - Latest perf baseline headline (from latest diagnostic/artifacts/perf/*.json)
#   - Recent slice merges (last 10, from git log)
#
# Sections this script PRESERVES verbatim from the existing file (because
# they are auditor- or repair-agent-curated):
#   - "## Open architectural decisions"
#   - "## Notes for auditors"
#
# Commits the result on integration/perf-roadmap with a [state-update] tag.
# Usage: update_state.sh

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

STATE_FILE="diagnostic/_state.md"
LOG="scripts/loop/state/runner.log"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
logmsg() { printf '[%s] update_state %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG" >/dev/null; }

# --- helpers ---

# Pull a section (between the section header and the next ## header) from the
# existing state file. Empty string if section absent or file missing.
extract_section() {
  local file="$1" header="$2"
  [[ -f "$file" ]] || { echo ""; return; }
  awk -v h="$header" '
    $0 == h { in_sec = 1; print; next }
    in_sec && /^## / && $0 != h { exit }
    in_sec { print }
  ' "$file"
}

# Latest file in a directory matching a glob, by mtime. Empty if none.
# Uses a glob that may match zero files, so we tolerate that under set -e.
latest_file() {
  local dir="$1" pattern="$2"
  [[ -d "$dir" ]] || { echo ""; return 0; }
  # shellcheck disable=SC2012
  local result
  result=$(ls -t "$dir"/$pattern 2>/dev/null | head -1 || true)
  echo "$result"
  return 0
}

# Render the phase status table from loop_status.sh as a Markdown table.
render_phase_table() {
  if [[ ! -x scripts/loop/loop_status.sh ]]; then
    echo "(loop_status.sh not executable)"
    return
  fi
  python3 <<'PY'
import subprocess, re
out = subprocess.check_output(['bash', 'scripts/loop/loop_status.sh'], text=True)
counts = {}  # phase -> {status: count}
for line in out.splitlines():
    parts = line.split(None, 4)
    if len(parts) < 4: continue
    phase, sid, status = parts[0], parts[1], parts[2]
    if phase in ('PHASE', '---'): continue
    if not phase.isdigit() and phase != '?': continue
    counts.setdefault(phase, {}).setdefault(status, 0)
    counts[phase][status] += 1
print('| Phase | Total | Done | Pending | Pending plan-audit | Revising plan | Awaiting audit | Ready to merge | Blocked | Missing |')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for phase in sorted(counts.keys(), key=lambda x: (x == '?', int(x) if x.isdigit() else 99)):
    row = counts[phase]
    total = sum(row.values())
    done    = row.get('done', 0)
    pending = row.get('pending', 0)
    ppa     = row.get('pending_plan_audit', 0)
    rp      = row.get('revising_plan', 0)
    aa      = row.get('awaiting_audit', 0)
    rtm     = row.get('ready_to_merge', 0)
    blocked = row.get('blocked', 0)
    missing = row.get('MISSING', 0)
    print(f'| {phase} | {total} | {done} | {pending} | {ppa} | {rp} | {aa} | {rtm} | {blocked} | {missing} |')
PY
}

# Render benchmark headline from latest healthcheck JSON. Empty section
# if no healthcheck file exists.
render_benchmark_headline() {
  local f
  f=$(latest_file diagnostic/artifacts/healthcheck '*.json')
  if [[ -z "$f" ]]; then
    echo "(no healthcheck artifact yet)"
    return
  fi
  python3 - "$f" <<'PY'
import json, sys, os
f = sys.argv[1]
print(f"- File: `{f}`")
try:
    d = json.load(open(f))
    s = d.get('summary', d)
    if isinstance(s.get('gradeCounts'), dict):
        gc = s['gradeCounts']
        print(f"- Overall A/B/C: {gc.get('A','?')} / {gc.get('B','?')} / {gc.get('C','?')}")
    if isinstance(s.get('answerGradeCounts'), dict):
        gc = s['answerGradeCounts']
        print(f"- Answer A/B/C: {gc.get('A','?')} / {gc.get('B','?')} / {gc.get('C','?')}")
    if isinstance(s.get('semanticConformanceGradeCounts'), dict):
        gc = s['semanticConformanceGradeCounts']
        print(f"- Semantic conformance A/B/C: {gc.get('A','?')} / {gc.get('B','?')} / {gc.get('C','?')}")
    if isinstance(s.get('rootCauseCounts'), dict):
        rc = s['rootCauseCounts']
        items = ', '.join(f"{k}: {v}" for k, v in sorted(rc.items(), key=lambda x: -x[1]))
        print(f"- Root causes: {items if items else '(none)'}")
    print(f"- Total questions: {s.get('total','?')}")
except Exception as e:
    print(f"- (could not parse: {e})")
PY
}

# Render perf headline from latest perf JSON.
render_perf_headline() {
  local f
  f=$(latest_file diagnostic/artifacts/perf '*.json')
  if [[ -z "$f" ]]; then
    echo "(no perf artifact yet)"
    return
  fi
  python3 - "$f" <<'PY'
import json, sys
f = sys.argv[1]
print(f"- File: `{f}`")
try:
    d = json.load(open(f))
    stages = d.get('stages', {})
    if not stages:
        # try alternate shape
        if isinstance(d, dict) and any(isinstance(v, dict) and 'p50_ms' in v for v in d.values()):
            stages = d
    if stages:
        slowest = sorted(stages.items(),
                         key=lambda kv: (kv[1].get('p50_ms') or 0, kv[1].get('p95_ms') or 0),
                         reverse=True)[:5]
        print('- Slowest stages by p50:')
        for name, st in slowest:
            p50 = st.get('p50_ms','?')
            p95 = st.get('p95_ms','?')
            cnt = st.get('count','?')
            print(f"  - `{name}` p50={p50}ms p95={p95}ms n={cnt}")
        total = stages.get('total', {})
        if total:
            print(f"- Overall p50={total.get('p50_ms','?')}ms p95={total.get('p95_ms','?')}ms")
    else:
        print(f"- (could not parse stages from {f})")
except Exception as e:
    print(f"- (could not parse: {e})")
PY
}

# Recent slice merges (last 10) from integration's git log.
render_recent_merges() {
  git log --grep='^merge:' --pretty=format:'- `%h` %s — %ad' --date=short -10 \
    integration/perf-roadmap 2>/dev/null \
    | head -10
  echo ""  # trailing newline
}

# --- assembly ---

now=$(stamp)

preserved_decisions=$(extract_section "$STATE_FILE" "## Open architectural decisions")
preserved_notes=$(extract_section "$STATE_FILE" "## Notes for auditors")

# Defaults if those sections don't yet exist.
if [[ -z "$preserved_decisions" ]]; then
  preserved_decisions=$'## Open architectural decisions\n\n_None._\n'
fi
if [[ -z "$preserved_notes" ]]; then
  preserved_notes=$'## Notes for auditors\n\n_No accumulated notes yet. Auditors may append single-line lessons here, max 10 entries._\n'
fi

# Build the new file.
{
  echo "# Project state — last updated: ${now}"
  echo
  echo "_Read this file at the start of every plan-audit, plan-revise,"
  echo "implementation, and implementation-audit dispatch. It is the"
  echo "accumulated context the loop carries between slices._"
  echo
  echo "## Phases status"
  echo
  render_phase_table
  echo
  echo "## Latest benchmark headline"
  echo
  render_benchmark_headline
  echo
  echo "## Latest perf baseline"
  echo
  render_perf_headline
  echo
  echo "## Recent slice merges (last 10)"
  echo
  render_recent_merges
  echo
  printf '%s\n' "$preserved_decisions"
  echo
  printf '%s\n' "$preserved_notes"
} > "$STATE_FILE.tmp"

mv "$STATE_FILE.tmp" "$STATE_FILE"

# Commit only if file actually changed.
if git diff --quiet -- "$STATE_FILE"; then
  if ! git ls-files --error-unmatch "$STATE_FILE" >/dev/null 2>&1; then
    : # new untracked file — proceed to add
  else
    logmsg "no change to state file; skipping commit"
    exit 0
  fi
fi

git add "$STATE_FILE"
git commit -m "state: regenerate _state.md after merge

[state-update]
" >/dev/null 2>&1 || { logmsg "commit failed (likely nothing to commit)"; exit 0; }
git push >/dev/null 2>&1 || logmsg "WARN: push failed; will retry next merge"

logmsg "regenerated $STATE_FILE at $now"
