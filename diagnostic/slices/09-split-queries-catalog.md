---
slice_id: 09-split-queries-catalog
phase: 9
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T13:21:47-0400
---

## Goal
Extract the query catalog declarations from queries.ts into queries/catalog.ts. Concretely, the catalog declaration in scope is `getSchemaCatalog` (the `information_schema.columns` lookup over `raw`/`core` schemas at `web/src/lib/queries.ts:759`), which is the lone "catalog" reader in the file.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/catalog.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`. In scope: `getSchemaCatalog` (and any helper types it owns; at audit time it owns none).
2. Move them to `web/src/lib/queries/catalog.ts`; re-export from `web/src/lib/queries.ts` for back-compat so any not-yet-rewritten imports stay green.
3. Update direct imports of these symbols across the codebase to point at the new file. The known direct-import sites for `getSchemaCatalog` (verified via `grep -rn "getSchemaCatalog" web/src`) are:
   - `web/src/app/catalog/page.tsx`
   - `web/src/app/api/schema/route.ts`
   Re-grep before committing to confirm no additional callers were introduced.
4. Verify no circular imports between `queries.ts` and `queries/catalog.ts`. Concretely: `queries/catalog.ts` MUST NOT import from `web/src/lib/queries.ts` (only from leaf modules such as `web/src/lib/db.ts`). Confirm by grep.

## Changed files expected
- `web/src/lib/queries.ts` (remove `getSchemaCatalog` body; keep a re-export for back-compat)
- `web/src/lib/queries/catalog.ts` (new file holding `getSchemaCatalog`)
- `web/src/app/catalog/page.tsx` (rewrite import to `@/lib/queries/catalog`)
- `web/src/app/api/schema/route.ts` (rewrite import to `@/lib/queries/catalog`)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/queries/catalog.ts` exists and exports `getSchemaCatalog` (verify via `grep -n "export async function getSchemaCatalog" web/src/lib/queries/catalog.ts`).
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (only re-exports if needed); verify via `grep -n "export async function getSchemaCatalog" web/src/lib/queries.ts` returning no match.
- [ ] No circular import introduced: `grep -n "from \"@/lib/queries\"\\|from \"\\.\\./queries\"\\|from \"\\.\\./\\.\\./lib/queries\"" web/src/lib/queries/catalog.ts` returns no match (the new file imports only leaf modules, never the parent barrel).
- [ ] Direct-import sites listed in Step 3 now import from `@/lib/queries/catalog`; verify via `grep -rn "getSchemaCatalog" web/src` showing every caller resolved either to the new path or to the back-compat re-export, with zero residual references to a missing symbol.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

Branch: `slice/09-split-queries-catalog`
Commit: see `[slice:09-split-queries-catalog][awaiting-audit]` HEAD on this branch.

### Decisions
- Created `web/src/lib/queries/catalog.ts` with `getSchemaCatalog`. The function only depends on the `sql` helper, so the new file imports `from "../db"` (a leaf module) — never from `web/src/lib/queries.ts`, so no circular import is possible.
- `web/src/lib/queries.ts` line 759 now reads `export { getSchemaCatalog } from "./queries/catalog";` — back-compat re-export retained, body removed.
- Direct-import sites updated: `web/src/app/catalog/page.tsx` and `web/src/app/api/schema/route.ts` both now import from `@/lib/queries/catalog`.
- Pure mechanical move; no behavioral change to the SQL or the function signature.

### Self-check (acceptance criteria)
- `grep -n "export async function getSchemaCatalog" web/src/lib/queries/catalog.ts` → matches at line 3.
- `grep -n "export async function getSchemaCatalog" web/src/lib/queries.ts` → no match (only the `export { ... } from` re-export remains).
- Circular-import grep `grep -n "from \"@/lib/queries\"\|from \"\.\./queries\"\|from \"\.\./\.\./lib/queries\"" web/src/lib/queries/catalog.ts` → no match.
- `grep -rn "getSchemaCatalog" web/src` shows the two callers resolved to `@/lib/queries/catalog`, the new file definition, and the re-export in `queries.ts`. No residual references to a missing symbol.

### Gates (exit codes)
- `cd web && npm run build` → 0
- `cd web && npm run typecheck` → 0
- `bash scripts/loop/test_grading_gate.sh` → 0 (`PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`)

## Audit verdict
**Status: PASS**

Gate #1 `cd web && npm run build` -> exit `0`
Gate #2 `cd web && npm run typecheck` -> exit `0`
Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
Scope diff -> PASS (`diagnostic/slices/09-split-queries-catalog.md`, `web/src/app/api/schema/route.ts`, `web/src/app/catalog/page.tsx`, `web/src/lib/queries.ts`, `web/src/lib/queries/catalog.ts`)
Criterion 1 -> PASS [`web/src/lib/queries/catalog.ts:3`]
Criterion 2 -> PASS [`web/src/lib/queries.ts:759`]; `grep -n "export async function getSchemaCatalog" web/src/lib/queries.ts` exit `1`
Criterion 3 -> PASS [`web/src/lib/queries/catalog.ts:1`]; circular-import grep exit `1`
Criterion 4 -> PASS [`web/src/app/api/schema/route.ts:2`, `web/src/app/catalog/page.tsx:2`, `web/src/lib/queries.ts:759`, `web/src/lib/queries/catalog.ts:3`]
Criterion 5 -> PASS
Decision -> PASS

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the raw `cd web && npm run test:grading` gate with `cd web && bash scripts/loop/test_grading_gate.sh` so the plan uses the required baseline-aware grading wrapper (`diagnostic/slices/09-split-queries-catalog.md:40`; `diagnostic/_state.md:50`).

### Medium
- [x] Expand `Changed files expected` to cover the repo-wide direct-import rewrites required by Step 3, because the current list only names the two query files while the plan explicitly changes additional import sites (`diagnostic/slices/09-split-queries-catalog.md:26`; `diagnostic/slices/09-split-queries-catalog.md:29`).
- [x] Add an acceptance criterion for Step 4 that makes the circular-import check explicit and testable instead of leaving it implied by generic gate success (`diagnostic/slices/09-split-queries-catalog.md:27`; `diagnostic/slices/09-split-queries-catalog.md:43`).

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T17:10:30Z, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T17:10:30Z, so no stale-state note is needed.
