# scripts/loop/lib/proposal_helpers.sh
# Proposal-branch sandbox primitives (§A.1).
#
# Replaces the slice/<id> single-branch model with slice/<id>/proposal-<n>.
# n=1 by default; n>1 is reserved for §C.1 speculative variants. Worktrees
# live at $WORKTREE_BASE/<slice_id>-proposal-<n>/ to avoid colliding with
# any legacy slice/<id> worktrees still on disk.
#
# Sourced by: dispatch_merger.sh, dispatch_claude.sh, dispatch_codex.sh,
#             dispatch_speculative_fork.sh (future §C.1).
#
# Required env (exported by runner.sh):
#   LOOP_MAIN_WORKTREE  — absolute path to the main worktree
#   LOOP_STATE_DIR      — absolute path to runner's state dir
#   WORKTREE_BASE       — absolute path under which per-proposal worktrees live
#                         (defaults to ~/.openf1-loop-worktrees per worktree_helpers.sh)

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be set (absolute path)}"

# Compute the proposal branch name for a slice.
# Args: <slice_id> [<n>]   (n defaults to 1)
proposal_branch_name() {
  local slice_id="$1" n="${2:-1}"
  printf 'slice/%s/proposal-%s' "$slice_id" "$n"
}

# Compute the proposal worktree path.
# Args: <slice_id> [<n>]
proposal_worktree_path() {
  local slice_id="$1" n="${2:-1}"
  printf '%s/%s-proposal-%s' "${WORKTREE_BASE:-$HOME/.openf1-loop-worktrees}" "$slice_id" "$n"
}

# Read the proposal_branch frontmatter field from a slice file (in the main worktree).
# Returns empty string if the field is absent (legacy slices use slice/<id>).
# Args: <slice_id>
read_proposal_branch() {
  local slice_id="$1"
  local f="$LOOP_MAIN_WORKTREE/diagnostic/slices/${slice_id}.md"
  [[ -f "$f" ]] || return 1
  awk '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == "proposal_branch:" { sub(/^[^:]+: */, ""); print; exit }
  ' "$f"
}

# Effective proposal branch — falls back to slice/<id> if frontmatter field is missing
# (backward compat with slices created before §A.1).
# Args: <slice_id> [<n>]
effective_proposal_branch() {
  local slice_id="$1" n="${2:-1}"
  local declared
  declared="$(read_proposal_branch "$slice_id")"
  if [[ -n "$declared" ]]; then
    printf '%s' "$declared"
  else
    proposal_branch_name "$slice_id" "$n"
  fi
}

# Create a proposal worktree for slice at branch slice/<id>/proposal-<n>.
# Branch is forked from integration/perf-roadmap. Idempotent — re-attaches if
# the branch already exists.
# Echoes: the worktree path on stdout.
# Args: <slice_id> [<n>]
create_proposal_worktree() {
  local slice_id="$1" n="${2:-1}"
  local branch worktree
  branch="$(proposal_branch_name "$slice_id" "$n")"
  worktree="$(proposal_worktree_path "$slice_id" "$n")"

  mkdir -p "$(dirname "$worktree")"

  # If the directory exists but git doesn't know it, prune.
  if [[ -d "$worktree" ]]; then
    if ! git -C "$LOOP_MAIN_WORKTREE" worktree list --porcelain \
        | grep -Fq "worktree $worktree"; then
      ( cd "$LOOP_MAIN_WORKTREE" && git worktree prune ) >/dev/null 2>&1 || true
      rm -rf "$worktree"
    fi
  fi

  if [[ ! -d "$worktree" ]]; then
    if git -C "$LOOP_MAIN_WORKTREE" show-ref --verify --quiet "refs/heads/$branch" \
       || git -C "$LOOP_MAIN_WORKTREE" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      git -C "$LOOP_MAIN_WORKTREE" worktree add "$worktree" "$branch" >/dev/null
    else
      git -C "$LOOP_MAIN_WORKTREE" worktree add "$worktree" -b "$branch" integration/perf-roadmap >/dev/null
    fi
  fi

  echo "$worktree"
}

# Remove a proposal's worktree (and any orphaned dirs). Idempotent.
# Does NOT delete the branch — the merger does that after merge.
# Args: <slice_id> [<n>]
cleanup_proposal_worktree() {
  local slice_id="$1" n="${2:-1}"
  local worktree
  worktree="$(proposal_worktree_path "$slice_id" "$n")"
  if [[ -d "$worktree" ]]; then
    ( cd "$LOOP_MAIN_WORKTREE" && git worktree remove "$worktree" --force ) 2>/dev/null \
      || rm -rf "$worktree"
  fi
  ( cd "$LOOP_MAIN_WORKTREE" && git worktree prune ) 2>/dev/null || true
}

# Append an entry to the slice's merge_attempts frontmatter list.
# Args: <slice_id> <attempt_n> <strategy> <result>
record_merge_attempt() {
  local slice_id="$1" attempt="$2" strategy="$3" result="$4"
  local work_dir="${WORKING_DIR:-$LOOP_MAIN_WORKTREE}"
  local f="$work_dir/diagnostic/slices/${slice_id}.md"
  [[ -f "$f" ]] || { echo "record_merge_attempt: missing $f" >&2; return 1; }

  python3 - "$f" "$attempt" "$strategy" "$result" <<'PY'
import sys, re
path, attempt, strategy, result = sys.argv[1:5]
with open(path) as fh: text = fh.read()
m = re.match(r'^---\n(.*?)\n---\n', text, flags=re.S)
if not m: sys.exit("no frontmatter in " + path)
fm = m.group(1)
entry = f"  - attempt: {attempt}\n    strategy: {strategy}\n    result: {result}"
if re.search(r'^merge_attempts:\s*$', fm, flags=re.M):
  # Field already present; append entry.
  fm = re.sub(r'(^merge_attempts:\s*\n)', r'\1' + entry + '\n', fm, count=1, flags=re.M)
elif re.search(r'^merge_attempts:', fm, flags=re.M):
  # Field has inline value or single-line — convert to list form (rare path).
  fm = re.sub(r'^merge_attempts:.*$', f'merge_attempts:\n{entry}', fm, count=1, flags=re.M)
else:
  fm = fm.rstrip() + '\nmerge_attempts:\n' + entry
new = '---\n' + fm + '\n---\n' + text[m.end():]
with open(path, 'w') as fh: fh.write(new)
PY
}
