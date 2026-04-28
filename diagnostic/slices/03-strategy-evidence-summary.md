---
slice_id: 03-strategy-evidence-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T20:16:43-0400
---

## Goal
Materialize `strategy_evidence_summary` (per strategic decision: which lap, what evidence available).

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
- `sql/strategy_evidence_summary.sql`
- `web/src/lib/contracts/strategyEvidenceSummary.ts`
- `web/scripts/tests/parity-strategy-evidence.test.mjs`

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
- [ ] Name the exact database objects this slice must create and validate, using the Phase 3 pattern from `03-core-build-schema`: make `core_build.strategy_evidence_summary` the source input, and specify whether implementation creates `core.strategy_evidence_summary_mat`, a public `core.strategy_evidence_summary` facade swap, or both.
- [ ] Replace the web-only gate list with executable database gates that apply the SQL and prove success end-to-end, including object existence and a bidirectional parity check against the live-query equivalent for three deterministic sessions.

### Medium
- [ ] Replace the ambiguous path `sql/strategy_evidence_summary.sql` with the actual migration file the implementer should add, following the repo's numbered SQL migration convention and matching the database objects named in the steps.
- [ ] Make the parity requirement reproducible by specifying exactly how the three sessions are chosen and where that logic runs; `for ≥3 sessions` is not deterministic enough for an audit-grade acceptance check.
- [ ] Expand `Required services / env` to cover the tooling the gates need, including `psql` on `PATH` and the database privileges required for the exact relation type named in the plan.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` is current enough to use; no stale-state note is needed for this round.
