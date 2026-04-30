---
slice_id: 09-split-chatRuntime-completeness
phase: 9
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T11:02:03-04:00
---

## Goal
Extract completeness-checks (have we got enough data to answer?) from chatRuntime.ts into chatRuntime/completeness.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/completeness.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target completeness-check functions/types in `web/src/lib/chatRuntime.ts`. Lock the final list before moving. The locked move list MUST be exactly the completeness-only symbols (see "Split boundary" below); do not include grain-selection or query-planning symbols.
2. Move them verbatim to `web/src/lib/chatRuntime/completeness.ts` (a new module). The new module MUST be self-contained: it imports `QuestionType` from `./classification` only, plus any standard-library/third-party deps it needs; it MUST NOT import `RowVolume`, `Grain`, `SessionCandidate`, `DriverCandidate`, `QueryPlan`, `grainForQuestion`, or `buildQueryPlan` from `@/lib/chatRuntime` (those stay in `chatRuntime.ts` for separate later slices). If a moved function references a trivial private helper currently colocated in `chatRuntime.ts` (e.g. `unique`, `includesAnyPhrase`), duplicate it locally inside `completeness.ts` rather than importing it back, matching the precedent set in `web/src/lib/chatRuntime/resolution.ts` (see `diagnostic/slices/09-split-chatRuntime-resolution.md` Slice-completion note, "Local helpers in `resolution.ts`"). Add re-exports back through `web/src/lib/chatRuntime.ts` for any symbol that another file currently imports from `@/lib/chatRuntime`, so existing public surface is preserved.
3. Update direct imports of the moved symbols across the codebase to point at `@/lib/chatRuntime/completeness`. As of audit time, the only external file that imports from `@/lib/chatRuntime` is `web/src/app/api/chat/route.ts`, and it currently imports `buildChatRuntime` / `ChatRuntimeResult` (neither is a completeness symbol); confirm via repo-wide `grep -rn "from \"@/lib/chatRuntime\"" web/src` before/after the move and list any additional callsites discovered. If no external callsite imports a moved symbol, document that finding in the slice-completion note rather than touching unrelated files.
4. Verify no new circular imports are introduced by the split — run the madge gate listed in `Gate commands` and confirm `chatRuntime.ts → chatRuntime/completeness.ts` remains a one-way edge (see Acceptance criteria for the explicit check).

## Split boundary (locked at plan time)

The "completeness" concern is narrow: deciding which warehouse tables a question requires, what counts as "we have enough rows to answer", and which fallback options exist when a required table is empty or session-scoped. The split boundary therefore IS:

In-scope (move to `completeness.ts`):
- Types: `CompletenessStatus` (`web/src/lib/chatRuntime.ts:33`), `TableCheck` (`web/src/lib/chatRuntime.ts:62`).
- Functions: `requiredTablesForQuestion` (`web/src/lib/chatRuntime.ts:615`), `fallbackOptionsForTables` (`web/src/lib/chatRuntime.ts:770`).
- Plus any private helper used only by those two functions (e.g. `unique`, `includesAnyPhrase`) — duplicated locally per Step 2.

Out-of-scope (stay in `chatRuntime.ts`, to be moved by separate later phase-9 slices):
- Grain-selection: `Grain` type (`web/src/lib/chatRuntime.ts:35`), `RowVolume` type (`web/src/lib/chatRuntime.ts:34`), `grainForQuestion` (`web/src/lib/chatRuntime.ts:808`).
- Query-planning: `QueryPlan` type (`web/src/lib/chatRuntime.ts:69`), `buildQueryPlan` (`web/src/lib/chatRuntime.ts:872`).
- Resolution candidates already exported from `./chatRuntime/resolution`: `SessionCandidate` / `DriverCandidate` are currently still defined in `chatRuntime.ts` (`web/src/lib/chatRuntime.ts:44,54`) and used by the inline completeness use-site inside `buildChatRuntime`, but they are NOT inputs/outputs of `requiredTablesForQuestion` or `fallbackOptionsForTables`, so they do not need to move with this slice.

The inline completeness use-site inside `buildChatRuntime` (`web/src/lib/chatRuntime.ts:1675-1733`) is also out of scope for this slice — only the helper functions and their types move; the inline block continues to reference them via `./chatRuntime/completeness` imports.

