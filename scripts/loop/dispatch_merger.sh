#!/usr/bin/env bash
# scripts/loop/dispatch_merger.sh
# Auto-merger: when a slice is status=ready_to_merge, merge slice/<id> into
# integration/perf-roadmap, flip status to done, push, and clean up.
#
# Item 2 (round-12) — entire merger flow runs under one repo lock, with
# hardened conflict policy (round-2 M-7) keyed off the slice's
# "Changed files expected" list. Plus regression gate hooks (Item 10).
# Merger now also calls cleanup_slice_state to purge stale attempt-N
# sentinels (round-11 L).
#
# Approval-flagged slices STILL require a user-touched
# diagnostic/slices/.approved-merge/<slice_id> sentinel before this runs.

set -euo pipefail

: "${LOOP_MAIN_WORKTREE:?LOOP_MAIN_WORKTREE must be exported by runner}"
: "${LOOP_STATE_DIR:?LOOP_STATE_DIR must be exported by runner}"

cd "$LOOP_MAIN_WORKTREE"

# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/repo_lock.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/worktree_helpers.sh"
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/slice_helpers.sh"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
slice_branch="slice/${slice_id}"
LOG="$LOOP_STATE_DIR/runner.log"
approved_merge_sentinel="diagnostic/slices/.approved-merge/${slice_id}"

stamp() { date -Iseconds; }
logmsg() { printf '[%s] auto_merger %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$LOG"; }

logmsg begin

# Conflict policy (round-2 M-7).
INTEGRATION_OWNED_PATHS=(
  "scripts/loop/"
  "scripts/loop/prompts/"
  "diagnostic/_state.md"
  "diagnostic/slices/_index.md"
  ".github/"
  ".gitignore"
)
SLICE_PLAUSIBLE_PATHS=(
  "web/"
  "src/"
  "sql/"
  "diagnostic/artifacts/"
)

# Check whether path P is in the slice's "Changed files expected".
path_in_changed_files_expected() {
  local p="$1" slice_file_path="$2"
  awk '
    /^## Changed files expected$/ { in_section = 1; next }
    /^## / && in_section { exit }
    in_section && /^- `[^`]+`/ {
      match($0, /`[^`]+`/);
      path = substr($0, RSTART+1, RLENGTH-2);
      print path;
    }
  ' "$slice_file_path" | grep -Fxq "$p"
}

resolve_conflict() {
  local p="$1" slice_file_path="$2"
  if path_in_changed_files_expected "$p" "$slice_file_path"; then
    git checkout --theirs -- "$p"; git add "$p"
    logmsg "auto-resolved $p with slice version (declared in Changed files expected)"
    return 0
  fi
  for prefix in "${INTEGRATION_OWNED_PATHS[@]}"; do
    if [[ "$p" == "$prefix"* || "$p" == "$prefix" ]]; then
      git checkout --ours -- "$p"; git add "$p"
      logmsg "auto-took integration version of $p (slice touched protected path)"
      return 0
    fi
  done
  for prefix in "${SLICE_PLAUSIBLE_PATHS[@]}"; do
    if [[ "$p" == "$prefix"* ]]; then
      logmsg "ambiguous-slice-owned conflict in $p (not in Changed files expected); cannot auto-resolve"
      return 1
    fi
  done
  logmsg "fully-unexpected conflict in $p; cannot auto-resolve"
  return 1
}

# Read frontmatter status + approval flag (with worktree-relative path).
read_field() {
  awk -v k="$1" '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == k":" { sub(/^[^:]+: */, ""); print; exit }
  ' "$slice_file"
}
status=$(read_field status)
approval=$(read_field user_approval_required)

if [[ "$status" != "ready_to_merge" ]]; then
  logmsg "skip: status=$status (expected ready_to_merge)"
  exit 0
fi

if [[ "$approval" == "yes" && ! -f "$approved_merge_sentinel" && "${LOOP_AUTO_APPROVE:-0}" != "1" ]]; then
  logmsg "BLOCKED: user_approval_required=yes but no sentinel at $approved_merge_sentinel"
  exit 0
fi

# Confirm slice branch exists. Worktree's branch may have been pushed only.
if ! git rev-parse --verify "$slice_branch" >/dev/null 2>&1; then
  if git ls-remote --exit-code --heads origin "$slice_branch" >/dev/null 2>&1; then
    logmsg "fetching slice branch $slice_branch from origin"
    git fetch origin "$slice_branch":"$slice_branch" 2>/dev/null || true
  fi
fi
if ! git rev-parse --verify "$slice_branch" >/dev/null 2>&1; then
  logmsg "FAIL: $slice_branch does not exist locally or on origin"
  exit 1
fi

