---
slice_id: 03-telemetry-lap-bridge
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T04:10:34Z
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, `03-strategy-summary`, `03-race-progression-summary`, `03-grid-vs-finish`, `03-pit-cycle-summary`, `03-strategy-evidence-summary`, `03-lap-phase-summary`, `03-lap-context-summary`) to the final hot contract `telemetry_lap_bridge`: read from the preserved source-definition view `core_build.telemetry_lap_bridge` (already shipped by `03-core-build-schema` in `sql/008_core_build_schema.sql:549` ff.), materialize into a real storage table `core.telemetry_lap_bridge_mat` (NOT `CREATE MATERIALIZED VIEW`) declared as a non-unique heap with two non-unique btree indexes (no `PRIMARY KEY` — see Decisions for the grain rationale), and replace the public `core.telemetry_lap_bridge` view with a thin facade `SELECT * FROM core.telemetry_lap_bridge_mat`. The existing 19-column projection (session attributes, driver identity, lap identity + window timestamps, aggregated `raw.car_data` lap-window telemetry stats, and `raw.location` sample count) is preserved verbatim. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against `core_build.telemetry_lap_bridge` for the deterministic three `analytic_ready` sessions plus a global rowcount equality check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as every preceding Phase 3 materialization slice: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.telemetry_lap_bridge_mat`; the public `core.telemetry_lap_bridge` is replaced via `CREATE OR REPLACE VIEW core.telemetry_lap_bridge AS SELECT * FROM core.telemetry_lap_bridge_mat`. The "matview" framing in the round-0 plan body is the conceptual pattern, not the SQL object kind.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** No SQL view in `core` / `core_build` / `raw` depends on `core.telemetry_lap_bridge` — it is a leaf in the source-definition graph (`grep -rn "core\.telemetry_lap_bridge\|core_build\.telemetry_lap_bridge" sql/` returns only the canonical body in `sql/007_semantic_summary_contracts.sql:792` ff. and the `core_build.*` clone in `sql/008_core_build_schema.sql:549` ff.; no other SQL file references it). Web runtime callers (`web/src/lib/anthropic.ts:60`, `web/src/lib/chatRuntime.ts:173/952/990/1030/1093`, `web/src/lib/queries.ts:80/127`, `web/src/lib/deterministicSql.ts:765`) read `core.telemetry_lap_bridge` through the public view, which transparently swings to the matview after the facade swap. We still use `CREATE OR REPLACE VIEW` to keep the pattern uniform with every preceding Phase 3 materialization slice and to keep the slice robust against a future SQL view that adds a dependency on it. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table's column list to exactly mirror the original view's projection, so `SELECT * FROM core.telemetry_lap_bridge_mat` is column-compatible and the swap succeeds.
- **No primary key. Non-unique heap with indexes — the same shape as `03-laps-enriched-materialize` and `03-lap-phase-summary`.** The canonical query at `sql/008_core_build_schema.sql:549` ff. is a non-aggregating projection: a `lap_windows` CTE that filters `core_build.laps_enriched` to laps where `lap_start_ts IS NOT NULL AND lap_end_ts IS NOT NULL AND lap_end_ts > lap_start_ts`, then `LEFT JOIN LATERAL (… aggregating subquery …) ON TRUE` against `raw.car_data` and `raw.location`. Each `LATERAL` aggregate produces exactly one row per outer `lap_windows` row (aggregate functions return a single row even with no input), so the join is 1:1:1 and the output multiplicity equals the `lap_windows` multiplicity, which equals `core_build.laps_enriched`'s multiplicity restricted by the `IS NOT NULL` window filter. Per `diagnostic/notes/03-laps-enriched-grain.md` (the grain-discovery deliverable that drove `03-laps-enriched-materialize`), `core_build.laps_enriched` is **non-unique**: 167172 total rows vs. 167170 distinct rows over the natural triple `(session_key, driver_number, lap_number)`, with 7,379 duplicate rows globally. That non-uniqueness propagates row-for-row through the `lap_windows` filter (the filter is on row-local fields, not a deduplicating projection), so `core_build.telemetry_lap_bridge` is also non-unique on every candidate triple. Therefore the storage table is declared with **no `PRIMARY KEY`** — exactly mirroring `03-laps-enriched-materialize` and `03-lap-phase-summary`. The required non-unique btree indexes are `(session_key, driver_number, lap_number)` (the natural query key — also matches the most common access pattern in `web/src/lib/deterministicSql.ts:765`) and `(session_key)` (supports the deferred delete-then-insert refresh per `session_key`). No additional indexes in this slice — secondary indexes are deferred to a profile-driven Phase 4 slice. **No pre-flight grain probe is required** because the non-uniqueness is already a known property of the upstream `core_build.laps_enriched`; a probe would be redundant and the heap-with-indexes shape is the right answer regardless of probe outcome. (Contrast with `03-strategy-evidence-summary`, which probed because its `ROW_NUMBER … rival_rank = 1` filter could collapse upstream duplicates into a unique output grain — that situation does not apply here.)
- **Refresh semantics: delete-then-insert per `session_key`.** Per roadmap §4 Phase 3 ("non-unique heap with indexes + delete-then-insert refresh per `session_key`"). This slice ships the migration that creates the table, populates it with `TRUNCATE` + `INSERT … SELECT *` for initial idempotent migration, and swaps the facade. The actual incremental `DELETE FROM core.telemetry_lap_bridge_mat WHERE session_key = $1; INSERT INTO core.telemetry_lap_bridge_mat SELECT * FROM core_build.telemetry_lap_bridge WHERE session_key = $1;` refresh helper and any ingest-hook integration are deferred to a later Phase 3 slice (out of scope here).
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as the precedent slices: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. The round-0 deliverables `web/src/lib/contracts/telemetryLapBridge.ts` and `web/scripts/tests/parity-telemetry-bridge.test.mjs` are therefore explicitly removed from `Changed files expected` and from `Steps`. A TypeScript contract type would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice — `web/src/lib/anthropic.ts`, `web/src/lib/chatRuntime.ts`, `web/src/lib/queries.ts`, and `web/src/lib/deterministicSql.ts` already read `core.telemetry_lap_bridge` through the public view, which transparently swings to the matview after the facade swap), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.telemetry_lap_bridge_mat SELECT * FROM core_build.telemetry_lap_bridge` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. Per-session incremental refresh and the ingest hook are deferred to a later Phase 3 slice.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql` / `sql/01N_*.sql`; the next free integer after `sql/018_lap_context_summary_mat.sql` (shipped by the just-merged `03-lap-context-summary` slice) is `019`, so this slice ships `sql/019_telemetry_lap_bridge_mat.sql`. The round-0 deliverable `sql/telemetry_lap_bridge.sql` is therefore replaced by the numbered name.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as every preceding Phase 3 materialization slice: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`) so duplicate-row drift is preserved — critical here precisely because the grain is non-unique (7,379 duplicate rows globally over the natural triple in `laps_enriched` propagate into `telemetry_lap_bridge` after the window filter). The global rowcount equality check is what proves materialization completeness across the entire table.
- **Prerequisite assumed: `sql/008_core_build_schema.sql` and `sql/010_laps_enriched_mat.sql` are already applied** so `core_build.telemetry_lap_bridge` exists and resolves transitively through `core_build.laps_enriched`. Slice `03-core-build-schema` shipped at `67bdeff` and slice `03-laps-enriched-materialize` shipped at `d2adddf`. Gate command #1 will fail non-zero with a clean `relation core_build.telemetry_lap_bridge does not exist` error if applied to a database where `008` has not been run, and the transaction will roll back. This slice **does not** recreate or modify the `core_build.telemetry_lap_bridge` source-definition view.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, "non-unique heap with indexes + delete-then-insert refresh" recommendation.
- `sql/007_semantic_summary_contracts.sql:792` ff. — current public `core.telemetry_lap_bridge` view (column ordering / types / semantics that the `_mat` table must mirror; the projection ends at line 859 just before the `core.metric_registry` backfill).
- `sql/008_core_build_schema.sql:549` ff. — preserved source-definition `core_build.telemetry_lap_bridge` (merged in slice `03-core-build-schema`; reads from `core_build.laps_enriched`, `raw.car_data`, `raw.location`).
- `sql/002_create_tables.sql:209` ff. — `raw.car_data` and `raw.location` column types, used to derive the aggregate result types in step 1.1 (`speed INTEGER`, `throttle DOUBLE PRECISION`, `brake INTEGER`, `date TIMESTAMPTZ`).
- `sql/009_driver_session_summary_mat.sql`, `sql/010_laps_enriched_mat.sql`, `sql/011_stint_summary_mat.sql`, `sql/012_strategy_summary_mat.sql`, `sql/013_race_progression_summary_mat.sql`, `sql/014_grid_vs_finish_mat.sql`, `sql/015_pit_cycle_summary_mat.sql`, `sql/016_strategy_evidence_summary_mat.sql`, `sql/017_lap_phase_summary_mat.sql`, `sql/018_lap_context_summary_mat.sql` — prior materialization migrations whose pattern this slice follows verbatim. Most directly: `sql/017_lap_phase_summary_mat.sql` (heap-with-indexes, no PK, two non-unique btree indexes — same shape this slice ships).
- `diagnostic/notes/03-laps-enriched-grain.md` — the grain-discovery decision that established `laps_enriched` (and therefore `telemetry_lap_bridge`) is non-unique.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.telemetry_lap_bridge` and the bidirectional `EXCEPT ALL` parity pattern this slice extends; this is the prerequisite called out in Decisions).
- `diagnostic/slices/03-laps-enriched-materialize.md` (originating heap-with-indexes precedent — same no-PK shape, same two non-unique btree indexes; the differences for this slice are the column list, the source view (`core_build.telemetry_lap_bridge` instead of `core_build.laps_enriched`), and the migration filename).
- `diagnostic/slices/03-lap-phase-summary.md` (most recent heap-pattern precedent — same `core_build.<contract>` source view with non-unique grain, same gate-check structure for table/view/index/facade verification and parity).
- `diagnostic/slices/03-lap-context-summary.md` (immediately preceding Phase 3 materialization slice — confirms the next free SQL filename integer is `019` and the auditor convention for the gate-command DO blocks).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.telemetry_lap_bridge` view body lives, lines 792–859).
- `sql/008_core_build_schema.sql` (where `core_build.telemetry_lap_bridge` is defined, lines 549–616 — already merged; this slice **does not** recreate it).
- `sql/002_create_tables.sql` (where `raw.car_data` and `raw.location` column types are pinned, used to derive the aggregate result types in step 1.1).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.telemetry_lap_bridge_mat` and the two non-unique btree indexes on it).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.telemetry_lap_bridge` (to read the canonical query during initial population and during the parity check). This implies transitive `SELECT` on `core_build.laps_enriched`, `raw.car_data`, and `raw.location`, which the migration role already holds.
  - Sufficient privilege to swap `core.telemetry_lap_bridge` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT`, `DELETE`, and `SELECT` on `core.telemetry_lap_bridge_mat` (implicit via ownership of the table the migration creates). `DELETE` is listed for completeness because the deferred refresh helper will use delete-then-insert; the migration in this slice itself only `TRUNCATE`s and `INSERT`s.
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which framed the artifact as a matview. **No `REFRESH MATERIALIZED VIEW` is invoked anywhere in this slice.**
- `psql` available on PATH for the gate commands below (same prerequisite as the precedent slices). The implementer must verify `psql --version` exits `0` before running gate command #1; the gate list assumes `psql` is the parity-execution tool. Gate #0 (`psql --version`) is the explicit PATH-availability check that satisfies round-1 audit's Low item.
- Web-tooling prerequisites for gate command #4 (`npm --prefix web run build` / `typecheck` / `test:grading`). These match the precedent slices' implicit assumptions and are made explicit here per round-2 audit's Low item:
  - `node` and `npm` available on PATH. `web/package.json` pins runtime dependencies for Next.js 15 / React 19 and dev dependencies for TypeScript 5.6 and `@types/node` 22; Node.js 20 LTS or newer (the version that ships with `@types/node` 22 typings) is required.
  - `web/node_modules/` must be installed and current relative to `web/package.json` and `web/package-lock.json`. If absent or stale, run `npm --prefix web ci` once before gate #4. The slice does not modify `web/package.json` or `web/package-lock.json`, so a one-time install on a clean checkout is sufficient — gate #4 itself does not run `npm install`.
  - The `next build` step compiles TypeScript and Next.js routes; `tsc --noEmit` (typecheck) reads from `web/tsconfig.json`; `node --test scripts/tests/*.test.mjs` (test:grading) runs the Node native test runner. None of these need network access at gate-run time, but the typecheck and build do read `web/src/lib/queries.ts` and `web/src/lib/deterministicSql.ts`, which reference `core.telemetry_lap_bridge` through the public view — so the migration in step 1 must have applied (gate #1) before gate #4 to guarantee the column signature the runtime expects is unchanged. (In practice the schema is unchanged because the facade preserves the view's column list verbatim, but the ordering keeps the gate dependency explicit.)
  - **No `DATABASE_URL` is required for gate #4** — `npm run build`, `npm run typecheck`, and `npm run test:grading` are all DB-free. The scripts that hit Neon (`healthcheck:chat`, `healthcheck:grade`) are not invoked by this slice's gates.

## Steps
1. Add `sql/019_telemetry_lap_bridge_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.telemetry_lap_bridge_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.telemetry_lap_bridge` view** as defined at `sql/007_semantic_summary_contracts.sql:792` ff. The 19 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `driver_number`, `driver_name`, `team_name`, `lap_number`, `lap_start_ts`, `lap_end_ts`, `car_samples`, `max_speed`, `avg_speed`, `max_throttle`, `avg_throttle`, `brake_samples`, `first_brake_time_sec`, `location_samples`. Types must match the view's projected types, derived from the upstream column types in `sql/006_semantic_lap_layer.sql` / `sql/010_laps_enriched_mat.sql` / `sql/002_create_tables.sql`:
      - `session_key`, `meeting_key` are `BIGINT`.
      - `year`, `driver_number`, `lap_number` are `INTEGER`.
      - `session_name`, `session_type`, `driver_name`, `team_name` are `TEXT`.
      - `lap_start_ts`, `lap_end_ts` are `TIMESTAMPTZ` (matches the upstream column types pinned at `sql/010_laps_enriched_mat.sql:25–26`).
      - `car_samples`, `brake_samples`, `location_samples` are `BIGINT` (`COUNT(*)` and `COUNT(*) FILTER (...)` produce `BIGINT`).
      - `max_speed` is `INTEGER` (`MAX(cd.speed)` where `raw.car_data.speed` is `INTEGER` per `sql/002_create_tables.sql:216`; `MAX` preserves the input type and there is no `ROUND` wrapper on this column).
      - `avg_speed`, `max_throttle`, `avg_throttle`, `first_brake_time_sec` are `NUMERIC` (the `ROUND(...::numeric, 3)` projection produces `NUMERIC`).
      Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/002`/`sql/006`/`sql/007`/`sql/010`) so the `_mat` table is positionally compatible with the source-definition view. **Declare no `PRIMARY KEY`** — the grain inherited from `core_build.laps_enriched` is non-unique (see Decisions). Do not declare any `NOT NULL` constraints on columns that the canonical query can null out: `lap_start_ts` and `lap_end_ts` are gated `IS NOT NULL` by the `lap_windows` CTE, but the LATERAL aggregate columns (`car_samples`, `max_speed`, `avg_speed`, `max_throttle`, `avg_throttle`, `brake_samples`, `first_brake_time_sec`, `location_samples`) can each be `NULL` when no `raw.car_data` / `raw.location` rows fall inside the lap window — leave them nullable.
   2. `CREATE INDEX IF NOT EXISTS telemetry_lap_bridge_mat_session_driver_lap_idx ON core.telemetry_lap_bridge_mat (session_key, driver_number, lap_number);` — non-unique btree on the natural query key.
   3. `CREATE INDEX IF NOT EXISTS telemetry_lap_bridge_mat_session_idx ON core.telemetry_lap_bridge_mat (session_key);` — non-unique btree to support the deferred delete-then-insert refresh per `session_key`.
   4. `TRUNCATE core.telemetry_lap_bridge_mat;` then `INSERT INTO core.telemetry_lap_bridge_mat SELECT * FROM core_build.telemetry_lap_bridge;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. Since the table has no PK and the indexes are non-unique, the bulk insert cannot fail on duplicate-key violation — the duplicate-row multiplicity from the source view is preserved verbatim, exactly as required by the inherited non-unique grain.
   5. `CREATE OR REPLACE VIEW core.telemetry_lap_bridge AS SELECT * FROM core.telemetry_lap_bridge_mat;` — replace the public view body in place with the facade. Use `CREATE OR REPLACE VIEW` (not `DROP VIEW … CREATE VIEW`) for pattern consistency with every preceding Phase 3 materialization slice and for robustness against any future SQL view that depends on `core.telemetry_lap_bridge`. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 1.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection.
2. Apply the SQL to `$DATABASE_URL` (gate command #1).
3. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), (c) the storage relation carries **no** primary-key constraint, (d) each of the two expected indexes exists exactly once and is a **non-unique btree** (`pg_index.indisunique = false`, `pg_am.amname = 'btree'`) on the **exact declared column list** (resolved via `array_position` over `ix.indkey` joined to `pg_attribute`) — name-only would silently pass a unique index, a non-btree index, or one whose column list drifted — and (e) the public view is actually a thin facade over the matview (its only relation dependency in schemas `core` / `core_build` / `raw`, sourced from `pg_depend` joined through `pg_rewrite`, is `core.telemetry_lap_bridge_mat`) — gate command #2. Without check (e), gate #2 would pass if the migration accidentally left the original aggregating view body in place, since that would still be a view (`relkind = 'v'`).
4. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.telemetry_lap_bridge` (canonical query) and `core.telemetry_lap_bridge_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by every preceding Phase 3 materialization slice, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.telemetry_lap_bridge_mat` differs from the global rowcount of `core_build.telemetry_lap_bridge`.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/019_telemetry_lap_bridge_mat.sql` (new — single `BEGIN; … COMMIT;` transaction; `CREATE TABLE … (no PK)`, two `CREATE INDEX IF NOT EXISTS`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.telemetry_lap_bridge`, `CREATE OR REPLACE VIEW core.telemetry_lap_bridge AS SELECT * FROM core.telemetry_lap_bridge_mat` — no `DROP VIEW`, for pattern consistency with prior heap-grain materialization slices).
- `diagnostic/slices/03-telemetry-lap-bridge.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/telemetryLapBridge.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-telemetry-bridge.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-8]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
set -euo pipefail

# 0. Prerequisite: psql must be on PATH. Must exit 0.
psql --version

# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/019_telemetry_lap_bridge_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation
#    is a view, (c) the storage relation carries NO primary-key constraint,
#    (d) each of the two expected indexes exists exactly once and is a
#    non-unique btree on the exact declared column list (per-index existence
#    count, indisunique, pg_am.amname, and the resolved column array via
#    array_position over ix.indkey -- a name-only check would silently pass
#    a unique index, a non-btree index, or one whose column list drifted),
#    and (e) the public view is actually a thin facade over
#    core.telemetry_lap_bridge_mat (its only relation dependency in core /
#    core_build / raw is the matview). Must exit 0; the DO block raises (and
#    ON_ERROR_STOP=1 forces non-zero exit) unless every assertion holds.
#    Without check (e) this gate would pass even if the migration accidentally
#    left the original aggregating view body in place, since that would still
#    be a view (relkind = 'v').
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  view_kind text;
  pk_count int;
  triple_idx_count int;
  triple_idx_unique boolean;
  triple_idx_am text;
  triple_idx_cols text[];
  session_idx_count int;
  session_idx_unique boolean;
  session_idx_am text;
  session_idx_cols text[];
  facade_refs text[];
BEGIN
  -- (a) storage relation is a base table.
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'telemetry_lap_bridge_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.telemetry_lap_bridge_mat as base table (relkind r), got %', table_kind;
  END IF;

  -- (b) public relation is a view.
  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'telemetry_lap_bridge';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.telemetry_lap_bridge as view (relkind v), got %', view_kind;
  END IF;

  -- (c) NO primary-key constraint on the storage relation.
  SELECT count(*) INTO pk_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'core'
    AND cl.relname = 'telemetry_lap_bridge_mat'
    AND c.contype = 'p';
  IF pk_count <> 0 THEN
    RAISE EXCEPTION
      'expected core.telemetry_lap_bridge_mat to have NO primary-key constraint, found %',
      pk_count;
  END IF;

  -- (d) Index #1: telemetry_lap_bridge_mat_session_driver_lap_idx exists exactly
  --     once, is non-unique btree, columns (session_key, driver_number, lap_number)
  --     in that order. Resolution via array_position over indkey so a column-list
  --     drift (e.g. (driver_number, session_key, lap_number)) is rejected.
  SELECT count(*) INTO triple_idx_count
  FROM pg_class ic
  JOIN pg_namespace n ON n.oid = ic.relnamespace
  WHERE n.nspname = 'core'
    AND ic.relname = 'telemetry_lap_bridge_mat_session_driver_lap_idx'
    AND ic.relkind = 'i';
  IF triple_idx_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one core.telemetry_lap_bridge_mat_session_driver_lap_idx, found %',
      triple_idx_count;
  END IF;

  SELECT ix.indisunique, am.amname::text
    INTO triple_idx_unique, triple_idx_am
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_namespace n ON n.oid = ic.relnamespace
  JOIN pg_am am ON am.oid = ic.relam
  WHERE n.nspname = 'core'
    AND ic.relname = 'telemetry_lap_bridge_mat_session_driver_lap_idx';
  IF triple_idx_unique IS NOT FALSE THEN
    RAISE EXCEPTION
      'expected telemetry_lap_bridge_mat_session_driver_lap_idx to be NON-unique (indisunique=false), got %',
      triple_idx_unique;
  END IF;
  IF triple_idx_am IS DISTINCT FROM 'btree' THEN
    RAISE EXCEPTION
      'expected telemetry_lap_bridge_mat_session_driver_lap_idx to be a btree index, got %',
      triple_idx_am;
  END IF;

  SELECT array_agg(a.attname ORDER BY array_position(ix.indkey::int[], a.attnum::int))
    INTO triple_idx_cols
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_namespace n ON n.oid = ic.relnamespace
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(ix.indkey::int[])
  WHERE n.nspname = 'core'
    AND ic.relname = 'telemetry_lap_bridge_mat_session_driver_lap_idx';
  IF triple_idx_cols IS DISTINCT FROM ARRAY['session_key','driver_number','lap_number']::text[] THEN
    RAISE EXCEPTION
      'expected telemetry_lap_bridge_mat_session_driver_lap_idx columns (session_key, driver_number, lap_number) in order, got %',
      triple_idx_cols;
  END IF;

  -- (d cont.) Index #2: telemetry_lap_bridge_mat_session_idx exists exactly once,
  --           is non-unique btree, columns (session_key).
  SELECT count(*) INTO session_idx_count
  FROM pg_class ic
  JOIN pg_namespace n ON n.oid = ic.relnamespace
  WHERE n.nspname = 'core'
    AND ic.relname = 'telemetry_lap_bridge_mat_session_idx'
    AND ic.relkind = 'i';
  IF session_idx_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one core.telemetry_lap_bridge_mat_session_idx, found %',
      session_idx_count;
  END IF;

  SELECT ix.indisunique, am.amname::text
    INTO session_idx_unique, session_idx_am
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_namespace n ON n.oid = ic.relnamespace
  JOIN pg_am am ON am.oid = ic.relam
  WHERE n.nspname = 'core'
    AND ic.relname = 'telemetry_lap_bridge_mat_session_idx';
  IF session_idx_unique IS NOT FALSE THEN
    RAISE EXCEPTION
      'expected telemetry_lap_bridge_mat_session_idx to be NON-unique (indisunique=false), got %',
      session_idx_unique;
  END IF;
  IF session_idx_am IS DISTINCT FROM 'btree' THEN
    RAISE EXCEPTION
      'expected telemetry_lap_bridge_mat_session_idx to be a btree index, got %',
      session_idx_am;
  END IF;

  SELECT array_agg(a.attname ORDER BY array_position(ix.indkey::int[], a.attnum::int))
    INTO session_idx_cols
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_namespace n ON n.oid = ic.relnamespace
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(ix.indkey::int[])
  WHERE n.nspname = 'core'
    AND ic.relname = 'telemetry_lap_bridge_mat_session_idx';
  IF session_idx_cols IS DISTINCT FROM ARRAY['session_key']::text[] THEN
    RAISE EXCEPTION
      'expected telemetry_lap_bridge_mat_session_idx columns (session_key), got %',
      session_idx_cols;
  END IF;

  -- (e) Assert the public view is a thin facade over the matview. Walk
  --     pg_depend through the view's pg_rewrite rule to enumerate every
  --     relation it depends on, restricted to schemas core/core_build/raw
  --     (so we ignore pg_catalog and self-references). The only relation
  --     that must appear is core.telemetry_lap_bridge_mat. If the migration
  --     accidentally left the original aggregating view body in place, this
  --     set would instead include core.laps_enriched, raw.car_data, and
  --     raw.location, and the assertion would fail with the offending list
  --     in the error message.
  SELECT array_agg(DISTINCT tn.nspname || '.' || t.relname
                   ORDER BY tn.nspname || '.' || t.relname)
    INTO facade_refs
  FROM pg_depend d
  JOIN pg_rewrite r ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass
  JOIN pg_class v ON r.ev_class = v.oid
  JOIN pg_namespace vn ON vn.oid = v.relnamespace
  JOIN pg_class t ON d.refobjid = t.oid AND d.refclassid = 'pg_class'::regclass
  JOIN pg_namespace tn ON tn.oid = t.relnamespace
  WHERE vn.nspname = 'core'
    AND v.relname = 'telemetry_lap_bridge'
    AND tn.nspname IN ('core', 'core_build', 'raw')
    AND t.oid <> v.oid;
  IF facade_refs IS DISTINCT FROM ARRAY['core.telemetry_lap_bridge_mat']::text[] THEN
    RAISE EXCEPTION
      'expected core.telemetry_lap_bridge to be a thin facade over core.telemetry_lap_bridge_mat, but it references: %',
      facade_refs;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.telemetry_lap_bridge and core.telemetry_lap_bridge_mat. Must
#    exit 0; the block raises if (a) fewer than 3 analytic_ready sessions are
#    available, (b) any session reports diff_rows > 0, or (c) global rowcounts
#    differ. Inline heredoc -- no .parity.sql file.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  sess record;
  diff bigint;
  sess_count int;
  build_rows bigint;
  mat_rows bigint;
BEGIN
  -- Hard-fail unless the deterministic selector returns exactly 3 sessions.
  SELECT count(*) INTO sess_count FROM (
    SELECT session_key
    FROM core.session_completeness
    WHERE completeness_status = 'analytic_ready'
    ORDER BY session_key ASC
    LIMIT 3
  ) s;
  IF sess_count <> 3 THEN
    RAISE EXCEPTION
      'expected 3 analytic_ready sessions for parity check, found %', sess_count;
  END IF;

  -- Global rowcount equality.
  SELECT count(*) INTO build_rows FROM core_build.telemetry_lap_bridge;
  SELECT count(*) INTO mat_rows   FROM core.telemetry_lap_bridge_mat;
  IF build_rows <> mat_rows THEN
    RAISE EXCEPTION 'global rowcount mismatch: core_build=%, mat=%', build_rows, mat_rows;
  END IF;

  -- Bidirectional, session-scoped, multiplicity-preserving parity.
  FOR sess IN
    SELECT session_key
    FROM core.session_completeness
    WHERE completeness_status = 'analytic_ready'
    ORDER BY session_key ASC
    LIMIT 3
  LOOP
    SELECT count(*) INTO diff FROM (
      (SELECT * FROM core_build.telemetry_lap_bridge  WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.telemetry_lap_bridge_mat    WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.telemetry_lap_bridge_mat    WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.telemetry_lap_bridge  WHERE session_key = sess.session_key)
    ) d;
    IF diff <> 0 THEN
      RAISE EXCEPTION 'parity drift: session_key=% diff_rows=%', sess.session_key, diff;
    END IF;
  END LOOP;
END $$;
SQL

# 4. Web side regression safety. Use --prefix so the three commands chain from one shell.
npm --prefix web run build
npm --prefix web run typecheck
npm --prefix web run test:grading
```

## Acceptance criteria
- [ ] `psql --version` exits `0` (gate #0 — prerequisite check that `psql` is on PATH so gates #1–#3 can run).
- [ ] `core.telemetry_lap_bridge_mat` exists as a base table with **no** primary-key constraint — gate #1 (`psql -f sql/019_telemetry_lap_bridge_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` and `pg_constraint` returns zero rows with `contype = 'p'`).
- [ ] `core.telemetry_lap_bridge` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] Index `telemetry_lap_bridge_mat_session_driver_lap_idx` exists exactly once, is a non-unique btree, and has columns `(session_key, driver_number, lap_number)` in that order — gate #2 exits `0` (the DO block raises unless the count is `1`, `pg_index.indisunique = false`, `pg_am.amname = 'btree'`, and the `array_position`-resolved column array matches `[session_key, driver_number, lap_number]`).
- [ ] Index `telemetry_lap_bridge_mat_session_idx` exists exactly once, is a non-unique btree, and has column list `(session_key)` — gate #2 exits `0` (the DO block raises unless the count is `1`, `pg_index.indisunique = false`, `pg_am.amname = 'btree'`, and the column array matches `[session_key]`).
- [ ] `core.telemetry_lap_bridge` is a thin facade over `core.telemetry_lap_bridge_mat` — gate #2 exits `0` (the DO block's final assertion raises unless `pg_depend`-via-`pg_rewrite` reports `core.telemetry_lap_bridge_mat` as the **only** relation the view depends on within schemas `core` / `core_build` / `raw`; this is the check that distinguishes the facade swap from the original aggregating view body, which depended on `core.laps_enriched`, `raw.car_data`, and `raw.location`).
- [ ] Global rowcount of `core.telemetry_lap_bridge_mat` equals the global rowcount of `core_build.telemetry_lap_bridge` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §4 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/019_telemetry_lap_bridge_mat.sql` (new) and `diagnostic/slices/03-telemetry-lap-bridge.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-8]_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.telemetry_lap_bridge_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.telemetry_lap_bridge_mat` beyond the two non-unique btree indexes declared in Steps §1.2/§1.3 (Phase 4, profile-driven).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`web/src/lib/anthropic.ts`, `web/src/lib/chatRuntime.ts`, `web/src/lib/queries.ts`, `web/src/lib/deterministicSql.ts`) to read the matview through a new typed contract — deferred until a consumer actually needs it. The facade swap means existing callers transparently benefit from the materialized storage with no code change.
- This is the **last hot contract** materialization slice in the Phase 3 scale-out priority list (per roadmap §4 Phase 3); after this slice merges, the eleven-contract `core_build.* → core.*_mat → core.* facade` shape is complete. The next Phase 3 slice is the per-session refresh helper (`src/refresh_summaries.py`), which is explicitly out of scope here.

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.telemetry_lap_bridge`. No SQL view in `core` / `core_build` / `raw` currently depends on it (it is a leaf in the source-definition graph; verified by grepping `sql/`), so the immediate dependent set is empty. Web callers (`web/src/lib/anthropic.ts`, `web/src/lib/chatRuntime.ts`, `web/src/lib/queries.ts`, `web/src/lib/deterministicSql.ts`) read it through the public view, so the facade swap is transparent at the SQL boundary. Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents (current or future), provided the new query produces the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 1.1 are explicit and ordered to match `core.telemetry_lap_bridge` as defined in `sql/007_semantic_summary_contracts.sql:792` ff.; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.telemetry_lap_bridge`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.telemetry_lap_bridge does not exist` error and the transaction rolls back; the loop's slice ordering already merged `03-core-build-schema` at `67bdeff` and `03-laps-enriched-materialize` at `d2adddf` before this slice can ship.
- Risk: cost of bulk `INSERT INTO … SELECT * FROM core_build.telemetry_lap_bridge`. The source view's `LEFT JOIN LATERAL` against `raw.car_data` and `raw.location` is the most expensive of any contract in the eleven-view set (high-frequency telemetry tables; ~10⁵–10⁶ rows per session in `raw.car_data` alone). Mitigation: the `lap_windows` CTE's `IS NOT NULL` filter narrows the outer driver, the LATERAL subqueries are session+driver+window-bounded, and `raw.car_data` / `raw.location` already have indexes on `(session_key, driver_number, date)` per `sql/003_indexes.sql`. The migration runs once per database; subsequent per-session refreshes (out of scope) will operate on a fraction of the data via the `(session_key)` index.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, no public DB dependent has to be preserved through the swap (the leaf-view property), but to keep the rollback path uniform with the precedent slices use `CREATE OR REPLACE VIEW` to swing `core.telemetry_lap_bridge`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction. **Do NOT re-apply `sql/007_semantic_summary_contracts.sql`** as a shortcut: that file also defines `core.strategy_summary`, `core.race_progression_summary`, `core.pit_cycle_summary`, `core.strategy_evidence_summary`, `core.lap_phase_summary`, `core.lap_context_summary`, and other contracts that have since been materialized by their own slices and now exist as facade views over their own `_mat` tables; re-running `sql/007` would clobber those facade swaps and replace them with the original aggregating bodies, silently breaking the other materializations. Paste **only** the `CREATE OR REPLACE VIEW core.telemetry_lap_bridge AS …` body from `sql/007_semantic_summary_contracts.sql:792` ff. verbatim:
  ```sql
  BEGIN;
  -- Step 1: Restore core.telemetry_lap_bridge to its original aggregating body.
  -- Use CREATE OR REPLACE VIEW for symmetry with the forward migration and so
  -- that any future SQL view that comes to depend on this view is not
  -- disturbed. Paste ONLY the core.telemetry_lap_bridge view definition from
  -- sql/007_semantic_summary_contracts.sql:792 ff. verbatim -- do NOT re-run
  -- the whole file, because that would also revert the facade swaps for
  -- core.strategy_summary, core.race_progression_summary,
  -- core.pit_cycle_summary, core.strategy_evidence_summary,
  -- core.lap_phase_summary, core.lap_context_summary, and other views that
  -- have since been materialized by later slices.
  CREATE OR REPLACE VIEW core.telemetry_lap_bridge AS
    -- ... exact body copied from sql/007_semantic_summary_contracts.sql:792 ff. ...
  ;
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.telemetry_lap_bridge_mat and DROP TABLE would fail with
  -- "cannot drop table core.telemetry_lap_bridge_mat because other objects
  -- depend on it". After Step 1 nothing depends on the table.
  DROP TABLE IF EXISTS core.telemetry_lap_bridge_mat;
  COMMIT;
  ```

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Add database gate commands that apply the `telemetry_lap_bridge` SQL to `core_build`, verify the materialized view exists, and run the parity check against the live query via `psql "$DATABASE_URL"` before the web gates, per the Phase 3 per-contract materialization protocol in `diagnostic/_state.md`.
- [x] Rewrite the Acceptance criteria so each required outcome is testable from command exit codes, including successful DB apply, successful existence verification, successful parity for 3 deterministic sessions, and successful web gates.

### Medium
- [x] Add the slice file path `diagnostic/slices/03-telemetry-lap-bridge.md` to Changed files expected, because implementation will update this file's frontmatter and Slice-completion note.
- [x] Specify the database artifact the SQL step must create, including the exact relation name/schema and how the implementer should apply it, because "Define the matview's SQL" does not currently produce the runtime object that step 3 depends on.

### Low
- [x] Add `psql` availability to Required services / env once DB gate commands are included.

### Notes (informational only — no action)
- `diagnostic/_state.md` was read and its `last updated` timestamp is within 24 hours.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
_None._

### Medium
_None._

### Low
- [x] Add the web-tooling prerequisites to `Required services / env` because gate #4 depends on `npm --prefix web ...` succeeding, but the plan currently documents only `DATABASE_URL` and `psql` requirements.

### Notes (informational only — no action)
- `diagnostic/_state.md` was read and its `last updated` timestamp is within 24 hours.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
_None._

### Medium
- [ ] Add `diagnostic/notes/03-laps-enriched-grain.md` to `## Prior context`, because the no-PK/non-unique grain decision depends on that artifact and auditors are instructed to read every path in that block before triaging.

### Low
- [ ] Remove the stale `## Audit verdict` placeholder so the appended `## Plan-audit verdict (round N)` sections remain the slice's single audit-status surface.

### Notes (informational only — no action)
- `diagnostic/_state.md` was read and its `last updated` timestamp is within 24 hours.
