---
slice_id: 12-read-replica-pool-split
phase: 12
status: done
owner: -
user_approval_required: yes
created: 2026-04-26
updated: 2026-04-27T16:56:11Z
---

## Goal
Split the read-only path to use a dedicated Neon read-replica pool, keeping the writer pool for mutations only.

## Inputs
- Production deployment context
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 12

## Prior context
- `diagnostic/_state.md`

## Required services / env
Production `DATABASE_URL`, deployment platform credentials.

## Steps
1. Design + implement the change.
2. Stage in a non-prod environment first.
3. Document the rollback procedure.
4. Land behind explicit user approval.

## Changed files expected
- `web/src/lib/db/driver.ts`
- `web/src/lib/db/readPool.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Implementation works in staging.
- [ ] Rollback plan documented in slice-completion note.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Production-touching, requires user-approved sentinel before merge. Full rollback documented in slice.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Slice-completion note
SKIPPED by user decision (2026-04-27). A dedicated Neon read-replica
branch has its own separately-billed compute (~$20-60/month depending on
read traffic). Current load doesn't justify the capacity add — primary
pool plus Phase 3 matviews + Phase 4 indexes + Phase 5 caches handle
read volume comfortably. Revisit only if observed read-side latency
or connection pressure shows a measurable bottleneck.

## Audit verdict
N/A — slice marked done without implementation per user direction.
