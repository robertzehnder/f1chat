---
slice_id: 04-perf-indexes-sql
phase: 4
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
