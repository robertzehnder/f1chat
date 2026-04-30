---
slice_id: 09-split-deterministicSql-dataHealth
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract data-health-check SQL from deterministicSql.ts into deterministicSql/dataHealth.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/dataHealth.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/deterministicSql.ts`.
2. Move them to `web/src/lib/deterministicSql/dataHealth.ts`; re-export from `web/src/lib/deterministicSql.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/deterministicSql/dataHealth.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/dataHealth.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the moved bodies (only re-exports if needed).
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
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the required grading baseline wrapper from `diagnostic/_state.md` ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:41]).

### Medium
- [ ] Expand `Changed files expected` to include the direct-import call sites that Step 3 says will be updated, or narrow Step 3 if those files are intentionally out of scope ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:27], [diagnostic/slices/09-split-deterministicSql-dataHealth.md:30]).
- [ ] Make the "Verify no circular imports" step testable by naming the concrete gate or acceptance criterion that proves it, instead of leaving it as an unbound manual check ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:28], [diagnostic/slices/09-split-deterministicSql-dataHealth.md:44]).

### Low
- [ ] Name the target symbols or symbol group being moved so the split scope is deterministic for the implementer and auditor ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:12], [diagnostic/slices/09-split-deterministicSql-dataHealth.md:25]).

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:57:30Z, so no stale-state note is required.
