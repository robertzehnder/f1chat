---
slice_id: 09-split-deterministicSql-dataHealth
phase: 9
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30
---

## Goal
Extract the two data-health / data-coverage SQL templates from `web/src/lib/deterministicSql.ts` into a new `web/src/lib/deterministicSql/dataHealth.ts`, mirroring the pattern already used for `pace`, `strategy`, `result`, and `telemetry`.

## Inputs
- `web/src/lib/deterministicSql.ts` (currently the source of truth — contains the two inline data-health blocks identified below)
- `web/src/lib/deterministicSql/dataHealth.ts` (new file)

## Prior context
- `diagnostic/_state.md`
- `web/src/lib/deterministicSql/telemetry.ts` (most-recent precedent: a new internal-only `build*Template` helper in the same directory, not re-exported from the root)
- `web/src/lib/deterministicSql/types.ts` (shared `DeterministicSqlTemplate` type used by every split helper to keep the dependency graph acyclic)

## Required services / env
None at author time.

## Steps
1. Identify the two data-health template blocks in `web/src/lib/deterministicSql.ts`:
   - the `templateKey: "canonical_id_lookup_abu_dhabi_2025_race"` block (currently around lines 65–97), guarded by `includesAny(lower, ["canonical ids", "canonical id", "canonical"]) && abuDhabi2025 && lower.includes("race")`;
   - the `templateKey: "sessions_most_complete_downstream_coverage"` block (currently around lines 99–147), guarded by `lower.includes("most complete downstream data coverage") || (lower.includes("most complete") && lower.includes("downstream") && lower.includes("coverage"))`.
   These are the two pre-`targetSession` templates at the top of `buildDeterministicSqlTemplate` and constitute the "data-health" group for this slice.
2. Extract both blocks into a single new `buildDataHealthTemplate(ctx)` function in `web/src/lib/deterministicSql/dataHealth.ts`, mirroring `web/src/lib/deterministicSql/telemetry.ts`. Concretely:
   - Function signature: `export function buildDataHealthTemplate(ctx: { lower: string; abuDhabi2025: boolean; includesAny: (text: string, candidates: string[]) => boolean }): DeterministicSqlTemplate | null`. Type imported from `./types` only (no import from `../deterministicSql` and no import from `../deterministicSql.js`), so the dependency graph stays acyclic by construction.
   - Body: run the two guards in the existing order (canonical-id first, then downstream-coverage); return the matching template object verbatim (same `templateKey` strings and SQL) on hit; return `null` if neither guard fires.
3. Replace the two inline blocks in `web/src/lib/deterministicSql.ts` with a single delegation:
   - Add `import { buildDataHealthTemplate } from "./deterministicSql/dataHealth";` alongside the existing `pace`/`strategy`/`result`/`telemetry` imports.
   - Insert `const dataHealth = buildDataHealthTemplate({ lower, abuDhabi2025, includesAny }); if (dataHealth) return dataHealth;` at the same position the inline blocks currently occupy (before the `if (!targetSession) return null;` short-circuit).
   - Do **not** add a root-level `export { buildDataHealthTemplate }` from `deterministicSql.ts`. Rationale: `buildPaceTemplate` and `buildTelemetryTemplate` are also internal-only; only `buildStrategyTemplate` and `buildResultTemplate` are re-exported. Keeping `buildDataHealthTemplate` internal matches the more-recent precedent (`pace`, `telemetry`) and avoids introducing a brand-new public API on a mechanical-split slice.
4. Verify no circular imports introduced. The combined evidence is:
   - source-level: `dataHealth.ts` imports only from `./types` (no `../deterministicSql` / `../deterministicSql.js` / `@/lib/deterministicSql` specifier);
   - build-level: `cd web && npm run build` succeeds (Next.js production build fails loudly on a circular module graph).

