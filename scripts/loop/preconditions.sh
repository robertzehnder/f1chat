#!/usr/bin/env bash
# scripts/loop/preconditions.sh
# Refuses to dispatch unless every gate is green.
# See automation_2026-04_loop_runner.md §6.

set -e
cd "$(git rev-parse --show-toplevel)"

# 1. Clean worktree, but ignore approval-sentinel touch files. The .approved/,
#    .approved-merge/, and .approved-loop-infra-repair/ directories are tracked
#    (via their .gitkeep), but the token files inside them are intentionally
#    git-ignored — otherwise every approval would taint the worktree and the
#    loop would block forever.
#
#    Also (Phase 22 — visualization roadmap run, 2026-05-25): the loop is being
#    exercised against the v0-frontend-replacement branch where the user has
#    active hand-driven WIP. The runner's per-slice worktrees isolate the
#    agent's work, so the main worktree's dirty state isn't a correctness
#    issue for dispatch; only the merger (which checks out integration) cares.
#    LOOP_ALLOW_DIRTY_WORKTREE=1 waives this gate.
if [[ "${LOOP_ALLOW_DIRTY_WORKTREE:-0}" != "1" ]]; then
  dirty=$(git status --porcelain | grep -vE '^\?\?[[:space:]]+diagnostic/slices/\.approved(-merge|-loop-infra-repair)?/[^/]+$' || true)
  if [[ -n "$dirty" ]]; then
    echo "FAIL: dirty worktree (ignoring approval sentinels)" >&2
    echo "  Files dirty:" >&2
    echo "$dirty" | sed 's/^/    /' >&2
    echo "  To waive (e.g. running against an active feature branch with WIP):" >&2
    echo "    LOOP_ALLOW_DIRTY_WORKTREE=1" >&2
    exit 1
  fi
fi

# 2. On the right base branch.
#    Default-allowed: integration/perf-roadmap or slice/*. LOOP_TARGET_BRANCH
#    overrides the integration default for runs on feature branches.
branch=$(git rev-parse --abbrev-ref HEAD)
target_branch="${LOOP_TARGET_BRANCH:-integration/perf-roadmap}"
if [[ "$branch" != "$target_branch" && "$branch" != slice/* ]]; then
  echo "FAIL: not on $target_branch or a slice branch (current: $branch)" >&2
  echo "  Override via LOOP_TARGET_BRANCH=<branch>" >&2
  exit 1
fi

# 3. Always-required env.
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "FAIL: ANTHROPIC_API_KEY not set" >&2
  exit 1
fi

# Slice-specific env (DB, dev server, etc.) is checked AFTER selection
# inside each dispatcher / slice file. Bootstrap slices must be able to run
# without DB connectivity.

# 4. Daily cost budget (soft cap, ADVISORY).
#    The dispatchers currently write cost_usd=0 placeholders because the
#    Claude / Codex CLIs do not expose token usage in non-interactive mode.
#    Until real cost capture is wired (see dispatcher TODO), the cap only
#    bites when external tooling backfills real numbers. Treat as advisory.
if [[ -x "scripts/loop/check_budget.sh" ]]; then
  if ! ./scripts/loop/check_budget.sh; then
    echo "FAIL: daily LLM cost budget exceeded (advisory cap)" >&2
    exit 1
  fi
fi

exit 0
