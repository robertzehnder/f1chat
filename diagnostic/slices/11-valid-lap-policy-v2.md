---
slice_id: 11-valid-lap-policy-v2
phase: 11
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-05-01T09:46:00-04:00
---

## Goal
Refine the `is_valid_lap` policy: improve handling of out-laps, in-laps, SC laps, deleted laps. Update `core.lap_clean` and downstream contracts.

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
- [ ] Replace the missing input path `diagnostic/artifacts/healthcheck/11-rerun_2026-04-26.json` with an existing rerun artifact and name the exact failing question IDs/categories this slice will re-grade, because step 1 is blocked on a non-existent benchmark input.
- [ ] Replace `core.lap_clean` with the actual existing contract or relation names this slice will change, because repo context already records `core.lap_clean` as a placeholder that does not exist.
- [ ] Add an explicit gate command that re-grades the targeted question IDs and the same-category previously-passing IDs, and tie both acceptance checkboxes to that command, because the current gate block only runs build/typecheck/full grading tests and never exercises either acceptance criterion.

### Medium
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` per the loop audit protocol in `diagnostic/_state.md`.
- [ ] Replace `Changed files expected: (determined by diagnosis)` with the concrete file families the implementer is expected to touch, including the contract/test artifacts implied by the plan, so scope can be audited before implementation starts.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current when audited (`last updated: 2026-05-01T13:24:14Z`).
