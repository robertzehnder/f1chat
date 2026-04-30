---
slice_id: 10-replay-viewer-mvp
phase: 10
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Add a basic race-replay viewer (positions over time, per-lap snapshots).

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
- `web/src/app/replay/[sessionId]/page.tsx`
- `web/src/app/replay/[sessionId]/ReplayViewer.tsx`

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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required baseline-aware grading gate.
- [ ] Make Step 3 deterministic by naming the exact automated test path this slice must add or update; do not leave test scope as “if the project has any” or fall back to a manual dev-server screenshot.
- [ ] Rewrite the acceptance criteria as command-checkable outcomes, including the specific test session or fixture whose replay data must be rendered and the gate that proves it.
- [ ] Expand `Changed files expected` to include the test files and any contract-facing files the stated steps necessarily modify.

### Low
- [ ] Identify the concrete Phase 3 semantic contract artifact this viewer must consume instead of the generic “appropriate semantic contracts” phrasing.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current on 2026-04-30, so no stale-state note applies.
