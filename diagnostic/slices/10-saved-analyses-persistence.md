---
slice_id: 10-saved-analyses-persistence
phase: 10
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Add a saved-analyses feature: user can name + persist a chat thread, retrieve it later. Backed by a new `saved_analysis` table.

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
- `sql/saved_analysis.sql`
- `web/src/app/api/saved-analyses/route.ts`
- `web/src/app/saved-analyses/page.tsx`

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
- [ ] Replace the raw grading gate with `bash scripts/loop/test_grading_gate.sh`; `cd web && npm run test:grading` is not an acceptable slice gate in this loop (`diagnostic/slices/10-saved-analyses-persistence.md:37`, `diagnostic/_state.md:68-69`).
- [ ] Add DB apply/existence/parity gate commands for the new `saved_analysis` table so the slice verifies the SQL artifact and schema backing, not only web build/typecheck (`diagnostic/slices/10-saved-analyses-persistence.md:30-41`, `diagnostic/_state.md:59`).
- [ ] Rewrite the acceptance criteria to prove the core flow end to end: saving a named chat thread persists it and retrieving it later returns the same saved analysis via objective checks, not only “page renders” or “data displayed” (`diagnostic/slices/10-saved-analyses-persistence.md:44-46`).

### Medium
- [ ] Replace the conditional “add basic Playwright/RTL tests if the project has any; otherwise visual smoke check via dev-server screenshot” with explicit automated test work and gates; the current fallback is ambiguous and introduces an unstated dev-server dependency (`diagnostic/slices/10-saved-analyses-persistence.md:24-27`).
- [ ] Fill in the Required services / env block for the DB-backed persistence path, or explicitly narrow the slice to mocked-only behavior; `None at author time` conflicts with a feature whose goal is persistence in a new table (`diagnostic/slices/10-saved-analyses-persistence.md:21-22`, `diagnostic/slices/10-saved-analyses-persistence.md:30-31`).

### Low
- [ ] Expand Changed files expected to include the test file(s) and any additional contract/server modules the steps necessarily touch so slice scope matches the planned work (`diagnostic/slices/10-saved-analyses-persistence.md:24-32`).

### Notes (informational only — no action)
- `diagnostic/_state.md` was current at audit time (`last updated: 2026-04-30T22:43:30Z`).
