---
slice_id: 10-replay-viewer-mvp
phase: 10
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
