#!/usr/bin/env bash
# scripts/loop/lib/policy_check.sh
# §B.2 — Dispatcher-enforced approval policy controller.
#
# Usage:
#   policy_check.sh patch <slice-id> <patch-file>
#   policy_check.sh shell <slice-id> <command-string>
#
# Output (one line on stdout):
#   pass
#   require_approval:<reason>
#   forbidden:<reason>
#
# On require_approval, this script ALSO writes a JSON entry to
# $LOOP_STATE_DIR/pending_approvals/<slice-id>-<turn>.json so the queue is
# durable across runner restarts.
#
# Reads policy from $LOOP_MAIN_WORKTREE/.loop-rules/approval-policy.yaml.

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be set}"

policy_yaml="$LOOP_MAIN_WORKTREE/.loop-rules/approval-policy.yaml"
shell_parser="$LOOP_MAIN_WORKTREE/scripts/loop/lib/shell_parser.py"
pending_dir="$LOOP_STATE_DIR/pending_approvals"
mkdir -p "$pending_dir"

[[ -f "$policy_yaml" ]] || { echo "pass"; exit 0; }  # No policy → permissive (fail open is OK; setup seeds the file)
[[ -x "$shell_parser" ]] || { echo "ERROR: shell_parser.py missing" >&2; exit 2; }

kind="${1:-}"
slice_id="${2:-}"
target="${3:-}"
[[ -n "$kind" && -n "$slice_id" && -n "$target" ]] || {
  echo "Usage: policy_check.sh {patch|shell} <slice-id> <patch-file|command-string>" >&2
  exit 2
}

# Queue a pending-approval entry. Args: <slice-id> <reason> <kind> <change-summary>
_queue_approval() {
  local sid="$1" reason="$2" change_kind="$3" change_summary="$4"
  local turn
  turn=$(date +%s)
  local entry="$pending_dir/${sid}-${turn}.json"
  python3 - "$entry" "$sid" "$reason" "$change_kind" "$change_summary" "$turn" <<'PY'
import json, sys
entry, sid, reason, ck, cs, t = sys.argv[1:7]
with open(entry, "w") as fh:
  json.dump({
    "slice_id": sid,
    "turn": int(t),
    "reason": reason,
    "change_kind": ck,
    "change_summary": cs,
    "queued_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
  }, fh, indent=2)
PY
  echo "  queued: $entry" >&2
}

# Read policy lists.
_policy_list() {
  # Args: <section> <subsection>
  python3 - "$policy_yaml" "$1" "$2" <<'PY'
import sys, re, pathlib
path, section, subsection = sys.argv[1:4]
text = pathlib.Path(path).read_text()
out, in_sec, in_sub = [], False, False
sec_indent, sub_indent = None, None
for raw in text.splitlines():
  line = raw.rstrip()
  if not line or line.lstrip().startswith("#"): continue
  if line == section + ":":
    in_sec, in_sub = True, False
    continue
  if in_sec and re.match(r'^[a-z]', line):
    in_sec = False; in_sub = False
    if line == section + ":": in_sec = True
    continue
  if in_sec and line.startswith("  ") and not line.startswith("    "):
    in_sub = (line.strip().rstrip(":") == subsection)
    continue
  if in_sec and in_sub and line.startswith("    - "):
    val = line[6:].strip()
    if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
      val = val[1:-1].encode().decode("unicode_escape")
    elif len(val) >= 2 and val[0] == "'" and val[-1] == "'":
      val = val[1:-1]
    out.append(val)
for v in out: print(v)
PY
}

case "$kind" in
  patch)
    [[ -f "$target" ]] || { echo "ERROR: patch file not found: $target" >&2; exit 2; }
    patch_file="$target"

    # 1. Extract paths the patch touches.
    paths_in_patch="$(grep -E '^(\+\+\+|---) [ab]/' "$patch_file" | awk '{ sub(/^[ab]\//, "", $2); print $2 }' | sort -u | grep -v '^/dev/null$' || true)"

    # 2. forbidden.paths — match against globs.
    while IFS= read -r forbidden_glob; do
      [[ -z "$forbidden_glob" ]] && continue
      while IFS= read -r p; do
        [[ -z "$p" ]] && continue
        # Glob match: convert glob to regex.
        re="$(echo "$forbidden_glob" | sed 's|/\*\*|/.*|g; s|\*|[^/]*|g; s|\.|\\.|g')"
        if [[ "$p" =~ ^${re}$ ]]; then
          echo "forbidden:path=$forbidden_glob matched=$p"
          exit 0
        fi
      done <<< "$paths_in_patch"
    done < <(_policy_list forbidden paths)

    # 3. forbidden.patterns — match against patch hunks.
    while IFS= read -r pat; do
      [[ -z "$pat" ]] && continue
      if grep -E "$pat" "$patch_file" >/dev/null 2>&1; then
        echo "forbidden:patch_pattern=$pat"
        exit 0
      fi
    done < <(_policy_list forbidden patterns)

    # 4. require_approval.paths — match against globs.
    while IFS= read -r ra_glob; do
      [[ -z "$ra_glob" ]] && continue
      while IFS= read -r p; do
        [[ -z "$p" ]] && continue
        re="$(echo "$ra_glob" | sed 's|/\*\*|/.*|g; s|\*|[^/]*|g; s|\.|\\.|g')"
        if [[ "$p" =~ ^${re}$ ]]; then
          _queue_approval "$slice_id" "path=$ra_glob matched=$p" patch "$patch_file"
          echo "require_approval:path=$ra_glob matched=$p"
          exit 0
        fi
      done <<< "$paths_in_patch"
    done < <(_policy_list require_approval paths)

    # 5. require_approval.patch_patterns.
    while IFS= read -r pat; do
      [[ -z "$pat" ]] && continue
      if grep -E "$pat" "$patch_file" >/dev/null 2>&1; then
        _queue_approval "$slice_id" "patch_pattern=$pat" patch "$patch_file"
        echo "require_approval:patch_pattern=$pat"
        exit 0
      fi
    done < <(_policy_list require_approval patch_patterns)

    echo "pass"
    ;;
  shell)
    cmd="$target"
    result="$(python3 "$shell_parser" check-shell "$policy_yaml" "$cmd")"
    case "$result" in
      forbidden:*) echo "$result" ;;
      require_approval:*)
        _queue_approval "$slice_id" "${result#require_approval:}" shell "$cmd"
        echo "$result"
        ;;
      pass) echo "pass" ;;
      *) echo "ERROR: shell_parser returned unexpected result: $result" >&2; exit 2 ;;
    esac
    ;;
  *)
    echo "Usage: policy_check.sh {patch|shell} <slice-id> <target>" >&2
    exit 2
    ;;
esac
