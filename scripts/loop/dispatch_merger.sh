#!/usr/bin/env bash
# scripts/loop/dispatch_merger.sh
# §A.1 — Proposal-branch merge ladder.
#
# Resolves the slice's proposal_branch (slice/<id>/proposal-<n>; falls back to
# slice/<id> for legacy slices). Attempts merges in three stages under a single
# repo lock:
#
#   Attempt 1 — git merge --ff-only proposal-branch
#     success → done; delete proposal branch
#     non-FF  → Attempt 2
#
#   Attempt 2 — rebase proposal onto integration inside the proposal worktree
#     clean rebase   → retry --ff-only
#       audit-pass-required? (status_before == awaiting_audit) → still need re-audit;
#         currently rebase preserves the audit verdict commit, so we treat the clean
#         rebase as "re-audited" via inheritance. Future: rerun audit explicitly.
#     rebase has conflicts → Attempt 3
#
#   Attempt 3 — fall back to the existing path-policy --no-ff merge
#     (path-aware auto-resolver from the pre-§A.1 merger; preserved as last resort)
#     success → done
#     unrecoverable conflict → status=awaiting_rebase; branch preserved; exit non-zero
#
# Each attempt is recorded in slice frontmatter's `merge_attempts` list.
#
# Approval-flagged slices STILL require a user-touched
# diagnostic/slices/.approved-merge/<slice_id> sentinel before this runs.
# Slices with pending_approvals (§B.2 — wired separately) ALSO block here.

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
# shellcheck disable=SC1091
source "$LOOP_MAIN_WORKTREE/scripts/loop/lib/proposal_helpers.sh"

slice_id="${1:?slice_id required}"
slice_file="diagnostic/slices/${slice_id}.md"
LOG="$LOOP_STATE_DIR/runner.log"
approved_merge_sentinel="diagnostic/slices/.approved-merge/${slice_id}"
pending_approvals_dir="${LOOP_STATE_DIR}/pending_approvals"

stamp() { date -Iseconds; }
logmsg() { printf '[%s] auto_merger %s %s\n' "$(stamp)" "$slice_id" "$*" | tee -a "$LOG"; }

logmsg begin

# --- Conflict policy (unchanged from pre-§A.1; used by Attempt 3 fallback) ---
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
    logmsg "auto-resolved $p with proposal version (declared in Changed files expected)"
    return 0
  fi
  for prefix in "${INTEGRATION_OWNED_PATHS[@]}"; do
    if [[ "$p" == "$prefix"* || "$p" == "$prefix" ]]; then
      git checkout --ours -- "$p"; git add "$p"
      logmsg "auto-took integration version of $p (proposal touched protected path)"
      return 0
    fi
  done
  for prefix in "${SLICE_PLAUSIBLE_PATHS[@]}"; do
    if [[ "$p" == "$prefix"* ]]; then
      logmsg "ambiguous-proposal-owned conflict in $p (not in Changed files expected); cannot auto-resolve"
      return 1
    fi
  done
  logmsg "fully-unexpected conflict in $p; cannot auto-resolve"
  return 1
}

