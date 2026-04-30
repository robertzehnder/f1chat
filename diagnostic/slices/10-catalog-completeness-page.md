---
slice_id: 10-catalog-completeness-page
phase: 10
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T22:30:00-04:00
---

## Goal
Add a `/catalog/completeness` sub-route that lists every session keyed by the existing `core.session_completeness` view (Phase 0/1 helper-tables contract — `sql/005_helper_tables.sql:457-699`) and shows, per session, the `completeness_status` bucket (`analytic_ready` / `partially_loaded` / `metadata_only` / `future_placeholder`), the integer `completeness_score`, and which raw-table contracts populated the session via the `has_*` boolean flags. Data must come from the materialized `core.session_completeness` view — no `raw.*` reads in the new query.

The existing `web/src/app/catalog/page.tsx` (Schema Catalog — `information_schema.columns` dump) is left untouched; this slice ADDS a sub-route at `web/src/app/catalog/completeness/page.tsx` rather than overwriting the existing schema-catalog route.

## Inputs
- `web/src/app/catalog/page.tsx` (existing Schema Catalog route — read for layout reference; NOT modified by this slice)
- `web/src/lib/queries/sessions.ts` (existing query module; gains a new export)
- `sql/005_helper_tables.sql:457-699` (column inventory for `core.session_completeness`)
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 10

## Prior context
- `diagnostic/_state.md`
- `web/scripts/tests/session-detail-strategy-summary.test.mjs` (reference for source-inspection grading-test pattern)
- `web/scripts/tests/session-detail-stint-timeline.test.mjs` (reference for source-inspection grading-test pattern)

## Required services / env
None at author time. The grading test is a pure source-inspection Node `node:test` suite (no live DB, no env vars). Runtime behavior of the page against a real database is explicitly out of scope for this slice's gates — see `Out of scope`.

