---
slice_id: 09-split-queries-execute
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract the query-execute wrapper from queries.ts into queries/execute.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/execute.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`.
2. Move them to `web/src/lib/queries/execute.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/execute.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/queries/execute.ts` exists and exports the moved symbols.
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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is evaluated through the loop baseline wrapper required by current audit policy.

### Medium
- [ ] Expand `Changed files expected` to include the direct-import call sites from Step 3, because the plan currently scopes edits to only two files while explicitly requiring repo-wide import updates.
- [ ] Add a concrete gate or acceptance check for Step 4's circular-import requirement; "Verify no circular imports" is currently untestable from the listed commands and criteria.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current on 2026-04-30, so no stale-state note applies.
