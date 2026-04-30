---
slice_id: 09-split-answerSanity-strategy-evidence
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract strategy-evidence sanity checks from answerSanity.ts into answerSanity/strategyEvidence.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/strategyEvidence.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts`.
2. Move them to `web/src/lib/answerSanity/strategyEvidence.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/strategyEvidence.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/strategyEvidence.ts` exists and exports the moved symbols.
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
- [ ] Replace `cd web && npm run test:grading` with `cd web && bash ../scripts/loop/test_grading_gate.sh` so the grading gate is evaluated against the shared failure baseline rather than raw repo-wide failures.

### Medium
- [ ] Expand `Changed files expected` to include the direct-import call sites Step 3 says will be updated; the current scope only lists the source and destination modules.
- [ ] Make Step 4 testable by naming the concrete proof for “Verify no circular imports” in gates or acceptance criteria, or remove that step if the existing build/typecheck gates are the intended check.

### Low

### Notes (informational only — no action)
- None.
