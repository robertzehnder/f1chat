---
slice_id: 03-core-build-schema
phase: 3
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Create `core_build` schema with `core.lap_clean`, `core.session_summary`, `core.driver_summary` materialized views as the foundation for all matview-backed semantic contracts.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/03-core-build-schema.md`

## Required services / env
`DATABASE_URL` (Neon Postgres). Statement-level `CREATE MATERIALIZED VIEW` requires the role used by the loop to have schema-create privileges on `core_build`.

## Steps
1. Define the matview's SQL with a stable column ordering.
2. Add a TS contract type matching the matview columns.
3. Add a parity test comparing matview output to the equivalent live-query output for ≥3 sessions.
4. Run gate commands; capture output.

## Changed files expected
- `sql/core_build_schema.sql`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `Materialized views` exist with non-zero rowcount.
- [ ] `REFRESH MATERIALIZED VIEW CONCURRENTLY` works without error.

## Out of scope
- Refresh strategy / cron (later phase or D-3 decision).
- Cutover from live query to matview in route.ts (later).

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
