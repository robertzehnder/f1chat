#!/usr/bin/env bash
# scripts/loop/slice_helpers.sh
# Helpers for reading and mutating diagnostic/slices/<id>.md frontmatter
# and structured sections.
#
# Source this file; do not exec it.

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be set (absolute path)}"

# Read a frontmatter field from a slice file.
# Args: <slice_id> <field>
read_slice_field() {
  local slice_id="$1" field="$2"
  local f="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
  [[ -f "$f" ]] || return 1
  awk -v field="$field" '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == field":" {
      sub(/^[^:]+: */, "");
      print;
      exit
    }
  ' "$f"
}

# Atomically flip a frontmatter field. Args: <slice_id> <new_status> <new_owner>
# Operates on the file in $WORKING_DIR if set, else LOOP_MAIN_WORKTREE.
# Caller is responsible for committing the change under the appropriate lock.
flip_slice_status() {
  local slice_id="$1" new_status="$2" new_owner="$3"
  local work_dir="${WORKING_DIR:-$LOOP_MAIN_WORKTREE}"
  local f="$work_dir/diagnostic/slices/${slice_id}.md"
  [[ -f "$f" ]] || { echo "flip_slice_status: missing $f" >&2; return 1; }
  local now; now=$(date -Iseconds)
  # Use python for safe in-place frontmatter editing.
  python3 - "$f" "$new_status" "$new_owner" "$now" <<'PY'
import sys, re
path, new_status, new_owner, now = sys.argv[1:5]
with open(path, 'r') as fh:
    text = fh.read()
m = re.match(r'^---\n(.*?)\n---\n', text, flags=re.S)
if not m:
    sys.exit("no frontmatter in " + path)
fm = m.group(1)
def repl(field, value):
    global fm
    pat = re.compile(r'^(' + re.escape(field) + r':\s*).*$', flags=re.M)
    if pat.search(fm):
        fm = pat.sub(r'\g<1>' + value, fm)
    else:
        fm = fm.rstrip() + '\n' + field + ': ' + value
fm_orig = fm
repl('status', new_status)
repl('owner', new_owner)
repl('updated', now)
new_text = '---\n' + fm + '\n---\n' + text[m.end():]
with open(path, 'w') as fh:
    fh.write(new_text)
PY
}

# Append a section (header + body) to the end of a slice file.
# Args: <slice_id> <header> <body>
append_slice_section() {
  local slice_id="$1" header="$2" body="$3"
  local work_dir="${WORKING_DIR:-$LOOP_MAIN_WORKTREE}"
  local f="$work_dir/diagnostic/slices/${slice_id}.md"
  [[ -f "$f" ]] || { echo "append_slice_section: missing $f" >&2; return 1; }
  {
    echo
    echo "$header"
    echo
    echo "$body"
  } >> "$f"
}

# Pull the most recent "## Audit verdict" section's body. Used by repair
# classification.
extract_latest_audit_verdict_text() {
  local slice_id="$1"
  local f="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
  [[ -f "$f" ]] || return 1
  awk '
    /^## Audit verdict/ { in_sec = 1; buf = ""; next }
    /^## / && in_sec { print buf; buf = ""; in_sec = 0 }
    in_sec { buf = buf $0 "\n" }
    END { if (in_sec) print buf }
  ' "$f" | tail -200
}

# Classify a repair as slice-state or loop-infra.
# Round-6 M-3: only treat as loop-infra if the audit verdict has triaged
# action items (High/Medium/Low) that point at scripts/loop/* or runner.sh
# protocol code. Mere mention in a Note (e.g. "the runner.sh circuit breaker
# is sufficient") must NOT trigger loop-infra classification.
classify_repair_mode() {
  local slice_id="$1"
  local verdict
  verdict=$(extract_latest_audit_verdict_text "$slice_id")
  if [[ -z "$verdict" ]]; then echo "slice-state"; return 0; fi
  # Look for High/Medium/Low triage entries that mention loop-infra paths.
  if echo "$verdict" \
      | awk '
          /^- (High|Medium|Low)/ { in_item = 1; buf = ""; next }
          /^- (High|Medium|Low)/ && in_item { print buf; buf = ""; next }
          /^## / { exit }
          in_item { buf = buf $0 "\n" }
          END { if (in_item) print buf }
        ' \
      | grep -Eq 'scripts/loop/|runner\.sh|dispatch_[a-z_]+\.sh|preconditions\.sh|loop_status\.sh'; then
    echo "loop-infra"
  else
    echo "slice-state"
  fi
}

# Determine the resume target for a loop-infra repair.
# Defaults to revising_plan if no status_before_block field; revising
# if the slice was in awaiting_audit (impl-side repair).
determine_resume_target() {
  local slice_id="$1"
  local sbb
  sbb=$(read_slice_field "$slice_id" "status_before_block" 2>/dev/null || true)
  case "$sbb" in
    awaiting_audit) echo "revising" ;;
    *)              echo "revising_plan" ;;
  esac
}