This boundary keeps `completeness.ts` free of any back-import into `chatRuntime.ts` and keeps the per-slice diff small. If Step 1 finds an additional helper used ONLY by `requiredTablesForQuestion` / `fallbackOptionsForTables`, treat it as in-scope and move it; if a helper is shared with grain/query-planning code, leave it in `chatRuntime.ts` and duplicate a private copy in `completeness.ts` per Step 2.

## Changed files expected
- `web/src/lib/chatRuntime.ts` (moved bodies removed; re-exports added if needed)
- `web/src/lib/chatRuntime/completeness.ts` (new)
- `diagnostic/slices/09-split-chatRuntime-completeness.md` (implementer fills in the `Slice-completion note` section)
- Any direct-import callsite of a moved symbol identified by Step 3's grep. Expected at audit time: none beyond `chatRuntime.ts` itself, since `web/src/app/api/chat/route.ts` only imports `buildChatRuntime` / `ChatRuntimeResult`. If Step 3 finds additional callsites, append them to this list in the slice-completion note.

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/completeness.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] `web/src/lib/chatRuntime/completeness.ts` does not import any of `RowVolume`, `Grain`, `SessionCandidate`, `DriverCandidate`, `QueryPlan`, `grainForQuestion`, or `buildQueryPlan` from `@/lib/chatRuntime` (verified by `grep -n "from \"@/lib/chatRuntime\"\|from \"\\.\\./chatRuntime\"" web/src/lib/chatRuntime/completeness.ts` returning no matches).
- [ ] `npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` (run from `web/`) reports no circular dependency involving `chatRuntime.ts` ↔ `chatRuntime/completeness.ts`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

- Branch: `slice/09-split-chatRuntime-completeness` off `integration/perf-roadmap`.
- Locked move list (Step 1):
  - Types: `CompletenessStatus`, `TableCheck` (previously at `web/src/lib/chatRuntime.ts:33,62`).
  - Functions: `requiredTablesForQuestion` (previously at `web/src/lib/chatRuntime.ts:615`), `fallbackOptionsForTables` (previously at `web/src/lib/chatRuntime.ts:770`).
  - Local helpers (Step 2 duplication, mirroring the `resolution.ts` precedent): `unique`, `includesAnyPhrase`. The originals at `web/src/lib/chatRuntime.ts:222-228` were left in place because they are also used by other code that stays in `chatRuntime.ts`.
- Move boundary respected: `web/src/lib/chatRuntime/completeness.ts` only imports `QuestionType` from `./classification`; no `RowVolume`, `Grain`, `SessionCandidate`, `DriverCandidate`, `QueryPlan`, `grainForQuestion`, or `buildQueryPlan` are referenced. Verified by `grep -n "from \"@/lib/chatRuntime\"\|from \"\\.\\./chatRuntime\"" web/src/lib/chatRuntime/completeness.ts` returning no matches (exit 1).
- Step 3 callsite scan: `grep -rn 'from ["\x27]@/lib/chatRuntime["\x27]' web/src` (run before and after the move) returned only `web/src/app/api/chat/route.ts:9`, which imports `buildChatRuntime` and `ChatRuntimeResult` (neither moved). No external file imports any of the moved symbols, so no callsites needed updating and no re-exports were added through `chatRuntime.ts` (Step 2 only requires re-exports when an external file already imports a moved symbol — none exist).
- `chatRuntime.ts` now imports the moved symbols from `./chatRuntime/completeness` and the inline completeness use-site inside `buildChatRuntime` (`web/src/lib/chatRuntime.ts:1481-1538` after the move) keeps its prior shape, just consuming the imported helpers.
- Gate command exit codes (run from this worktree):
  - `cd web && npm run build` → exit 0.
  - `cd web && npm run typecheck` → exit 0.
  - `bash scripts/loop/test_grading_gate.sh` → exit 0 (`PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`).
  - `cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` → exit 0 (`No circular dependency found!`, processed 4 files). This confirms `chatRuntime.ts → chatRuntime/completeness.ts` remains a one-way edge.
