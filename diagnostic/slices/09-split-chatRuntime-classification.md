---
slice_id: 09-split-chatRuntime-classification
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract the question-classification logic from chatRuntime.ts into chatRuntime/classification.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/classification.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts`.
2. Move them to `web/src/lib/chatRuntime/classification.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/classification.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/classification.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate uses the required baseline-aware wrapper from `diagnostic/_state.md`.

### Medium
- [ ] Expand `Changed files expected` to include the import-consumer files Step 3 says will be updated, because the current scope lists only `chatRuntime.ts` and the new `classification.ts`.
- [ ] Make Step 4 testable by naming the concrete check for circular imports or by removing that step if build/typecheck are the intended proof.

### Low
- [ ] Add an acceptance criterion that direct imports of the moved symbols are updated to `web/src/lib/chatRuntime/classification.ts`, matching Step 3.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:05:46Z, so no stale-state note applies.
