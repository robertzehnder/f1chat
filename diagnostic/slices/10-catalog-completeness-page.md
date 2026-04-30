---
slice_id: 10-catalog-completeness-page
phase: 10
status: awaiting_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-30T18:34:50-04:00
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
2. Create `web/src/app/catalog/completeness/CompletenessTable.tsx` as a default-exported function component taking `{ rows: Record<string, unknown>[] }`. Render a table with one row per session showing: `session_key`, `year`, `meeting_name`, `normalized_session_type`, `completeness_status`, `completeness_score`, plus a contract-coverage cell that renders the names of the `has_*` flags that are `true` (e.g. "drivers, laps, pit, stints, weather"). The contract-coverage cell MUST be marked with `data-testid="completeness-coverage"` and its content MUST be derived in source from each of the `has_*` flag identifiers (`has_core_analysis_pack`, `has_drivers`, `has_laps`, `has_pit`, `has_stints`, `has_weather`, `has_team_radio`, `has_position_history`, `has_intervals`, `has_car_data`, `has_location`, `has_session_result`, `has_starting_grid`, `has_race_control`) — i.e. the source of `CompletenessTable.tsx` must literally reference each of those 14 column identifiers so the grading test can prove (statically) that the cell consumes the contract booleans rather than fabricating output. Mark each session row with `data-testid="completeness-row"` and the status cell with `data-testid="completeness-status"`. The component must contain the literal substrings `data-testid="completeness-row"`, `data-testid="completeness-status"`, `data-testid="completeness-coverage"`, `session_key`, `year`, `meeting_name`, `normalized_session_type`, `completeness_status`, `completeness_score`, and each of the 14 `has_*` column identifiers listed above (G2 below).
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
Each line below is intended to be runnable independently from the repo root. The first two are wrapped in subshells so a `cd web` inside one line does NOT bleed into the next line's working directory (otherwise pasting the block would leave the shell in `web/` and the second `cd web && npm run typecheck` would resolve against `web/web` and fail before the gate ran).
```bash
(cd web && npm run build)
(cd web && npm run typecheck)
bash scripts/loop/test_grading_gate.sh
```

## Acceptance criteria
- [ ] `web/scripts/tests/catalog-completeness.test.mjs` exists and passes under `bash scripts/loop/test_grading_gate.sh` with these assertions:
  - **G1**: `getCatalogCompleteness` is declared in `web/src/lib/queries/sessions.ts` (`export async function getCatalogCompleteness`); its body contains the literal substrings `FROM core.session_completeness` and `WHERE`; it does NOT reference any `raw.` table (the test asserts the body string does not include `raw.`); and it references each of these column identifiers as literal substrings: `session_key`, `meeting_key`, `year`, `meeting_name`, `session_name`, `normalized_session_type`, `country_name`, `date_start`, `completeness_status`, `completeness_score`, `has_core_analysis_pack`, `has_drivers`, `has_laps`, `has_pit`, `has_stints`, `has_weather`, `has_team_radio`, `has_position_history`, `has_intervals`, `has_car_data`, `has_location`, `has_session_result`, `has_starting_grid`, `has_race_control`. **G1 also asserts the body references the bare `location` column identifier** (the projected `core.session_completeness.location` column from Step 1) **distinct from the `has_location` flag**, by requiring at least two occurrences of the substring `location` in the body (one for `location` itself and one for `has_location`) — equivalent to `(body.match(/location/g) ?? []).length >= 2`. This guards against the implementation projecting only `has_location` while silently dropping the `location` column. **G1 also enforces the SQL contract from Step 1 by asserting**: (i) the body contains the year-filter predicate `$1::int IS NULL OR year = $1` and the status-filter predicate `$2::text IS NULL OR completeness_status = $2` as literal substrings (i.e. the `$1`-bound year filter and `$2`-bound status filter are both present); (ii) the body contains the literal substring `ORDER BY date_start DESC NULLS LAST, session_key DESC`; and (iii) the body references both the `safeLimit` and `clampInt` helper identifiers as literal substrings (proving `LIMIT` and `OFFSET` are bounded via the existing helpers rather than passed through unclamped).
  - **G2**: `web/src/app/catalog/completeness/CompletenessTable.tsx` exists, exports a default function (`/export\s+default\s+function\b/`), and contains the literal substrings `data-testid="completeness-row"`, `data-testid="completeness-status"`, `data-testid="completeness-coverage"`, `session_key`, `year`, `meeting_name`, `normalized_session_type`, `completeness_status`, and `completeness_score`. The added `session_key`, `year`, and `normalized_session_type` literal-source checks enforce the full required session-column projection from Step 2 (so the slice cannot pass while omitting those declared table fields). **G2 also asserts that the file's source references EACH of the 14 `has_*` contract-coverage column identifiers** (`has_core_analysis_pack`, `has_drivers`, `has_laps`, `has_pit`, `has_stints`, `has_weather`, `has_team_radio`, `has_position_history`, `has_intervals`, `has_car_data`, `has_location`, `has_session_result`, `has_starting_grid`, `has_race_control`) as literal substrings. This proves (statically, without a live DB) that the contract-coverage cell consumes the `has_*` flags from `core.session_completeness` rather than omitting the goal-critical "which contracts populated this session" output.
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

