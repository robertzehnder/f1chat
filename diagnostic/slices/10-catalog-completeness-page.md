---
slice_id: 10-catalog-completeness-page
phase: 10
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Add a `/catalog` page showing which sessions have full vs partial data coverage (which contracts populated).

## Inputs
- `web/src/app/`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Build the page/component per the goal.
2. Wire to the appropriate semantic contracts from Phase 3.
3. Add basic Playwright/RTL tests if the project has any; otherwise visual smoke check via dev-server screenshot.

## Changed files expected
- `web/src/app/catalog/page.tsx`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Page renders without runtime errors.
- [ ] Data displayed matches the underlying contract for at least one test session.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High

### Medium
- [ ] Replace the raw `cd web && npm run test:grading` gate with `bash scripts/loop/test_grading_gate.sh` so the slice uses the baseline-aware grading wrapper required by repo protocol.
- [ ] Rewrite Step 3 to target the repo's existing `web/scripts/tests/*.test.mjs` grading harness instead of conditional Playwright/RTL or a dev-server screenshot path, and align the acceptance criteria to those concrete gates.
- [ ] Name the exact Phase 3 contract source(s) and the coverage fields/semantics the page must present; "appropriate semantic contracts" is too vague to implement or audit consistently.
- [ ] Expand `Changed files expected` beyond `web/src/app/catalog/page.tsx` to cover the obvious supporting files this slice will need, including the grading test file(s) and any query/helper modules used to compute completeness.
- [ ] Update `Required services / env` to declare the database/service prerequisites needed to validate contract-backed coverage data, or explicitly scope the slice to mocked/fixture-backed verification if it must remain env-free.
- [ ] Make the acceptance criteria executable by naming the command or test artifact that proves the page renders and that the displayed completeness matches contract data for a defined session fixture/case.

### Low

### Notes (informational only — no action)
- `web/src/app/catalog/page.tsx` already exists in the repo, so this slice is a repurpose/extension of the existing route rather than creation of a brand-new page.
