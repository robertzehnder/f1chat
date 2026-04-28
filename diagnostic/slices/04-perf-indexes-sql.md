---
slice_id: 04-perf-indexes-sql
phase: 4
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28
---

## Goal
Add the indexes identified in roadmap §4 Phase 4 to support common access patterns (driver+session lookups, stint/lap range scans, grid-vs-finish queries).

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 4

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/perf/01-baseline-snapshot-v2_2026-04-26.json`

## Required services / env
`DATABASE_URL`. Need privilege to `CREATE INDEX CONCURRENTLY`.

## Steps
1. Author SQL file `sql/perf_indexes.sql` listing each `CREATE INDEX CONCURRENTLY ... IF NOT EXISTS` per the roadmap.
2. Document the access pattern each index supports (one comment line per index).
3. Test: dry-run with `EXPLAIN` against representative queries from the catalog.

## Changed files expected
- `sql/perf_indexes.sql`
- `web/scripts/tests/perf-indexes.test.mjs`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] All `CREATE INDEX` statements parse against the live DB.
- [ ] EXPLAIN test confirms each new index is selected by the intended query (no Seq Scan on the supporting query path).

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace the web-only gate list with DB-backed gate commands that actually validate this slice's acceptance criteria, including applying/parsing `sql/perf_indexes.sql` against the target database and running the EXPLAIN checks for the indexed query shapes.
- [ ] Add the missing artifact or exact source for the "representative queries from the catalog" so the EXPLAIN step and acceptance criteria are reproducible instead of relying on an undefined catalog.

### Medium
- [ ] Fix the `## Prior context` block because `diagnostic/artifacts/perf/01-baseline-snapshot-v2_2026-04-26.json` does not exist in the worktree.
- [ ] Reconcile `## Steps` with `## Changed files expected` by explicitly planning the test artifact under `web/scripts/tests/perf-indexes.test.mjs` or removing it from expected changes if the slice is SQL-only.

### Low
- [ ] Clarify the required DB state for `CREATE INDEX CONCURRENTLY`, including that the gate must run outside a transaction against a database where the target tables already exist.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T04:35:20Z, so no stale-state note is needed this round.
