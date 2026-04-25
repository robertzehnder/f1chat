---
slice_id: 00-tsbuildinfo-gitignore
phase: 0
status: done
owner: -
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Stop tracking the constantly-regenerated `web/tsconfig.tsbuildinfo`.

## Inputs
- [.gitignore](../../.gitignore)
- [roadmap §1: Repo hygiene gaps](../roadmap_2026-04_performance_and_upgrade.md)

## Required services / env
None.

## Steps
1. Add `web/tsconfig.tsbuildinfo` to `.gitignore` (already done as part of `00-gitignore-exceptions`).
2. `git rm --cached web/tsconfig.tsbuildinfo` to stop tracking the existing file.

## Changed files expected
- `web/tsconfig.tsbuildinfo` (removal from tracking; file remains on disk)

## Artifact paths
None.

## Gate commands
```bash
git ls-files web/tsconfig.tsbuildinfo | grep -q tsbuildinfo && { echo "FAIL: still tracked"; exit 1; } || true
git check-ignore -q web/tsconfig.tsbuildinfo || { echo "FAIL: not ignored"; exit 1; }
echo "tsbuildinfo ignored and untracked"
```

## Acceptance criteria
- [x] `git ls-files` no longer lists the file.
- [x] `git check-ignore -q` matches.

## Out of scope
Other build artifacts.

## Risk / rollback
Rollback: `git restore --staged web/tsconfig.tsbuildinfo`.

## Slice-completion note
`git rm --cached` executed during bootstrap.

## Audit verdict
Self-audited at execution time.
