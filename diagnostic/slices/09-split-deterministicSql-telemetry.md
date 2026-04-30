---
slice_id: 09-split-deterministicSql-telemetry
phase: 9
status: ready_to_merge
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T17:07:00-04:00
---

## Goal
Extract telemetry SQL from deterministicSql.ts into deterministicSql/telemetry.ts.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth)
- `web/src/lib/deterministicSql/telemetry.ts` (new file)

## Prior context
- `diagnostic/_state.md`

## Required services / env
None at author time.

## Steps
1. Identify the telemetry-window block in `web/src/lib/deterministicSql.ts` (the inline branch keyed by `templateKey: "max_leclerc_fastest_lap_telemetry_window"`, reachable via `includesAny(lower, ["braked later", "carried more speed"])`, currently around lines 487–540).
2. Extract that block into a new `buildTelemetryTemplate(ctx)` function in `web/src/lib/deterministicSql/telemetry.ts`, mirroring the pattern already used by `pace.ts`, `strategy.ts`, and `result.ts` (function signature, return shape, imports of any shared helpers).
3. Replace the inline block in `web/src/lib/deterministicSql.ts` with a delegation to `buildTelemetryTemplate`. Do **not** add a root-level `export { buildTelemetryTemplate }` from `deterministicSql.ts` — `buildPaceTemplate` is also internal-only, so leaving telemetry internal-only matches that precedent and avoids introducing a brand-new public API on this slice. (External callers continue to import `buildDeterministicSqlTemplate` from `@/lib/deterministicSql`.)
4. Verify no circular imports by running `cd web && npm run build` (Next.js build will fail on a circular module graph) and the typecheck gate.

## Decisions
- **Re-export policy:** `web/src/lib/deterministicSql.ts` currently re-exports `buildStrategyTemplate` and `buildResultTemplate` but not `buildPaceTemplate`. The plan-audit (round 2) flagged this slice's claim of "parity" as ambiguous. Resolution: do not re-export `buildTelemetryTemplate`. This matches `pace`'s pattern, keeps the public surface minimal, and avoids adding new exported symbols on a mechanical-split slice. If a future caller needs `buildTelemetryTemplate` directly, it can import `@/lib/deterministicSql/telemetry`.
- **No call-site migration step:** the symbol `buildTelemetryTemplate` does not exist before this slice, so a repo-wide grep cannot validate any "migration"; it would only find imports introduced by this slice. The slice therefore omits an external-importer search step. The only consumer remains the inline call site replaced in Step 3.

