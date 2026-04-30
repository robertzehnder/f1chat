---
slice_id: 10-session-detail-pace-table
phase: 10
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Build a session-detail page section showing per-driver pace (median lap, fastest lap, sector splits).

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
- `web/src/app/sessions/[id]/PaceTable.tsx`
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
- [ ] None.

### Medium
- [ ] Replace the raw `cd web && npm run test:grading` gate with `bash scripts/loop/test_grading_gate.sh` so the slice uses the repo's required grading wrapper and baseline diff behavior.
- [ ] Correct the route/file scope to the actual session-detail path (`web/src/app/sessions/[sessionKey]/page.tsx`) and update any related wording that still refers to `[id]`.
- [ ] Expand `Changed files expected` to include the test file(s) Step 3 requires, or narrow Step 3 if no new automated test file will be created.
- [ ] Replace the ambiguous "Playwright/RTL tests if the project has any" step with one concrete test strategy and gateable command that matches this repo's existing test harness.
- [ ] Specify the required data/runtime prerequisites for validating this page, including the DB-backed session data/env expected by the chosen test or verification path.
- [ ] Rewrite the acceptance criteria so each item is observable via a named automated check or explicit artifact, including how "matches the underlying contract" will be verified for a specific session.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T20:16:19Z, so no stale-state note is needed.
