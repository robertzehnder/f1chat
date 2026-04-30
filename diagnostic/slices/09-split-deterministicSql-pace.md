---
slice_id: 09-split-deterministicSql-pace
phase: 9
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T16:15:00-04:00
---

## Goal
Extract pace-related deterministic SQL branches from `web/src/lib/deterministicSql.ts` into a new helper module `web/src/lib/deterministicSql/pace.ts`. Pure mechanical split; no behavior change.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth — contains `buildDeterministicSqlTemplate` plus shared helpers; also currently `export type DeterministicSqlTemplate`)
- `web/src/lib/deterministicSql/types.ts` (new file — owns `DeterministicSqlTemplate` so both modules can import it without forming a cycle)
- `web/src/lib/deterministicSql/pace.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Scope — exact symbols to move

The following pace-related branches inside `buildDeterministicSqlTemplate` (`web/src/lib/deterministicSql.ts`) are in scope. Each is identified by its `templateKey` and the source-line of the entry `if`. These return-blocks (the `if (...) { return { templateKey: ..., sql: \`...\` }; }` units) are the move targets:

1. `practice_laps_vs_race_pace_same_meeting` — branch starting at line 186 (uses `mentionsRacePaceComparison` and `mentionsPractice`).
2. `max_leclerc_avg_clean_lap_pace` — branch starting at line 337 (`average clean-lap pace`).
3. `max_leclerc_lap_degradation_by_stint` — branch starting at line 553 (`degradation trend`; pace-degradation by stint).
4. `max_leclerc_final_third_pace` — branch starting at line 595 (`final third`).
5. `max_leclerc_common_lap_window_pace` — branch starting at line 796 (`same lap window`).
6. `max_leclerc_pre_post_pit_pace` — branch starting at line 1063 (`undercut`/`overcut`; uses `pace_windows` CTE).
7. `max_leclerc_stint_pace_vs_tire_age` — branch starting at line 1212 (`strongest pace relative to tire age`).
8. `max_leclerc_post_pit_pace` — branch starting at line 1349 (`after pit stops`).
9. `max_leclerc_lap_pace_summary` — branch starting at line 1440 (`lap pace`/`compare`).

Pace-detection helper locals computed inside `buildDeterministicSqlTemplate` that are only consumed by these branches (e.g. `mentionsRacePaceComparison`, `practiceVsRaceDriver`, `mentionsPractice`) move with branch (1) into the new module. Shared locals that other (non-pace) branches still depend on — `lower`, `targetSession`, `driverPairSql`, `useFixedPair`, `mentionsAbuDhabi`, `mentions2025`, `abuDhabi2025`, `isMaxVsLeclerc`, `hasComparisonLanguage`, `resolvedDriverPair`, plus the file-level helpers `normalizeInt`, `includesAny`, `includesAll` and the constants `MAX_VERSTAPPEN`, `CHARLES_LECLERC` — stay in `deterministicSql.ts` and are passed in as arguments to the new pace helper.

Out of scope for this slice: pit, position, sector, tire-compound, fastest-lap, and canonical-ID branches — none are moved here.

## Steps
1. Create `web/src/lib/deterministicSql/types.ts` exporting `export type DeterministicSqlTemplate = { templateKey: string; sql: string };`. In `web/src/lib/deterministicSql.ts`, replace the inline `export type DeterministicSqlTemplate = …` (lines 1–4) with BOTH a local type-only import AND a re-export, so the same file can still use `DeterministicSqlTemplate` as a return-type annotation on `buildDeterministicSqlTemplate` while preserving the existing public surface (`import { DeterministicSqlTemplate } from "@/lib/deterministicSql"` if any). Concretely, replace those four lines with the following two lines:
   ```ts
   import type { DeterministicSqlTemplate } from "./deterministicSql/types";
   export type { DeterministicSqlTemplate } from "./deterministicSql/types";
   ```
   The `import type` brings the symbol into the file's local scope so `buildDeterministicSqlTemplate(...): DeterministicSqlTemplate` continues to type-check; the `export type { ... } from` keeps the symbol re-exported from `@/lib/deterministicSql` for any external importer. Both lines are erased at compile time, so no runtime import is added.
2. In `web/src/lib/deterministicSql/pace.ts`, `import type { DeterministicSqlTemplate } from "./types";` and export a single function `buildPaceTemplate(input)` returning `DeterministicSqlTemplate | null`. `input` carries the shared locals listed above plus `lower`. Move the pace-only helper computations (`mentionsRacePaceComparison`, `practiceVsRaceDriver`, `mentionsPractice`) as locals inside `buildPaceTemplate`. The body of `buildPaceTemplate` MUST evaluate the nine moved branches in the same relative order they currently appear in `buildDeterministicSqlTemplate` — the source-line ordering already enumerated in **Scope — exact symbols to move** (1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9, i.e. lines 186, 337, 553, 595, 796, 1063, 1212, 1349, 1440). First-match-wins dispatch must produce the same `templateKey` for every prompt that any pair of these branches could match — preserving order is what guarantees that. The new module imports nothing from `deterministicSql.ts` (only from `./types`), so no cycle is possible.
3. In `web/src/lib/deterministicSql.ts`, replace the nine return-blocks listed above with a single early-return: `const pace = buildPaceTemplate({ lower, targetSession, driverPairSql, ... }); if (pace) return pace;`. Place the call at the original first-pace-branch position (line 186 region) so dispatch order is unchanged.
4. Do not re-export `buildPaceTemplate` from `web/src/lib/deterministicSql.ts`. `buildPaceTemplate` is a new internal helper with no existing public callers (grep confirms zero importers; the symbol did not exist before this slice). Keeping it private to `web/src/lib/deterministicSql/pace.ts` matches the “pure mechanical split, no behavior change” scope and avoids speculatively expanding the public API surface of `deterministicSql.ts`. The only existing external caller of the file (`web/src/app/api/chat/route.ts`, which imports `buildDeterministicSqlTemplate`) needs no edit, and grep confirms no external callers import the per-branch `templateKey` strings or pace-only helper locals being moved (those locals were never exported). No caller-file edits are therefore expected in `Changed files expected`.
5. Verify no circular imports between `deterministicSql.ts` and `deterministicSql/pace.ts` (build will fail loudly if introduced; see Acceptance criteria).

## Changed files expected
- `web/src/lib/deterministicSql.ts` (inline `DeterministicSqlTemplate` type replaced with both a local `import type { DeterministicSqlTemplate } from "./deterministicSql/types";` — needed so `buildDeterministicSqlTemplate(...): DeterministicSqlTemplate` still type-checks — and `export type { DeterministicSqlTemplate } from "./deterministicSql/types";` to preserve the public surface; nine pace branches removed; one delegating `import { buildPaceTemplate } from "./deterministicSql/pace";` plus the early-return call inserted at the original first-pace-branch position; `buildPaceTemplate` is NOT re-exported)
- `web/src/lib/deterministicSql/types.ts` (new; sole owner of `export type DeterministicSqlTemplate`)
- `web/src/lib/deterministicSql/pace.ts` (new; `import type { DeterministicSqlTemplate } from "./types";` and exports `buildPaceTemplate`)

No caller-file edits are expected: `web/src/app/api/chat/route.ts` (the only external importer of `buildDeterministicSqlTemplate`) is unchanged; the moved `templateKey` strings and helper locals were never exported.

## Artifact paths
None.

## Gate commands
Run from the repo root; each line is its own subshell so cwd does not leak between commands:
```bash
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/types.ts` exists and is the sole declaration site of `export type DeterministicSqlTemplate`; `deterministicSql.ts` BOTH locally imports the type (`import type { DeterministicSqlTemplate } from "./deterministicSql/types";`) so `buildDeterministicSqlTemplate(...): DeterministicSqlTemplate` still type-checks AND re-exports it via `export type { DeterministicSqlTemplate } from "./deterministicSql/types";` so external importers of `@/lib/deterministicSql` see no API change.
- [ ] `web/src/lib/deterministicSql/pace.ts` exists, imports its template type only from `./types` (no runtime import from `../deterministicSql`), and exports `buildPaceTemplate`, which covers all nine `templateKey` values listed in **Scope — exact symbols to move** AND evaluates them in the same relative order they currently have in `buildDeterministicSqlTemplate` (source-line ascending: 186 → 337 → 553 → 595 → 796 → 1063 → 1212 → 1349 → 1440), so first-match-wins dispatch returns the same `templateKey` as before for every overlapping prompt.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the nine pace return-blocks; it instead imports `buildPaceTemplate` from `./deterministicSql/pace` and delegates to it via a single early-return. `buildPaceTemplate` is NOT re-exported from `deterministicSql.ts` (no existing callers, and this slice does not expand public API surface).
- [ ] No circular import between `deterministicSql.ts` and `deterministicSql/pace.ts` (confirmed by `(cd web && npm run build)` succeeding; the shared `./types` module makes the cycle structurally impossible).
- [ ] All gate commands pass; `bash scripts/loop/test_grading_gate.sh` exits zero against `scripts/loop/state/test_grading_baseline.txt`.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

- Branch: `slice/09-split-deterministicSql-pace`
- Implementation commit: `13ecf3d`
- Files touched (matches "Changed files expected"):
  - `web/src/lib/deterministicSql.ts` — modified: lines 1–4 inline `export type DeterministicSqlTemplate` replaced with `import type { DeterministicSqlTemplate } from "./deterministicSql/types";` plus `export type { DeterministicSqlTemplate } from "./deterministicSql/types";`; added `import { buildPaceTemplate } from "./deterministicSql/pace";`; removed pace-only locals (`mentionsPractice`, `mentionsRacePaceComparison`, `practiceVsRaceDriver`); removed nine pace return-blocks; inserted single early-return `const pace = buildPaceTemplate({ ... }); if (pace) return pace;` at the original first-pace-branch position (immediately after the `if (!targetSession) return null;` guard, where branch 1 used to live).
  - `web/src/lib/deterministicSql/types.ts` — new file; sole owner of `export type DeterministicSqlTemplate = { templateKey: string; sql: string };`.
  - `web/src/lib/deterministicSql/pace.ts` — new file; `import type { DeterministicSqlTemplate } from "./types";` (no runtime import from `../deterministicSql`); exports `buildPaceTemplate(input)`. Body evaluates the nine moved branches in source-line ascending order: `practice_laps_vs_race_pace_same_meeting` → `max_leclerc_avg_clean_lap_pace` → `max_leclerc_lap_degradation_by_stint` → `max_leclerc_final_third_pace` → `max_leclerc_common_lap_window_pace` → `max_leclerc_pre_post_pit_pace` → `max_leclerc_stint_pace_vs_tire_age` → `max_leclerc_post_pit_pace` → `max_leclerc_lap_pace_summary`. The pace-only helper locals `mentionsPractice`, `mentionsRacePaceComparison`, `practiceVsRaceDriver` were moved into this module and are computed inside `buildPaceTemplate` (consumed only by branch 1).
- Decisions:
  - `buildPaceTemplate` input shape is the minimum needed by the nine moved branches plus the helpers required by `practiceVsRaceDriver`: `lower`, `targetSession` (post-`!targetSession` guard, narrowed to `number`), `driverPairSql`, `hasComparisonLanguage`, `driverNumbers`, `mentionsMax`, `mentionsLeclerc`, `normalizeInt`, `includesAny`, `MAX_VERSTAPPEN`, `CHARLES_LECLERC`. Other shared locals listed in **Scope — exact symbols to move** (`useFixedPair`, `mentionsAbuDhabi`, `mentions2025`, `abuDhabi2025`, `isMaxVsLeclerc`, `resolvedDriverPair`, `includesAll`) are not consumed by any pace branch and so were not threaded through, in keeping with the slice's "pure mechanical split, no behavior change" scope.
  - `buildPaceTemplate` is intentionally NOT re-exported from `deterministicSql.ts` (per Step 4 / round-3 audit guidance); grep confirms no pre-existing public callers.
  - The early-return is placed at the line-186 region (immediately after the `if (!targetSession) return null;` guard, where branch 1 used to live), so first-match-wins dispatch is preserved relative to non-pace branches and to the inter-pace-branch source order.
- Self-check:
  - `web/src/lib/deterministicSql/types.ts` is the sole declaration site of `export type DeterministicSqlTemplate`; verified by `grep -nE 'DeterministicSqlTemplate' web/src/lib/deterministicSql.ts web/src/lib/deterministicSql/*.ts`, which shows: the declaration in `types.ts` (`export type DeterministicSqlTemplate = {`), the type-only `import type` + `export type { … } from` re-export pair in `deterministicSql.ts` (lines 1–2), and the type-only consumption in `pace.ts` (`import type ... from "./types"` and the return-type annotation on `buildPaceTemplate`). No other declarations.
  - `web/src/lib/deterministicSql/pace.ts` exports `buildPaceTemplate` and contains exactly nine `templateKey:` literals in the required source-line ascending order; verified via `grep -n 'templateKey:' web/src/lib/deterministicSql/pace.ts`.
  - `web/src/lib/deterministicSql.ts` no longer contains any of the nine pace `templateKey` literals; verified via `grep -nE 'practice_laps_vs_race_pace_same_meeting|max_leclerc_avg_clean_lap_pace|max_leclerc_lap_degradation_by_stint|max_leclerc_final_third_pace|max_leclerc_common_lap_window_pace|max_leclerc_pre_post_pit_pace|max_leclerc_stint_pace_vs_tire_age|max_leclerc_post_pit_pace|max_leclerc_lap_pace_summary' web/src/lib/deterministicSql.ts` returning zero matches.
  - `pace.ts` does not runtime-import from `../deterministicSql`; verified via `grep -n '../deterministicSql' web/src/lib/deterministicSql/pace.ts` returning zero matches (only `./types` is imported).
  - `buildPaceTemplate` is not re-exported from `deterministicSql.ts`; verified via `grep -n 'buildPaceTemplate' web/src/lib/deterministicSql.ts` returning only the runtime `import { buildPaceTemplate } from "./deterministicSql/pace";` and the call site.
- Gate command exit codes (run from repo root, in order):
  - `(cd web && npm run build)` → exit 0
  - `(cd web && npm run typecheck)` → exit 0
  - `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`)

