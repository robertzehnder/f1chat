---
slice_id: 03-lap-phase-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T21:13:00-04:00
---

## Goal
Materialize `lap_phase_summary` (per lap: green, yellow, SC, VSC, red phase classification).

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
- `sql/lap_phase_summary.sql`
- `web/src/lib/contracts/lapPhaseSummary.ts`
- `web/scripts/tests/parity-lap-phase.test.mjs`

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
- [ ] Add database gate commands for this materialization slice in addition to the web gates, and make them prove apply/existence/parity success; the current gate list at `diagnostic/slices/03-lap-phase-summary.md:38` only runs web commands and does not satisfy the Phase 3 DB-gate rule from `diagnostic/_state.md`.
- [ ] Make the acceptance criteria at `diagnostic/slices/03-lap-phase-summary.md:45` executable by requiring the SQL apply/existence check and the parity check to exit `0`, not only that a generic parity test "passes."

### Medium
- [ ] Add the slice file itself to `Changed files expected` at `diagnostic/slices/03-lap-phase-summary.md:30`, because implementation will update this file's frontmatter and `Slice-completion note`.
- [ ] Specify the deterministic session selector for the ">=3 sessions" parity check in `diagnostic/slices/03-lap-phase-summary.md:27`, preferably using analytic-ready sessions from `core.session_completeness`, so repeated audits run the same coverage.
- [ ] State how the new parity test in `diagnostic/slices/03-lap-phase-summary.md:27` is actually executed by the gate list at `diagnostic/slices/03-lap-phase-summary.md:38`; if it is a standalone script, add the command explicitly instead of assuming `npm run test:grading` covers it.

### Low
- [ ] Add `psql` on PATH to `Required services / env` at `diagnostic/slices/03-lap-phase-summary.md:21` if the revised gate list applies SQL directly, so the execution prerequisites are complete.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T01:09:52Z, so no stale-state note is required for this round.
