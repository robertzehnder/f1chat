---
slice_id: 09-split-route-orchestration
phase: 9
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T14:22:45-04:00
---

## Goal
Extract route-handler orchestration from `web/src/app/api/chat/route.ts` into `web/src/app/api/chat/orchestration.ts` (route.ts becomes a thin entry point that re-exports the moved symbols).

## Inputs
- `web/src/app/api/chat/route.ts` (currently the source of truth)
- `web/src/app/api/chat/orchestration.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/app/api/chat/route.ts`.
2. Move them to `web/src/app/api/chat/orchestration.ts`; re-export from `web/src/app/api/chat/route.ts` so existing import sites keep resolving via the back-compat re-exports (no other source files are modified in this slice).
3. Verify no circular imports between `web/src/app/api/chat/route.ts` and `web/src/app/api/chat/orchestration.ts`.

## Changed files expected
- `web/src/app/api/chat/route.ts`
- `web/src/app/api/chat/orchestration.ts`

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/app/api/chat/orchestration.ts` exists and exports the moved symbols.
- [ ] `web/src/app/api/chat/route.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

Branch: `slice/09-split-route-orchestration` (worktree at `/Users/robertzehnder/.openf1-loop-worktrees/09-split-route-orchestration`).

### Changes
- `web/src/app/api/chat/orchestration.ts` (new): receives the entire orchestration body previously hosted in `web/src/app/api/chat/route.ts` — the same imports, helper functions (`mapToFactContractGrain`, `filterScalarKeys`, `buildSynthesisContract`, `wantsSse`, `isTrueLike`, `traceEnabledForRequest`, `isTransientDatabaseAvailabilityError`, `buildFallbackAnswer`, `extractSessionKeyLiterals`, `enforcePinnedSessionKeyInSql`), helper types (`SseDeltaKind`, `RouteCtx`, `RouteOutcome`, `ChatBody`), the `SSE_RESPONSE_HEADERS` constant, the SSE-frame contract comment block, the `dynamic = "force-dynamic"` export, and the `POST` / `runChatRoute` functions. No semantics changed — this is a verbatim move.
- `web/src/app/api/chat/route.ts` (now 1 line, was 1280 lines): collapsed to `export { POST, dynamic } from "./orchestration";`. Next.js App Router resolves the route handler through the re-export; the build emits `/api/chat` exactly as before.

### Decisions
- Re-exported only `POST` and `dynamic` from `route.ts` since those are the symbols Next.js's App Router consumes from a `route.ts` file. The internal helper functions/types are deliberately not re-exported — no source file imports them via `@/app/api/chat/route`, so leaving them un-re-exported avoids polluting the public surface. The slice-plan language ("re-export from … so existing import sites keep resolving") is satisfied because no import sites for the moved private symbols exist; only `POST`/`dynamic` are publicly load-bearing.
- The transpile-and-load route tests under `web/scripts/tests/*.test.mjs` (e.g. `zero-llm-path.test.mjs`, `answer-cache.test.mjs`) load `route.ts` by reading its source, swapping `@/lib/*` imports for stubs, and writing it to a temp dir. After the split, `route.ts` only has a relative `./orchestration` import, so those tests cannot resolve the orchestration body and fail. All affected test names were already on `scripts/loop/state/test_grading_baseline.txt` (slice_fails=34 == baseline_fails=34, baseline_failures_fixed=0). No new failures introduced. Adapting those harnesses to the new file layout is out of scope per the plan ("no other source files are modified in this slice").

### Self-checks
- No circular import between `route.ts` and `orchestration.ts`: `route.ts` imports from `./orchestration`; `orchestration.ts` does not import from `./route`. Confirmed by inspection of both files.
- `git diff --stat` shows route.ts went from 1280 lines to 1 line; orchestration.ts is the only new file. No other source files modified.

### Gate exit codes
- `cd web && npm run typecheck` → exit 0.
- `cd web && npm run build` → exit 0 (Next.js compiled, `/api/chat` route emitted).
- `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`).

Commit hash: `f1dc05b2af382cb508bb2a7fb031f9905661549d`.

## Audit verdict

**PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS; `git diff --name-only integration/perf-roadmap...HEAD` changed only `web/src/app/api/chat/route.ts`, `web/src/app/api/chat/orchestration.ts`, and `diagnostic/slices/09-split-route-orchestration.md`.
- Criterion `web/src/app/api/chat/orchestration.ts` exists and exports the moved symbols -> PASS (`web/src/app/api/chat/orchestration.ts:93`, `web/src/app/api/chat/orchestration.ts:266`).
- Criterion `web/src/app/api/chat/route.ts` no longer contains the moved bodies -> PASS (`web/src/app/api/chat/route.ts:1`).
- Criterion all gate commands pass -> PASS.
- Decision -> PASS; the split is mechanical, `route.ts` is a thin re-export, and no `./route` import exists in `web/src/app/api/chat/orchestration.ts`.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Make the target file path consistent across Goal, Inputs, Steps, Changed files expected, and Acceptance criteria; the Goal says `route/orchestration.ts` while the rest of the plan says `web/src/app/api/chat/orchestration.ts`.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the loop-required grading wrapper and baseline diff behavior.
- [x] Expand Changed files expected to include the import-site files Step 3 says will be updated, or narrow Step 3 so the stated file scope matches the actual work.

### Low

### Notes (informational only — no action)

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
