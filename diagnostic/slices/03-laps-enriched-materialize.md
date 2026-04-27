---
slice_id: 03-laps-enriched-materialize
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T12:05:00-04:00
---

## Goal
Materialize `laps_enriched` per the chosen grain.

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
- `sql/laps_enriched.sql`
- `web/src/lib/contracts/lapsEnriched.ts`
- `web/scripts/tests/parity-laps-enriched.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Matview rowcount matches live query.
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
- [ ] Replace the `CREATE MATERIALIZED VIEW` / matview object model with the established Phase 3 pattern: create and populate `core.laps_enriched_mat` as a real heap table sourced from `core_build.laps_enriched`, then replace `core.laps_enriched` with a thin facade view over the table.
- [ ] Incorporate the completed grain-discovery decision for `laps_enriched`: the storage table must have no primary key, must use non-unique indexes including at least `(session_key, driver_number, lap_number)` and `(session_key)`, and must use delete-then-insert refresh semantics by `session_key`.
- [ ] Add executable database gate commands that apply the SQL and verify the acceptance criteria, including relation-kind checks, global rowcount equality, and bidirectional session-scoped `EXCEPT ALL` parity between `core_build.laps_enriched` and `core.laps_enriched_mat` for the deterministic three `analytic_ready` sessions.
- [ ] Replace the TypeScript contract and `.mjs` parity-test steps with the SQL-only migration and inline `psql` heredoc parity pattern established by `03-driver-session-summary-prototype`, or explicitly justify why this scale-out slice needs a different test/runtime surface.

### Medium
- [ ] Add the required prior-context artifacts that this plan depends on, especially `diagnostic/slices/03-driver-session-summary-prototype.md`, `diagnostic/slices/03-laps-enriched-grain-discovery.md`, and `diagnostic/notes/03-laps-enriched-grain.md`.
- [ ] Rename the expected SQL file to the next numbered migration path consistent with the existing `sql/00N_*.sql` convention instead of `sql/laps_enriched.sql`.
- [ ] Expand `Required services / env` to include `psql` on PATH and the exact privileges needed for a base table, facade view swap, source read from `core_build.laps_enriched`, parity selector read from `core.session_completeness`, and non-unique index creation; remove the materialized-view privilege requirement.
- [ ] Make the acceptance criteria directly testable by tying each criterion to a gate command exit code rather than only saying rowcount and parity "match".

### Low
- [ ] Add rollback instructions for restoring the original aggregating `core.laps_enriched` view from `sql/006_semantic_lap_layer.sql` and dropping `core.laps_enriched_mat`, not only `git revert <commit>`.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27 and is current for this audit.