## Decisions
- **Symbol scope:** the slice extracts exactly the two non-pair templates above (`canonical_id_lookup_abu_dhabi_2025_race`, `sessions_most_complete_downstream_coverage`) into one new helper `buildDataHealthTemplate`. No other templates are touched. No type or helper currently in `deterministicSql.ts` is moved with them (the helper takes `lower`, `abuDhabi2025`, and `includesAny` as inputs to keep the dependency graph one-way: helper → `./types` only).
- **Re-export policy:** `buildDataHealthTemplate` is **not** re-exported from `web/src/lib/deterministicSql.ts`. This matches `pace.ts` / `telemetry.ts` (also internal-only) and is the more-recent precedent for this split. External callers continue to use `buildDeterministicSqlTemplate` from `@/lib/deterministicSql`.
- **No call-site migration step:** `buildDataHealthTemplate` does not exist before this slice, so a repo-wide grep for direct importers is guaranteed to find only the new import added in Step 3. The slice therefore omits a separate "update direct imports" step. The only consumer is the new internal call site inside `buildDeterministicSqlTemplate` introduced in Step 3.
- **Circular-import gate:** the structural argument (helper imports only from `./types`) is the primary proof; `npm run build` is the executable corroboration. Both are reflected in the acceptance criteria below.

## Changed files expected
- `web/src/lib/deterministicSql.ts` (delete the two inline data-health blocks; add the `import { buildDataHealthTemplate } from "./deterministicSql/dataHealth";` line and the three-line `const dataHealth = …; if (dataHealth) return dataHealth;` delegation at their former position).
- `web/src/lib/deterministicSql/dataHealth.ts` (new module exporting `buildDataHealthTemplate`).
- (No other files. No external call-site edits — the symbol is new and is intentionally not re-exported from the root module per the Decisions above.)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/src/lib/deterministicSql/dataHealth.ts` exists and exports `buildDataHealthTemplate`, returning the same `templateKey` strings (`canonical_id_lookup_abu_dhabi_2025_race`, `sessions_most_complete_downstream_coverage`) and the same SQL bodies that previously lived inline in `deterministicSql.ts`.
- [ ] `web/src/lib/deterministicSql.ts` no longer contains the two inline data-health blocks: `grep -nE 'canonical_id_lookup_abu_dhabi_2025_race|sessions_most_complete_downstream_coverage' web/src/lib/deterministicSql.ts` returns zero matches.
- [ ] `web/src/lib/deterministicSql/dataHealth.ts` does not import from the root module: `grep -nE "from ['\"](\.\./)?deterministicSql(\.js)?['\"]|from ['\"]@/lib/deterministicSql(\.js)?['\"]" web/src/lib/deterministicSql/dataHealth.ts` returns zero matches (source-level no-circular-import proof).
- [ ] `cd web && npm run build` exits 0 (executable corroboration that the new module imports cleanly with no circular-dependency failure between `deterministicSql.ts` and `deterministicSql/dataHealth.ts`).
- [ ] `cd web && npm run typecheck` exits 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (no new failures vs. `scripts/loop/state/test_grading_baseline.txt`).

## Out of scope
- Behavioral changes — this is a pure mechanical split.
- Re-exporting `buildDataHealthTemplate` from `web/src/lib/deterministicSql.ts` (intentionally omitted; see Decisions).
- Touching any of the other templates or any of the `pace` / `strategy` / `result` / `telemetry` modules.

## Risk / rollback
Rollback: `git revert <commit>`.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace `cd web && npm run test:grading` with `bash scripts/loop/test_grading_gate.sh` in Gate commands so the slice uses the required grading baseline wrapper from `diagnostic/_state.md` ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:41]).

### Medium
- [x] Expand `Changed files expected` to include the direct-import call sites that Step 3 says will be updated, or narrow Step 3 if those files are intentionally out of scope ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:27], [diagnostic/slices/09-split-deterministicSql-dataHealth.md:30]).
- [x] Make the "Verify no circular imports" step testable by naming the concrete gate or acceptance criterion that proves it, instead of leaving it as an unbound manual check ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:28], [diagnostic/slices/09-split-deterministicSql-dataHealth.md:44]).

### Low
- [x] Name the target symbols or symbol group being moved so the split scope is deterministic for the implementer and auditor ([diagnostic/slices/09-split-deterministicSql-dataHealth.md:12], [diagnostic/slices/09-split-deterministicSql-dataHealth.md:25]).

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-30T16:57:30Z, so no stale-state note is required.