## Audit verdict
**PASS**

- Gate #1 `(cd web && npm run build)` -> exit `0`
- Gate #2 `(cd web && npm run typecheck)` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS; `git diff --name-only integration/perf-roadmap...HEAD` is limited to `diagnostic/slices/09-split-deterministicSql-pace.md`, `web/src/lib/deterministicSql.ts`, `web/src/lib/deterministicSql/pace.ts`, and `web/src/lib/deterministicSql/types.ts`
- Acceptance criterion 1 -> PASS; [web/src/lib/deterministicSql/types.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-deterministicSql-pace/web/src/lib/deterministicSql/types.ts:1) is the sole declaration site, and [web/src/lib/deterministicSql.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-deterministicSql-pace/web/src/lib/deterministicSql.ts:1) both locally type-imports and re-exports `DeterministicSqlTemplate`
- Acceptance criterion 2 -> PASS; [web/src/lib/deterministicSql/pace.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-deterministicSql-pace/web/src/lib/deterministicSql/pace.ts:1) imports only from `./types`, exports `buildPaceTemplate`, and preserves the nine moved pace branches in required order at lines 71, 168, 220, 262, 307, 351, 500, 542, and 593
- Acceptance criterion 3 -> PASS; [web/src/lib/deterministicSql.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-deterministicSql-pace/web/src/lib/deterministicSql.ts:3) imports `buildPaceTemplate`, delegates via the single early return at line 148, and no longer contains the nine moved pace template branches
- Acceptance criterion 4 -> PASS; no circular import is present, confirmed by Gate #1 exit `0` and `pace.ts` importing only `./types`
- Acceptance criterion 5 -> PASS; all gate commands exited `0`

