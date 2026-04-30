---
slice_id: 09-split-deterministicSql-pace
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract pace-related deterministic SQL from deterministicSql.ts into deterministicSql/pace.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/pace.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/deterministicSql.ts`.
2. Move them to `web/src/lib/deterministicSql/pace.ts`; re-export from `web/src/lib/deterministicSql.ts` for back-compat.
3. Update direct imports of these symbols across the codebase to point at the new file.
4. Verify no circular imports.

## Changed files expected
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/deterministicSql/pace.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && npm run test:grading
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/pace.ts` exists and exports the moved symbols.
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
- [ ] None.

### Medium
- [ ] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate uses the loop-approved baseline wrapper instead of failing on known shared grading failures.
- [ ] Rewrite the `web` gate commands so the block is runnable as written from the repo root, for example `(cd web && npm run build)` and `(cd web && npm run typecheck)`, because repeated `cd web && ...` lines leave the shell in `web/` after the first command.
- [ ] Enumerate the exact pace-related branches/helpers/constants to move out of `buildDeterministicSqlTemplate`, because the current “pace-related” wording is ambiguous in a file that mixes pace, pit, position, and canonical-ID templates.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.
