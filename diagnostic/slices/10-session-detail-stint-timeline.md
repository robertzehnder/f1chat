---
slice_id: 10-session-detail-stint-timeline
phase: 10
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Add a stint-timeline visualization (Gantt-style) to the session-detail page.

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
- `web/src/app/sessions/[id]/StintTimeline.tsx`
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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the declared gate matches loop policy and does not fail on known baseline grading cases.

### Medium
- [ ] Rewrite Step 3 and the acceptance criteria to require a deterministic automated check for the stint timeline; `if the project has any` plus a fallback screenshot does not verify the goal or the contract-parity claim.
- [ ] Add the expected test file and any artifact path the plan intends to create, or remove the screenshot path entirely; the current Changed files expected / Artifact paths blocks do not cover Step 3.
- [ ] Name the concrete Phase 3 semantic contract source this slice will consume so Step 2 is auditable and the implementer is not left to guess which contract defines stint data.

### Low
- [ ] Tighten `Page renders without runtime errors` into a command- or assertion-based acceptance criterion tied to the declared gates.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T21:15:31Z, so no staleness note applies.
