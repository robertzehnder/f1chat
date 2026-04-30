---
slice_id: 09-line-count-gate
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T20:30:00Z
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
1. Add a script `scripts/loop/line_count_gate.sh` that fails (exit non-zero) if any `.ts` under `web/src/lib/` exceeds 500 lines, and exits 0 otherwise. Print offending file paths and their line counts on failure.
2. Wire into the existing CI workflow `.github/workflows/ci.yml` as a new step that runs `bash scripts/loop/line_count_gate.sh`.
3. Run `bash scripts/loop/line_count_gate.sh` locally; should exit 0 after all Phase 9 splits.
4. Verify the failure path: temporarily pad a `web/src/lib/*.ts` file past 500 lines (or feed an oversized fixture path), confirm the script exits non-zero and prints the offending file, then revert the padding before commit.

## Changed files expected
- `scripts/loop/line_count_gate.sh`
- `.github/workflows/ci.yml`

## Artifact paths
None.

## Gate commands
```bash
bash scripts/loop/line_count_gate.sh
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
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
- [x] Add the new line-count gate command itself to `## Gate commands` so the slice can verify `scripts/loop/line_count_gate.sh` exits 0 on current state and fails when a `web/src/lib/*.ts` file is padded past 500 lines, matching the acceptance criteria.

### Medium
- [x] Replace raw `cd web && npm run test:grading` in `## Gate commands` with `bash scripts/loop/test_grading_gate.sh` per the repository audit note, so pre-existing grading failures do not make this slice's verification nondeterministic.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T19:53:42Z, so no stale-state note is needed.
