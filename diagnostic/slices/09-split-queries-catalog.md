---
slice_id: 09-split-queries-catalog
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract the query catalog declarations from queries.ts into queries/catalog.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/catalog.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`.
2. Move them to `web/src/lib/queries/catalog.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/catalog.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/queries/catalog.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (only re-exports if needed).
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
- [ ] Replace the raw `cd web && npm run test:grading` gate with `cd web && bash scripts/loop/test_grading_gate.sh` so the plan uses the required baseline-aware grading wrapper (`diagnostic/slices/09-split-queries-catalog.md:40`; `diagnostic/_state.md:50`).

### Medium
- [ ] Expand `Changed files expected` to cover the repo-wide direct-import rewrites required by Step 3, because the current list only names the two query files while the plan explicitly changes additional import sites (`diagnostic/slices/09-split-queries-catalog.md:26`; `diagnostic/slices/09-split-queries-catalog.md:29`).
- [ ] Add an acceptance criterion for Step 4 that makes the circular-import check explicit and testable instead of leaving it implied by generic gate success (`diagnostic/slices/09-split-queries-catalog.md:27`; `diagnostic/slices/09-split-queries-catalog.md:43`).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T17:10:30Z, so no stale-state note is needed.
