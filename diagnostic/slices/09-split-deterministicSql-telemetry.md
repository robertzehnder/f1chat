---
slice_id: 09-split-deterministicSql-telemetry
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract telemetry SQL from deterministicSql.ts into deterministicSql/telemetry.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/telemetry.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/deterministicSql.ts`.
2. Move them to `web/src/lib/deterministicSql/telemetry.ts`; re-export from `web/src/lib/deterministicSql.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/deterministicSql/telemetry.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/telemetry.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the declared grading gate matches the repo audit wrapper and does not fail on known baseline noise.

### Medium
- [ ] Expand `Changed files expected` to include the direct-import call sites from Step 3, because the current file list omits the repo files the plan explicitly says to edit.

### Low
- [ ] Add an acceptance criterion that makes Step 4 testable by requiring the moved telemetry symbols to import without introducing a circular-dependency failure.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:41:30Z, so no stale-state warning applies.
