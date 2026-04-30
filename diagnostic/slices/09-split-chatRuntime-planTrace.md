---
slice_id: 09-split-chatRuntime-planTrace
phase: 9
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T16:05:00-04:00
---

## Goal
Extract plan-trace recording from chatRuntime.ts into chatRuntime/planTrace.ts.

## Inputs
- `web/src/lib/chatRuntime.ts` (currently the source of truth)
- `web/src/lib/chatRuntime/planTrace.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/chatRuntime.ts` (e.g., plan-trace recording helpers/types such as `recordPlanTrace`, `appendPlanTrace`, `PlanTraceEntry`, or whatever the plan-trace logic is named in the current file — the implementer enumerates the actual symbols during Step 1 and records them in the Slice-completion note).
2. Move them to `web/src/lib/chatRuntime/planTrace.ts`; re-export from `web/src/lib/chatRuntime.ts` for back-compat.
3. Run `rg "<moved symbol names>" web/src` to enumerate every direct import site of the moved symbols. If any external file imports them, update the import to `@/lib/chatRuntime/planTrace` and add that file to `Changed files expected` before committing. If `rg` returns only `web/src/lib/chatRuntime.ts` (i.e., the symbols are internal-only today), record that finding in the Slice-completion note and skip external import edits — the back-compat re-export keeps any future external caller working.
4. Verify no circular imports via a source-level check: `web/src/lib/chatRuntime/planTrace.ts` must not contain any `import`/`from` statement that resolves to `web/src/lib/chatRuntime.ts` (i.e., no `'../chatRuntime'`, `'../chatRuntime.js'`, `'@/lib/chatRuntime'`, or `'@/lib/chatRuntime.js'` specifier). The grep gate below is the direct proof-of-record; `npm run build` / `npm run typecheck` remain belt-and-braces but are not the primary evidence for this requirement.

## Changed files expected
- `web/src/lib/chatRuntime.ts`
- `web/src/lib/chatRuntime/planTrace.ts`
- Any additional `web/src/**` files surfaced by the Step 3 ripgrep that directly import the moved symbols (expected to be zero based on a pre-plan scan, but the implementer must extend this list if Step 3 finds external import sites).

## Artifact paths
None.

