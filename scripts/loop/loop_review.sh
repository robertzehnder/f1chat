#!/usr/bin/env bash
# scripts/loop/loop_review.sh
# §B.2 — human-triage CLI for the dispatcher-enforced approval queue.
#
# Usage:
#   loop_review.sh --list                List all pending approvals (grouped by slice)
#   loop_review.sh --approve <slice-id>  Release approvals; flip status to status_before_block
#   loop_review.sh --reject <slice-id>   Discard approvals; flip status to blocked
#
# Pending-approval entries live at $LOOP_STATE_DIR/pending_approvals/<slice-id>-<turn>.json.
# Each entry was created by policy_check.sh when a slice_* wrapper hit a
# require_approval rule. The runner blocks slices with pending entries from
# advancing past awaiting_human_review; the merger refuses to merge.

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Resolve LOOP_MAIN_WORKTREE + LOOP_STATE_DIR if not exported (interactive use).
: "${LOOP_MAIN_WORKTREE:=$(pwd)}"
: "${LOOP_STATE_DIR:=$LOOP_MAIN_WORKTREE/.loop-state}"
export LOOP_MAIN_WORKTREE LOOP_STATE_DIR

pending_dir="$LOOP_STATE_DIR/pending_approvals"
mkdir -p "$pending_dir"

# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/slice_helpers.sh"

cmd_list() {
  local entries
  entries=$(find "$pending_dir" -maxdepth 1 -name '*.json' -type f 2>/dev/null | sort)
  if [[ -z "$entries" ]]; then
    echo "No pending approvals."
    return 0
  fi

  # Group by slice (filename prefix before -<turn>.json).
  local last_slice=""
  while IFS= read -r entry; do
    local base sid
    base="$(basename "$entry" .json)"
    sid="${base%-*}"     # strip the trailing -<turn>
    if [[ "$sid" != "$last_slice" ]]; then
      [[ -n "$last_slice" ]] && echo
      echo "=== slice: $sid ==="
      # Show slice's current status for context.
      local sf="$LOOP_MAIN_WORKTREE/diagnostic/slices/${sid}.md"
      if [[ -f "$sf" ]]; then
        local status
        status="$(awk '/^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next } fm && /^status:/ { sub(/^[^:]+: */, ""); print; exit }' "$sf")"
        echo "  current status: $status"
      fi
      last_slice="$sid"
    fi
    echo "  - entry: $entry"
    python3 - "$entry" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for k in ("turn", "reason", "change_kind", "change_summary", "queued_at"):
  v = d.get(k, "?")
  print(f"    {k}: {v}")
PY
  done <<< "$entries"
}

_pending_entries_for_slice() {
  local sid="$1"
  find "$pending_dir" -maxdepth 1 -name "${sid}-*.json" -type f 2>/dev/null
}

cmd_approve() {
  local sid="$1"
  local entries
  entries=$(_pending_entries_for_slice "$sid")
  if [[ -z "$entries" ]]; then
    echo "No pending approvals for slice $sid." >&2
    return 1
  fi
  local sf="$LOOP_MAIN_WORKTREE/diagnostic/slices/${sid}.md"
  [[ -f "$sf" ]] || { echo "ERROR: slice file not found: $sf" >&2; return 2; }

  # Read status_before_block from the slice file. If absent, refuse to guess.
  local prior
  prior="$(awk '/^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next } fm && /^status_before_block:/ { sub(/^[^:]+: */, ""); print; exit }' "$sf")"
  if [[ -z "$prior" ]]; then
    echo "ERROR: $sf has no status_before_block field; cannot determine the restore status." >&2
    echo "  Manually flip the slice's status, then remove the pending_approvals entries." >&2
    return 3
  fi

  # Flip status back to prior; clear status_before_block.
  flip_slice_status "$sid" "$prior" claude
  clear_slice_field "$sid" status_before_block

  # Remove pending entries.
  while IFS= read -r entry; do
    rm -f "$entry"
  done <<< "$entries"

  echo "Approved $sid → status=$prior; cleared status_before_block; removed $(echo "$entries" | wc -l | tr -d ' ') pending entries."
}

cmd_reject() {
  local sid="$1"
  local entries
  entries=$(_pending_entries_for_slice "$sid")
  if [[ -z "$entries" ]]; then
    echo "No pending approvals for slice $sid." >&2
    return 1
  fi
  local sf="$LOOP_MAIN_WORKTREE/diagnostic/slices/${sid}.md"
  [[ -f "$sf" ]] || { echo "ERROR: slice file not found: $sf" >&2; return 2; }

  # Flip status to blocked; keep status_before_block (for repair triage).
  flip_slice_status "$sid" blocked user

  while IFS= read -r entry; do
    rm -f "$entry"
  done <<< "$entries"

  echo "Rejected $sid → status=blocked; kept status_before_block for repair routing; removed $(echo "$entries" | wc -l | tr -d ' ') pending entries."
}

case "${1:-}" in
  --list)    cmd_list ;;
  --approve) shift; [[ -n "${1:-}" ]] || { echo "Usage: $0 --approve <slice-id>" >&2; exit 2; }; cmd_approve "$1" ;;
  --reject)  shift; [[ -n "${1:-}" ]] || { echo "Usage: $0 --reject <slice-id>" >&2; exit 2; }; cmd_reject "$1" ;;
  -h|--help|"")
    cat <<USAGE
Usage:
  $0 --list                 List all pending approvals (grouped by slice)
  $0 --approve <slice-id>   Release approvals; flip status to status_before_block
  $0 --reject <slice-id>    Discard approvals; flip status to blocked
USAGE
    ;;
  *) echo "Unknown command: $1" >&2; exit 2 ;;
esac
