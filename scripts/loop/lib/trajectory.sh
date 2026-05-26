# scripts/loop/lib/trajectory.sh
# §C.3 — Per-dispatch trajectory artifact.
#
# After a dispatch captures the agent's stdout/JSON output, copy it to a
# per-dispatch artifact path so triage_blocked_slice.sh can reference it.
# Tee target: $LOOP_STATE_DIR/dispatches/<slice-id>/<turn-n>.jsonl
#
# Turn numbering is monotonic per (slice, dispatch_kind). The runner
# rotates: after a slice reaches `done`, the slice's dispatches dir is
# pruned (handled by cleanup_slice_state).

: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be set}"

# Record a trajectory file for a dispatch.
# Args: <slice-id> <dispatch-kind> <source-capture-file>
# Returns the trajectory path on stdout.
record_trajectory() {
  local slice_id="$1" kind="$2" src="$3"
  local dir="$LOOP_STATE_DIR/dispatches/$slice_id"
  mkdir -p "$dir"
  # Find next turn number for this kind.
  local n=1
  while [[ -f "$dir/${kind}-${n}.jsonl" ]]; do
    n=$((n + 1))
  done
  local target="$dir/${kind}-${n}.jsonl"
  if [[ -f "$src" ]]; then
    cp "$src" "$target"
  else
    # Empty placeholder so triage knows the dispatch happened.
    : > "$target"
  fi
  echo "$target"
}

# List trajectory files for a slice (newest last).
# Args: <slice-id> [<kind-filter>]
list_trajectories() {
  local slice_id="$1" kind="${2:-}"
  local dir="$LOOP_STATE_DIR/dispatches/$slice_id"
  [[ -d "$dir" ]] || return 0
  if [[ -n "$kind" ]]; then
    find "$dir" -name "${kind}-*.jsonl" -type f | sort -V
  else
    find "$dir" -name '*.jsonl' -type f | sort -V
  fi
}

# Prune a slice's trajectory directory. Called by cleanup_slice_state after merge.
prune_slice_trajectories() {
  local slice_id="$1"
  rm -rf "$LOOP_STATE_DIR/dispatches/$slice_id"
}
