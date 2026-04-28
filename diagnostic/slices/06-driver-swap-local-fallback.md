---
slice_id: 06-driver-swap-local-fallback
phase: 6
status: revising_plan
owner: claude
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-28
---

## Goal
When `DATABASE_URL` is missing or unreachable, fall back to a local SQLite snapshot (or PGlite) so dev can run without Neon connectivity. Production remains unchanged.

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
- `web/scripts/tests/driver-fallback.test.mjs`

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
- [ ] Replace the real-Neon/staging verification requirement with repo-local gates that prove both modes, because this slice's goal is a local fallback when Neon is missing or unreachable and the current plan cannot be completed in an isolated implementation pass.
- [ ] Specify the fallback mechanism concretely by choosing SQLite snapshot or PGlite and naming every required code/config/artifact path, because `web/src/lib/db/driver.ts` alone does not provide the local data source the goal requires.

### Medium
- [ ] Update `Required services / env` to describe the local fallback prerequisites and any selection logic instead of only Neon access, or narrow the goal so it no longer promises offline development.
- [ ] Replace the acceptance criteria with command-testable checks that cover `DATABASE_URL` missing and primary-connection failure cases, rather than "implemented and tested per the goal" and "verified in the staging environment before merge."
- [ ] Expand `Changed files expected` and `Artifact paths` to include the fallback snapshot/PGlite setup and any docs/config/test harness files the chosen approach necessarily touches.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T15:43:27Z, so no stale-state note is needed.
- The gate order `build` before `typecheck` matches the current auditor note for web slices.
