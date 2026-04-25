#!/usr/bin/env bash
# scripts/loop/loop_status.sh
# One-shot snapshot of the slice queue. Parses every slice file's frontmatter
# and prints a table.

set -e
cd "$(git rev-parse --show-toplevel)"

INDEX="diagnostic/slices/_index.md"
[[ -f "$INDEX" ]] || { echo "no slice index yet" ; exit 0; }

read_field() {
  local file="$1" key="$2"
  awk -v k="$key" '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == k":" { sub(/^[^:]+: */, ""); print; exit }
  ' "$file"
}

printf '%-6s %-50s %-18s %-8s %-10s\n' PHASE SLICE_ID STATUS OWNER APPROVAL
printf '%s\n' '-------------------------------------------------------------------------------------------------------'

while IFS= read -r sid; do
  [[ -z "$sid" ]] && continue
  f="diagnostic/slices/${sid}.md"
  if [[ ! -f "$f" ]]; then
    printf '%-6s %-50s %-18s %-8s %-10s\n' '?' "$sid" 'MISSING' '-' '-'
    continue
  fi
  phase=$(read_field "$f" phase)
  status=$(read_field "$f" status)
  owner=$(read_field "$f" owner)
  approval=$(read_field "$f" user_approval_required)
  printf '%-6s %-50s %-18s %-8s %-10s\n' "$phase" "$sid" "$status" "$owner" "$approval"
done < <(grep -oE '^- `[^`]+`' "$INDEX" | sed 's/^- `//; s/`$//')
