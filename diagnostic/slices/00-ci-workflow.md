---
slice_id: 00-ci-workflow
phase: 0
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25T19:27:34-04:00
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
Branch: slice/00-ci-workflow
Commit: 0a1980c

File created: `.github/workflows/ci.yml`

Jobs: web-typecheck, web-tests, web-build (node_modules cache keyed on web/package-lock.json), python-compile, shell-syntax.
Triggers: push and pull_request to main and integration/perf-roadmap.

Fix from REJECT: replaced `scripts/**/*.sh` glob with
`find scripts/ -name "*.sh"` so top-level scripts (init_db.sh,
load_codex_helpers.sh) are checked alongside scripts/loop/*.sh.
9 scripts total covered by find.

Scope: `git diff --name-only integration/perf-roadmap...HEAD` → `.github/workflows/ci.yml` only.

Gate results (all exit 0):
- `cd web && npm run typecheck` → 0
- `cd web && npm run test:grading` → 0 (4 pass, 9 skipped/integration)
- `cd web && npm run build` → 0 (Next.js 15, 20 routes)
- `python3 -m compileall -q src/` → 0
- `find scripts/ -name "*.sh" shell-syntax check` → 0 (9 scripts)

YAML inspection: all required sections present (yamllint unavailable; manual inspection confirms valid structure).

## Audit verdict
REJECT

- Pull attempt: `git pull --ff-only origin slice/00-ci-workflow` exited `1` with `error: cannot open '.git/FETCH_HEAD': Operation not permitted`. `git status --short --branch` showed the local branch already aligned with `origin/slice/00-ci-workflow`.
- Gate exit codes observed locally:
  - `cd web && npm run typecheck` → `0`
  - `cd web && npm run test:grading` → `0`
  - `cd web && npm run build` → `0`
  - `python3 -m compileall -q src/` → `0`
  - `for s in scripts/**/*.sh; do bash -n "$s" || exit 1; done` → `0`
- Scope diff: `git diff --name-only integration/perf-roadmap...HEAD` returned `.github/workflows/ci.yml` and `diagnostic/slices/00-ci-workflow.md`. The slice allows only `.github/workflows/ci.yml`. This is out-of-scope and fails the mandatory subset check.
- Acceptance criteria:
  - `.github/workflows/ci.yml` exists: PASS.
  - All five gate commands exit `0` locally: PASS.
  - YAML parses (`yamllint` if available, else manual inspection): PASS. `yamllint` was not installed; manual inspection confirms valid YAML structure with the required triggers and jobs.
- Substantive failure: [.github/workflows/ci.yml](/Users/robertzehnder/Documents/coding/f1/openf1/.github/workflows/ci.yml:89) does not implement step 3. In GitHub Actions `bash`, `scripts/**/*.sh` expands here to `scripts/loop/*.sh` and skips top-level scripts `scripts/init_db.sh` and `scripts/load_codex_helpers.sh`. The `shell-syntax` job therefore does not run `bash -n` on every `*.sh` under `scripts/`.
