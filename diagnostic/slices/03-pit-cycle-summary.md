---
slice_id: 03-pit-cycle-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T23:10:48Z
---

## Goal
Materialize `pit_cycle_summary` (per pit stop: in-lap, out-lap, duration, time loss).

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
- `sql/pit_cycle_summary.sql`
- `web/src/lib/contracts/pitCycleSummary.ts`
- `web/scripts/tests/parity-pit-cycle.test.mjs`

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
- [ ] Rewrite the slice around the approved Phase 3 materialization pattern: create the next numbered SQL migration (currently `sql/015_pit_cycle_summary_mat.sql`) for a real `core.pit_cycle_summary_mat` base table populated from `core_build.pit_cycle_summary`, then swap `core.pit_cycle_summary` to a thin facade `SELECT * FROM core.pit_cycle_summary_mat`; do not plan a standalone `CREATE MATERIALIZED VIEW` in `sql/pit_cycle_summary.sql`.
- [ ] Account for the live public dependent `core.strategy_evidence_summary` when describing the facade swap: require `CREATE OR REPLACE VIEW core.pit_cycle_summary AS SELECT * FROM core.pit_cycle_summary_mat` and explicitly forbid `DROP VIEW`, because `sql/007_semantic_summary_contracts.sql` already reads `FROM core.pit_cycle_summary`.
- [ ] Replace the web-only gate list with executable database gates that apply the migration, assert the storage/view relation kinds and chosen unique grain, and prove parity with bidirectional `EXCEPT ALL` on 3 deterministic `analytic_ready` sessions plus a global rowcount check; the current gates cannot verify that the DB objects were created correctly.

### Medium
- [ ] Align `Changed files expected` with the actual slice scope by listing the numbered SQL migration and this slice file, and remove `web/src/lib/contracts/pitCycleSummary.ts` plus `web/scripts/tests/parity-pit-cycle.test.mjs` unless the plan also adds matching implementation steps, gates, and acceptance criteria for those paths.
- [ ] Expand `Required services / env` to the base-table migration prerequisites used by adjacent approved slices: `psql` on `PATH`, `CREATE` on schema `core`, ownership/replace rights on `core.pit_cycle_summary`, `USAGE`/`SELECT` on `core_build`, and `SELECT` on `core.session_completeness`; remove the current `CREATE MATERIALIZED VIEW` privilege requirement.
- [ ] Add the existing contract and adjacent slice precedents to `Prior context` so the plan can be audited against the actual dependency and gate pattern: `sql/007_semantic_summary_contracts.sql`, `diagnostic/slices/03-strategy-summary.md`, and `diagnostic/slices/03-race-progression-summary.md`.

### Low
- [ ] Clarify the Goal wording so it matches the existing `core.pit_cycle_summary` contract being materialized; the current shorthand "in-lap, out-lap, duration, time loss" does not describe the broader public column set preserved by this slice.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated at `2026-04-27T23:09:08Z`, so no staleness note is required for this round.
