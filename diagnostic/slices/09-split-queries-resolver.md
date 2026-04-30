---
slice_id: 09-split-queries-resolver
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract query→resolver mapping from queries.ts into queries/resolver.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/resolver.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`.
2. Move them to `web/src/lib/queries/resolver.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/resolver.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/queries/resolver.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (only re-exports if needed).
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

### Medium
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is evaluated through the loop baseline wrapper required by `diagnostic/_state.md`.
- [ ] Expand `## Changed files expected` to include the non-`queries.ts` import sites that Step 3 explicitly updates, or narrow Step 3 so the declared file scope matches the planned edits.

### Low
- [ ] Make Step 4 and its acceptance coverage concrete by naming how the slice proves the split introduces no circular import beyond the existing build/typecheck gates.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T17:22:56Z, so no staleness note applies.
