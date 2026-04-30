---
slice_id: 09-split-deterministicSql-pace
phase: 9
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T20:18:00Z
---

## Goal
Extract pace-related deterministic SQL branches from `web/src/lib/deterministicSql.ts` into a new helper module `web/src/lib/deterministicSql/pace.ts`. Pure mechanical split; no behavior change.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth — contains `buildDeterministicSqlTemplate` plus shared helpers)
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
1. In `web/src/lib/deterministicSql/pace.ts`, export a single function `buildPaceTemplate(input)` returning `DeterministicSqlTemplate | null`. `input` carries the shared locals listed above plus `lower`. Re-export the pace-only helper computations (`mentionsRacePaceComparison`, etc.) as locals inside `buildPaceTemplate`.
2. In `web/src/lib/deterministicSql.ts`, replace the nine return-blocks listed above with a single early-return: `const pace = buildPaceTemplate({ lower, targetSession, driverPairSql, ... }); if (pace) return pace;`. Place the call at the original first-pace-branch position (line 186 region) so dispatch order is unchanged.
3. Re-export `buildPaceTemplate` from `web/src/lib/deterministicSql.ts` for back-compat (`export { buildPaceTemplate } from "./deterministicSql/pace"`).
4. Search the codebase for direct imports of any of the moved `templateKey` strings or symbols and update them to point at the new module if they referenced internals (callers of `buildDeterministicSqlTemplate` itself need no change).
5. Verify no circular imports between `deterministicSql.ts` and `deterministicSql/pace.ts`.

## Changed files expected
- `web/src/lib/deterministicSql.ts` (nine pace branches removed; one delegating call inserted; re-export added)
- `web/src/lib/deterministicSql/pace.ts` (new; exports `buildPaceTemplate`)

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
- [ ] `web/src/lib/deterministicSql/pace.ts` exists and exports `buildPaceTemplate`, which covers all nine `templateKey` values listed in **Scope — exact symbols to move**.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the nine pace return-blocks; it instead delegates to `buildPaceTemplate` and re-exports it for back-compat.
- [ ] No circular import between `deterministicSql.ts` and `deterministicSql/pace.ts` (confirmed by `(cd web && npm run build)` succeeding).
- [ ] All gate commands pass; `bash scripts/loop/test_grading_gate.sh` exits zero against `scripts/loop/state/test_grading_baseline.txt`.

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
- [ ] Specify where `DeterministicSqlTemplate` will live or how `pace.ts` will type it without importing runtime symbols from `deterministicSql.ts`, so the new helper can satisfy the no-circular-import acceptance criterion by construction.
- [ ] Resolve the contradiction between Step 3 and Step 4: either rely on the `deterministicSql.ts` re-export for back-compat and drop importer updates, or enumerate any expected caller-file edits in `Changed files expected` and acceptance criteria.

### Low
- [ ] Clarify Step 4 to name concrete importable symbols or delete it, because `templateKey` strings and function-local helper variables are not direct imports and the current wording is not actionable.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:40:29Z, so no stale-state note applies.
