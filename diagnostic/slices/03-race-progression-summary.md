---
slice_id: 03-race-progression-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T16:53:07Z
---

## Goal
Materialize `race_progression_summary` (lap-by-lap position changes).

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
- `sql/race_progression_summary.sql`
- `web/src/lib/contracts/raceProgressionSummary.ts`
- `web/scripts/tests/parity-race-progression.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Parity test passes.

## Out of scope
- Refresh strategy / cron (later phase or D-3 decision).
- Cutover from live query to matview in route.ts (later).

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace the slice body with the actual Phase 3 materialization pattern for `race_progression_summary`: use the existing `core_build.race_progression_summary` source-definition view, create a real `core.race_progression_summary_mat` table, refresh it from `core_build`, and swap `core.race_progression_summary` to a thin facade; do not introduce a PostgreSQL materialized view or require `REFRESH MATERIALIZED VIEW`.
- [ ] Add executable DB gate commands that apply the SQL and verify `core.race_progression_summary_mat` exists, the facade points at it, the refresh/population step succeeds, and bidirectional session-scoped `EXCEPT ALL` parity returns zero for at least three deterministic analytic-ready sessions.
- [ ] Fix the step/file-scope mismatch: either include all implementation files required for the materialization pattern, including SQL and any refresh/parity support files, or remove the TypeScript contract and web parity-test steps from this slice if they are not part of the intended implementation.

### Medium
- [ ] Specify the deterministic session selector for parity checks, preferably the same `core.session_completeness` `analytic_ready` query used by prior Phase 3 slices.
- [ ] Include the prerequisite from prior context that `sql/008_core_build_schema.sql` has already created `core_build.race_progression_summary`, so the implementer does not try to recreate the preserved source-definition view in this slice.

### Low
- [ ] Replace the vague SQL filename `sql/race_progression_summary.sql` with the repository's Phase 3 migration naming convention or explicitly justify the new path.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so it is current for this audit.
