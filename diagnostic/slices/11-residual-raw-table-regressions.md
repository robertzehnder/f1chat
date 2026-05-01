---
slice_id: 11-residual-raw-table-regressions
phase: 11
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T23:59:00-04:00
---

## Goal
Find any chat questions still hitting raw `f1.*` tables instead of the materialized contracts; fix them by routing through the matview path.

## Inputs
- `diagnostic/artifacts/healthcheck/11-rerun_2026-04-26.json`
- Specific failing question IDs from that artifact

## Prior context
- `diagnostic/_state.md`
- `diagnostic/slices/11-rerun-benchmark-baseline.md`

## Required services / env
None at author time.

## Steps
1. Identify the specific failing-question IDs the slice targets.
2. Diagnose root cause.
3. Apply the fix.
4. Re-grade just the target questions to confirm the fix.

## Changed files expected
- `(determined by diagnosis)`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Targeted question IDs now grade A or B.
- [ ] No regression on previously-passing questions in the same category.

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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh`, or declare an isolated grading gate that exits 0 for only the targeted questions plus the same-category regression set, because raw `npm run test:grading` violates the loop audit protocol and does not prove the slice-local acceptance criteria.
- [ ] Add an explicit gate command that re-grades the targeted failing question IDs and a second explicit gate that checks previously-passing questions in the same category still pass, because the current gate block contains only repo-wide build/typecheck/grading commands and never tests either acceptance criterion directly.

### Medium
- [ ] Replace `Specific failing question IDs from that artifact` with the concrete question IDs or a deterministic command/path that derives them, so the slice scope is auditable and step 1 is reproducible.
- [ ] Update `## Required services / env` to list every prerequisite needed to diagnose and re-grade chat questions, including the DB/web/API env and any required running service, because `None at author time.` conflicts with the planned grading workflow.
- [ ] Replace `Changed files expected: (determined by diagnosis)` with the minimum expected file set or an explicit bounded pattern, because the current scope declaration is too open-ended for a plan that intends to route queries off raw `f1.*` tables.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T03:00:31Z`).
