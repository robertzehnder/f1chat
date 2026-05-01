---
slice_id: 11-resolver-disambiguation-tightening
phase: 11
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T13:42:51-04:00
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Add an explicit command path that identifies the target failing question IDs from `diagnostic/artifacts/healthcheck/11-rerun_2026-04-26.json`, re-runs just those questions after the resolver change, and asserts they now grade A or B, because the current gate block at `diagnostic/slices/11-resolver-disambiguation-tightening.md:37` never executes the core verification required by steps 1 and 4 (`diagnostic/slices/11-resolver-disambiguation-tightening.md:25`).
- [ ] Replace `cd web && npm run test:grading` at `diagnostic/slices/11-resolver-disambiguation-tightening.md:41` with `bash scripts/loop/test_grading_gate.sh`, because `_state.md` requires the baseline-aware wrapper for slice grading gates.

### Medium
- [ ] Specify the required services and env for the targeted re-grade workflow at `diagnostic/slices/11-resolver-disambiguation-tightening.md:22`, or replace the workflow with a fully local command path, because `None at author time` is not compatible with the planned post-fix grading step.
- [ ] Make the second acceptance criterion at `diagnostic/slices/11-resolver-disambiguation-tightening.md:46` testable by naming the exact comparison set and gate command for “previously-passing questions in the same category”, or narrow the criterion to the questions the plan actually re-grades.

### Low
- [ ] Replace `(determined by diagnosis)` at `diagnostic/slices/11-resolver-disambiguation-tightening.md:32` with the expected resolver/test file scope once the intended rerun path is defined, so implementers are not left with an unbounded edit surface.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T15:42:52Z`).
