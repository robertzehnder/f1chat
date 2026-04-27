---
slice_id: 09-split-queries-execute
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Extract the query-execute wrapper from queries.ts into queries/execute.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/execute.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`.
2. Move them to `web/src/lib/queries/execute.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/execute.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/queries/execute.ts` exists and exports the moved symbols.
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
