---
slice_id: 09-split-answerSanity-grid-finish
phase: 9
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T19:12:00-04:00
---

## Goal
Extract grid/finish sanity checks from answerSanity.ts into answerSanity/gridFinish.ts.

## Inputs
- `web/src/lib/answerSanity.ts` (currently the source of truth)
- `web/src/lib/answerSanity/gridFinish.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target grid/finish functions/types in `web/src/lib/answerSanity.ts`.
2. Move them to `web/src/lib/answerSanity/gridFinish.ts`; re-export from `web/src/lib/answerSanity.ts` for back-compat.
3. Verify no circular imports. (No direct-import migration step is needed: the only consumer in-tree is the barrel `@/lib/answerSanity` via `web/src/app/api/chat/orchestration.ts:11`, which the re-export in step 2 keeps stable.)

## Changed files expected
- `web/src/lib/answerSanity.ts`
- `web/src/lib/answerSanity/gridFinish.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
cd web && bash ../scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/answerSanity/gridFinish.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/answerSanity.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

- Branch: `slice/09-split-answerSanity-grid-finish` (worktree at `/Users/robertzehnder/.openf1-loop-worktrees/09-split-answerSanity-grid-finish`).
- Implementation commit: `769e28b` "split(answerSanity): extract grid/finish into answerSanity/gridFinish".
- Decisions:
  - Moved `buildPositionsAnswer` and the helpers it needs (`asNumber`, `asString`, `driverLabel`) into `web/src/lib/answerSanity/gridFinish.ts`. Helpers were duplicated rather than imported, matching the established `web/src/lib/answerSanity/sector.ts` pattern (each split module owns its own copies; the barrel keeps its own copies for the still-resident summarizers).
  - `web/src/lib/answerSanity.ts` now imports `buildPositionsAnswer` from `./answerSanity/gridFinish` and uses it inside `applyAnswerSanityGuards`. No re-export through the barrel was added because `buildPositionsAnswer` was never part of the previous public surface (only the in-tree consumer `web/src/app/api/chat/orchestration.ts:11` uses the barrel, and it imports `applyAnswerSanityGuards` / `buildStructuredSummaryFromRows` only). This matches how `buildSectorAnswer` is wired in.
- Self-check:
  - `rg -n "buildPositionsAnswer" web/src` returns three hits: the new export in `web/src/lib/answerSanity/gridFinish.ts:28`, the import in `web/src/lib/answerSanity.ts:13`, and the call site in `web/src/lib/answerSanity.ts:276`. The function body no longer lives in `answerSanity.ts`.
  - `rg -n "from .*answerSanity" web/src` shows only the barrel’s three intra-folder imports plus the existing `orchestration.ts:11` consumer; no new direct imports were introduced and no circular import path exists (`gridFinish.ts` does not import from `answerSanity.ts`).
- Gate results (run from `web/`):
  - `npm run build` → exit 0.
  - `npm run typecheck` → exit 0.
  - `bash ../scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=38 baseline_fails=38 baseline_failures_fixed=0`).
- Revision (round 2, 2026-04-30T15:08:36-04:00): the round-1 audit reported `npm run typecheck` exit 1 (TS6053 missing `web/.next/types/app/api/admin/perf-summary/route.ts`). Reproducing on this worktree after `rm -rf web/.next web/tsconfig.tsbuildinfo` and re-running the declared gate sequence yields all-green:
  - `cd web && npm run build` → exit 0 (regenerated `web/.next/types/app/api/admin/perf-summary/route.ts`, confirmed via `ls`).
  - `cd web && npm run typecheck` → exit 0.
  - `cd web && bash ../scripts/loop/test_grading_gate.sh` → exit 0 (`slice_fails=38 baseline_fails=38`).
  No source changes were required to make the gates green; the round-1 typecheck failure was a stale incremental-TS state (tsconfig has `"incremental": true`) that did not survive a clean rerun. No files outside `Changed files expected` were touched in this revision (`git diff --name-only origin/integration/perf-roadmap...HEAD` returns only the slice file plus the two declared sources).
- Acceptance criteria:
  - [x] `web/src/lib/answerSanity/gridFinish.ts` exists and exports `buildPositionsAnswer`.
  - [x] `web/src/lib/answerSanity.ts` no longer contains the moved body; it imports the function from the new module.
  - [x] All gate commands pass.

## Audit verdict

**Status: PASS**

Gate #1 `cd web && npm run build` -> exit `0`
Gate #2 `cd web && npm run typecheck` -> exit `0`
Gate #3 `cd web && bash ../scripts/loop/test_grading_gate.sh` -> exit `0`
Scope diff -> PASS: changed paths are limited to `diagnostic/slices/09-split-answerSanity-grid-finish.md`, `web/src/lib/answerSanity.ts`, and `web/src/lib/answerSanity/gridFinish.ts`.
Criterion 1 -> PASS: `web/src/lib/answerSanity/gridFinish.ts:28` exports `buildPositionsAnswer`.
Criterion 2 -> PASS: `web/src/lib/answerSanity.ts:13` imports `buildPositionsAnswer` from `./answerSanity/gridFinish`, `web/src/lib/answerSanity.ts:276` calls the imported helper, and the moved body is no longer present in `web/src/lib/answerSanity.ts`.
Criterion 3 -> PASS: all declared gate commands exit `0`.
Decision -> PASS
Rationale -> The mechanical split is in scope, preserves behavior, and all required gates rerun green in this worktree.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `cd web && bash ../scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the required grading wrapper baseline instead of hard-failing on known unrelated grading failures (`diagnostic/_state.md:52`, `diagnostic/slices/09-split-answerSanity-grid-finish.md:36`).

### Medium
- [x] Reconcile Step 3 with the repo’s current import surface: either remove the repo-wide direct-import migration step or name the concrete files to update, because the current tree only imports the barrel `@/lib/answerSanity` and does not show any direct imports of a future `gridFinish` module (`web/src/app/api/chat/orchestration.ts:11`, `diagnostic/slices/09-split-answerSanity-grid-finish.md:25`).

### Low
- [x] Expand `Changed files expected` if Step 3 remains, because a plan that updates direct imports across the codebase cannot list only the source barrel and the new module as touched files (`diagnostic/slices/09-split-answerSanity-grid-finish.md:25-30`). (Step 3’s direct-import migration was removed per the Medium item, so the existing two-file `Changed files expected` list is correct as-is.)

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T18:56:33Z, so the required audit context is fresh.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md:1` is fresh (last updated 2026-04-30T18:56:33Z).
- `rg -n "answerSanity" web/src` exited 0 and shows the in-tree consumer remains the barrel import at `web/src/app/api/chat/orchestration.ts:11`.
