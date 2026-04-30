---
slice_id: 09-split-deterministicSql-strategy
phase: 9
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T12:26:59-04:00
---

## Goal
Extract strategy-related SQL from deterministicSql.ts into deterministicSql/strategy.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/strategy.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target strategy-related functions/types in `web/src/lib/deterministicSql.ts` (e.g., strategy SQL builders/templates such as `buildStrategy*Sql`, `STRATEGY_*` constants, or whatever the strategy logic is named in the current file — the implementer enumerates the actual symbols during Step 1 and records them in the Slice-completion note).
2. Move them to `web/src/lib/deterministicSql/strategy.ts`; re-export from `web/src/lib/deterministicSql.ts` for back-compat.
3. Run `rg "<moved symbol names>" web/src` to enumerate every direct import site of the moved symbols. If any external file imports them, update the import to `@/lib/deterministicSql/strategy` and add that file to `Changed files expected` before committing. If `rg` returns only `web/src/lib/deterministicSql.ts` (i.e., the symbols are internal-only today), record that finding in the Slice-completion note and skip external import edits — the back-compat re-export keeps any future external caller working.
4. Verify no circular imports via a source-level check: `web/src/lib/deterministicSql/strategy.ts` must not contain any `import`/`from` statement that resolves to `web/src/lib/deterministicSql.ts` (i.e., no `'../deterministicSql'`, `'../deterministicSql.js'`, `'@/lib/deterministicSql'`, or `'@/lib/deterministicSql.js'` specifier). The grep gate below is the direct proof-of-record; `npm run build` / `npm run typecheck` remain belt-and-braces but are not the primary evidence for this requirement.

## Changed files expected
- `web/src/lib/deterministicSql.ts`
- `web/src/lib/deterministicSql/strategy.ts`
- Any additional `web/src/**` files surfaced by the Step 3 ripgrep that directly import the moved symbols (expected to be zero based on a pre-plan scan, but the implementer must extend this list if Step 3 finds external import sites).

## Artifact paths
None.