- Self-check vs Acceptance criteria:
  - [x] `web/src/lib/chatRuntime/completeness.ts` exists and exports the moved symbols (`CompletenessStatus`, `TableCheck`, `requiredTablesForQuestion`, `fallbackOptionsForTables`).
  - [x] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies; only an `import { … } from "./chatRuntime/completeness"` declaration remains.
  - [x] `web/src/lib/chatRuntime/completeness.ts` does not import any of `RowVolume`, `Grain`, `SessionCandidate`, `DriverCandidate`, `QueryPlan`, `grainForQuestion`, or `buildQueryPlan` from `@/lib/chatRuntime` (grep returned no matches).
  - [x] `madge --circular` reports no circular dependency involving `chatRuntime.ts ↔ chatRuntime/completeness.ts`.
  - [x] All four gate commands pass (exit 0).
- Commit hashes:
  - `0e3f3ca2a29a298f95641f1438685e1bc7826351` — split chatRuntime: extract completeness checks (the code move + slice frontmatter status flip).
  - Follow-up commit on this branch records this commit-hash line in the Slice-completion note (no code changes).

## Audit verdict

**PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Gate #4 `cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime` -> exit `0`
- Scope diff -> exit `0`; changed paths limited to `diagnostic/slices/09-split-chatRuntime-completeness.md`, `web/src/lib/chatRuntime.ts`, `web/src/lib/chatRuntime/completeness.ts`
- Criterion: `web/src/lib/chatRuntime/completeness.ts` exists and exports `CompletenessStatus`, `TableCheck`, `requiredTablesForQuestion`, `fallbackOptionsForTables` at `web/src/lib/chatRuntime/completeness.ts:3-10,20-211` -> PASS
- Criterion: `web/src/lib/chatRuntime.ts` no longer contains the moved bodies; it imports the moved symbols from `./chatRuntime/completeness` at `web/src/lib/chatRuntime.ts:16-21`, and remaining use sites are at `web/src/lib/chatRuntime.ts:788,1139,1481` -> PASS
- Criterion: `grep -n "from \"@/lib/chatRuntime\"\|from \"\.\./chatRuntime\"" web/src/lib/chatRuntime/completeness.ts` -> exit `1` -> PASS
- Criterion: madge reports no `chatRuntime.ts` <-> `chatRuntime/completeness.ts` cycle -> PASS
- Criterion: all gate commands pass -> PASS
- Decision: PASS

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the required grading gate uses the loop baseline wrapper instead of failing on unrelated known grading regressions.

### Medium
- [x] Expand `Changed files expected` to cover the direct-import callsites Step 3 says will be updated; the current list only names the source and destination module files.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T14:46:37Z, so no stale-state note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Define the split boundary so `completeness.ts` does not import private completeness/query-plan types or helpers back from `chatRuntime.ts`; `web/src/lib/chatRuntime.ts:33-86` and `web/src/lib/chatRuntime.ts:760-957` show the likely dependencies (`CompletenessStatus`, `RowVolume`, `Grain`, `SessionCandidate`, `DriverCandidate`, `TableCheck`, `QueryPlan`, `fallbackOptionsForTables`, `grainForQuestion`, `buildQueryPlan`), and leaving them behind would force a circular back-import or a non-verbatim rewrite.

### Medium
- [x] Add an explicit circular-dependency gate and matching acceptance criterion for Step 4; precedent already exists at `diagnostic/slices/09-split-chatRuntime-resolution.md:43-50` (`cd web && npx --yes madge --circular --extensions ts,tsx src/lib/chatRuntime.ts src/lib/chatRuntime`), while this slice currently names the check in `diagnostic/slices/09-split-chatRuntime-completeness.md:28,47-50` but does not make it executable.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated at 2026-04-30T14:46:37Z, so no stale-state note applies.
- `rg -n 'from "@/lib/chatRuntime"' web/src` exited `0` and only found `web/src/app/api/chat/route.ts:9`, so Step 3's "audit time" assumption still matches the repo.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Add `diagnostic/slices/09-split-chatRuntime-completeness.md` to `Changed files expected`, because the implementer must update the `Slice-completion note` in this slice file and the current scope list omits that required edit.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated at 2026-04-30T14:46:37Z, so no stale-state note applies.
- `rg -n "from ['\"]@/lib/chatRuntime['\"]" web/src` exited `0` and only found `web/src/app/api/chat/route.ts:9`, so Step 3's audit-time import assumption still matches the repo.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md:1` was updated at 2026-04-30T14:46:37Z, so no stale-state note applies.
