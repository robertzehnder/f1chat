---
slice_id: 03-core-build-schema
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T13:53:18Z
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Align the plan with the roadmap's Phase 3 architecture: use `core_build.<name>` as preserved source-definition views plus `core.<name>_mat` real tables and a public facade, or explicitly narrow this slice to source-definition views only; do not require `MATERIALIZED VIEW` objects or `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- [ ] Add executable DB gate commands that apply the SQL and verify the acceptance criteria, including rowcount and parity checks against at least three session keys; the current gate list only runs web build/typecheck/tests and cannot prove the database objects exist.
- [ ] Expand `Changed files expected` to include every file implied by the steps, including the TypeScript contract file and parity test file, or remove those steps from this slice.

### Medium
- [ ] Correct the target relation names and schema qualification so they match the existing semantic layer and Phase 3 roadmap; `core.session_summary`, `core.driver_summary`, and `core.lap_clean` are not referenced elsewhere, while the hot existing contract is `core.driver_session_summary`.
- [ ] Specify how the three parity-test sessions are selected, preferably from `core.session_completeness` analytic-ready sessions, so the test is deterministic and reproducible.

### Low
- [ ] Replace the self-reference in `## Prior context` with the roadmap Phase 3 section or relevant benchmark/perf artifacts, since listing this slice as its own prior context adds no audit value.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T05:12:12Z`).
