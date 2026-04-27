---
slice_id: 04-explain-before-after
phase: 4
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Capture EXPLAIN ANALYZE plans for the top 10 slowest queries (per `01-perf-summary-route` rollup) before and after the Phase 4 indexes land. Document p50/p95 deltas.

## Inputs
- `sql/perf_indexes.sql`
- `diagnostic/artifacts/perf/01-baseline-snapshot-v2_2026-04-26.json`

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/04-perf-indexes-sql.md`

## Required services / env
`DATABASE_URL`.

## Steps
1. Identify top 10 slowest queries from the v2 baseline artifact.
2. Run EXPLAIN ANALYZE pre- and post-index, capture both plans into the artifact JSON.
3. Compute per-query speedup; flag any regressions.

## Changed files expected
- `diagnostic/artifacts/perf/04-explain-before-after_2026-04-26.json`

## Artifact paths
- `diagnostic/artifacts/perf/04-explain-before-after_2026-04-26.json`

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Artifact contains pre/post EXPLAIN plans for ≥10 queries.
- [ ] Net p50 speedup across the 10 ≥ 1.5×; no regression > 1.2× slower.

## Out of scope
- Anything outside the slice's declared scope.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
