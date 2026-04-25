#!/usr/bin/env bash
# scripts/loop/preconditions.sh
# Refuses to dispatch unless every gate is green.
# See automation_2026-04_loop_runner.md §6.

set -e
cd "$(git rev-parse --show-toplevel)"

# 1. Clean worktree, but ignore approval-sentinel touch files. The .approved/
#    and .approved-merge/ directories are tracked (via their .gitkeep), but
#    the token files inside them are intentionally git-ignored — otherwise
#    every approval would taint the worktree and the loop would block forever.
#    The grep below is belt-and-suspenders: even if a stray untracked sentinel
#    appears (e.g. on a fresh checkout before .gitignore is loaded), we skip
#    it here so the loop keeps moving.
dirty=$(git status --porcelain | grep -vE '^\?\?[[:space:]]+diagnostic/slices/\.approved(-merge)?/[^/]+$' || true)
if [[ -n "$dirty" ]]; then
  echo "FAIL: dirty worktree (ignoring approval sentinels)" >&2
  echo "  Files dirty:" >&2
  echo "$dirty" | sed 's/^/    /' >&2
  exit 1
fi

# 2. On the right base branch.
branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "integration/perf-roadmap" && "$branch" != slice/* ]]; then
  echo "FAIL: not on integration/perf-roadmap or a slice branch (current: $branch)" >&2
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
