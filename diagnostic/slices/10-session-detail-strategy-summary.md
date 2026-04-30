---
slice_id: 10-session-detail-strategy-summary
phase: 10
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Add a strategy-summary card to the session-detail page (per driver: pit count, compounds, undercut/overcut classification).

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
- `web/src/app/sessions/[id]/StrategySummary.tsx`
- `web/src/app/sessions/[id]/page.tsx`

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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the loop's baseline-aware grading gate instead of the raw repo-wide test script.

### Medium
- [ ] Fix the `Changed files expected` paths to use the real session-detail route segment `web/src/app/sessions/[sessionKey]/...` instead of nonexistent `[id]` paths.
- [ ] Expand `Changed files expected` to include the query-layer and grading-test files this slice will need, at minimum the `web/src/lib/queries/sessions.ts` contract reader and a dedicated `web/scripts/tests/session-detail-strategy-summary.test.mjs` gate file.
- [ ] Replace the Playwright/RTL-or-screenshot fallback in Step 3 with the repo's actual grading-test approach, since this codebase already uses source-inspection node tests for adjacent session-detail slices and does not rely on Playwright/RTL here.
- [ ] Rewrite the acceptance criteria as command-verifiable outcomes that name the required `core.strategy_summary` wiring and the concrete grading assertion(s), rather than broad statements like "renders without runtime errors" and "matches the underlying contract for at least one test session."

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:41:07Z, so the loop context is current.
- Adjacent implemented session-detail slices already follow the `[sessionKey]` route shape and dedicated grading-test pattern in `web/scripts/tests/session-detail-*.test.mjs`.
