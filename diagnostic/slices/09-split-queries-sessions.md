---
slice_id: 09-split-queries-sessions
phase: 9
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T13:54:07-04:00
---

## Goal
Extract session-related queries from queries.ts into queries/sessions.ts.

## Inputs
- `web/src/lib/queries.ts` (currently the source of truth)
- `web/src/lib/queries/sessions.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the target functions/types in `web/src/lib/queries.ts`.
2. Move them to `web/src/lib/queries/sessions.ts`; re-export from `web/src/lib/queries.ts` for back-compat.
3. Leave existing consumers importing from `web/src/lib/queries.ts` (the back-compat re-exports cover them). Consumer-import migration is out of scope for this slice; defer to a follow-up so the declared file scope matches the work done.
4. Verify no circular import by confirming the new file does not re-enter `queries.ts`: `grep -nE "from ['\"](\\.\\./queries|@/lib/queries)['\"]" web/src/lib/queries/sessions.ts` must return zero matches. The `cd web && npm run build` and `cd web && npm run typecheck` gates also fail on a runtime/type-detectable cycle.

## Changed files expected
- `web/src/lib/queries.ts`
- `web/src/lib/queries/sessions.ts`

## Artifact paths
None.

## Gate commands
Run from the repo root. Each `web` gate is wrapped in a subshell so the parent shell's CWD does not drift; the final `grep` is intentionally repo-rooted.
```bash
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
grep -nE "from ['\"](\.\./queries|@/lib/queries)['\"]" web/src/lib/queries/sessions.ts; test $? -eq 1
```

## Acceptance criteria
- [ ] `web/src/lib/queries/sessions.ts` exists and exports the moved symbols.
- [ ] `web/src/lib/queries.ts` no longer contains the moved bodies (only re-exports if needed).
- [ ] `web/src/lib/queries/sessions.ts` contains no import from `'../queries'` or `'@/lib/queries'` (verified via the grep gate above; circular-import guard).
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-split-queries-sessions`

**Symbols moved from `web/src/lib/queries.ts` to `web/src/lib/queries/sessions.ts`:**
- `getSessions`
- `getSessionByKey`
- `getSessionDrivers`
- `getSessionLaps`
- `getSessionWeather`
- `getSessionRaceControl`
- `getSessionTelemetry`
- `getSessionCompleteness`
- `getSessionTableCounts`

Together with their session-only constants (`DEFAULT_LIST_LIMIT`, `MAX_LIST_LIMIT`, `TELEMETRY_TABLES`, `SESSION_TABLE_COUNT_SQL`) and locally-redeclared helpers (`nullableLike`, `safeLimit`, `parseCountValue`) — following the same self-contained pattern as the prior `queries/resolver.ts` and `queries/catalog.ts` splits.

**Back-compat:** `web/src/lib/queries.ts` re-exports all nine moved functions via `export { ... } from "./queries/sessions"`, so existing consumers (`@/lib/queries`) continue to work unchanged. Consumer-import migration is deferred per Step 3.

**Decisions:**
- Kept `getOverviewStats`, `getGlobalTableCounts`, `runReadOnlySql`, `buildHeuristicSql` and `GLOBAL_TABLE_COUNT_SQL` in `queries.ts` — they are not session-scoped queries.
- `safeLimit` / `parseCountValue` are duplicated locally in `queries/sessions.ts` (still consumed by `runReadOnlySql` / `getGlobalTableCounts` in `queries.ts`). This matches the convention established by `queries/resolver.ts`, which also redeclares `safeLimit` and `nullableLike` locally rather than introducing a shared helper module (out of scope for a mechanical split).
- Removed the now-unused `import type { SessionCompleteness }` from `queries.ts`; it remains imported by `queries/sessions.ts` where `getSessionCompleteness` lives.
- Did not re-export `SessionCompleteness` from `queries.ts` — a repo-wide grep confirms no consumer imports the type from `@/lib/queries`.

**Gate command exit codes (run from worktree root after `cd web && npm ci`):**
- `(cd web && npm run build)` → 0 (Next.js build succeeded; all 21 routes compiled)
- `(cd web && npm run typecheck)` → 0 (`tsc --noEmit` clean)
- `bash scripts/loop/test_grading_gate.sh` → 0 (`PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`)
- `grep -nE "from ['\"](\.\./queries|@/lib/queries)['\"]" web/src/lib/queries/sessions.ts` → 1 (no matches → circular-import guard satisfied), `test $? -eq 1` → 0

**Self-check vs acceptance criteria:**
- [x] `web/src/lib/queries/sessions.ts` exists and exports the moved symbols (verified: 9 `export async function`).
- [x] `web/src/lib/queries.ts` no longer contains the moved bodies (`git diff --stat` shows -317 lines from queries.ts; remaining content is only re-exports plus `getOverviewStats` / `getGlobalTableCounts` / `runReadOnlySql` / `buildHeuristicSql`).
- [x] `web/src/lib/queries/sessions.ts` contains no import from `'../queries'` or `'@/lib/queries'` (grep gate exit 1).
- [x] All gate commands pass.

**Commit hash:** `68cc3be`

## Audit verdict
**Status: PASS**

Gate #1 `(cd web && npm run build)` -> exit `0`
Gate #2 `(cd web && npm run typecheck)` -> exit `0`
Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
Gate #4 `grep -nE "from ['\"](\.\./queries|@/lib/queries)['\"]" web/src/lib/queries/sessions.ts; test $? -eq 1` -> exit `0`

Scope diff -> PASS (`diagnostic/slices/09-split-queries-sessions.md`, `web/src/lib/queries.ts`, `web/src/lib/queries/sessions.ts`)

Criterion 1 -> PASS: `web/src/lib/queries/sessions.ts` exists and exports all nine moved session-query functions at [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:82), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:128), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:141), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:153), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:184), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:197), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:219), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:254), [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:302).
Criterion 2 -> PASS: `web/src/lib/queries.ts` retains only re-exports for the moved symbols at [web/src/lib/queries.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries.ts:17) and no longer defines their bodies.
Criterion 3 -> PASS: `web/src/lib/queries/sessions.ts` imports `../db`, `../querySafety`, and `../types` only at [web/src/lib/queries/sessions.ts](/Users/robertzehnder/.openf1-loop-worktrees/09-split-queries-sessions/web/src/lib/queries/sessions.ts:1); Gate #4 confirmed no `../queries` or `@/lib/queries` import.
Criterion 4 -> PASS: all declared gates passed.

Decision -> PASS

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the repo-required grading wrapper rather than the raw repo-wide gate.
- [x] Expand `Changed files expected` to include the direct-import consumer files Step 3 will modify, or narrow Step 3 so the declared file scope matches the work.
- [x] Make Step 4 and the acceptance criteria name a concrete circular-import verification method or gate; "Verify no circular imports" is not currently testable from this slice.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T17:38:27Z, so no staleness note is needed.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Rewrite the `Gate commands` block so it can be executed as a single shell snippet without directory drift; the current `cd web && ...` lines leave the shell in `web/`, so the next `cd web ...` and the final `grep web/src/...` command break when run sequentially from one shell.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T17:38:27Z, so no staleness note is needed.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-30T17:38:27Z, so no staleness note is needed.
