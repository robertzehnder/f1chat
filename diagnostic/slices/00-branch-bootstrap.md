---
slice_id: 00-branch-bootstrap
phase: 0
status: done
owner: -
user_approval_required: yes
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Create the long-lived `integration/perf-roadmap` branch and document merge authority.

## Inputs
- [execution_plan §0a, §4 steps 15–17](../execution_plan_2026-04_autonomous_loop.md)

## Required services / env
- `git` configured.

## Steps
1. Create `integration/perf-roadmap` from `main`.
2. Document merge authority: user-only during Phase 0; Codex may merge non-approval-flagged Phase 1+ slices after Phase 0 sign-off; user-approval-flagged slices always require user merge.
3. (Procedural) on GitHub, enable branch protection on `main` if available.

## Changed files expected
None — branch creation only.

## Artifact paths
None.

## Gate commands
```bash
git rev-parse --verify integration/perf-roadmap >/dev/null
```

## Acceptance criteria
- [x] `integration/perf-roadmap` exists locally.
- [x] Merge-authority rule recorded (this slice file + execution_plan §4).

## Out of scope
- Pushing the branch to remote (deferred to user).
- Configuring GitHub-side branch protection (user does this in the GitHub UI).

## Risk / rollback
Rollback: `git branch -D integration/perf-roadmap`.

## Slice-completion note
- Created locally during bootstrap. User to push to remote and configure protection.

## Audit verdict
Self-audited at execution time.
