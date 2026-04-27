---
slice_id: 06-driver-swap-local-fallback
phase: 6
status: pending_plan_audit
owner: codex
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-26
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
