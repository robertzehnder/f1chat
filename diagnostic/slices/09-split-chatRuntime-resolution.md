---
slice_id: 09-split-chatRuntime-resolution
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract entity-resolution wiring from chatRuntime.ts into chatRuntime/resolution.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/resolution.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts`.
2. Move them to `web/src/lib/chatRuntime/resolution.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/resolution.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/resolution.ts` exists and exports the moved symbols.
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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is baseline-aware per loop protocol.

### Medium
- [ ] Expand `Changed files expected` to include the direct-import callsites Step 3 says will be updated, not only `chatRuntime.ts` and `chatRuntime/resolution.ts`.
- [ ] Add an acceptance criterion that makes Step 3 testable by requiring direct imports of the moved symbols to resolve from `web/src/lib/chatRuntime/resolution.ts` while back-compat re-exports from `web/src/lib/chatRuntime.ts` remain intact.

### Low
- [ ] Add an explicit gate or acceptance check for the “no circular imports” requirement in Step 4 instead of leaving it as an unverified instruction.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:25:18Z, so its auditor notes are current.
