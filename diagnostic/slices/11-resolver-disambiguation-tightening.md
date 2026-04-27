---
slice_id: 11-resolver-disambiguation-tightening
phase: 11
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Tighten resolver disambiguation: when a query mentions "Verstappen", default to Max in 2024+ but resolve other Verstappens for historic seasons. Avoid silent wrong-driver answers.

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