**Branch:** `slice/10-catalog-completeness-page`

**Files changed:**
- `web/src/lib/queries/sessions.ts` — added `type CatalogCompletenessFilters` and new export `getCatalogCompleteness(filters?: CatalogCompletenessFilters)`. Body selects `FROM core.session_completeness` (no `raw.*` reads), projects all 24 declared columns (incl. bare `location` and `has_location`), applies the `$1::int IS NULL OR year = $1` and `$2::text IS NULL OR completeness_status = $2` predicates, orders by `date_start DESC NULLS LAST, session_key DESC`, and clamps `LIMIT` (default 200, max 500) / `OFFSET` (default 0, max 1_000_000) via the existing `safeLimit` / `clampInt` helpers — same pattern used by `getSessions`.
- `web/src/app/catalog/completeness/CompletenessTable.tsx` — new default-exported component. Renders one `<tr data-testid="completeness-row">` per session with cells for `session_key`, `year`, `meeting_name`, `normalized_session_type`, `completeness_status` (in a `<td data-testid="completeness-status">`), `completeness_score`, plus a contract-coverage `<td data-testid="completeness-coverage">` whose content is derived by filtering a `HAS_FLAGS` array that literally references each of the 14 `has_*` column identifiers.
- `web/src/app/catalog/completeness/page.tsx` — new server sub-route. Default-imports `CompletenessTable` from `./CompletenessTable`, imports `getCatalogCompleteness` from the per-module `@/lib/queries/sessions` path (no barrel touched), declares `export const dynamic = "force-dynamic"`, awaits `const rows = await getCatalogCompleteness({})`, and renders `<CompletenessTable rows={rows} />` inside a `stack` layout. The existing `/catalog` Schema Catalog page is untouched.
- `web/scripts/tests/catalog-completeness.test.mjs` — new source-inspection grading test (Node `node:test`, no DB/env). Asserts G1–G5 per the slice's acceptance criteria (function-body extraction with brace balancing, then literal-substring + regex checks for SQL contract, JSX bindings, and import shape).

**Decisions:**
- Used a named `type CatalogCompletenessFilters` alias rather than an inline object-type parameter, so that the `extractFunctionBody` helper in the grading test (first `{`-after-decl + brace balancing — the same helper used by `session-detail-strategy-summary.test.mjs` and `session-detail-stint-timeline.test.mjs`) lands on the function body and not the parameter type literal. The parameter is `filters?: CatalogCompletenessFilters` (optional), accessed via `filters?.…` inside the body — this avoids the `= {}` default that would also have introduced an `{}` token before the body brace.
- Mirrored `getSessions` for `safeLimit`/`clampInt` clamping (200 default, 500 max, OFFSET capped at 1_000_000) so the new export reuses the existing bounded-pagination helpers rather than introducing a parallel mechanism.
- The contract-coverage cell renders only the labels for `has_*` flags that are `true`, joined by `, ` (e.g. `"drivers, laps, pit, stints, weather"`), with `"—"` as the empty-set placeholder. This satisfies the slice's "names of the `has_*` flags that are true" requirement while keeping the cell readable.

**Gate results (exit codes):**
- `(cd web && npm run build)` — exit `0`. Output confirms the new `/catalog/completeness` route is registered alongside the existing `/catalog`.
- `(cd web && npm run typecheck)` — exit `0`.
- `bash scripts/loop/test_grading_gate.sh` — exit `0`. Wrapper output: `PASS (no new failures vs integration baseline) slice_fails=39 baseline_fails=39 baseline_failures_fixed=0`. The 39 slice failures match the cached integration baseline exactly; this slice introduced 0 new failures.

