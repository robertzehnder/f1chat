#!/usr/bin/env bash
# scripts/loop/select_next_slice.sh
# Reads diagnostic/slices/_index.md (ordered list), parses each slice's
# frontmatter, and prints "slice_id owner status" for the first actionable
# slice. Empty output = nothing to do.
#
# A slice is "actionable" if status ∈ {pending, revising, awaiting_audit,
# blocked, ready_to_merge}. Pending+approval-required slices wait on a
# sentinel file at diagnostic/slices/.approved/<slice_id>.

set -e
cd "$(git rev-parse --show-toplevel)"

INDEX="diagnostic/slices/_index.md"
APPROVED_DIR="diagnostic/slices/.approved"

[[ -f "$INDEX" ]] || { exit 0; }

# Tiny YAML-frontmatter reader: everything between leading "---" lines.
read_field() {
  local file="$1" key="$2"
  awk -v k="$key" '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == k":" { sub(/^[^:]+: */, ""); print; exit }
  ' "$file"
}

# Extract slice ids from _index.md (lines starting with "- `<id>`") and walk in order.
# Portable across bash 3.2 (macOS) — no mapfile.
while IFS= read -r sid; do
  [[ -z "$sid" ]] && continue
  f="diagnostic/slices/${sid}.md"
  [[ -f "$f" ]] || continue

  status=$(read_field "$f" status)
  owner=$(read_field "$f" owner)
  approval=$(read_field "$f" user_approval_required)

  case "$status" in
    done|"")
      continue
      ;;
    pending_plan_audit)
      # Plan-audit phase: Codex reviews the slice file for plan bugs before
      # any implementation work runs.
      echo "$sid codex $status"
      exit 0
      ;;
    revising_plan)
      # Plan-revise phase: Claude addresses Codex's triaged action items by
      # editing the slice file, then flips status back to pending_plan_audit
      # for re-audit.
      echo "$sid claude $status"
      exit 0
      ;;
    pending|revising)
      # Approval-required pending slices wait on sentinel — unless the user
      # set LOOP_AUTO_APPROVE=1 in the runner's environment, which waives all
      # approval gates (suitable for low-risk personal projects).
      if [[ "$status" == "pending" && "$approval" == "yes" && "${LOOP_AUTO_APPROVE:-0}" != "1" ]]; then
        if [[ ! -f "${APPROVED_DIR}/${sid}" ]]; then
          continue
        fi
      fi
      echo "$sid claude $status"
      exit 0
      ;;
    awaiting_audit)
      echo "$sid codex $status"
      exit 0
      ;;
    ready_to_merge|blocked)
      echo "$sid user $status"
      exit 0
      ;;
  esac
done < <(grep -oE '^- `[^`]+`' "$INDEX" | sed 's/^- `//; s/`$//')

# Nothing actionable.
exit 0
