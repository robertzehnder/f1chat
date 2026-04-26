---
slice_id: 00-verify-script
phase: 0
status: ready_to_merge
owner: user
user_approval_required: no
created: 2026-04-25
updated: 2026-04-25T22:23:12-04:00
---

## Goal
Add `npm run verify` that chains typecheck + tests + build into a single pre-PR command.

## Inputs
- `web/package.json`

## Required services / env
None.

## Steps
1. In `web/package.json`, add a `verify` script:
   ```json
   "verify": "npm run typecheck && npm run test:grading && npm run build"
   ```
2. Confirm `npm run verify` exits 0.

## Changed files expected
- `web/package.json`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run verify
```

## Acceptance criteria
- [ ] Script exists in `package.json`.
- [ ] `npm run verify` exits 0.

## Out of scope
- Adding new gates inside the script (security audit, SQL parse) — those run conditionally on relevant slices, not on every dev verify.

## Risk / rollback
Rollback: remove the line from `package.json`.

## Slice-completion note
Branch: slice/00-verify-script

Added `"verify": "npm run typecheck && npm run test:grading && npm run build"` to `web/package.json` scripts block.

Gate: `cd web && npm run verify` — exit 0
- typecheck: clean (tsc --noEmit, no errors)
- test:grading: 4 pass, 0 fail, 9 skipped (integration tests require OPENF1_RUN_CHAT_INTEGRATION_TESTS=1)
- build: Next.js 15.5.15 compiled successfully, 20 routes generated

Self-check: `verify` key present in `web/package.json`; script chains the three required commands.

## Audit verdict

**Verdict: PASS**

Gate commands re-run locally:
- `cd web && npm run verify` -> exit 0

Diff scope (`git diff --name-only integration/perf-roadmap...HEAD`):
```text
diagnostic/slices/00-verify-script.md
web/package.json
```
Subset check passes. `web/package.json` is in "Changed files expected"; `diagnostic/slices/00-verify-script.md`
is the slice file and is implicitly allowed.

Acceptance criteria:
- [x] Script exists in `package.json` as `"verify": "npm run typecheck && npm run test:grading && npm run build"` at `web/package.json:15`.
- [x] `npm run verify` exits 0 when re-run locally by the auditor.

Observed gate output:
- `typecheck`: `tsc --noEmit` completed with exit 0.
- `test:grading`: exit 0 with 4 passed, 0 failed, 9 skipped.
- `build`: `next build` completed with exit 0 and generated 20 routes.

Phase 0 merge status: `status=ready_to_merge`, `owner=user`.