**Self-check (acceptance criteria):**
- G1 (sessions.ts query contract) — passes. `extractFunctionBody` lands on the body `{ … }`; body contains `FROM core.session_completeness`, `WHERE`, no `raw.`, all 24 declared column identifiers, the `$1`/`$2`-bound year/status predicates, `ORDER BY date_start DESC NULLS LAST, session_key DESC`, and references both `safeLimit` and `clampInt`. The `(body.match(/location/g) ?? []).length >= 2` assertion holds (one match for the bare `location` projection, one for `has_location`).
- G2 (CompletenessTable.tsx) — passes. File exists, matches `/export\s+default\s+function\b/`, contains all required `data-testid` literals, all 6 session-column literals (`session_key`, `year`, `meeting_name`, `normalized_session_type`, `completeness_status`, `completeness_score`), and each of the 14 `has_*` identifiers (via the `HAS_FLAGS` const).
- G3 (page.tsx wires query → JSX) — passes. Per-module import regex matches; `<CompletenessTable rows={rows}` extracts `rows`; `const rows = await getCatalogCompleteness(` is present in the same file.
- G4 (default import path) — passes. `import CompletenessTable from "./CompletenessTable";` matches the regex.
- G5 (force-dynamic) — passes. Literal `export const dynamic = "force-dynamic"` is present.

**Out-of-scope confirmations:**
- `web/src/app/catalog/page.tsx` (Schema Catalog) is unchanged — verified via `git status` showing only the four expected files modified/added.
- `web/src/lib/queries.ts` is unchanged — the new export is reachable only via the per-module `@/lib/queries/sessions` specifier, as required by Step 3.
- No `core.session_completeness` schema change; the view is consumed read-only.
- No live-DB runtime verification was performed; that is explicitly out of scope per `Required services / env` and `Out of scope`.

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

## Plan-audit verdict (round 2)

**Status: REVISE**

### High

### Medium
- [x] Make the `## Gate commands` block shell-safe when run as a pasted multi-line block by wrapping the `cd web && ...` entries in subshells or switching to an equivalent root-safe form; as written, the first `cd web && npm run build` leaves the shell in `web/`, so the next `cd web && npm run typecheck` resolves against `web/web` and fails before the intended gate runs.
- [x] Extend the grading-test contract so G2 (or a new assertion) proves `CompletenessTable.tsx` actually renders the contract-coverage cell from the `has_*` booleans; the current acceptance criteria only require `completeness_status`, `completeness_score`, and `meeting_name` substrings, so the slice can pass while omitting the goal-critical “which contracts populated this session” output entirely.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T22:11:15Z`, which is within 24 hours of this audit.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High

### Medium
- [x] Tighten G1 so the grading test proves `getCatalogCompleteness` implements the required SQL contract from Step 1 rather than merely mentioning `WHERE`: assert the source contains the year/status filter predicates (or equivalent `$1`/`$2`-bound checks), the `ORDER BY date_start DESC NULLS LAST, session_key DESC` clause, and the `safeLimit` / `clampInt` bounded `LIMIT`/`OFFSET` helpers.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T22:11:15Z`, which is within 24 hours of this audit.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [x] Extend G1 so the grading test also asserts the `getCatalogCompleteness` source references `session_name`, `country_name`, `location`, and `date_start`; Step 1 requires those columns in the projection, but the current acceptance criteria never verify them, so the implementation can omit part of the declared query contract and still pass all listed gates.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T22:11:15Z`, which is within 24 hours of this audit.

## Plan-audit verdict (round 5)

**Status: REVISE**

### High

### Medium
- [x] Extend G2 so the grading test proves `CompletenessTable.tsx` renders the full required session columns from Step 2, not just `meeting_name`, `completeness_status`, and `completeness_score`; require literal-source checks for `session_key`, `year`, and `normalized_session_type` so the slice cannot pass while omitting those declared table fields.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T22:11:15Z`, which is within 24 hours of this audit.

## Plan-audit verdict (round 6)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated at `2026-04-30T22:11:15Z`, which is within 24 hours of this audit.
