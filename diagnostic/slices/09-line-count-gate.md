---
slice_id: 09-line-count-gate
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Add a CI gate asserting no single TS file in `web/src/lib/` exceeds 500 lines after all Phase 9 splits land. Catches future bloat regressions.

## Inputs
- `web/src/lib/`
- `.github/workflows/ci.yml`

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Add a script `scripts/loop/line_count_gate.sh` that fails if any `.ts` under `web/src/lib/` exceeds 500 lines.
2. Wire into the existing CI workflow.
3. Run locally; should pass after all Phase 9 splits.

## Changed files expected
- `scripts/loop/line_count_gate.sh`
- `.github/workflows/ci.yml`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] Gate exits 0 against current state.
- [ ] Gate exits non-zero if a test file in lib/ is artificially padded > 500 lines.

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
- [ ] Add the new line-count gate command itself to `## Gate commands` so the slice can verify `scripts/loop/line_count_gate.sh` exits 0 on current state and fails when a `web/src/lib/*.ts` file is padded past 500 lines, matching the acceptance criteria.

### Medium
- [ ] Replace raw `cd web && npm run test:grading` in `## Gate commands` with `bash scripts/loop/test_grading_gate.sh` per the repository audit note, so pre-existing grading failures do not make this slice's verification nondeterministic.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T19:53:42Z, so no stale-state note is needed.
