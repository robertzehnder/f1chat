---
slice_id: 09-split-queries-resolver
phase: 9
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T23:05:00Z
---

## Goal
Extract query→resolver mapping from queries.ts into queries/resolver.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/resolver.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`.
2. Move them to `web/src/lib/queries/resolver.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Leave existing call-site imports unchanged — they continue to resolve through the back-compat re-exports in `web/src/lib/queries.ts`. (Slice scope is the two files in `## Changed files expected`; do not touch other import sites.)
4. Prove no circular import was introduced: assert via `! grep -n "from ['\"]\\(\\.\\./queries\\|@/lib/queries\\)['\"]" web/src/lib/queries/resolver.ts` that the new resolver file does NOT import from `web/src/lib/queries.ts` (since queries.ts now re-exports from it). The negated grep exits non-zero on any match, failing the gate. The build/typecheck gate must additionally pass.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/resolver.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
# Circular-import guard: fails (non-zero) if resolver.ts imports queries.ts.
# `! grep -n …` inverts grep's exit code so an empty result (no match) exits 0
# and any match exits non-zero, blocking the gate.
! grep -n "from ['\"]\(\.\./queries\|@/lib/queries\)['\"]" web/src/lib/queries/resolver.ts
```

## Acceptance criteria
- [ ] `web/src/lib/queries/resolver.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] `web/src/lib/queries/resolver.ts` does not import from `web/src/lib/queries.ts` (Step 4 grep returns empty), proving no `queries.ts ↔ resolver.ts` cycle.
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

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is evaluated through the loop baseline wrapper required by `diagnostic/_state.md`.
- [x] Expand `## Changed files expected` to include the non-`queries.ts` import sites that Step 3 explicitly updates, or narrow Step 3 so the declared file scope matches the planned edits.

### Low
- [x] Make Step 4 and its acceptance coverage concrete by naming how the slice proves the split introduces no circular import beyond the existing build/typecheck gates.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T17:22:56Z, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High

### Medium
- [x] Remove the trailing `|| true` from the circular-import `grep` gate, or replace it with an explicit empty-output assertion that exits non-zero on any match, so `All gate commands pass` cannot succeed when `resolver.ts` imports `queries.ts`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T17:22:56Z, so no staleness note applies.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T17:22:56Z, so no staleness note applies.
