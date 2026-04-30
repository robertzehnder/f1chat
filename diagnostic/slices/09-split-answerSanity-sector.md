---
slice_id: 09-split-answerSanity-sector
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract sector sanity checks from answerSanity.ts into answerSanity/sector.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/sector.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts`.
2. Move them to `web/src/lib/answerSanity/sector.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/sector.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/sector.ts` exists and exports the moved symbols.
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
- [ ] None.

### Medium
- [ ] Replace the raw grading gate `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required baseline-aware wrapper from `diagnostic/_state.md:69` instead of a repo-wide gate that can fail on unrelated known breakage (`diagnostic/slices/09-split-answerSanity-sector.md:37`).

### Low
- [ ] Reconcile Step 3 with the declared file scope: either name the concrete consumer files expected to change for import rewrites or narrow/remove the step if the split remains barrel-only, because the plan currently says it will update direct imports across the codebase while `Changed files expected` lists only the two library files (`diagnostic/slices/09-split-answerSanity-sector.md:27`, `diagnostic/slices/09-split-answerSanity-sector.md:30`).

### Notes (informational only — no action)
- The current repo search shows `@/lib/answerSanity` is imported from `web/src/app/api/chat/orchestration.ts`, but that is a barrel import, not a direct `answerSanity/sector` consumer.