## Gate commands
```bash
# Source-level no-circular-import check: strategy.ts must NOT import from deterministicSql.ts.
# This grep must produce zero matches (the leading `!` inverts rg's exit code).
! rg -nP "(?:from|import)\s+['\"](?:\.\./deterministicSql|@/lib/deterministicSql)(?:\.js)?['\"]" web/src/lib/deterministicSql/strategy.ts
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/strategy.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] Step 3 ripgrep is recorded in the Slice-completion note; any external `web/src/**` import sites it surfaces resolve from `web/src/lib/deterministicSql/strategy.ts` (or, if none exist, the note states that explicitly).
- [ ] The source-level grep gate (`! rg -nP "(?:from|import)\s+['\"](?:\.\./deterministicSql|@/lib/deterministicSql)(?:\.js)?['\"]" web/src/lib/deterministicSql/strategy.ts`) exits 0 with no matches, directly proving `web/src/lib/deterministicSql/strategy.ts` does not import from `web/src/lib/deterministicSql.ts`.
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` both exit 0 (secondary corroboration of no circular ESM resolution).
- [ ] All gate commands pass.

## Decisions
- The audit item literally read "Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh`". The wrapper script lives at `scripts/loop/test_grading_gate.sh` relative to the repo root (not under `web/`), so we run it as `bash scripts/loop/test_grading_gate.sh` without a leading `cd web`. This matches the invocation used by the recently-merged sibling slices (e.g. `09-split-chatRuntime-planTrace`, `08-validators-grid-finish`).

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-split-deterministicSql-strategy`

**Commit hashes:**
- `3d37b2a1801b8f253a2c083c2bddffe43f2119b4` (short: `3d37b2a`) — slice 09: extract strategy deterministic SQL into `deterministicSql/strategy.ts` (the squashed code+slice-note commit). A trailing follow-up commit on this branch updates the same slice file with the final commit hash for traceability.

### Step 1 — symbols identified and moved

The following nine deterministic SQL templates (all branches inside `buildDeterministicSqlTemplate` in `web/src/lib/deterministicSql.ts`) were identified as strategy-related and moved into the new module `web/src/lib/deterministicSql/strategy.ts`, which exports a single helper `buildStrategyTemplate(input)`:

1. `max_leclerc_pit_stop_count` (trigger: `lower.includes("how many pit stops")`)
2. `max_leclerc_pit_laps` (trigger: `lower.includes("on which laps") && lower.includes("pit")`)
3. `max_leclerc_shortest_pit_stop` (trigger: `includesAny(lower, ["shorter stationary pit stop", "shortest stationary pit stop"])`)
4. `max_leclerc_total_pit_time` (trigger: `includesAny(lower, ["less total time in the pit lane", "least total time in the pit lane"])`)
5. `max_leclerc_stint_lengths` (trigger: `lower.includes("stint lengths")`)
6. `max_leclerc_compounds_used` (trigger: `includesAny(lower, ["tire compounds", "tyre compounds"])`)
7. `max_leclerc_strategy_type` (trigger: `includesAny(lower, ["one-stop", "two-stop"])`)
8. `max_leclerc_position_change_around_pit_cycle` (trigger: `lower.includes("pit cycle")`)
9. `max_leclerc_opening_closing_stint_lengths` (trigger: `lower.includes("opening stint") && lower.includes("closing stint")`)

These are the SQL builders whose templates explicitly model strategy-domain concepts (pit stops, stint structure, pit-cycle position change, one-stop/two-stop classification). They were a contiguous block in `deterministicSql.ts` between the telemetry/top-speed branch and the running-order/grid-vs-finish branches; all SQL bodies were moved verbatim. The new `buildStrategyTemplate` is invoked from `buildDeterministicSqlTemplate` at the same position as the original `if` chain, preserving evaluation order with respect to the surrounding branches.

In addition, `web/src/lib/deterministicSql.ts` now `import { buildStrategyTemplate } ...` from `./deterministicSql/strategy` and re-exports the symbol via `export { buildStrategyTemplate } from "./deterministicSql/strategy";` for back-compat (mirroring the type re-export pattern already used for `DeterministicSqlTemplate`). No existing public symbol was removed from `deterministicSql.ts`.

### Step 3 — ripgrep of moved symbols

Run:

```
rg -n "buildStrategyTemplate|max_leclerc_pit_stop_count|max_leclerc_pit_laps|max_leclerc_shortest_pit_stop|max_leclerc_total_pit_time|max_leclerc_stint_lengths|max_leclerc_compounds_used|max_leclerc_strategy_type|max_leclerc_position_change_around_pit_cycle|max_leclerc_opening_closing_stint_lengths" web/src
```

Output (only matches inside the two files involved in the split):

```
web/src/lib/deterministicSql.ts:4:import { buildStrategyTemplate } from "./deterministicSql/strategy";
web/src/lib/deterministicSql.ts:5:export { buildStrategyTemplate } from "./deterministicSql/strategy";
web/src/lib/deterministicSql.ts:559:  const strategy = buildStrategyTemplate({
web/src/lib/deterministicSql/strategy.ts:10:export function buildStrategyTemplate(input: BuildStrategyTemplateInput): DeterministicSqlTemplate | null {
web/src/lib/deterministicSql/strategy.ts:15:      templateKey: "max_leclerc_pit_stop_count",
web/src/lib/deterministicSql/strategy.ts:31:      templateKey: "max_leclerc_pit_laps",
web/src/lib/deterministicSql/strategy.ts:54:      templateKey: "max_leclerc_shortest_pit_stop",
web/src/lib/deterministicSql/strategy.ts:74:      templateKey: "max_leclerc_total_pit_time",
web/src/lib/deterministicSql/strategy.ts:90:      templateKey: "max_leclerc_stint_lengths",
web/src/lib/deterministicSql/strategy.ts:111:      templateKey: "max_leclerc_compounds_used",
web/src/lib/deterministicSql/strategy.ts:130:      templateKey: "max_leclerc_strategy_type",
web/src/lib/deterministicSql/strategy.ts:148:      templateKey: "max_leclerc_position_change_around_pit_cycle",
web/src/lib/deterministicSql/strategy.ts:218:      templateKey: "max_leclerc_opening_closing_stint_lengths",
```

The only `web/src/**` file that imported any of these symbols externally is `web/src/lib/deterministicSql.ts` itself (which does so via the new `./deterministicSql/strategy` import). No other file in `web/src` references the moved symbols, so per Step 3 the symbols are internal-only and no external import sites exist that need rewriting. The back-compat re-export in `web/src/lib/deterministicSql.ts` keeps any future caller of `buildStrategyTemplate` from `@/lib/deterministicSql` working transparently. `Changed files expected` therefore did not need to be extended.

For completeness, `rg "deterministicSql" web/src` confirms only one external importer of the package as a whole — `web/src/app/api/chat/route.ts` — and that file imports `buildDeterministicSqlTemplate` (still defined in `web/src/lib/deterministicSql.ts`), not any moved symbol.

### Step 4 — circular-import source-level check

`web/src/lib/deterministicSql/strategy.ts` only `import`s `DeterministicSqlTemplate` from `./types` (a type-only sibling module), and contains zero imports that resolve to `web/src/lib/deterministicSql.ts`. The grep gate (see Gate results below) directly confirms this.

### Decisions

- Boundary chosen: only the nine SQL templates listed above were moved. The adjacent branches `max_leclerc_running_order_progression`, `max_leclerc_positions_gained_or_lost`, and `max_leclerc_fresh_vs_used_tires` were intentionally **not** moved — they model race-progression / grid-vs-finish / fresh-vs-used-tire pace concerns rather than pit-strategy structure, and grouping them with strategy would blur the module boundary. Likewise the practice-vs-race and degradation/post-pit-pace builders already live in `pace.ts` and were not touched.
- The unused `includesAll` helper in `web/src/lib/deterministicSql.ts` was already unused on `integration/perf-roadmap` (verified by reading the prior commit `13ecf3d:web/src/lib/deterministicSql.ts`); removing it is out of scope for a mechanical strategy split, so it was left untouched.
- `buildStrategyTemplate` accepts a typed input object `{ lower, targetSession, driverPairSql, includesAny }` mirroring the `buildPaceTemplate` shape from the previous split, rather than reaching for module-level globals — this keeps the module pure and avoids any need for circular imports.
- The `buildStrategyTemplate` call site in `deterministicSql.ts` was placed at the original block's position (after the `higher top speed` branch, before the `running order change` branch) so evaluation order of all surrounding `if` branches is preserved exactly.

### Gate results

| # | Command | Exit code |
|---|---|---|
| 1 | `! rg -nP "(?:from\|import)\s+['\"](?:\.\./deterministicSql\|@/lib/deterministicSql)(?:\.js)?['\"]" web/src/lib/deterministicSql/strategy.ts` | 0 (no matches; `!` inverted into success) |
| 2 | `cd web && npm run build` | 0 (Next.js 15.5.15 compiled successfully, all 4 static pages generated) |
| 3 | `cd web && npm run typecheck` | 0 |
| 4 | `bash scripts/loop/test_grading_gate.sh` | 0 (`PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`) |

### Self-check vs acceptance criteria

- [x] `web/src/lib/deterministicSql/strategy.ts` exists and exports the moved symbols (`buildStrategyTemplate`).
- [x] `web/src/lib/deterministicSql.ts` no longer contains the moved branch bodies; the moved templates are reached via `buildStrategyTemplate(...)` call and the re-export `export { buildStrategyTemplate } from "./deterministicSql/strategy";`.
- [x] Step 3 ripgrep recorded above; only `web/src/lib/deterministicSql.ts` and `web/src/lib/deterministicSql/strategy.ts` reference the moved symbols, so no external `web/src/**` import sites exist and no additional files were added to `Changed files expected`.
- [x] Source-level grep gate exits 0 with no matches (gate #1).
- [x] `npm run build` and `npm run typecheck` both exit 0 (gates #2 and #3).
- [x] All gate commands pass.

## Audit verdict
**PASS**

- Gate #1 `! rg -nP "(?:from|import)\s+['\"](?:\.\./deterministicSql|@/lib/deterministicSql)(?:\.js)?['\"]" web/src/lib/deterministicSql/strategy.ts` -> exit `0`.
- Gate #2 `cd web && npm run build` -> exit `0`.
- Gate #3 `cd web && npm run typecheck` -> exit `0`.
- Gate #4 `bash scripts/loop/test_grading_gate.sh` -> exit `0`.
- Scope diff: PASS — `git diff --name-only integration/perf-roadmap...HEAD` is limited to `diagnostic/slices/09-split-deterministicSql-strategy.md`, `web/src/lib/deterministicSql.ts`, and `web/src/lib/deterministicSql/strategy.ts`.
- Criterion `web/src/lib/deterministicSql/strategy.ts` exists and exports the moved symbols: PASS — `buildStrategyTemplate` is exported from `web/src/lib/deterministicSql/strategy.ts:10`.
- Criterion `web/src/lib/deterministicSql.ts` no longer contains the moved bodies: PASS — the file imports/re-exports `buildStrategyTemplate` at `web/src/lib/deterministicSql.ts:4` and `web/src/lib/deterministicSql.ts:5`, then delegates via `buildStrategyTemplate(...)` at `web/src/lib/deterministicSql.ts:559`.
- Criterion Step 3 ripgrep is recorded and any external import sites are updated: PASS — the Slice-completion note records the ripgrep and states no external `web/src/**` importers beyond `web/src/lib/deterministicSql.ts`.
- Criterion source-level no-circular-import grep exits `0`: PASS — gate #1 exit `0`.
- Criterion `cd web && npm run build` and `cd web && npm run typecheck` both exit `0`: PASS — gates #2 and #3 exit `0`.
- Criterion all gate commands pass: PASS — gates #1-#4 exit `0`.
- Decision: PASS — the strategy SQL split is in scope, mechanically complete, and all declared gates pass.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh` in the gate commands so the plan uses the required baseline-aware grading gate wrapper.

### Medium
- [x] Expand `Changed files expected` to include the direct import sites touched by Step 3, or narrow Step 3 if no repo-wide import rewrites are intended.

### Low
- [ ]

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T16:12:28Z, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High
- [ ]

### Medium
- [ ]

### Low
- [ ]

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T16:12:28Z, so no staleness note applies.