# ============================================================
# Locked merge + regression-gate + push + state-update + cleanup
# ============================================================
do_merge_under_lock() {
  # Ensure on integration; main worktree should already be — runner stays here.
  current=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$current" != "integration/perf-roadmap" ]]; then
    if [[ -n "$(git status --porcelain)" ]]; then
      logmsg "FAIL: dirty worktree on $current; cannot switch"
      return 1
    fi
    git checkout integration/perf-roadmap >/dev/null 2>&1
  fi

  git pull --ff-only origin integration/perf-roadmap 2>/dev/null || true

  logmsg "merging $slice_branch (attempt 1: direct)"
  if git merge --no-ff "$slice_branch" -m "merge: $slice_id [pass]"; then
    logmsg "merge attempt 1 succeeded"
  else
    conflicts=$(git diff --name-only --diff-filter=U)
    logmsg "merge attempt 1 produced conflicts in: $(echo "$conflicts" | tr '\n' ' ')"
    local recoverable=1
    while IFS= read -r conflicted; do
      [[ -z "$conflicted" ]] && continue
      if ! resolve_conflict "$conflicted" "$slice_file"; then
        recoverable=0; break
      fi
    done <<EOF_CONFLICTS
$conflicts
EOF_CONFLICTS

    if [[ "$recoverable" != "1" ]]; then
      git merge --abort 2>/dev/null || true
      logmsg "FAIL: merge unrecoverable; aborted"
      return 1
    fi

    if ! git commit --no-edit; then
      logmsg "FAIL: merge commit refused even after auto-resolution; aborting"
      git merge --abort 2>/dev/null || true
      return 1
    fi
    logmsg "merge attempt 1 succeeded after conflict auto-resolution"
  fi

  # ===== REGRESSION GATE =====
  # Always-on cheap gates. Phase-boundary heavy gates can be wired here later.
  local gate_failed=""
  if ! bash -n scripts/loop/*.sh 2>/dev/null; then
    gate_failed="bash-syntax"
  fi
  if [[ -z "$gate_failed" ]] && [[ -x scripts/loop/loop_status.sh ]]; then
    if ! scripts/loop/loop_status.sh >/dev/null 2>&1; then
      gate_failed="loop_status"
    fi
  fi

  if [[ -n "$gate_failed" ]]; then
    logmsg "REGRESSION: gate '$gate_failed' failed; rolling back local merge"

    # 1. Local-only rollback.
    git reset --hard ORIG_HEAD

    # 2. Update integration's slice file to blocked + regression note.
    sed -i.bak 's/^status: ready_to_merge$/status: blocked/; s/^owner: user$/owner: user/' "$slice_file"
    rm -f "${slice_file}.bak"

    cat >> "$slice_file" <<EOF

## Regression detected (auto-merger)
Slice merge produced a regression that failed phase-boundary gates.
Local merge has been reset; this status flip preserves visibility for the
runner. See git log on slice branch for the original audit verdict trail.
- Failed gate: ${gate_failed}
- Detected at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

    git add "$slice_file"
    git commit -m "regression: mark $slice_id blocked after merger gate failure

[slice:${slice_id}][regression-revert]" >/dev/null 2>&1 || true

    if ! git push >/dev/null 2>&1; then
      echo "$(git rev-parse HEAD)" > "$LOOP_STATE_DIR/regression_pending_push"
      logmsg "regression: push failed; pending sentinel set"
    fi

    logmsg "REGRESSION slice=$slice_id gate=${gate_failed}"
    return 1
  fi

  # Flip frontmatter: ready_to_merge → done; owner → -
  sed -i.bak 's/^status: ready_to_merge$/status: done/' "$slice_file"
  sed -i.bak 's/^owner: user$/owner: -/' "$slice_file"
  rm -f "${slice_file}.bak"
  git add "$slice_file"
  git commit -m "chore: mark $slice_id done after auto-merge

[slice:${slice_id}][done][auto-merger]" >/dev/null 2>&1

  # Single push: includes merge + done commit.
  if ! git push >/dev/null 2>&1; then
    logmsg "WARN: push failed (will retry on next tick)"
    return 1
  fi

  # Delete slice branch (local + remote).
  git branch -D "$slice_branch" >/dev/null 2>&1 || true
  if git ls-remote --exit-code --heads origin "$slice_branch" >/dev/null 2>&1; then
    git push origin --delete "$slice_branch" >/dev/null 2>&1 || true
  fi

  # Clean up the approval-merge sentinel if it existed.
  [[ -f "$approved_merge_sentinel" ]] && rm -f "$approved_merge_sentinel"

  # Clean up the slice's worktree.
  cleanup_slice_worktree "$slice_id"

  # Round-11 L: purge per-slice state files AND any stale loop-infra-repair
  # attempt-N sentinels for this slice.
  cleanup_slice_state "$slice_id"

  return 0
}

with_repo_lock "merger:$slice_id" do_merge_under_lock || {
  logmsg "merger returned non-zero; check log"
  exit 1
}

# State update (separate commit + push). Best-effort; merger has already pushed.
if [[ -x scripts/loop/update_state.sh ]]; then
  with_repo_lock "merger:$slice_id:state" \
    scripts/loop/update_state.sh >>"$LOG" 2>&1 || logmsg "WARN: update_state.sh failed; continuing"
fi

logmsg "merged and pushed; slice marked done"