## Steps
1. Add `export async function getCatalogCompleteness(filters?: { year?: number; status?: string; limit?: number; offset?: number })` to `web/src/lib/queries/sessions.ts`. The body must `SELECT ... FROM core.session_completeness` (no `raw.*` reads). Project these columns (all sourced from `core.session_completeness` per `sql/005_helper_tables.sql:648-699`): `session_key`, `meeting_key`, `year`, `meeting_name`, `session_name`, `normalized_session_type`, `country_name`, `location`, `date_start`, `completeness_status`, `completeness_score`, `has_core_analysis_pack`, `has_drivers`, `has_laps`, `has_pit`, `has_stints`, `has_weather`, `has_team_radio`, `has_position_history`, `has_intervals`, `has_car_data`, `has_location`, `has_session_result`, `has_starting_grid`, `has_race_control`. Apply optional parameterized filters `($1::int IS NULL OR year = $1)` and `($2::text IS NULL OR completeness_status = $2)`, order by `date_start DESC NULLS LAST, session_key DESC`, and clamp `LIMIT` (default 200, max 500) + `OFFSET` (default 0) via the existing `safeLimit` / `clampInt` helpers already used by `getSessions`.
2. Create `web/src/app/catalog/completeness/CompletenessTable.tsx` as a default-exported function component taking `{ rows: Record<string, unknown>[] }`. Render a table with one row per session showing: `session_key`, `year`, `meeting_name`, `normalized_session_type`, `completeness_status`, `completeness_score`, plus a contract-coverage cell that renders the names of the `has_*` flags that are `true` (e.g. "drivers, laps, pit, stints, weather"). Mark each session row with `data-testid="completeness-row"` and the status cell with `data-testid="completeness-status"`. The component must contain the literal substrings `data-testid="completeness-row"`, `data-testid="completeness-status"`, `completeness_status`, `completeness_score`, and `meeting_name` (G2 below).
3. Create `web/src/app/catalog/completeness/page.tsx` as a server component:
   - Default-import `CompletenessTable` from `./CompletenessTable`.
   - Import `getCatalogCompleteness` from `@/lib/queries/sessions` (per-module path; do NOT import from the `@/lib/queries` barrel — `web/src/lib/queries.ts` is not modified by this slice and the new export is only reachable via the per-module specifier).
   - Set `export const dynamic = "force-dynamic"` to match the adjacent `web/src/app/catalog/page.tsx` route convention.
   - Inside the default-exported async function, declare `const rows = await getCatalogCompleteness({})` (use `rows` exactly so G3's binding match is unambiguous), then render `<div className="stack"><section className="card"><h2 className="panel-title">Session Completeness</h2><p className="muted">…</p></section><CompletenessTable rows={rows} /></div>`.
   - Do NOT modify `web/src/app/catalog/page.tsx` (Schema Catalog) or any other existing route file. The Schema Catalog page remains the `/catalog` index; this slice adds the `/catalog/completeness` sibling route only.
4. Add the source-inspection grading test `web/scripts/tests/catalog-completeness.test.mjs`, mirroring the structure of `web/scripts/tests/session-detail-strategy-summary.test.mjs`. The test uses Node's built-in `node:test` and `node:fs` only (no transpile, no DB, no env). Required assertions G1–G5 are spelled out under Acceptance criteria. G3 must extract the `<CompletenessTable rows={…}>` JSX binding directly via the regex `/<CompletenessTable\s+rows=\{(\w+)\}/` and verify it matches a `const <name> = await getCatalogCompleteness(` declaration in the same file (no destructured-`Promise.all` shortcut, since this page calls a single query and binds it directly).

## Changed files expected
- `web/src/lib/queries/sessions.ts` (new export `getCatalogCompleteness`)
- `web/src/app/catalog/completeness/CompletenessTable.tsx` (new component)
- `web/src/app/catalog/completeness/page.tsx` (new sub-route)
- `web/scripts/tests/catalog-completeness.test.mjs` (new dedicated grading test)

## Artifact paths
None.

## Gate commands
```bash
cd web && npm run build
cd web && npm run typecheck
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/scripts/tests/catalog-completeness.test.mjs` exists and passes under `bash scripts/loop/test_grading_gate.sh` with these assertions:
  - **G1**: `getCatalogCompleteness` is declared in `web/src/lib/queries/sessions.ts` (`export async function getCatalogCompleteness`); its body contains the literal substrings `FROM core.session_completeness` and `WHERE` (so the parameterized `$1`/`$2` filters apply); it does NOT reference any `raw.` table (the test asserts the body string does not include `raw.`); and it references each of these column identifiers as literal substrings: `session_key`, `meeting_key`, `year`, `meeting_name`, `normalized_session_type`, `completeness_status`, `completeness_score`, `has_core_analysis_pack`, `has_drivers`, `has_laps`, `has_pit`, `has_stints`, `has_weather`, `has_team_radio`, `has_position_history`, `has_intervals`, `has_car_data`, `has_location`, `has_session_result`, `has_starting_grid`, `has_race_control`.
  - **G2**: `web/src/app/catalog/completeness/CompletenessTable.tsx` exists, exports a default function (`/export\s+default\s+function\b/`), and contains the literal substrings `data-testid="completeness-row"`, `data-testid="completeness-status"`, `completeness_status`, `completeness_score`, and `meeting_name`.
  - **G3**: `web/src/app/catalog/completeness/page.tsx` (a) imports `getCatalogCompleteness` from `@/lib/queries/sessions` specifically (per-module path; the `@/lib/queries` barrel form is NOT accepted because this slice does not modify `web/src/lib/queries.ts` to re-export the new function); (b) calls `getCatalogCompleteness(` somewhere in the file body; (c) contains a `<CompletenessTable rows={<binding>}` JSX element from which `<binding>` is extracted via `/<CompletenessTable\s+rows=\{(\w+)\}/`; and (d) `<binding>` matches the `<name>` in some `const <name>\s*=\s*await\s+getCatalogCompleteness(` declaration in the same file (i.e., the JSX rows prop is bound to the awaited query result, by name).
  - **G4**: `page.tsx` default-imports `CompletenessTable` from `./CompletenessTable` (`/import\s+CompletenessTable\s+from\s+["']\.\/CompletenessTable["']/`).
  - **G5**: `page.tsx` declares `export const dynamic = "force-dynamic"` (literal substring; matches the convention of the existing `web/src/app/catalog/page.tsx`).
- [ ] `cd web && npm run build` exits 0.
- [ ] `cd web && npm run typecheck` exits 0.
- [ ] `bash scripts/loop/test_grading_gate.sh` exits 0 (any pre-existing baseline failures in `scripts/loop/state/test_grading_baseline.txt` may stay; no NEW non-baseline failures may be introduced — the wrapper enforces this).

## Out of scope
- DB-backed runtime verification of the rendered rows (the slice ships the page; verifying live DB rows against real sessions is out of scope, mirrored from `Required services / env`).
- Modifying the existing Schema Catalog page at `web/src/app/catalog/page.tsx`.
- Adding a barrel re-export to `web/src/lib/queries.ts` for `getCatalogCompleteness`.
- Filter/sort UI controls, pagination affordances, or query-string param handling beyond the bounded SQL `LIMIT` defaults.
- Weekend-level rollup (`core.weekend_session_coverage` is a separate concern and is not consumed by this page).
- Any change to `core.session_completeness` itself (the view is treated as an existing read-only contract).

## Risk / rollback
Rollback: `git revert <commit>`. The route is purely additive at `/catalog/completeness`; the existing `/catalog` Schema Catalog route, all existing query exports, all session-detail pages, and `web/src/lib/queries.ts` are untouched.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High

### Medium
- [x] Replace the raw `cd web && npm run test:grading` gate with `bash scripts/loop/test_grading_gate.sh` so the slice uses the baseline-aware grading wrapper required by repo protocol.
- [x] Rewrite Step 3 to target the repo's existing `web/scripts/tests/*.test.mjs` grading harness instead of conditional Playwright/RTL or a dev-server screenshot path, and align the acceptance criteria to those concrete gates.
- [x] Name the exact Phase 3 contract source(s) and the coverage fields/semantics the page must present; "appropriate semantic contracts" is too vague to implement or audit consistently.
- [x] Expand `Changed files expected` beyond `web/src/app/catalog/page.tsx` to cover the obvious supporting files this slice will need, including the grading test file(s) and any query/helper modules used to compute completeness.
- [x] Update `Required services / env` to declare the database/service prerequisites needed to validate contract-backed coverage data, or explicitly scope the slice to mocked/fixture-backed verification if it must remain env-free.
- [x] Make the acceptance criteria executable by naming the command or test artifact that proves the page renders and that the displayed completeness matches contract data for a defined session fixture/case.

### Low

### Notes (informational only — no action)
- `web/src/app/catalog/page.tsx` already exists in the repo, so this slice is a repurpose/extension of the existing route rather than creation of a brand-new page.