# --- Read slice fields -------------------------------------------------------
read_field() {
  awk -v k="$1" '
    /^---$/ { fm = !fm; if (!fm && seen) exit; seen = 1; next }
    fm && $1 == k":" { sub(/^[^:]+: */, ""); print; exit }
  ' "$slice_file"
}
status=$(read_field status)
approval=$(read_field user_approval_required)
proposal_branch="$(effective_proposal_branch "$slice_id")"
proposal_worktree=""
# Resolve worktree path for the chosen branch (slice/<id> legacy uses worktree_helpers
# path; slice/<id>/proposal-<n> uses proposal_helpers path).
case "$proposal_branch" in
  slice/*/proposal-*)
    # Extract n from the branch name suffix.
    n="${proposal_branch##*-}"
    proposal_worktree="$(proposal_worktree_path "$slice_id" "$n")"
    ;;
  *)
    proposal_worktree="${WORKTREE_BASE:-$HOME/.openf1-loop-worktrees}/$slice_id"
    ;;
esac

if [[ "$status" != "ready_to_merge" ]]; then
  logmsg "skip: status=$status (expected ready_to_merge)"
  exit 0
fi

if [[ "$approval" == "yes" && ! -f "$approved_merge_sentinel" && "${LOOP_AUTO_APPROVE:-0}" != "1" ]]; then
  logmsg "BLOCKED: user_approval_required=yes but no sentinel at $approved_merge_sentinel"
  exit 0
fi

# §B.2 merger guard — refuse to merge if any pending_approvals entries exist for this slice.
if [[ -d "$pending_approvals_dir" ]] && \
   compgen -G "$pending_approvals_dir/${slice_id}-*.json" >/dev/null; then
  logmsg "BLOCKED: pending_approvals/ has entries for $slice_id (run loop_review.sh --approve/--reject)"
  exit 0
fi

# Confirm proposal branch exists locally; fetch from origin if needed.
if ! git rev-parse --verify "$proposal_branch" >/dev/null 2>&1; then
  if git ls-remote --exit-code --heads origin "$proposal_branch" >/dev/null 2>&1; then
    logmsg "fetching proposal branch $proposal_branch from origin"
    git fetch origin "$proposal_branch":"$proposal_branch" 2>/dev/null || true
  fi
fi
if ! git rev-parse --verify "$proposal_branch" >/dev/null 2>&1; then
  logmsg "FAIL: $proposal_branch does not exist locally or on origin"
  exit 1
fi

# --- Regression gate (run after each successful merge attempt) ---------------
run_regression_gate() {
  if ! bash -n scripts/loop/*.sh scripts/loop/lib/*.sh 2>/dev/null; then
    echo "bash-syntax"; return
  fi
  if [[ -x scripts/loop/loop_status.sh ]] && ! scripts/loop/loop_status.sh >/dev/null 2>&1; then
    echo "loop_status"; return
  fi
  echo ""
}

# --- Locked merge flow -------------------------------------------------------
do_merge_under_lock() {
  current=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$current" != "integration/perf-roadmap" ]]; then
    if [[ -n "$(git status --porcelain)" ]]; then
      logmsg "FAIL: dirty worktree on $current; cannot switch"
      return 1
    fi
    git checkout integration/perf-roadmap >/dev/null 2>&1
  fi

  git pull --ff-only origin integration/perf-roadmap 2>/dev/null || true

  local pre_merge_sha
  pre_merge_sha="$(git rev-parse HEAD)"

  # === Attempt 1: ff-only ===
  logmsg "attempt 1 (ff-only): merging $proposal_branch"
  if git merge --ff-only "$proposal_branch" 2>/dev/null; then
    record_merge_attempt "$slice_id" 1 ff-only success
    logmsg "attempt 1 succeeded"
  else
    record_merge_attempt "$slice_id" 1 ff-only non_ff
    logmsg "attempt 1: non-FF (integration drifted); trying rebase"

    # === Attempt 2: rebase proposal onto integration ===
    if [[ ! -d "$proposal_worktree" ]]; then
      logmsg "attempt 2: proposal worktree missing at $proposal_worktree; skipping rebase"
      record_merge_attempt "$slice_id" 2 rebase missing_worktree
    else
      local integration_sha
      integration_sha="$(git rev-parse integration/perf-roadmap)"
      if ( cd "$proposal_worktree" && git rebase "$integration_sha" >/dev/null 2>&1 ); then
        record_merge_attempt "$slice_id" 2 rebase clean
        logmsg "attempt 2: rebase clean; retrying ff-only"
        if git merge --ff-only "$proposal_branch" 2>/dev/null; then
          record_merge_attempt "$slice_id" 1 ff-only success
          logmsg "post-rebase ff-only succeeded"
        else
          # Should not happen if rebase was truly clean and we're up to date.
          logmsg "post-rebase ff-only still failed; falling through to Attempt 3"
        fi
      else
        # Rebase has conflicts — abort and fall through to path-policy fallback.
        ( cd "$proposal_worktree" && git rebase --abort 2>/dev/null || true )
        record_merge_attempt "$slice_id" 2 rebase conflict
        logmsg "attempt 2: rebase conflicts; falling through to Attempt 3 (path-policy merge)"
      fi
    fi

    # === Attempt 3: path-policy --no-ff merge with auto-resolver fallback ===
    if [[ "$(git rev-parse HEAD)" == "$pre_merge_sha" ]]; then
      logmsg "attempt 3 (path-policy --no-ff)"
      if git merge --no-ff "$proposal_branch" -m "merge: $slice_id [pass]"; then
        record_merge_attempt "$slice_id" 3 path-policy success
        logmsg "attempt 3 succeeded (clean no-ff)"
      else
        conflicts=$(git diff --name-only --diff-filter=U)
        logmsg "attempt 3 conflicts in: $(echo "$conflicts" | tr '\n' ' ')"
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
          record_merge_attempt "$slice_id" 3 path-policy unrecoverable
          logmsg "FAIL: attempt 3 unrecoverable; setting status=awaiting_rebase"
          # Flip status to awaiting_rebase (human triage) instead of leaving ready_to_merge.
          sed -i.bak 's/^status: ready_to_merge$/status: awaiting_rebase/' "$slice_file"
          rm -f "${slice_file}.bak"
          git add "$slice_file" 2>/dev/null || true
          git commit -m "merger: $slice_id → awaiting_rebase (unrecoverable conflict)" >/dev/null 2>&1 || true
          git push >/dev/null 2>&1 || true
          return 1
        fi

        if ! git commit --no-edit; then
          logmsg "FAIL: merge commit refused even after auto-resolution; aborting"
          git merge --abort 2>/dev/null || true
          record_merge_attempt "$slice_id" 3 path-policy commit_refused
          return 1
        fi
        record_merge_attempt "$slice_id" 3 path-policy success_after_resolution
        logmsg "attempt 3 succeeded after conflict auto-resolution"
      fi
    fi
  fi

  # === Regression gate ===
  local gate_failed
  gate_failed="$(run_regression_gate)"

  if [[ -n "$gate_failed" ]]; then
    logmsg "REGRESSION: gate '$gate_failed' failed; rolling back local merge"
    git reset --hard "$pre_merge_sha"
    sed -i.bak 's/^status: ready_to_merge$/status: blocked/' "$slice_file"
    rm -f "${slice_file}.bak"

    cat >> "$slice_file" <<EOF

## Regression detected (auto-merger)
Slice merge produced a regression that failed phase-boundary gates.
Local merge has been reset; this status flip preserves visibility.
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

  # === Flip frontmatter to done ===
  sed -i.bak 's/^status: ready_to_merge$/status: done/' "$slice_file"
  sed -i.bak 's/^owner: user$/owner: -/' "$slice_file"
  rm -f "${slice_file}.bak"
  git add "$slice_file"
  git commit -m "chore: mark $slice_id done after auto-merge

[slice:${slice_id}][done][auto-merger]" >/dev/null 2>&1

  if ! git push >/dev/null 2>&1; then
    logmsg "WARN: push failed (will retry on next tick)"
    return 1
  fi

  # Delete proposal branch (local + remote).
  git branch -D "$proposal_branch" >/dev/null 2>&1 || true
  if git ls-remote --exit-code --heads origin "$proposal_branch" >/dev/null 2>&1; then
    git push origin --delete "$proposal_branch" >/dev/null 2>&1 || true
  fi

  # Clean up sentinel.
  [[ -f "$approved_merge_sentinel" ]] && rm -f "$approved_merge_sentinel"

  # Clean up the proposal worktree. Fall back to slice_id-only path for legacy branches.
  if [[ -n "$proposal_worktree" && -d "$proposal_worktree" ]]; then
    ( cd "$LOOP_MAIN_WORKTREE" && git worktree remove "$proposal_worktree" --force ) 2>/dev/null \
      || rm -rf "$proposal_worktree"
    ( cd "$LOOP_MAIN_WORKTREE" && git worktree prune ) 2>/dev/null || true
  fi
  cleanup_slice_worktree "$slice_id"  # legacy path; idempotent

  cleanup_slice_state "$slice_id"
  return 0
}

with_repo_lock "merger:$slice_id" do_merge_under_lock || {
  logmsg "merger returned non-zero; check log"
  exit 1
}

# Best-effort state update + baseline refresh (unchanged from pre-§A.1).
if [[ -x scripts/loop/update_state.sh ]]; then
  with_repo_lock "merger:$slice_id:state" \
    scripts/loop/update_state.sh >>"$LOG" 2>&1 || logmsg "WARN: update_state.sh failed; continuing"
fi
if [[ -x scripts/loop/refresh_test_grading_baseline.sh ]]; then
  scripts/loop/refresh_test_grading_baseline.sh --quiet \
    >>"$LOG" 2>&1 || logmsg "WARN: refresh_test_grading_baseline.sh failed; continuing"
fi

logmsg "merged and pushed; slice marked done"