Ready to merge.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate uses the loop-approved baseline wrapper instead of failing on known shared grading failures.
- [x] Rewrite the `web` gate commands so the block is runnable as written from the repo root, for example `(cd web && npm run build)` and `(cd web && npm run typecheck)`, because repeated `cd web && ...` lines leave the shell in `web/` after the first command.
- [x] Enumerate the exact pace-related branches/helpers/constants to move out of `buildDeterministicSqlTemplate`, because the current “pace-related” wording is ambiguous in a file that mixes pace, pit, position, and canonical-ID templates.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Specify where `DeterministicSqlTemplate` will live or how `pace.ts` will type it without importing runtime symbols from `deterministicSql.ts`, so the new helper can satisfy the no-circular-import acceptance criterion by construction.
- [x] Resolve the contradiction between Step 3 and Step 4: either rely on the `deterministicSql.ts` re-export for back-compat and drop importer updates, or enumerate any expected caller-file edits in `Changed files expected` and acceptance criteria.

### Low
- [x] Clarify Step 4 to name concrete importable symbols or delete it, because `templateKey` strings and function-local helper variables are not direct imports and the current wording is not actionable.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Remove the Step 4 / acceptance-criteria requirement to re-export `buildPaceTemplate` from `web/src/lib/deterministicSql.ts`, because repo context shows no existing public `buildPaceTemplate` import to preserve and that re-export would expand API surface in a slice scoped as a pure mechanical split with no behavior change.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Require `buildPaceTemplate` to preserve the original relative order of the nine moved pace branches inside `web/src/lib/deterministicSql/pace.ts`, not just their coverage and the call-site position, so overlapping pace prompts continue to resolve to the same first-match template after the extraction.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [x] Amend Step 1 and the matching acceptance criterion so `web/src/lib/deterministicSql.ts` keeps a local type binding for `DeterministicSqlTemplate` after the extraction, for example by adding a type-only import alongside the re-export (or an equivalent local alias), because `export type { DeterministicSqlTemplate } from "./deterministicSql/types";` alone does not let the same file use `DeterministicSqlTemplate` in `buildDeterministicSqlTemplate`'s return type.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.

## Plan-audit verdict (round 6)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.
