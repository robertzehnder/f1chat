---
slice_id: 11-multi-axis-grader-redesign
phase: 11
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01
---

## Goal
Redesign the chat-quality grader to score on multiple axes (factual correctness, completeness, clarity) instead of a single A/B/C grade. Update healthcheck artifact schema accordingly.

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
- [ ] Rewrite the acceptance criteria and validation steps around multi-axis outputs instead of `A or B`, because the goal is to replace the single-letter grade with factual-correctness / completeness / clarity scoring and the current plan still audits the old schema.
- [ ] Add explicit implementation and gate coverage for the healthcheck artifact schema update, including the concrete artifact fields/files that must change and the command(s) that prove consumers still pass with the new schema.

### Medium
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` per the loop protocol in `diagnostic/_state.md`.
- [ ] Expand `## Changed files expected` beyond `(determined by diagnosis)` to name the grader, healthcheck artifact schema, and test files the implementer is expected to touch so slice scope is auditable.
- [ ] Make step 4 and the acceptance criteria name the exact re-grade artifact or test assertion that proves the targeted question IDs improved on the new axes and that previously passing questions in the same category did not regress.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T18:26:26Z`).
