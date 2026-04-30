---
slice_id: 09-split-answerSanity-pit-stints
phase: 9
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T14:36:39-04:00
---

## Goal
Extract pit-stint sanity checks from answerSanity.ts into answerSanity/pitStints.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/pitStints.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts`.
2. Move them to `web/src/lib/answerSanity/pitStints.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat. Because of the re-export, no call-site rewrites are required by this slice; existing `answerSanity` imports continue to resolve unchanged.
3. Verify no circular imports.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/pitStints.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/pitStints.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/answerSanity.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

Branch: `slice/09-split-answerSanity-pit-stints` (worktree at `/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-pit-stints`).

### Changes
- `web/src/lib/answerSanity/pitStints.ts` (new): receives the pit-stint sanity functions previously hosted in `web/src/lib/answerSanity.ts` — verbatim function bodies for `strategyTypeFromStops`, `summarizeStrategyRows`, `summarizeStintRows`, `summarizeStintLengthRows`, `summarizePitCycleRows`, `summarizeUndercutOvercutRows`, `buildPitStopCountAnswer`, `buildStrategyTypeAnswer`, `hasPitPositionEvidence`, `hasUndercutOvercutEvidence`. Also receives the `asBoolean` helper (whose only callers were the moved functions). The generic helpers (`asNumber`, `asString`, `driverLabel`, `hasAnyKey`) are duplicated inside `pitStints.ts` (kept as private file-local declarations) so the new module has no import dependency on `../answerSanity` — this is the chosen mechanism for avoiding a circular import (see Decisions).
- `web/src/lib/answerSanity.ts`: removed the moved function bodies and the now-unused `asBoolean` helper. Added a top-of-file `import { ... } from "./answerSanity/pitStints"` for the names that the still-resident `applyAnswerSanityGuards` and `buildStructuredSummaryFromRows` call, plus an `export { ... } from "./answerSanity/pitStints"` re-export block (including `strategyTypeFromStops`) so any direct consumer of the moved symbols would resolve unchanged. `applyAnswerSanityGuards` and `buildStructuredSummaryFromRows` themselves are unchanged in body and are still the only externally imported symbols (verified: `web/src/app/api/chat/orchestration.ts:11` imports just those two from `@/lib/answerSanity`).

### Decisions
- **Helper duplication over circular import.** The moved pit-stint functions need `asNumber`, `asString`, `driverLabel`, `hasAnyKey` — all of which also have non-pit-stint callers in `answerSanity.ts` (`metricFromRows`, `summarizeComparisonRows`, `summarizeRankedRows`, `summarizeGenericRows`, `buildPositionsAnswer`, `buildSectorAnswer`). Importing those helpers from `../answerSanity` into `pitStints.ts` while `answerSanity.ts` imports from `./answerSanity/pitStints` would create a cyclic import graph. The slice's Step 3 explicitly says "Verify no circular imports", and the deterministicSql split established the same convention (e.g. `deterministicSql/strategy.ts` accepts `includesAny` as a parameter rather than importing it). Duplicating the four small helpers (≈ 25 lines total) inside `pitStints.ts` keeps the dependency graph one-way and avoids creating a third shared-helpers file (which would be outside `Changed files expected`).
- **`asBoolean` and `strategyTypeFromStops` moved cleanly, not duplicated.** Both have callers only inside the moved set (verified by grep), so they are now sole-owned by `pitStints.ts`. `strategyTypeFromStops` remains exported (used by `buildStrategyTypeAnswer`); `asBoolean` is file-private. `strategyTypeFromStops` is re-exported from `answerSanity.ts` for back-compat per the slice plan but is intentionally not imported into `answerSanity.ts` itself (it has no caller there), so the import block in `answerSanity.ts` does not list it.
- **No call-site rewrites.** The only external import of `@/lib/answerSanity` is `web/src/app/api/chat/orchestration.ts:11`, which imports `applyAnswerSanityGuards` and `buildStructuredSummaryFromRows` — both still exported from `answerSanity.ts` with unchanged signatures. No other code path imports the moved symbols, so the re-export block is a precautionary back-compat surface rather than a load-bearing one. The "Changed files expected" list is therefore tight at the two files declared in the plan.

### Self-checks
- No circular import: `grep -n "from .*answerSanity\|from .*pitStints" web/src/lib/answerSanity.ts web/src/lib/answerSanity/pitStints.ts` shows imports only in `answerSanity.ts` (lines 11, 24, both pointing to `./answerSanity/pitStints`); `pitStints.ts` has zero imports. Confirms one-way dependency.
- Moved bodies are gone from `answerSanity.ts`: `grep -n "function asBoolean\|function strategyTypeFromStops\|function summarizeStrategyRows\|function summarizeStintRows\|function summarizeStintLengthRows\|function summarizePitCycleRows\|function summarizeUndercutOvercutRows\|function buildPitStopCountAnswer\|function buildStrategyTypeAnswer\|function hasPitPositionEvidence\|function hasUndercutOvercutEvidence" web/src/lib/answerSanity.ts` returns no matches.
- Public API surface unchanged: `applyAnswerSanityGuards` and `buildStructuredSummaryFromRows` are still exported from `web/src/lib/answerSanity.ts`; the lone caller (`web/src/app/api/chat/orchestration.ts`) is unmodified.
- Changed files match the slice's `Changed files expected`: `git status` lists only `web/src/lib/answerSanity.ts` (modified) and `web/src/lib/answerSanity/pitStints.ts` (new), plus the slice file itself.

### Gate exit codes
- `cd web && npm run build` → exit 0 (Next.js compiled, all routes emitted).
- `cd web && npm run typecheck` → exit 0 (`tsc --noEmit` clean).
- `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=38 baseline_fails=38 baseline_failures_fixed=0`).

Commit hash: `28918de6c5c6ca3b5ff0e2be9d6513bb65759857`.

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the grading gate is evaluated against the maintained baseline instead of auto-failing on known unrelated repo-wide test failures.

### Medium
- [x] Expand `Changed files expected` to include the direct-import call sites touched by Step 3, or narrow Step 3 so the slice no longer claims repo-wide import rewrites outside the listed file scope.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T18:31:51Z, so the required audit context is current.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T18:31:51Z, so the required audit context is current.
