---
slice_id: 00-ci-workflow
phase: 0
status: pending
owner: claude
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25
---

## Goal
Add a GitHub Actions CI workflow that runs the always-on deterministic gates on every push and pull-request to `integration/perf-roadmap` and `main`.

## Inputs
- [execution_plan §6 deterministic gates](../execution_plan_2026-04_autonomous_loop.md)

## Required services / env
None at author time. Workflow runs in GitHub-hosted runners.

## Steps
1. Create `.github/workflows/ci.yml` with three jobs:
   - `web-typecheck` — `npm ci && npm run typecheck` in `web/`.
   - `web-tests` — `npm run test:grading` in `web/`.
   - `web-build` — `npm run build` in `web/`.
2. Add a `python-compile` job: `python -m compileall -q src/`.
3. Add a `shell-syntax` job: `bash -n` on every `*.sh` under `scripts/`.
4. Trigger on `push` and `pull_request` to `main` and `integration/perf-roadmap`.
5. Cache `web/node_modules` keyed on `package-lock.json`.

## Changed files expected
- `.github/workflows/ci.yml`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run typecheck
cd web && npm run test:grading
cd web && npm run build
python3 -m compileall -q src/
for s in scripts/**/*.sh; do bash -n "$s" || exit 1; done
```

## Acceptance criteria
- [ ] `.github/workflows/ci.yml` exists.
- [ ] All five gate commands above exit 0 locally.
- [ ] YAML parses (`yamllint` if available, else manual inspection).

## Out of scope
- Conditional gates (security audit, SQL parse) — added by their slice when relevant.
- ESLint, Prettier, Ruff (deferred per Codex round-2 answer).

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by auditor)
