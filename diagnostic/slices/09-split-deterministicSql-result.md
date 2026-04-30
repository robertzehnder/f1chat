---
slice_id: 09-split-deterministicSql-result
phase: 9
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T12:34:07-04:00
---

## Goal
Extract result/finish SQL from deterministicSql.ts into deterministicSql/result.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/result.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the result/finish-oriented branches inside `buildDeterministicSqlTemplate` in `web/src/lib/deterministicSql.ts` (e.g. the `grid_vs_finish` / `positions_gained` / `finish_position` blocks and any companion helpers exclusive to result/finish queries) plus any private helper types used only by those branches.
2. Move the identified logic into a new `buildResultTemplate(...)` helper in `web/src/lib/deterministicSql/result.ts` (mirroring the existing `pace.ts` / `strategy.ts` pattern), and call it from `buildDeterministicSqlTemplate` via `import { buildResultTemplate } from "./deterministicSql/result"`. Re-export the new helper from `web/src/lib/deterministicSql.ts` (`export { buildResultTemplate } from "./deterministicSql/result";`) so the barrel keeps full parity even though no external consumer imports it today.
3. Survey direct importers of the moved symbols across the repo (search `web/src`, `web/scripts`, `web/tests`, top-level `scripts/`) and retarget any that referenced the old in-file paths to import from `@/lib/deterministicSql/result`. Today the only external consumer of the public surface is `web/src/app/api/chat/route.ts` (`buildDeterministicSqlTemplate`, unchanged location), so no caller is expected to need a path update; record the survey result explicitly in the slice-completion note.
4. Verify no circular imports between `web/src/lib/deterministicSql.ts` ↔ `web/src/lib/deterministicSql/result.ts` (e.g. `cd web && npx madge --circular --extensions ts,tsx src/lib/deterministicSql.ts src/lib/deterministicSql/result.ts`).

## Changed files expected
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/deterministicSql/result.ts` (new)
- Any consumer file the Step 3 survey turns up that directly imports a moved helper (currently expected to be none — `web/src/app/api/chat/route.ts` imports only `buildDeterministicSqlTemplate` via the barrel and stays unchanged). If the survey finds additional importers, add them here before commit.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
cd web && npx madge --circular --extensions ts,tsx src/lib/deterministicSql.ts src/lib/deterministicSql/result.ts
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/result.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] Every direct import of a moved symbol across the repo resolves from `web/src/lib/deterministicSql/result.ts` (or via the `deterministicSql.ts` barrel re-export); the slice-completion note records the import survey performed in Step 3.
- [ ] The `madge --circular` gate command above reports no circular dependency between `deterministicSql.ts` and `deterministicSql/result.ts`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-split-deterministicSql-result`

**Decisions:**
- Identified the result/finish branch in `buildDeterministicSqlTemplate` strictly per the slice spec's example (`grid_vs_finish` / `positions_gained` / `finish_position`): the only matching branch is `max_leclerc_positions_gained_or_lost`, which selects from `core.grid_vs_finish` and references `grid_position`, `finish_position`, `positions_gained`. Adjacent blocks were left in place: `max_leclerc_running_order_progression` (uses `core.race_progression_summary` — race progression rather than finish state) and `max_leclerc_fresh_vs_used_tires` (tire/pace, not result).
- No private helper types were exclusive to the moved branch, so none were moved.
- Mirrored the `pace.ts` / `strategy.ts` pattern: `buildResultTemplate` accepts `{ lower, targetSession, driverPairSql, includesAny }` and returns `DeterministicSqlTemplate | null`. The barrel re-exports `buildResultTemplate` from `web/src/lib/deterministicSql.ts`.
- Replaced the inlined block in `deterministicSql.ts` with a `buildResultTemplate({...})` call placed at the original block's source position, preserving evaluation order between the surrounding `running_order_progression` and `fresh_vs_used_tires` branches.

**Step 3 import survey (recorded per acceptance criterion):**
- `grep -rEn "from.*deterministicSql|import.*deterministicSql" web/src web/scripts web/tests scripts` and `grep -rEn "buildResultTemplate|max_leclerc_positions_gained_or_lost" ...` were run.
- Direct importers of the public surface: only `web/src/app/api/chat/route.ts:8` imports `buildDeterministicSqlTemplate` from `@/lib/deterministicSql` (the barrel) — unchanged.
- `web/scripts/tests/zero-llm-path.test.mjs` references `max_leclerc_positions_gained_or_lost` as a string literal in an expected-template-keys list, not as a TypeScript import — no path update applies.
- All other `web/scripts/tests/*.test.mjs` files replace `@/lib/deterministicSql` with a stub at test-runtime; none import internal helpers directly.
- Conclusion: no caller required a path update.

**Gate command exit codes (run from worktree root):**
- `cd web && npm run build` → exit 0
- `cd web && npm run typecheck` → exit 0
- `bash scripts/loop/test_grading_gate.sh` → exit 0 (PASS, no new failures vs baseline; slice_fails=34 baseline_fails=34)
- `cd web && npx madge --circular --extensions ts,tsx src/lib/deterministicSql.ts src/lib/deterministicSql/result.ts` → exit 0 ("No circular dependency found!")

**Self-checks:**
- Acceptance criterion 1: `web/src/lib/deterministicSql/result.ts` exists and exports `buildResultTemplate` — ✓.
- Acceptance criterion 2: `web/src/lib/deterministicSql.ts` no longer contains the moved body; only the `import` and barrel `export` for `buildResultTemplate` plus the `buildResultTemplate({...})` call remain — ✓ (verified by `grep -n "max_leclerc_positions_gained_or_lost\|grid_vs_finish\|positions_gained" web/src/lib/deterministicSql.ts` returning no matches).
- Acceptance criterion 3: every direct import of the moved symbol resolves from `web/src/lib/deterministicSql/result.ts` (or via the `deterministicSql.ts` barrel re-export); survey above documents that no external direct importer exists.
- Acceptance criterion 4: madge gate reports no circular dependency between `deterministicSql.ts` and `deterministicSql/result.ts` — ✓.
- Acceptance criterion 5: all four gate commands above exit 0 — ✓.

**Commit hashes:** filled in after `git commit` below.

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the slice uses the required baseline-aware grading gate instead of failing on known unrelated test debt.

### Medium
- [x] Expand `## Changed files expected` to include every direct-import consumer Step 3 may retarget, not only `web/src/lib/deterministicSql.ts` and `web/src/lib/deterministicSql/result.ts`.
- [x] Add an acceptance criterion that makes Step 3 testable by requiring all direct imports of the moved symbols to resolve from `web/src/lib/deterministicSql/result.ts` after the split.

### Low
- [x] Add an acceptance criterion or explicit gate note for Step 4 that no circular import is introduced, instead of leaving that verification implicit.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:28:16Z, so no stale-state note is needed.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High
- None.

### Medium
- None.

### Low
- None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:28:16Z, so no stale-state note is needed.
