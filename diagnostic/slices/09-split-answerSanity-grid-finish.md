---
slice_id: 09-split-answerSanity-grid-finish
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T19:00:01Z
---

## Goal
Extract grid/finish sanity checks from answerSanity.ts into answerSanity/gridFinish.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/gridFinish.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target grid/finish functions/types in `web/src/lib/answerSanity.ts`.
2. Move them to `web/src/lib/answerSanity/gridFinish.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Verify no circular imports. (No direct-import migration step is needed: the only consumer in-tree is the barrel `@/lib/answerSanity` via `web/src/app/api/chat/orchestration.ts:11`, which the re-export in step 2 keeps stable.)

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/gridFinish.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && bash ../scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/gridFinish.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/answerSanity.ts` no longer contains the moved bodies (only re-exports if needed).
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
- [x] Replace `cd web && npm run test:grading` with `cd web && bash ../scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the required grading wrapper baseline instead of hard-failing on known unrelated grading failures (`diagnostic/_state.md:52`, `diagnostic/slices/09-split-answerSanity-grid-finish.md:36`).

### Medium
- [x] Reconcile Step 3 with the repo’s current import surface: either remove the repo-wide direct-import migration step or name the concrete files to update, because the current tree only imports the barrel `@/lib/answerSanity` and does not show any direct imports of a future `gridFinish` module (`web/src/app/api/chat/orchestration.ts:11`, `diagnostic/slices/09-split-answerSanity-grid-finish.md:25`).

### Low
- [x] Expand `Changed files expected` if Step 3 remains, because a plan that updates direct imports across the codebase cannot list only the source barrel and the new module as touched files (`diagnostic/slices/09-split-answerSanity-grid-finish.md:25-30`). (Step 3’s direct-import migration was removed per the Medium item, so the existing two-file `Changed files expected` list is correct as-is.)

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T18:56:33Z, so the required audit context is fresh.
