---
slice_id: 09-split-chatRuntime-recommendations
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract follow-up recommendation logic from chatRuntime.ts into chatRuntime/recommendations.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/recommendations.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts`.
2. Move them to `web/src/lib/chatRuntime/recommendations.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/recommendations.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/recommendations.ts` exists and exports the moved symbols.
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
- [ ] None.

### Medium
- [ ] Replace `cd web && npm run test:grading` in Gate commands with `bash scripts/loop/test_grading_gate.sh` so the slice uses the loop-approved grading wrapper instead of failing on known baseline issues.
- [ ] Expand `Changed files expected` to cover the import sites Step 3 requires, or narrow Step 3 so the declared file scope matches the planned edits.

### Low
- [ ] Add an acceptance criterion that makes Step 3 and Step 4 auditable by requiring all direct imports to resolve from `web/src/lib/chatRuntime/recommendations.ts` and the referenced gate(s) to be the proof that no circular import was introduced.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:09:50Z, so no stale-state note is needed.
