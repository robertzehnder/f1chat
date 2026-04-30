---
slice_id: 09-split-deterministicSql-telemetry
phase: 9
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T16:50:18Z
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
(filled by Claude)

## Audit verdict
(filled by Codex)

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
