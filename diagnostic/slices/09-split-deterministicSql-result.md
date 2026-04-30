---
slice_id: 09-split-deterministicSql-result
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract result/finish SQL from deterministicSql.ts into deterministicSql/result.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/result.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/deterministicSql.ts`.
2. Move them to `web/src/lib/deterministicSql/result.ts`; re-export from `web/src/lib/deterministicSql.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/deterministicSql/result.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/result.ts` exists and exports the moved symbols.
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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required baseline-aware grading gate instead of failing on known unrelated test debt.

### Medium
- [ ] Expand `## Changed files expected` to include every direct-import consumer Step 3 may retarget, not only `web/src/lib/deterministicSql.ts` and `web/src/lib/deterministicSql/result.ts`.
- [ ] Add an acceptance criterion that makes Step 3 testable by requiring all direct imports of the moved symbols to resolve from `web/src/lib/deterministicSql/result.ts` after the split.

### Low
- [ ] Add an acceptance criterion or explicit gate note for Step 4 that no circular import is introduced, instead of leaving that verification implicit.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:28:16Z, so no stale-state note is needed.
