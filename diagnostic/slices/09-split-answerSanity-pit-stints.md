---
slice_id: 09-split-answerSanity-pit-stints
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract pit-stint sanity checks from answerSanity.ts into answerSanity/pitStints.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/pitStints.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts`.
2. Move them to `web/src/lib/answerSanity/pitStints.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/pitStints.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/pitStints.ts` exists and exports the moved symbols.
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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is evaluated against the maintained baseline instead of auto-failing on known unrelated repo-wide test failures.

### Medium
- [ ] Expand `Changed files expected` to include the direct-import call sites touched by Step 3, or narrow Step 3 so the slice no longer claims repo-wide import rewrites outside the listed file scope.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T18:31:51Z, so the required audit context is current.