## Gate commands
```bash
# Source-level no-circular-import check: planTrace.ts must NOT import from chatRuntime.ts.
# This grep must produce zero matches (the leading `!` inverts rg's exit code).
! rg -nP "(?:from|import)\s+['\"](?:\.\./chatRuntime|@/lib/chatRuntime)(?:\.js)?['\"]" web/src/lib/chatRuntime/planTrace.ts
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/chatRuntime/planTrace.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/chatRuntime.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] Step 3 ripgrep is recorded in the Slice-completion note; any external `web/src/**` import sites it surfaces resolve from `web/src/lib/chatRuntime/planTrace.ts` (or, if none exist, the note states that explicitly).
- [ ] The source-level grep gate (`! rg -nP "(?:from|import)\s+['\"](?:\.\./chatRuntime|@/lib/chatRuntime)(?:\.js)?['\"]" web/src/lib/chatRuntime/planTrace.ts`) exits 0 with no matches, directly proving `web/src/lib/chatRuntime/planTrace.ts` does not import from `web/src/lib/chatRuntime.ts`.
- [ ] `cd web && npm run build` and `cd web && npm run typecheck` both exit 0 (secondary corroboration of no circular ESM resolution).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-split-chatRuntime-planTrace` (commit `5d0e346`)

**Symbols identified (Step 1):** The only plan-trace recording symbol in
`web/src/lib/chatRuntime.ts` was the type `ChatRuntimeStageLog` (the entry
type pushed onto the local `stageLogs` array during runtime stage tracing).
There were no exported helpers like `recordPlanTrace`/`appendPlanTrace`;
recording is performed via inline `stageLogs.push(...)` calls within
`buildChatRuntime`. The `stageLogs` local array and its `push` sites stay
in `chatRuntime.ts` because they are scoped to `buildChatRuntime`'s body
and are not standalone helpers. Per the slice's "pure mechanical split"
directive (no behavioral changes), only the type was moved. `QueryPlan`
and `buildQueryPlan` represent the plan output (not its trace) and were
left in place to keep this slice scoped to plan-trace recording.

**Step 3 ripgrep result:** `rg -n "ChatRuntimeStageLog" web/src` returned
matches only in `web/src/lib/chatRuntime.ts` (the import + re-export + two
internal usages) and `web/src/lib/chatRuntime/planTrace.ts` (the
declaration). No external `web/src/**` files import the symbol directly,
so the back-compat re-export from `chatRuntime.ts` is sufficient and no
additional `Changed files expected` entries were needed.

**Changes:**
- New file `web/src/lib/chatRuntime/planTrace.ts`: contains the moved
  `export type ChatRuntimeStageLog`.
- `web/src/lib/chatRuntime.ts`: removed the inline `ChatRuntimeStageLog`
  declaration; added `import { type ChatRuntimeStageLog } from "./chatRuntime/planTrace"`
  and `export type { ChatRuntimeStageLog }` for back-compat re-export.

**Step 4 self-check (no circular import):** The grep gate
`! rg -nP "(?:from|import)\s+['\"](?:\.\./chatRuntime|@/lib/chatRuntime)(?:\.js)?['\"]" web/src/lib/chatRuntime/planTrace.ts`
exited 0 (no matches in `planTrace.ts`), directly proving the new file
does not import back from `chatRuntime.ts`.

**Gate exit codes (all 0):**
- `! rg -nP "(?:from|import)\s+['\"](?:\.\./chatRuntime|@/lib/chatRuntime)(?:\.js)?['\"]" web/src/lib/chatRuntime/planTrace.ts` → 0
- `cd web && npm run build` → 0
- `cd web && npm run typecheck` → 0
- `bash scripts/loop/test_grading_gate.sh` → 0 (slice_fails=34, baseline_fails=34, baseline_failures_fixed=0 — no new failures vs baseline)

**Decisions:**
- Conservative scope: moved only `ChatRuntimeStageLog`. No behavioral
  changes; no new helpers introduced (slice "Out of scope" forbids it).
- Back-compat re-export preserved so no other call sites needed updates.

**Self-check vs Acceptance criteria:**
- [x] `web/src/lib/chatRuntime/planTrace.ts` exists and exports `ChatRuntimeStageLog`.
- [x] `web/src/lib/chatRuntime.ts` no longer contains the moved body — only the re-export.
- [x] Step 3 ripgrep recorded above; no external import sites found.
- [x] Step 4 source-level grep gate exits 0.
- [x] `npm run build` and `npm run typecheck` both exit 0.
- [x] All gate commands pass (commit hash will be filled by the runner after commit).

## Audit verdict

**Status: PASS**

- Gate #1 no-circular-import grep -> exit `0`
- Gate #2 `cd web && npm run build` -> exit `0`
- Gate #3 `cd web && npm run typecheck` -> exit `0`
- Gate #4 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff: PASS — `git diff --name-only integration/perf-roadmap...HEAD` returned only `diagnostic/slices/09-split-chatRuntime-planTrace.md`, `web/src/lib/chatRuntime.ts`, and `web/src/lib/chatRuntime/planTrace.ts`; all are in scope.
- Criterion 1: PASS — `web/src/lib/chatRuntime/planTrace.ts:1` exports `ChatRuntimeStageLog`.
- Criterion 2: PASS — `web/src/lib/chatRuntime.ts:22` and `web/src/lib/chatRuntime.ts:37` retain only the type import and back-compat re-export; the moved type body is no longer present in `chatRuntime.ts`.
- Criterion 3: PASS — Slice-completion note records `rg -n "ChatRuntimeStageLog" web/src` and the observed result matches current state: only `web/src/lib/chatRuntime.ts:22`, `web/src/lib/chatRuntime.ts:37`, `web/src/lib/chatRuntime.ts:126`, `web/src/lib/chatRuntime.ts:760`, and `web/src/lib/chatRuntime/planTrace.ts:1` reference the symbol.
- Criterion 4: PASS — the source-level grep gate exited `0` with no matches, so `web/src/lib/chatRuntime/planTrace.ts` does not import from `web/src/lib/chatRuntime.ts`.
- Criterion 5: PASS — `cd web && npm run build` and `cd web && npm run typecheck` both exited `0`.
- Criterion 6: PASS — all declared gate commands exited `0`.
- Decision: PASS — pure mechanical type split verified; safe to merge.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `cd web && bash scripts/loop/test_grading_gate.sh` so the grading gate honors the repo baseline wrapper required by audit policy.

### Medium
- [x] Expand `## Changed files expected` to cover the direct-import rewrites from Step 3, or narrow Step 3 if only `chatRuntime.ts` and `chatRuntime/planTrace.ts` should change.
- [x] Add an explicit gate or acceptance check for Step 4's circular-import verification so the plan tests that requirement instead of leaving it implicit.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:22:22Z, so no staleness note applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High

### Medium
- [x] Add a source-level gate or acceptance check that `web/src/lib/chatRuntime/planTrace.ts` does not import from `web/src/lib/chatRuntime.ts`; successful `npm run build` and `npm run typecheck` are not a direct proof for the no-circular-import requirement stated in Step 4.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:22:22Z, so no staleness note applies.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T15:22:22Z, so no staleness note applies.
