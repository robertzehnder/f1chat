---
slice_id: 03-lap-phase-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T23:00:16-04:00
---

## Goal
Materialize `lap_phase_summary` (per lap: green, yellow, SC, VSC, red phase classification).

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/03-core-build-schema.md`

## Required services / env
- `DATABASE_URL` (Neon Postgres). Statement-level `CREATE MATERIALIZED VIEW` requires the role used by the loop to have schema-create privileges on the `core` schema, plus `USAGE`/`SELECT` on `core_build.lap_phase_summary` (the source-definition view shipped by `03-core-build-schema`) and `SELECT` on `core.session_completeness` (the deterministic session selector used by gate #3).
- `psql` available on `PATH` for the DB gate commands below.

## Steps
1. Define the matview's SQL with a stable column ordering, written to `sql/lap_phase_summary.sql`. The body materializes from `core_build.lap_phase_summary` (the source-definition view shipped by `03-core-build-schema` at `sql/008_core_build_schema.sql:482`) so the matview's column list and ordering exactly mirror that view's projection.
2. Add a TS contract type at `web/src/lib/contracts/lapPhaseSummary.ts` matching the matview columns one-for-one.
3. Add a parity test at `web/scripts/tests/parity-lap-phase.test.mjs` that compares matview output to `core_build.lap_phase_summary` for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   The test must run a bidirectional, multiplicity-preserving `EXCEPT ALL` per session (matching the precedent used by every prior Phase 3 materialization slice) and exit non-zero on any drift or if the selector returns fewer than 3 sessions.
4. Run gate commands (DB apply + existence + parity + web side) per the Gate commands block; capture output into the slice-completion note.

## Changed files expected
- `sql/lap_phase_summary.sql`
- `web/src/lib/contracts/lapPhaseSummary.ts`
- `web/scripts/tests/parity-lap-phase.test.mjs`
- `diagnostic/slices/03-lap-phase-summary.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only).

## Artifact paths
None.

## Gate commands
```bash
set -euo pipefail

# 1. Apply the matview migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/lap_phase_summary.sql

# 2. Confirm the matview exists in schema `core` with name `lap_phase_summary`.
#    Must exit 0; the DO block raises (and ON_ERROR_STOP=1 forces non-zero exit)
#    unless exactly one matching matview is found.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_class c
  JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
  WHERE nsp.nspname = 'core'
    AND c.relname = 'lap_phase_summary'
    AND c.relkind = 'm';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected 1 matview core.lap_phase_summary, found %', n;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity vs core_build.lap_phase_summary
#    for the deterministic 3 `analytic_ready` sessions. Implemented as the
#    standalone parity script declared in Steps §3. Must exit 0.
node web/scripts/tests/parity-lap-phase.test.mjs

# 4. Web side regression safety. Use --prefix so the three commands chain from one shell.
npm --prefix web run build
npm --prefix web run typecheck
npm --prefix web run test:grading
```

## Acceptance criteria
- [ ] `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/lap_phase_summary.sql` exits `0` (gate #1 applies the matview migration).
- [ ] Matview `core.lap_phase_summary` exists — gate #2 exits `0` (its DO block raises unless exactly one matching `pg_class` row with `relkind = 'm'` is found).
- [ ] `node web/scripts/tests/parity-lap-phase.test.mjs` exits `0` — the parity script runs bidirectional `EXCEPT ALL` against `core_build.lap_phase_summary` for the 3 deterministic `analytic_ready` sessions selected per Steps §3 and reports zero drift.
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.

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
- [x] Add database gate commands for this materialization slice in addition to the web gates, and make them prove apply/existence/parity success; the current gate list at `diagnostic/slices/03-lap-phase-summary.md:38` only runs web commands and does not satisfy the Phase 3 DB-gate rule from `diagnostic/_state.md`.
- [x] Make the acceptance criteria at `diagnostic/slices/03-lap-phase-summary.md:45` executable by requiring the SQL apply/existence check and the parity check to exit `0`, not only that a generic parity test "passes."

### Medium
- [x] Add the slice file itself to `Changed files expected` at `diagnostic/slices/03-lap-phase-summary.md:30`, because implementation will update this file's frontmatter and `Slice-completion note`.
- [x] Specify the deterministic session selector for the ">=3 sessions" parity check in `diagnostic/slices/03-lap-phase-summary.md:27`, preferably using analytic-ready sessions from `core.session_completeness`, so repeated audits run the same coverage.
- [x] State how the new parity test in `diagnostic/slices/03-lap-phase-summary.md:27` is actually executed by the gate list at `diagnostic/slices/03-lap-phase-summary.md:38`; if it is a standalone script, add the command explicitly instead of assuming `npm run test:grading` covers it.

### Low
- [x] Add `psql` on PATH to `Required services / env` at `diagnostic/slices/03-lap-phase-summary.md:21` if the revised gate list applies SQL directly, so the execution prerequisites are complete.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T01:09:52Z, so no stale-state note is required for this round.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] Replace the `core.lap_phase_summary` materialized-view plan with the established Phase 3 contract pattern from `diagnostic/slices/03-core-build-schema.md`: materialize into a real `core.lap_phase_summary_mat` relation sourced from `core_build.lap_phase_summary`, then restore `core.lap_phase_summary` as the public facade the web contract reads.
- [ ] Rewrite the gate commands and acceptance criteria to prove the artifacts from that Phase 3 pattern exist and are parity-clean, instead of only asserting a single `core.lap_phase_summary` matview exists; the current plan at `diagnostic/slices/03-lap-phase-summary.md:43` and `diagnostic/slices/03-lap-phase-summary.md:71` would pass while leaving no public facade in place.

### Medium
- [ ] Update `Required services / env` and `Changed files expected` so they match the corrected storage-plus-facade plan, including any additional SQL artifacts needed to create `core.lap_phase_summary_mat` and the public `core.lap_phase_summary` facade rather than only a standalone matview file.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T01:09:52Z, so no stale-state note is required for this round.
