---
slice_id: 09-split-answerSanity-strategy-evidence
phase: 9
status: revising
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T15:25:40-04:00
---

## Goal
Extract strategy-evidence sanity checks from answerSanity.ts into answerSanity/strategyEvidence.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/strategyEvidence.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/answerSanity.ts` (strategy/evidence sanity branches and their helpers — e.g. the strategy/one-stop/two-stop, pit-cycle-evidence, undercut/overcut-evidence guard branches and any strategy-evidence-only helpers they depend on).
2. Move them to `web/src/lib/answerSanity/strategyEvidence.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Audit direct imports of the moved symbols across `web/src` and `web/tests` with `grep -rn "<symbol>" web/src web/tests`. Update any direct importer to point at the new file (the back-compat re-export from `web/src/lib/answerSanity.ts` is the fallback path for indirect importers). At plan time the only known importer is `web/src/lib/answerSanity.ts` itself; if implementation finds additional direct importers, list them in the slice-completion note.

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/strategyEvidence.ts`
- Any `web/src/**` or `web/tests/**` files that the Step 3 grep surfaces as direct importers of the moved symbols (none expected at plan time; `web/src/lib/answerSanity.ts` covers the only known importer).

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

The build and typecheck gates serve as the proof-of-no-circular-imports
check (a circular import between `answerSanity.ts` and
`answerSanity/strategyEvidence.ts` would surface as a TypeScript module
resolution error or a runtime ReferenceError during `next build`'s
SSR/RSC analysis). No separate gate is added.

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/strategyEvidence.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/answerSanity.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

- Branch: `slice/09-split-answerSanity-strategy-evidence` (worktree at `/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence`).
- Implementation commit: `f563bc6` "split(answerSanity): extract strategy/evidence guards into answerSanity/strategyEvidence".
- Decisions:
  - Step 1 audit: the strategy/evidence guard branches in `applyAnswerSanityGuards` (one-stop/two-stop, stint+stop strategy, pit-cycle-evidence, undercut/overcut-evidence) had no strategy-evidence-only helpers left in `web/src/lib/answerSanity.ts`; their helpers (`buildStrategyTypeAnswer`, `summarizeStrategyRows`, `hasPitPositionEvidence`, `hasUndercutOvercutEvidence`) already live in `web/src/lib/answerSanity/pitStints.ts`. So the move surface was the four branch wrappers themselves.
  - Created `web/src/lib/answerSanity/strategyEvidence.ts` exporting four small functions — `applyStrategyTypeGuard`, `applyStintStopStrategyGuard`, `applyPitCycleEvidenceGuard`, `applyUndercutOvercutEvidenceGuard` — and a `StrategyEvidenceGuardResult` type alias. Each returns `null` on no-match (preserving the original fall-through semantics for the strategy/one-stop and stint+stop branches when their helper returns falsy) or `{ answer, notes }` on match (matching the original literal answer strings and `answer_guard:*` / `evidence_required_for_strategy_claim` / `stop_count_consistent_with_stints` notes byte-for-byte).
  - The strategy-evidence module imports its helpers directly from `./pitStints` (not from `../answerSanity`), so there is no `strategyEvidence.ts → answerSanity.ts → strategyEvidence.ts` cycle.
  - The barrel `web/src/lib/answerSanity.ts` now (a) imports the four wrappers and calls them inside `applyAnswerSanityGuards`, and (b) re-exports them plus the `StrategyEvidenceGuardResult` type for back-compat. Step 3 grep confirmed there are zero existing direct importers of these new symbols, so the re-export is purely defensive.
- Self-check:
  - `grep -rn "applyStrategyTypeGuard\|applyStintStopStrategyGuard\|applyPitCycleEvidenceGuard\|applyUndercutOvercutEvidenceGuard\|StrategyEvidenceGuardResult" web/src web/tests` returns only the new module's exports (`web/src/lib/answerSanity/strategyEvidence.ts`) and the barrel's import + re-export + call sites in `web/src/lib/answerSanity.ts`. No other importers existed at plan time and none were discovered at implementation time, so the `Changed files expected` set is unchanged from the plan (only `web/src/lib/answerSanity.ts` and `web/src/lib/answerSanity/strategyEvidence.ts`).
  - `grep -rn "from .*answerSanity" web/src web/tests` shows only the prior barrel consumer `web/src/app/api/chat/orchestration.ts:11` (importing `applyAnswerSanityGuards` and `buildStructuredSummaryFromRows`, neither moved) and the barrel's own intra-folder imports — no test or app file directly imports the moved branch wrappers.
  - The four guard branches no longer appear as inline `if`-blocks in `web/src/lib/answerSanity.ts`; only single-line wrapper invocations and early returns remain at lines 272–275 and 310–323. The literal answer strings and notes for the matched branches are now exclusively in `web/src/lib/answerSanity/strategyEvidence.ts`.
  - No circular-import surface: a successful `next build` (which performs SSR/RSC graph analysis) and `tsc --noEmit` both exited 0, satisfying the proof-of-no-circular-imports check the slice plan calls out under Gate commands.
- Gate results (run from `web/` unless noted):
  - `npm run build` → exit 0 (full Next.js production build, all 21 routes prerendered/dynamic as before).
  - `npm run typecheck` → exit 0 (`tsc --noEmit`).
  - `bash scripts/loop/test_grading_gate.sh` (run from repo root) → exit 0; wrapper output: `PASS (no new failures vs integration baseline) slice_fails=38 baseline_fails=38 baseline_failures_fixed=0`.
- Acceptance criteria:
  - [x] `web/src/lib/answerSanity/strategyEvidence.ts` exists and exports the moved symbols (`applyStrategyTypeGuard`, `applyStintStopStrategyGuard`, `applyPitCycleEvidenceGuard`, `applyUndercutOvercutEvidenceGuard`, `StrategyEvidenceGuardResult`).
  - [x] `web/src/lib/answerSanity.ts` no longer contains the moved bodies; `applyAnswerSanityGuards` invokes the wrappers and the barrel re-exports them.
  - [x] All gate commands pass.

## Audit verdict
**Status: REVISE**

Gate #1 `cd web && npm run build` -> exit `0`
Gate #2 `cd web && npm run typecheck` -> exit `2`
Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
Scope-diff -> PASS (`diagnostic/slices/09-split-answerSanity-strategy-evidence.md`, `web/src/lib/answerSanity.ts`, `web/src/lib/answerSanity/strategyEvidence.ts`; all in declared scope / implicit allow-list)
Criterion `web/src/lib/answerSanity/strategyEvidence.ts` exists and exports moved symbols -> PASS ([web/src/lib/answerSanity/strategyEvidence.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity/strategyEvidence.ts:8), [web/src/lib/answerSanity/strategyEvidence.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity/strategyEvidence.ts:10), [web/src/lib/answerSanity/strategyEvidence.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity/strategyEvidence.ts:27), [web/src/lib/answerSanity/strategyEvidence.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity/strategyEvidence.ts:48), [web/src/lib/answerSanity/strategyEvidence.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity/strategyEvidence.ts:62))
Criterion `web/src/lib/answerSanity.ts` no longer contains moved bodies -> PASS ([web/src/lib/answerSanity.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity.ts:11), [web/src/lib/answerSanity.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity.ts:31), [web/src/lib/answerSanity.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity.ts:272), [web/src/lib/answerSanity.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity.ts:310), [web/src/lib/answerSanity.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity.ts:315), [web/src/lib/answerSanity.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/src/lib/answerSanity.ts:320))
Criterion all gate commands pass -> FAIL (`npm run typecheck` exit `2`; TS6053 missing `.next/types/**` entries matched by `include` in [web/tsconfig.json](/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-strategy-evidence/web/tsconfig.json:23))
Decision -> REVISE
Rationale -> Repair the typecheck gate so the declared command passes in this worktree; the extraction itself is otherwise in-scope and mechanically correct.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `cd web && bash ../scripts/loop/test_grading_gate.sh` so the grading gate is evaluated against the shared failure baseline rather than raw repo-wide failures.

### Medium
- [x] Expand `Changed files expected` to include the direct-import call sites Step 3 says will be updated; the current scope only lists the source and destination modules.
- [x] Make Step 4 testable by naming the concrete proof for “Verify no circular imports” in gates or acceptance criteria, or remove that step if the existing build/typecheck gates are the intended check.

### Low

### Notes (informational only — no action)
- None.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- None.
