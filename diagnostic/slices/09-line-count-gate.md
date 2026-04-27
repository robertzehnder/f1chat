---
slice_id: 09-line-count-gate
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
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
