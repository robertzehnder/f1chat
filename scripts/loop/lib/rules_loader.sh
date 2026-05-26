#!/usr/bin/env bash
# scripts/loop/lib/rules_loader.sh
# §C.2 — Path-scoped rules loader.
#
# Globs the slice's "Changed files expected" list against each .loop-rules/*.md
# file's `paths:` frontmatter; concatenates matching rule bodies into a
# markdown block the dispatcher injects into the agent's system prompt.
#
# Usage:
#   rules_loader.sh <slice-id>
#       Echo a concatenated markdown block of matching rules to stdout.
#
# Source (function form):
#   load_rules_for_slice <slice-id>
#       Prints the same block; usable in dispatcher subshells.

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set}"

load_rules_for_slice() {
  local slice_id="$1"
  local rules_dir="$LOOP_MAIN_WORKTREE/.loop-rules"
  local slice_file="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
  [[ -d "$rules_dir" ]] || return 0
  [[ -f "$slice_file" ]] || return 0

  # Extract the slice's touched paths from "Changed files expected".
  local touched
  touched="$(awk '
    /^## Changed files expected$/ { in_section = 1; next }
    /^## / && in_section { exit }
    in_section && /^- `[^`]+`/ {
      match($0, /`[^`]+`/);
      print substr($0, RSTART+1, RLENGTH-2);
    }
  ' "$slice_file")"

  # For each .md rule file with `paths:` frontmatter, check if any touched path
  # matches any glob. If yes, emit the body (post-frontmatter).
  shopt -s nullglob
  for rule in "$rules_dir"/*.md; do
    python3 - "$rule" "$touched" <<'PY'
import sys, re, fnmatch
rule_path, touched_blob = sys.argv[1], sys.argv[2]
text = open(rule_path).read()
m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, flags=re.S)
if not m:
  sys.exit(0)
fm, body = m.group(1), m.group(2)
# Parse paths: [list].
pm = re.search(r'paths:\s*\[(.*?)\]', fm, flags=re.S)
if not pm:
  sys.exit(0)
patterns = [p.strip().strip('"').strip("'") for p in pm.group(1).split(",") if p.strip()]
touched_paths = [p for p in touched_blob.splitlines() if p]
matched = False
for tp in touched_paths:
  for pat in patterns:
    # Glob-style matching with ** support.
    if fnmatch.fnmatch(tp, pat) or fnmatch.fnmatch(tp, pat.replace("**", "*")):
      matched = True; break
    # Also support ** as recursive: convert to regex.
    re_pat = re.escape(pat).replace(r"\*\*", ".*").replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
    if re.fullmatch(re_pat, tp):
      matched = True; break
  if matched: break
if not matched:
  sys.exit(0)
import os
title = os.path.basename(rule_path).replace(".md", "")
print(f"\n<!-- rule: {title} -->")
print(body.rstrip())
PY
  done
}

# --- CLI dispatch ------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  slice_id="${1:?Usage: $0 <slice-id>}"
  load_rules_for_slice "$slice_id"
fi
