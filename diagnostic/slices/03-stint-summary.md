---
slice_id: 03-stint-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T12:13:33-04:00
---

## Goal
Materialize `stint_summary` (one row per driver-session-stint).

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
- `sql/stint_summary.sql`
- `web/src/lib/contracts/stintSummary.ts`
- `web/scripts/tests/parity-stint-summary.test.mjs`

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
- [ ] Replace the `CREATE MATERIALIZED VIEW` / `core_build` framing with the established Phase 3 object model: read from `core_build.stint_summary`, create and populate a real storage table such as `core.stint_summary_mat`, and replace public `core.stint_summary` with a thin facade view.
- [ ] Add executable database gate commands that apply the SQL and verify the materialized storage object, facade view, global rowcount parity, and bidirectional session-scoped `EXCEPT ALL` parity against `core_build.stint_summary` for three deterministic `analytic_ready` sessions.
- [ ] Define the `_mat` table schema, column order, types, and key/grain assertion for one row per driver-session-stint, including an executable gate that proves the expected primary key or chosen non-unique storage strategy.

### Medium
- [ ] Replace `sql/stint_summary.sql` with the next numbered SQL migration path and include the slice file itself in `Changed files expected` for the implementation completion note.
- [ ] Remove or justify the TypeScript contract and `.mjs` parity-test deliverables, because the merged Phase 3 materialization slices use SQL migrations plus inline `psql` parity gates rather than `web/src/lib/contracts/*` files or standalone parity tests.
- [ ] Expand `Prior context` to include the merged Phase 3 materialization precedent and source definitions this slice depends on, especially `diagnostic/slices/03-driver-session-summary-prototype.md`, `sql/008_core_build_schema.sql`, and `sql/007_semantic_summary_contracts.sql`.

### Low
- [ ] Expand acceptance criteria so each criterion maps to a specific gate command and exit condition, rather than only saying the parity test passes.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so it is current for this audit.
