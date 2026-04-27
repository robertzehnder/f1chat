---
slice_id: 09-split-route-orchestration
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-26
---

## Goal
Extract route-handler orchestration from route.ts into route/orchestration.ts (route.ts becomes a thin entry point).

## Inputs
- `web/src/app/api/chat/route.ts` (currently the source of truth)
- `web/src/app/api/chat/orchestration.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/app/api/chat/route.ts`.
2. Move them to `web/src/app/api/chat/orchestration.ts`; re-export from `web/src/app/api/chat/route.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/app/api/chat/orchestration.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/app/api/chat/orchestration.ts` exists and exports the moved symbols.
- [ ] `web/src/app/api/chat/route.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)
