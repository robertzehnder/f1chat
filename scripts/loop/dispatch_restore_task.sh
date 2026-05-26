#!/usr/bin/env bash
# scripts/loop/dispatch_restore_task.sh <slice-id>
# §B.3 — Cline `"task"` scope: remove the slice's prior audit-verdict history
# from the slice file so the next dispatch sees a fresh perspective. Code in
# the proposal worktree is preserved.
set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be exported by runner}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be exported by runner}"

slice_id="${1:?slice_id required}"
LOG="$LOOP_STATE_DIR/runner.log"

cd "$LOOP_MAIN_WORKTREE"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/slice_helpers.sh"

stamp() { date -Iseconds; }
logmsg() { printf '[%s] restore_task %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$LOG"; }

f="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
[[ -f "$f" ]] || { logmsg "ERROR: slice file missing"; exit 2; }

logmsg "begin: stripping prior audit history from slice file"

# Remove all '## Audit verdict' and '## Revision notes' sections.
python3 - "$f" <<'PY'
import sys, re
path = sys.argv[1]
text = open(path).read()
# Strip every '## Audit verdict' or '## Revision notes' section (header through
# the next '## ' header, exclusive).
text = re.sub(
  r'\n## (Audit verdict|Revision notes).*?(?=\n## |\Z)',
  '',
  text,
  flags=re.S
)
open(path, "w").write(text)
PY

flip_slice_status "$slice_id" revising claude
append_slice_section "$slice_id" "## Restore action" "Mode: task ($(stamp))\nStripped prior audit/revision sections; preserved proposal-worktree code."

printf '{"ts":"%s","slice":"%s","action":"restore_task"}\n' "$(stamp)" "$slice_id" \
  >> "$LOOP_STATE_DIR/triage_actions.jsonl"

logmsg "done"
