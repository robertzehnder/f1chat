---
slice_id: 00-gitignore-exceptions
phase: 0
status: done
owner: -
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Add the `.gitignore` exceptions that allow CI workflow, env examples, artifact `.gitkeep` sentinels, slice files, and loop scripts to be tracked.

## Inputs
- [.gitignore](../../.gitignore)
- [automation_2026-04_loop_runner.md §8](../automation_2026-04_loop_runner.md)

## Required services / env
None.

## Steps
1. Add exceptions block to root `.gitignore`.
2. Verify with `git check-ignore -q` that target paths are no longer ignored.
3. Verify `web/tsconfig.tsbuildinfo` is now ignored (already-tracked file removed via `git rm --cached` in 00-tsbuildinfo-gitignore).

## Changed files expected
- `.gitignore`

## Artifact paths
None (config change only).

## Gate commands
```bash
for p in .github/workflows/ci.yml .env.example web/.env.local.example diagnostic/artifacts/perf/.gitkeep diagnostic/slices/test.md scripts/loop/runner.sh; do
  git check-ignore -q "$p" && { echo "FAIL: $p still ignored"; exit 1; }
done
echo "all paths tracked"
```

## Acceptance criteria
- [x] Six exception patterns added to `.gitignore`.
- [x] Verification loop above prints "all paths tracked".

## Out of scope
Anything not directly related to ignore-pattern exceptions.

## Risk / rollback
Rollback: `git revert <commit>` restores prior `.gitignore`.

## Slice-completion note
- Branch: integration/perf-roadmap (executed manually as bootstrap; runner did not yet exist)
- Verification output: all six paths confirmed tracked via `git check-ignore -q` loop.
- Notable: also added explicit ignores for `scripts/loop/state/{runner.log,runner.pid,cost_ledger.jsonl}` and `web/tsconfig.tsbuildinfo`.

## Audit verdict
Self-audited at execution time; pending Codex re-review on first PR.
