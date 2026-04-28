---
slice_id: 03-strategy-evidence-summary
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T20:16:18-04:00
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
- [ ] Replace the slice body with the actual Phase 3 materialization pattern for `strategy_evidence_summary`: use the existing `core_build.strategy_evidence_summary` source-definition view, create a real `core.strategy_evidence_summary_mat` table refreshed from `core_build`, and swap `core.strategy_evidence_summary` to a thin facade; do not introduce a standalone PostgreSQL materialized view.
- [ ] Add executable DB gate commands that apply the SQL and verify the new `_mat` table, the public facade, and bidirectional session-scoped `EXCEPT ALL` parity against `core_build.strategy_evidence_summary` for 3 deterministic `analytic_ready` sessions; the current web-only gates cannot prove the acceptance criteria.

### Medium
- [ ] Rewrite `Steps`, `Changed files expected`, and `Acceptance criteria` to match the repo's SQL-only Phase 3 summary-slice pattern: this plan should not add a TypeScript contract file or a `.mjs` parity test, and it must include the new SQL migration file plus this slice file in scope.
- [ ] Specify the required DB gate prerequisites completely, including `psql` on `PATH` and any object-level checks needed for `core.strategy_evidence_summary_mat` shape and facade dependency, so the implementer can run the slice without inferring missing tooling or assertions.

### Low
- [ ] Tighten the acceptance criteria so each item is directly testable by a named gate command exit `0` rather than the generic `Parity test passes`.

### Notes (informational only — no action)
- `diagnostic/_state.md` is current enough to use; no staleness note is needed this round.
- `sql/008_core_build_schema.sql` already defines `core_build.strategy_evidence_summary`, so this slice should build on that prior artifact rather than recreate the source-definition query.
