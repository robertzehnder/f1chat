---
slice_id: 04-explain-before-after
phase: 4
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T11:31:24Z
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Specify how the implementer obtains both the pre-index and post-index plans, including whether this slice runs against two DB states/snapshots or temporarily drops and reapplies the Phase 4 indexes; the current Steps assume a pre-index state that no longer exists once `04-perf-indexes-sql` has landed.
- [ ] Replace the unrelated `web` gate commands with DB/artifact gates that actually execute this slice's workflow and prove the acceptance criteria from the generated artifact; `build`, `typecheck`, and `test:grading` do not validate top-10 query selection, pre/post EXPLAIN capture, or delta computation.

### Medium
- [ ] Rename the Phase 4 index input from `sql/perf_indexes.sql` to `sql/020_perf_indexes.sql` so this slice matches the merged sibling `04-perf-indexes-sql` plan and the actual migration filename.
- [ ] Add the `01-perf-summary-route` rollup artifact to Inputs/Prior context, or change the Goal/Steps to name the baseline artifact actually used to rank the top 10 slowest queries; the current slice says the ranking comes from the rollup but points only at `01-baseline-snapshot-v2_2026-04-26.json`.
- [ ] Make the acceptance criteria fully testable and internally consistent by specifying where both p50 and p95 deltas are recorded and by adding a gate that asserts those fields in the output artifact; the current criteria require a p50 threshold only even though the Goal says to document p50/p95 deltas.
- [ ] Expand `Changed files expected` to include the slice file itself and any helper script or SQL artifact the implementer must add if artifact generation is not purely manual; the current list only names the JSON artifact.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on `2026-04-28T11:30:14Z`, so no stale-state note is required this round.