## Changed files expected
- `web/src/lib/deterministicSql.ts` (replace inline telemetry branch with a `buildTelemetryTemplate(ctx)` delegation; add an `import { buildTelemetryTemplate } from "./deterministicSql/telemetry";` line)
- `web/src/lib/deterministicSql/telemetry.ts` (new module exporting `buildTelemetryTemplate`)
- (No other files. No external call-site edits — the symbol is new, and it is not re-exported from the root module per the Decisions above.)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/telemetry.ts` exists and exports `buildTelemetryTemplate`.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the inline telemetry SQL body — only an `import` of `buildTelemetryTemplate` and a delegating call at the original branch site. No `export { buildTelemetryTemplate }` is added at the root (matches `buildPaceTemplate`'s precedent).
- [ ] `cd web && npm run build` succeeds, demonstrating the new module imports cleanly with no circular-dependency failure between `deterministicSql.ts` and `deterministicSql/telemetry.ts`.
- [ ] All gate commands pass.

## Out of scope
- Behavioral changes — this is a pure mechanical split.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note

**Branch:** `slice/09-split-deterministicSql-telemetry`

**Decisions:**
- Identified the telemetry-window block strictly per the slice spec: the only branch keyed on `templateKey: "max_leclerc_fastest_lap_telemetry_window"` and gated by `includesAny(lower, ["braked later", "carried more speed"])`. No adjacent block matched. The neighbouring `max_leclerc_top_speed` branch (raw `cd.speed`, gated on `lower.includes("higher top speed")`) was deliberately left in place — different gate phrase, different source table (`raw.car_data`), and outside the slice's scope.
- Mirrored the `pace.ts` / `strategy.ts` / `result.ts` pattern: `buildTelemetryTemplate` accepts `{ lower, targetSession, driverPairSql, includesAny }` and returns `DeterministicSqlTemplate | null`. No additional shared helpers needed (the moved branch only uses `includesAny`, `targetSession`, and `driverPairSql`).
- Per the Decisions section above, did **not** add a root-level `export { buildTelemetryTemplate }` from `deterministicSql.ts`. This matches `buildPaceTemplate`'s precedent and keeps the public surface minimal. The new module is internal-only; external callers continue to use `buildDeterministicSqlTemplate` from `@/lib/deterministicSql`.
- Replaced the inlined block in `deterministicSql.ts` with a `buildTelemetryTemplate({...})` call placed at the original block's source position — preserving the evaluation/gate ordering between the preceding `max_leclerc_lap_consistency` branch and the following `max_leclerc_top_speed` branch (gate ordering rule per state notes).

**Gate command exit codes (run from worktree root):**
- `cd web && npm run build` → exit 0 (Next.js production build succeeded; demonstrates no circular module graph)
- `cd web && npm run typecheck` → exit 0
- `bash scripts/loop/test_grading_gate.sh` → exit 0 (`[test_grading_gate] PASS (no new failures vs integration baseline) slice_fails=34 baseline_fails=34 baseline_failures_fixed=0`)

**Self-checks:**
- Acceptance criterion 1: `web/src/lib/deterministicSql/telemetry.ts` exists and exports `buildTelemetryTemplate` — ✓.
- Acceptance criterion 2: `web/src/lib/deterministicSql.ts` no longer contains the inline telemetry SQL body; only an `import { buildTelemetryTemplate } from "./deterministicSql/telemetry";` line and a delegating `buildTelemetryTemplate({...})` call at the original branch site remain. No `export { buildTelemetryTemplate }` is added at the root, matching `buildPaceTemplate`'s precedent — ✓ (verified by `grep -n "telemetry_lap_bridge\|max_leclerc_fastest_lap_telemetry_window\|braked later\|carried more speed" web/src/lib/deterministicSql.ts` returning no matches).
- Acceptance criterion 3: `cd web && npm run build` succeeded; the new module imports cleanly with no circular-dependency failure between `deterministicSql.ts` and `deterministicSql/telemetry.ts` — ✓.
- Acceptance criterion 4: all gate commands exit 0 — ✓.

**Commit hashes:**
- `0c8f4df` — split: extract telemetry SQL into deterministicSql/telemetry.ts (code split + slice-note + frontmatter flip)
- `740101a` — slice: record commit hash in completion note (this slice file update)

## Audit verdict

**Status: PASS**

- Gate #1 `cd web && npm run build` -> exit `0`
- Gate #2 `cd web && npm run typecheck` -> exit `0`
- Gate #3 `bash scripts/loop/test_grading_gate.sh` -> exit `0`
- Scope diff -> PASS (`git diff --name-only integration/perf-roadmap...HEAD`: `diagnostic/slices/09-split-deterministicSql-telemetry.md`, `web/src/lib/deterministicSql.ts`, `web/src/lib/deterministicSql/telemetry.ts`)
- Criterion 1 -> PASS (`web/src/lib/deterministicSql/telemetry.ts:10-68` exports `buildTelemetryTemplate`)
- Criterion 2 -> PASS (`web/src/lib/deterministicSql.ts:8` imports `buildTelemetryTemplate`; `web/src/lib/deterministicSql.ts:488-494` delegates at the original branch site; no root `export { buildTelemetryTemplate }` in `web/src/lib/deterministicSql.ts:1-496`)
- Criterion 3 -> PASS (Gate #1 exit `0`; no circular-import failure observed)
- Criterion 4 -> PASS (Gates #1-#3 exit `0`)
- Decision -> PASS

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` so the declared grading gate matches the repo audit wrapper and does not fail on known baseline noise.

### Medium
- [x] Expand `Changed files expected` to include the direct-import call sites from Step 3, because the current file list omits the repo files the plan explicitly says to edit.

### Low
- [x] Add an acceptance criterion that makes Step 4 testable by requiring the moved telemetry symbols to import without introducing a circular-dependency failure.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:41:30Z, so no stale-state warning applies.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Remove the planned root-level re-export of `buildTelemetryTemplate`, or explicitly add the same root-level export for `buildPaceTemplate`, because `web/src/lib/deterministicSql.ts` currently re-exports `buildStrategyTemplate` and `buildResultTemplate` but not `buildPaceTemplate`, so Step 3's claimed "parity" would otherwise introduce a new public API inconsistent with the existing split pattern.
- [x] Rewrite or drop Step 4, because grepping for direct imports of `buildTelemetryTemplate` cannot validate any migration for this slice: the symbol does not exist before the extraction, so the search is guaranteed to find only imports introduced by the slice itself.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:41:30Z, so no stale-state warning applies.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High
- [ ] None.

### Medium
- [ ] None.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:41:30Z, so no stale-state warning applies.
