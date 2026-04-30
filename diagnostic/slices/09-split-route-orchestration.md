---
slice_id: 09-split-route-orchestration
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T19:00:00Z
---

## Goal
Extract route-handler orchestration from `web/src/app/api/chat/route.ts` into `web/src/app/api/chat/orchestration.ts` (route.ts becomes a thin entry point that re-exports the moved symbols).

## Inputs
- `web/src/app/api/chat/route.ts` (currently the source of truth)
- `web/src/app/api/chat/orchestration.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/app/api/chat/route.ts`.
2. Move them to `web/src/app/api/chat/orchestration.ts`; re-export from `web/src/app/api/chat/route.ts` so existing import sites keep resolving via the back-compat re-exports (no other source files are modified in this slice).
3. Verify no circular imports between `web/src/app/api/chat/route.ts` and `web/src/app/api/chat/orchestration.ts`.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/app/api/chat/orchestration.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
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

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Make the target file path consistent across Goal, Inputs, Steps, Changed files expected, and Acceptance criteria; the Goal says `route/orchestration.ts` while the rest of the plan says `web/src/app/api/chat/orchestration.ts`.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the loop-required grading wrapper and baseline diff behavior.
- [x] Expand Changed files expected to include the import-site files Step 3 says will be updated, or narrow Step 3 so the stated file scope matches the actual work.

### Low

### Notes (informational only — no action)
