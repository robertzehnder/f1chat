---
slice_id: 09-split-chatRuntime-planTrace
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract plan-trace recording from chatRuntime.ts into chatRuntime/planTrace.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/planTrace.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts`.
2. Move them to `web/src/lib/chatRuntime/planTrace.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/planTrace.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/planTrace.ts` exists and exports the moved symbols.
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
- [ ] Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh` so the grading gate honors the repo baseline wrapper required by audit policy.

### Medium
- [ ] Expand `## Changed files expected` to cover the direct-import rewrites from Step 3, or narrow Step 3 if only `chatRuntime.ts` and `chatRuntime/planTrace.ts` should change.
- [ ] Add an explicit gate or acceptance check for Step 4's circular-import verification so the plan tests that requirement instead of leaving it implicit.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:22:22Z, so no staleness note applies.
