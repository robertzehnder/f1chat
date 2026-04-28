---
slice_id: 03-lap-context-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T23:35:05-0400
---

## Goal
Materialize `lap_context_summary` (per driver-lap: traffic ahead/behind, gap deltas, sector flags).

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
- `sql/lap_context_summary.sql`
- `web/src/lib/contracts/lapContextSummary.ts`
- `web/scripts/tests/parity-lap-context.test.mjs`

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
- [ ] Replace the `CREATE MATERIALIZED VIEW` plan with the Phase 3 contract-materialization shape already established by prior context: preserve `core_build.lap_context_summary` as the source-definition view and define the slice around the actual materialized contract object/facade the roadmap expects, or explicitly narrow the goal so it no longer claims to materialize the contract.
- [ ] Add database gate commands that apply the SQL and verify object existence plus parity against the live query for 3 deterministic sessions; the current gate list only runs web commands and cannot prove the contract was created or matches source output.

### Medium
- [ ] Expand `Changed files expected` to include the slice file itself for the required frontmatter and slice-completion-note edits, or explicitly state that audit-process edits are excluded from the scope list.
- [ ] Make the acceptance criteria testable by naming the concrete contract object that must exist and by tying parity to a command or exit-0 gate rather than the generic statement "Parity test passes."
- [ ] Specify how the parity-test sessions are chosen and what tool executes the parity check so the implementer has a reproducible DB-side procedure, including any `psql`/PATH prerequisite if that is the intended gate mechanism.

### Low
- [ ] Clarify whether the TypeScript contract type is generated from the SQL contract shape or maintained manually so the step is auditable against stable column ordering.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current enough to use; no staleness note needed.
- The build-before-typecheck gate ordering already matches the current auditor note.
