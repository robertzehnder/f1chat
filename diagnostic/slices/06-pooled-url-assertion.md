---
slice_id: 06-pooled-url-assertion
phase: 6
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28
---

## Goal
Assert `DATABASE_URL` uses the Neon pooler connection string (port 6543 / `-pooler` suffix) in production. Throw a startup error if direct-connection URL is detected in `NODE_ENV=production`.

## Inputs
- `web/src/lib/db/driver.ts`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 6

## Prior context
- `diagnostic/_state.md`

## Required services / env
Production `DATABASE_URL` (Neon pooler). For Neon-config slices, requires Neon API token or console access.

## Steps
1. Read the current implementation if any.
2. Apply the change per the slice goal.
3. Add tests / docs as appropriate.
4. Verify against a real Neon connection.

## Changed files expected
- `web/src/lib/db/driver.ts`
- `web/scripts/tests/pooled-url-assertion.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Change is implemented and tested per the goal.
- [ ] Production-side behavior verified in the staging environment before merge.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Production-touching. Require user-approved sentinel before merge. Rollback: `git revert` + Neon-config revert if applicable.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [ ] Replace `Verify against a real Neon connection.` with a concrete pre-merge verification step that names the exact environment, command or check, and any required artifact or evidence; the current step is underspecified and not actionable for the implementer.
- [ ] Make the acceptance criteria directly testable from this slice by specifying the expected automated assertion coverage for pooled versus direct production URLs instead of `implemented and tested per the goal`.
- [ ] Align `Required services / env` with the actual slice scope: either remove the Neon API token / console requirement or add explicit plan steps that use it, because the current plan declares external access without any defined action.

### Low
- [ ] Resolve the mismatch between `Add tests / docs as appropriate.` and `Changed files expected` by either naming any expected doc path or dropping docs from the step.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated within 24 hours, so no staleness note applies.
