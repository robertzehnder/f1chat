---
slice_id: 03-pit-cycle-summary
phase: 3
status: revising
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T19:51:48-04:00
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, `03-strategy-summary`, `03-race-progression-summary`, `03-grid-vs-finish`) to `pit_cycle_summary`: read from the preserved source-definition view `core_build.pit_cycle_summary` (already shipped by `03-core-build-schema` in `sql/008_core_build_schema.sql:715` ff.), materialize into a real storage table `core.pit_cycle_summary_mat` keyed on the verified per-pit-event grain `(session_key, driver_number, pit_sequence)`, and replace the public `core.pit_cycle_summary` view with a thin facade `SELECT * FROM core.pit_cycle_summary_mat`. The existing 26-column projection (driver/session attributes, pit-event identifiers, pit timing, pre/post-pit positions, pre/post pace-window aggregates, and the four boolean evidence-sufficiency flags) is preserved verbatim. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against `core_build.pit_cycle_summary` for the deterministic three `analytic_ready` sessions plus a global rowcount equality check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as the precedent slices: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.pit_cycle_summary_mat`; the public `core.pit_cycle_summary` is replaced via `CREATE OR REPLACE VIEW core.pit_cycle_summary AS SELECT * FROM core.pit_cycle_summary_mat`. The "matview" framing in the round-0 plan body is the conceptual pattern, not the SQL object kind. The round-0 deliverables that required `MATERIALIZED VIEW` and `REFRESH MATERIALIZED VIEW` privileges are explicitly removed.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** A public dependent already exists: `core.strategy_evidence_summary` (defined in `sql/007_semantic_summary_contracts.sql:553` ff.) reads from `core.pit_cycle_summary` via `WITH pit_cycle AS (SELECT * FROM core.pit_cycle_summary)` at `sql/007_semantic_summary_contracts.sql:556`. A `DROP VIEW core.pit_cycle_summary` would fail at apply time with `cannot drop view core.pit_cycle_summary because other objects depend on it`, even inside a transaction. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 2.1 declares the storage table's column list to exactly mirror the original view's projection, so `SELECT * FROM core.pit_cycle_summary_mat` is column-compatible and the swap succeeds without disturbing `core.strategy_evidence_summary`.
- **Grain: unique `(session_key, driver_number, pit_sequence)` → real `PRIMARY KEY`, gated by an explicit pre-flight grain probe.** Per the canonical query at `sql/008_core_build_schema.sql:715` ff., the source-definition `core_build.pit_cycle_summary` is one row per element of `core_build.strategy_summary.pit_laps` for each `(session_key, driver_number)`, with `pit_sequence = ROW_NUMBER() OVER (PARTITION BY session_key, driver_number ORDER BY pit_lap)`. By construction `pit_sequence` is dense and unique within each `(session_key, driver_number)` partition, so the triple `(session_key, driver_number, pit_sequence)` is the natural unique grain. The triple `(session_key, driver_number, pit_lap)` is **not** chosen as the PK because the canonical query does not impose a uniqueness invariant on `pit_lap` within a driver-session — if a driver's `strategy_summary.pit_laps` array ever contained duplicates (e.g. two raw.pit rows on the same lap), `pit_lap` would repeat but `pit_sequence` would not. The three downstream LEFT JOINs (`position_pairs`, `pace_windows`, `pit_meta`) are each pre-aggregated with `GROUP BY (session_key, driver_number, pit_lap)` (or `pit_lap → lap_number`), so they match at most once per pit-event row and cannot multiply rows beyond `pit_events`. To address the grain claim with explicit plan-time evidence rather than relying solely on the bulk-INSERT PK-violation rollback, the plan adds a **pre-flight grain probe** as gate command #0 that runs before the migration is applied: it queries `core_build.pit_cycle_summary` for `total_rows`, `distinct_triple` on `(session_key, driver_number, pit_sequence)`, and `duplicate_rows = total_rows - distinct_triple`, and **`RAISE EXCEPTION` if `duplicate_rows <> 0`**. Gate #0 fails non-zero before any DDL is run, so a non-unique triple is discovered with diagnostics rather than via opaque PK-violation rollback. **Documented heap-with-indexes fallback:** if gate #0 ever fires (whether on first apply, or on a future re-apply after the canonical view body changes), the slice must be re-planned to mirror `03-laps-enriched-materialize` / `03-race-progression-summary` exactly — drop `PRIMARY KEY`, declare two non-unique btree indexes `(session_key, driver_number, pit_sequence)` and `(session_key)`, switch the gate #2 assertions accordingly, and ship as a separate revision. The bulk `INSERT … SELECT` in step 2.2 remains a secondary backstop assertion, but is no longer the *only* grain check — gate #0 is the primary, plan-time evidence.
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as the precedent slices: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. The round-0 deliverables `web/src/lib/contracts/pitCycleSummary.ts` and `web/scripts/tests/parity-pit-cycle.test.mjs` are therefore explicitly removed from `Changed files expected` and from `Steps`. A TypeScript contract type would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice — `web/src/lib/deterministicSql.ts` and `web/src/lib/queries.ts` already read `core.pit_cycle_summary` through the public view, which transparently swings to the matview after the facade swap), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.pit_cycle_summary_mat SELECT * FROM core_build.pit_cycle_summary` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. Per-session incremental refresh and the ingest hook are deferred to a later Phase 3 slice.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql` / `sql/01N_*.sql`; the next free integer after `sql/014_grid_vs_finish_mat.sql` is `015`, so this slice ships `sql/015_pit_cycle_summary_mat.sql`. The round-0 deliverable `sql/pit_cycle_summary.sql` is therefore replaced.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as every preceding Phase 3 materialization slice: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`). Although the grain is unique on `(session_key, driver_number, pit_sequence)` (so duplicate rows are not expected in a single-session scope), `EXCEPT ALL` is still mandated by roadmap §4 Phase 3 step 5 for consistency across all materialization slices. The global rowcount equality check is what proves materialization completeness across the entire table.
- **Prerequisite assumed: `sql/008_core_build_schema.sql` is already applied** so `core_build.pit_cycle_summary` exists, along with its prerequisites `core_build.strategy_summary`, `core_build.race_progression_summary`, and `core_build.laps_enriched`. Slice `03-core-build-schema` shipped this and was merged at `67bdeff`. Gate command #1 will fail non-zero with a clean `relation core_build.pit_cycle_summary does not exist` error if applied to a database where `008` has not been run, and the transaction will roll back. This slice **does not** recreate or modify the `core_build.pit_cycle_summary` source-definition view.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, parity SQL.
- `sql/007_semantic_summary_contracts.sql:401` ff. — current public `core.pit_cycle_summary` view (column ordering / types / semantics that the `_mat` table must mirror); `sql/007_semantic_summary_contracts.sql:553` ff. — `core.strategy_evidence_summary` (the live public dependent at line 556 that forces `CREATE OR REPLACE VIEW`).
- `sql/008_core_build_schema.sql:715` ff. — preserved source-definition `core_build.pit_cycle_summary` (merged in slice `03-core-build-schema`; reads from `core_build.strategy_summary`, `core_build.race_progression_summary`, `core_build.laps_enriched`, and `raw.pit`).
- `sql/009_driver_session_summary_mat.sql`, `sql/010_laps_enriched_mat.sql`, `sql/011_stint_summary_mat.sql`, `sql/012_strategy_summary_mat.sql`, `sql/013_race_progression_summary_mat.sql`, `sql/014_grid_vs_finish_mat.sql` — prior materialization migrations whose pattern this slice follows verbatim.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.pit_cycle_summary` and the bidirectional `EXCEPT ALL` parity pattern this slice extends; this is the prerequisite called out below).
- `diagnostic/slices/03-strategy-summary.md` (most direct PK-grain precedent for this exact pattern — same `CREATE OR REPLACE VIEW` facade swap into a public dependent, same gate structure; the differences for this slice are the column list, the grain triple `(session_key, driver_number, pit_sequence)`, the dependent name `core.strategy_evidence_summary`, and the addition of a pre-flight grain probe).
- `diagnostic/slices/03-race-progression-summary.md` (precedent for the pre-flight grain probe pattern this slice reuses, including the documented heap-with-indexes fallback if the probe ever finds duplicates).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.pit_cycle_summary` view body lives, lines 401–549, plus `core.strategy_evidence_summary` at line 553 ff. which depends on it via the `WITH pit_cycle AS (SELECT * FROM core.pit_cycle_summary)` reference at line 556).
- `sql/008_core_build_schema.sql` (where `core_build.pit_cycle_summary` is defined, lines 715–863 — already merged; this slice **does not** recreate it).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.pit_cycle_summary_mat`).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.pit_cycle_summary` (to read the canonical query during initial population, the pre-flight grain probe, and the parity check).
  - Sufficient privilege to swap `core.pit_cycle_summary` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT` and `SELECT` on `core.pit_cycle_summary_mat` (implicit via ownership of the table the migration creates).
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which required statement-level `CREATE MATERIALIZED VIEW`. **No `REFRESH MATERIALIZED VIEW` is invoked anywhere in this slice.**
- `psql` available on PATH for the gate commands below (same prerequisite as the precedent slices).

## Steps
1. **Pre-flight grain probe (run BEFORE applying the migration).** Execute gate command #0 below to probe the grain of `core_build.pit_cycle_summary` on `(session_key, driver_number, pit_sequence)` and assert `duplicate_rows = 0`. Gate #0 fails non-zero (via `RAISE EXCEPTION`) if `duplicate_rows > 0` so a non-unique triple is caught with explicit diagnostics before any DDL is run. The grain claim is plausible by construction (`pit_sequence` is `ROW_NUMBER()` over each `(session_key, driver_number)` partition in `core_build.strategy_summary`'s `pit_laps`), but is gate-enforced rather than assumed.
2. Add `sql/015_pit_cycle_summary_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.pit_cycle_summary_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.pit_cycle_summary` view** as defined at `sql/007_semantic_summary_contracts.sql:401` ff. The 26 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`, `driver_number`, `full_name`, `team_name`, `pit_sequence`, `pit_lap`, `pit_timestamp`, `pit_duration_seconds`, `pre_pit_position`, `post_pit_position`, `positions_gained_after_pit`, `pre_window_lap_count`, `pre_window_avg_lap`, `post_window_lap_count`, `post_window_avg_lap`, `post_minus_pre_lap_delta`, `position_evidence_sufficient`, `pace_window_evidence_sufficient`, `evidence_sufficient_for_pit_cycle_claim`, `evidence_sufficient_for_strategy_claim`. Types must match the view's projected types (sourced from `sql/007_semantic_summary_contracts.sql`, `sql/008_core_build_schema.sql`, the upstream `core_build.strategy_summary`/`core_build.race_progression_summary`/`core_build.laps_enriched`, and `raw.pit`):
      - `session_key`, `meeting_key` are `BIGINT` (raw `BIGINT` columns from `raw.sessions` / `raw.meetings`, projected through `strategy_summary`).
      - `year`, `driver_number` are `INTEGER` (raw `INTEGER` columns).
      - `session_name`, `session_type`, `country_name`, `location`, `full_name`, `team_name` are `TEXT`.
      - `pit_sequence` is `BIGINT` (`ROW_NUMBER()` resolves to `bigint`).
      - `pit_lap` is `INTEGER` (projected from `pl.lap_number` via `UNNEST(integer[])`, which preserves `integer`).
      - `pit_timestamp` is `TIMESTAMPTZ` (`MIN(p.date)` where `raw.pit.date` is declared `TIMESTAMPTZ`).
      - `pit_duration_seconds` is `NUMERIC` (`ROUND(MIN(p.pit_duration)::numeric, 3)` resolves to `numeric`).
      - `pre_pit_position`, `post_pit_position` are `INTEGER` (`MAX(CASE … rp.position_end_of_lap)` over `integer` preserves type; `position_end_of_lap` is declared `INTEGER` at `sql/006_semantic_lap_layer.sql` / `sql/010_laps_enriched_mat.sql`).
      - `positions_gained_after_pit` is `INTEGER` (`pre_pit_position - post_pit_position` of two `integer` operands resolves to `integer`).
      - `pre_window_lap_count`, `post_window_lap_count` are `BIGINT` (`COUNT(*) FILTER(...)` resolves to `bigint`).
      - `pre_window_avg_lap`, `post_window_avg_lap`, `post_minus_pre_lap_delta` are `NUMERIC` (`ROUND(AVG(...)::numeric, 3)` and `ROUND((... - ...)::numeric, 3)` resolve to `numeric`).
      - `position_evidence_sufficient`, `pace_window_evidence_sufficient`, `evidence_sufficient_for_pit_cycle_claim`, `evidence_sufficient_for_strategy_claim` are `BOOLEAN` (boolean expressions).
      Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/007` and `sql/006`/`sql/010`) so the `_mat` table is positionally compatible with the source-definition view. **Declare `PRIMARY KEY (session_key, driver_number, pit_sequence)`** — the verified unique grain (gate #0 confirms zero duplicates on this triple before the migration runs).
   2. `TRUNCATE core.pit_cycle_summary_mat;` then `INSERT INTO core.pit_cycle_summary_mat SELECT * FROM core_build.pit_cycle_summary;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. The bulk `INSERT … SELECT` doubles as a secondary grain backstop: a non-unique grain on `(session_key, driver_number, pit_sequence)` would abort the transaction with a clean PK-violation error and roll back the migration (gate #0 is the primary check; this is belt-and-braces).
   3. `CREATE OR REPLACE VIEW core.pit_cycle_summary AS SELECT * FROM core.pit_cycle_summary_mat;` — replace the public view body in place with the facade. **Do not** use `DROP VIEW … CREATE VIEW`: `core.strategy_evidence_summary` (`sql/007_semantic_summary_contracts.sql:553` ff., specifically the `WITH pit_cycle AS (SELECT * FROM core.pit_cycle_summary)` reference at `sql/007_semantic_summary_contracts.sql:556`) depends on `core.pit_cycle_summary` and would block the drop, even in a single transaction. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 2.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection.
3. Apply the SQL to `$DATABASE_URL` (gate command #1).
4. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), (c) the storage relation carries `PRIMARY KEY (session_key, driver_number, pit_sequence)` in that exact column order, and (d) the public view is actually a thin facade over the matview (its only relation dependency in schemas `core` / `core_build` / `raw`, sourced from `pg_depend` joined through `pg_rewrite`, is `core.pit_cycle_summary_mat`) — gate command #2. Without check (d), gate #2 would pass if the migration accidentally left the original aggregating view body in place, since that would still be a view (`relkind = 'v'`).
5. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.pit_cycle_summary` (canonical query) and `core.pit_cycle_summary_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by every preceding Phase 3 materialization slice, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.pit_cycle_summary_mat` differs from the global rowcount of `core_build.pit_cycle_summary`.
6. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
7. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/015_pit_cycle_summary_mat.sql` (new — single `BEGIN; … COMMIT;` transaction; `CREATE TABLE … PRIMARY KEY (session_key, driver_number, pit_sequence)`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.pit_cycle_summary`, `CREATE OR REPLACE VIEW core.pit_cycle_summary AS SELECT * FROM core.pit_cycle_summary_mat` — no `DROP VIEW`, because `core.strategy_evidence_summary` depends on `core.pit_cycle_summary`).
- `diagnostic/slices/03-pit-cycle-summary.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/pitCycleSummary.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-pit-cycle.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-4]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
set -euo pipefail

# 0. Pre-flight grain probe over core_build.pit_cycle_summary on
#    (session_key, driver_number, pit_sequence). Must exit 0; the DO block
#    raises (and ON_ERROR_STOP=1 forces non-zero exit) if duplicate_rows > 0,
#    so a non-unique triple is discovered with diagnostics before any DDL is
#    applied. If gate #0 fires, switch the slice to the heap-with-indexes
#    fallback documented in Risk / rollback.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  total_rows bigint;
  distinct_rows bigint;
  duplicate_rows bigint;
BEGIN
  SELECT count(*) INTO total_rows FROM core_build.pit_cycle_summary;
  SELECT count(*) INTO distinct_rows FROM (
    SELECT DISTINCT session_key, driver_number, pit_sequence
    FROM core_build.pit_cycle_summary
  ) d;
  duplicate_rows := total_rows - distinct_rows;
  RAISE NOTICE 'core_build.pit_cycle_summary grain probe: total=% distinct_triple=% duplicate=%',
    total_rows, distinct_rows, duplicate_rows;
  IF duplicate_rows <> 0 THEN
    RAISE EXCEPTION
      'core_build.pit_cycle_summary grain non-unique on (session_key, driver_number, pit_sequence): total=% distinct=% duplicate=%; switch to heap-with-indexes fallback',
      total_rows, distinct_rows, duplicate_rows;
  END IF;
END $$;
SQL

# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/015_pit_cycle_summary_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation
#    is a view, (c) the storage relation carries PRIMARY KEY
#    (session_key, driver_number, pit_sequence) in that exact column order,
#    and (d) the public view is actually a thin facade over
#    core.pit_cycle_summary_mat (its only relation dependency in core /
#    core_build / raw is the matview). Must exit 0; the DO block raises (and
#    ON_ERROR_STOP=1 forces non-zero exit) unless every assertion holds.
#    Without check (d) this gate would pass even if the migration accidentally
#    left the original aggregating view body in place, since that would still
#    be a view (relkind = 'v').
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  view_kind text;
  pk_cols text[];
  facade_refs text[];
BEGIN
  -- (a) storage relation is a base table.
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'pit_cycle_summary_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.pit_cycle_summary_mat as base table (relkind r), got %', table_kind;
  END IF;

  -- (b) public relation is a view.
  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'pit_cycle_summary';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.pit_cycle_summary as view (relkind v), got %', view_kind;
  END IF;

  -- (c) PRIMARY KEY (session_key, driver_number, pit_sequence) in that exact
  --     column order. Order is preserved by sorting attribute names by their
  --     position in c.conkey.
  SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'core'
    AND cl.relname = 'pit_cycle_summary_mat'
    AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM ARRAY['session_key','driver_number','pit_sequence']::text[] THEN
    RAISE EXCEPTION
      'expected core.pit_cycle_summary_mat PRIMARY KEY (session_key, driver_number, pit_sequence), got %',
      pk_cols;
  END IF;

  -- (d) Assert the public view is a thin facade over the matview. Walk
  --     pg_depend through the view's pg_rewrite rule to enumerate every
  --     relation it depends on, restricted to schemas core/core_build/raw
  --     (so we ignore pg_catalog and self-references). The only relation
  --     that must appear is core.pit_cycle_summary_mat. If the migration
  --     accidentally left the original aggregating view body in place, this
  --     set would instead include core.strategy_summary,
  --     core.race_progression_summary, core.laps_enriched, raw.pit, etc.,
  --     and the assertion would fail with the offending list in the error
  --     message.
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
    AND v.relname = 'pit_cycle_summary'
    AND tn.nspname IN ('core', 'core_build', 'raw')
    AND t.oid <> v.oid;
  IF facade_refs IS DISTINCT FROM ARRAY['core.pit_cycle_summary_mat']::text[] THEN
    RAISE EXCEPTION
      'expected core.pit_cycle_summary to be a thin facade over core.pit_cycle_summary_mat, but it references: %',
      facade_refs;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.pit_cycle_summary and core.pit_cycle_summary_mat. Must exit 0;
#    the block raises if (a) fewer than 3 analytic_ready sessions are
#    available, (b) any session reports diff_rows > 0, or (c) global
#    rowcounts differ. Inline heredoc -- no .parity.sql file.
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
  SELECT count(*) INTO build_rows FROM core_build.pit_cycle_summary;
  SELECT count(*) INTO mat_rows   FROM core.pit_cycle_summary_mat;
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
      (SELECT * FROM core_build.pit_cycle_summary  WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.pit_cycle_summary_mat    WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.pit_cycle_summary_mat    WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.pit_cycle_summary  WHERE session_key = sess.session_key)
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
- [ ] Pre-flight grain probe over `core_build.pit_cycle_summary` confirms zero duplicates on `(session_key, driver_number, pit_sequence)` — gate #0 exits `0` (the DO block's `RAISE EXCEPTION` branch on `duplicate_rows <> 0` does not fire) and emits a NOTICE with `total`, `distinct_triple`, and `duplicate` counts.
- [ ] `core.pit_cycle_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number, pit_sequence)` — gate #1 (`psql -f sql/015_pit_cycle_summary_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` AND the table carries a primary-key constraint whose columns are exactly `['session_key','driver_number','pit_sequence']` in that order, sourced from `pg_constraint` with `contype = 'p'`).
- [ ] `core.pit_cycle_summary` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] `core.pit_cycle_summary` is a thin facade over `core.pit_cycle_summary_mat` — gate #2 exits `0` (the DO block's final assertion raises unless `pg_depend`-via-`pg_rewrite` reports `core.pit_cycle_summary_mat` as the **only** relation the view depends on within schemas `core` / `core_build` / `raw`; this is the check that distinguishes the facade swap from the original aggregating view body, which depended on `core.strategy_summary`, `core.race_progression_summary`, `core.laps_enriched`, `raw.pit`).
- [ ] Global rowcount of `core.pit_cycle_summary_mat` equals the global rowcount of `core_build.pit_cycle_summary` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §5 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/015_pit_cycle_summary_mat.sql` (new) and `diagnostic/slices/03-pit-cycle-summary.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-4]_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.pit_cycle_summary_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.pit_cycle_summary_mat` beyond the PK (Phase 4, profile-driven).
- Materializing the other hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order — `core.strategy_evidence_summary`, `core.lap_phase_summary`, `core.lap_context_summary`, `core.telemetry_lap_bridge`).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`web/src/lib/deterministicSql.ts`, `web/src/lib/queries.ts`, `web/src/lib/chatRuntime.ts`) to read the matview through a new typed contract — deferred until a consumer actually needs it. The facade swap means existing callers transparently benefit from the materialized storage with no code change.

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.pit_cycle_summary`. `core.strategy_evidence_summary` depends on it (`sql/007_semantic_summary_contracts.sql:556`). Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents, provided the new query produces the same column names, types, and ordering as the existing view. Step 2.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe. A `DROP VIEW` would have failed at apply time with `cannot drop view core.pit_cycle_summary because other objects depend on it` and rolled back the whole transaction.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 2.1 are explicit and ordered to match `core.pit_cycle_summary` as defined in `sql/007_semantic_summary_contracts.sql:401` ff.; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: PK violation on `(session_key, driver_number, pit_sequence)` if the source view's grain is non-unique on that triple. Primary mitigation: gate #0's pre-flight grain probe runs before any DDL is applied and `RAISE EXCEPTION` if `duplicate_rows <> 0`, so a non-unique triple is caught with explicit numbers (`total / distinct / duplicate`) rather than via the opaque PK-violation rollback. **Documented heap-with-indexes fallback:** if gate #0 ever fires (whether on first apply, or on a future re-apply after the canonical view body changes), the slice must be re-planned to mirror `03-laps-enriched-materialize` / `03-race-progression-summary` exactly — drop `PRIMARY KEY`, declare two non-unique btree indexes `(session_key, driver_number, pit_sequence)` and `(session_key)`, switch the gate #2 assertions accordingly, and ship as a separate revision. Secondary backstop: even if gate #0 is somehow bypassed, the bulk `INSERT … SELECT` in step 2.2 still aborts the transaction with a clean PK-violation error and no half-built state. The grain claim is plausible by construction (`pit_sequence` is `ROW_NUMBER()` over each `(session_key, driver_number)` partition) but is not assumed — it is gate-enforced.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.pit_cycle_summary`, since it depends transitively on `core_build.strategy_summary`, `core_build.race_progression_summary`, `core_build.laps_enriched`). Mitigation: gate #0 / gate #1 fail non-zero with a clean `relation core_build.pit_cycle_summary does not exist` error and the transaction rolls back; the loop's slice ordering already merged `03-core-build-schema` at `67bdeff` before this slice can ship.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, the public dependent `core.strategy_evidence_summary` must continue to work throughout. Use the same dependency-safe pattern as the forward migration: `CREATE OR REPLACE VIEW` to swing `core.pit_cycle_summary`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction. **Do NOT re-apply `sql/007_semantic_summary_contracts.sql`** as a shortcut: that file also defines `core.strategy_summary`, `core.race_progression_summary`, and other contracts that have since been materialized by their own slices (`03-strategy-summary`, `03-race-progression-summary`, etc.) and now exist as facade views over their own `_mat` tables; re-running `sql/007` would clobber those facade swaps and replace them with the original aggregating bodies, silently breaking the other materializations. Paste **only** the `CREATE OR REPLACE VIEW core.pit_cycle_summary AS …` body from `sql/007_semantic_summary_contracts.sql:401` ff. verbatim:
  ```sql
  BEGIN;
  -- Step 1: Restore core.pit_cycle_summary to its original aggregating body.
  -- This MUST be CREATE OR REPLACE VIEW, NOT DROP VIEW + CREATE VIEW: dropping
  -- the view would fail with "cannot drop view core.pit_cycle_summary because
  -- other objects depend on it" because core.strategy_evidence_summary
  -- references it. Paste ONLY the core.pit_cycle_summary view definition from
  -- sql/007_semantic_summary_contracts.sql:401 ff. verbatim — do NOT re-run
  -- the whole file, because that would also revert the facade swaps for
  -- core.strategy_summary, core.race_progression_summary, and other views
  -- that have since been materialized by later slices.
  CREATE OR REPLACE VIEW core.pit_cycle_summary AS
    -- … exact body copied from sql/007_semantic_summary_contracts.sql:401 ff. …
  ;
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.pit_cycle_summary_mat and DROP TABLE would fail with "cannot drop
  -- table core.pit_cycle_summary_mat because other objects depend on it".
  -- After Step 1 nothing depends on the table.
  DROP TABLE IF EXISTS core.pit_cycle_summary_mat;
  COMMIT;
  ```

## Slice-completion note

**Branch:** `slice/03-pit-cycle-summary`

**Files changed (only these — confirmed by `git status` / `git diff --name-only integration/perf-roadmap..HEAD`):**
- `sql/015_pit_cycle_summary_mat.sql` (new, single `BEGIN; … COMMIT;`)
- `diagnostic/slices/03-pit-cycle-summary.md` (frontmatter `status pending → awaiting_audit → revising → in_progress → awaiting_audit`, `owner claude → codex → claude → codex`, `updated → 2026-04-27T19:38:33-04:00`; Slice-completion note filled in; gate #3 output corrected per audit round 1 finding #3)

No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-4]_*.sql`, no application code. Scope clean.

**Commit hashes (this slice):** `7c28a34` (`slice 03-pit-cycle-summary: materialize core.pit_cycle_summary`), `98ed1bf` (`slice 03-pit-cycle-summary: record commit hash in completion note`), and the follow-up revise commit on this same branch tagged `[slice:03-pit-cycle-summary][awaiting-audit]` that addresses audit round 1 finding #3 (gate #3 output claim).

**Decisions applied (verbatim from plan):**
- Object model: real `core.pit_cycle_summary_mat` base table + facade view `core.pit_cycle_summary` (Decisions §1). No `CREATE MATERIALIZED VIEW`, no `REFRESH MATERIALIZED VIEW`.
- Facade swap via `CREATE OR REPLACE VIEW` (Decisions §2) — `DROP VIEW` would have failed because `core.strategy_evidence_summary` (`sql/007_semantic_summary_contracts.sql:556`) depends on `core.pit_cycle_summary`.
- Grain confirmed unique by gate #0 (`total=18718 distinct_triple=18718 duplicate=0`), so the storage table carries `PRIMARY KEY (session_key, driver_number, pit_sequence)` per Decisions §3 — heap-with-indexes fallback was not triggered.
- Single SQL migration; no TypeScript contract, no `.mjs` parity script (Decisions §4).
- Initial population: `TRUNCATE` + `INSERT … SELECT * FROM core_build.pit_cycle_summary` inside the same transaction. 18 718 rows inserted on first apply.
- Numbered `sql/015_pit_cycle_summary_mat.sql` per Decisions §6.
- Bidirectional, multiplicity-preserving `EXCEPT ALL` parity over the 3 deterministic `analytic_ready` sessions plus a global rowcount-equality check (Decisions §7).

**Gate command exit codes (run from this worktree against `$DATABASE_URL`):**
- Gate #0 — pre-flight grain probe over `core_build.pit_cycle_summary` on `(session_key, driver_number, pit_sequence)` — **exit 0**. NOTICE: `core_build.pit_cycle_summary grain probe: total=18718 distinct_triple=18718 duplicate=0`.
- Gate #1 — `psql -v ON_ERROR_STOP=1 -f sql/015_pit_cycle_summary_mat.sql` — **exit 0**. Output: `BEGIN / CREATE TABLE / TRUNCATE TABLE / INSERT 0 18718 / CREATE VIEW / COMMIT`.
- Gate #2 — structural assertions DO block (relkind='r' on `_mat`; relkind='v' on the public view; PK columns exactly `['session_key','driver_number','pit_sequence']` in that order; the view's only `pg_depend`-via-`pg_rewrite` reference within `core`/`core_build`/`raw` is `core.pit_cycle_summary_mat`) — **exit 0**.
- Gate #3 — parity DO block (3-session sentinel; global rowcount equality; bidirectional `EXCEPT ALL` per session) — **exit 0**. Output: `DO`. The DO block uses `RAISE EXCEPTION` for failure paths only, so a clean run emits no per-session NOTICE and no rowcount NOTICE — passing the block is signalled solely by exit `0`. Independent verification (run separately, not part of gate #3): `SELECT count(*) FROM core_build.pit_cycle_summary;` and `SELECT count(*) FROM core.pit_cycle_summary_mat;` both returned `18718`; the deterministic 3-session selector returned `9102`, `9110`, `9118`.
- `npm --prefix web run build` — **exit 0** (Next.js 15 build successful, all 21 routes compiled).
- `npm --prefix web run typecheck` — **exit 0** (`tsc --noEmit` clean).
- `npm --prefix web run test:grading` — **exit 0** (`# tests 31 / # pass 21 / # fail 0 / # skipped 10`; the 10 skips are the `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`-gated `/api/chat` propagation checks, which require a running app and are skipped by default in every prior slice).

**Self-check vs Acceptance criteria:**
- [x] Gate #0 exits `0` (`duplicate_rows = 0`); NOTICE emitted with `total=18718 distinct_triple=18718 duplicate=0`.
- [x] `core.pit_cycle_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number, pit_sequence)` — gate #1 exit 0, gate #2 exit 0.
- [x] `core.pit_cycle_summary` exists as a view (the facade) — gate #2 exit 0.
- [x] `core.pit_cycle_summary` is a thin facade over `core.pit_cycle_summary_mat` — gate #2 exit 0 (the view's only `pg_depend`-via-`pg_rewrite` reference within `core`/`core_build`/`raw` is `core.pit_cycle_summary_mat`).
- [x] Global rowcount equality: `core_build.pit_cycle_summary` = `core.pit_cycle_summary_mat` = 18 718 — gate #3 exit 0.
- [x] Bidirectional `EXCEPT ALL` parity = 0 for sessions 9102, 9110, 9118 — gate #3 exit 0.
- [x] `npm --prefix web run build` exit 0.
- [x] `npm --prefix web run typecheck` exit 0.
- [x] `npm --prefix web run test:grading` exit 0.
- [x] Only files changed are `sql/015_pit_cycle_summary_mat.sql` (new) and this slice file (frontmatter + Slice-completion note). Verified by `git status`. `web/node_modules` and `web/.next` are gitignored, so the local `npm install` and build left no tracked changes.

**Notes for the auditor:**
- `pit_sequence` is `ROW_NUMBER() OVER (PARTITION BY session_key, driver_number ORDER BY pit_lap)` in the canonical view body (`sql/008_core_build_schema.sql:729-732`), so the triple `(session_key, driver_number, pit_sequence)` is unique by construction. Gate #0 confirmed empirically on the live DB: `total=18718 distinct_triple=18718 duplicate=0`. The PK was therefore declared per the plan's "if gate #0 passes" branch; the heap-with-indexes fallback documented in Risk / rollback was not triggered.
- No web cutover happened in this slice. `web/src/lib/queries.ts`, `web/src/lib/deterministicSql.ts`, and `web/src/lib/chatRuntime.ts` continue to read `core.pit_cycle_summary` through the public view, which now transparently resolves to the matview via the facade. Likewise `core.strategy_evidence_summary` (`sql/007_semantic_summary_contracts.sql:553` ff.) continues to read `FROM core.pit_cycle_summary` and was not disturbed by the `CREATE OR REPLACE VIEW` swap.

## Audit verdict
**REVISE**

[slice:03-pit-cycle-summary][revise]

Gate exit codes observed by audit agent:
- Gate #0 `psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL' ... SQL` → exit `0`. Output: `NOTICE: core_build.pit_cycle_summary grain probe: total=18718 distinct_triple=18718 duplicate=0`, then `DO`.
- Gate #1 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/015_pit_cycle_summary_mat.sql` → exit `0`. Output included `BEGIN`, `CREATE TABLE`, `NOTICE: relation "pit_cycle_summary_mat" already exists, skipping`, `TRUNCATE TABLE`, `INSERT 0 18718`, `CREATE VIEW`, `COMMIT`.
- Gate #2 structural assertion block → exit `0`. Output: `DO`.
- Gate #3 parity block → exit `0`. Output: `DO`.
- `npm --prefix web run build` → exit `0`.
- `npm --prefix web run typecheck` → exit `0`.
- `npm --prefix web run test:grading` → exit `0` (`tests 31`, `pass 21`, `fail 0`, `skipped 10`).

Scope-diff result:
- `git diff --name-only integration/perf-roadmap...HEAD` returned only `diagnostic/slices/03-pit-cycle-summary.md` and `sql/015_pit_cycle_summary_mat.sql`.
- That path set is a subset of `Changed files expected`, with the slice file allowed by policy.

Findings:
- `diagnostic/slices/03-pit-cycle-summary.md:11-324` rewrites the slice plan body (`Goal`, `Decisions`, `Inputs`, `Prior context`, `Required services / env`, `Steps`, `Changed files expected`, `Gate commands`, `Acceptance criteria`, `Out of scope`, `Risk / rollback`). The file-content acceptance rule at `diagnostic/slices/03-pit-cycle-summary.md:287` allows only frontmatter transitions plus the `Slice-completion note`; these plan-body edits are out of bounds.
- `diagnostic/slices/03-pit-cycle-summary.md:409-455` appends full prior `Plan-audit verdict` sections in the implementation diff. The same rule at line 287 forbids edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes.

Criterion-by-criterion:
- Pre-flight grain probe on `(session_key, driver_number, pit_sequence)`: verified.
- `core.pit_cycle_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number, pit_sequence)`: verified.
- `core.pit_cycle_summary` exists as a view: verified.
- `core.pit_cycle_summary` is a thin facade over `core.pit_cycle_summary_mat`: verified.
- Global rowcount equality between `core_build.pit_cycle_summary` and `core.pit_cycle_summary_mat`: verified. Independent rowcounts observed: `18718` and `18718`.
- Bidirectional `EXCEPT ALL` parity across the three deterministic `analytic_ready` sessions: verified. Selector returned session keys `9102`, `9110`, `9118`.
- `npm --prefix web run build`: verified.
- `npm --prefix web run typecheck`: verified.
- `npm --prefix web run test:grading`: verified.
- Slice-file content restriction: failed.

Required revision:
- Reduce the `diagnostic/slices/03-pit-cycle-summary.md` diff so this file changes only in allowed frontmatter fields, the `Slice-completion note`, and the audit section. Remove the implementation-time plan-body rewrite and the appended prior `Plan-audit verdict` sections from the branch diff.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Rewrite the slice around the approved Phase 3 materialization pattern: create the next numbered SQL migration (currently `sql/015_pit_cycle_summary_mat.sql`) for a real `core.pit_cycle_summary_mat` base table populated from `core_build.pit_cycle_summary`, then swap `core.pit_cycle_summary` to a thin facade `SELECT * FROM core.pit_cycle_summary_mat`; do not plan a standalone `CREATE MATERIALIZED VIEW` in `sql/pit_cycle_summary.sql`.
- [x] Account for the live public dependent `core.strategy_evidence_summary` when describing the facade swap: require `CREATE OR REPLACE VIEW core.pit_cycle_summary AS SELECT * FROM core.pit_cycle_summary_mat` and explicitly forbid `DROP VIEW`, because `sql/007_semantic_summary_contracts.sql` already reads `FROM core.pit_cycle_summary`.
- [x] Replace the web-only gate list with executable database gates that apply the migration, assert the storage/view relation kinds and chosen unique grain, and prove parity with bidirectional `EXCEPT ALL` on 3 deterministic `analytic_ready` sessions plus a global rowcount check; the current gates cannot verify that the DB objects were created correctly.

### Medium
- [x] Align `Changed files expected` with the actual slice scope by listing the numbered SQL migration and this slice file, and remove `web/src/lib/contracts/pitCycleSummary.ts` plus `web/scripts/tests/parity-pit-cycle.test.mjs` unless the plan also adds matching implementation steps, gates, and acceptance criteria for those paths.
- [x] Expand `Required services / env` to the base-table migration prerequisites used by adjacent approved slices: `psql` on `PATH`, `CREATE` on schema `core`, ownership/replace rights on `core.pit_cycle_summary`, `USAGE`/`SELECT` on `core_build`, and `SELECT` on `core.session_completeness`; remove the current `CREATE MATERIALIZED VIEW` privilege requirement.
- [x] Add the existing contract and adjacent slice precedents to `Prior context` so the plan can be audited against the actual dependency and gate pattern: `sql/007_semantic_summary_contracts.sql`, `diagnostic/slices/03-strategy-summary.md`, and `diagnostic/slices/03-race-progression-summary.md`.

### Low
- [x] Clarify the Goal wording so it matches the existing `core.pit_cycle_summary` contract being materialized; the current shorthand "in-lap, out-lap, duration, time loss" does not describe the broader public column set preserved by this slice.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated at `2026-04-27T23:09:08Z`, so no staleness note is required for this round.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Make the gate-command block fail fast by chaining the commands with `&&` or adding `set -e` before the multi-command sequence; as written, an earlier failing gate can be masked by a later successful command because the block ends with `npm --prefix web run test:grading`.

### Medium
- [x] Replace the rollback guidance that re-applies `sql/007_semantic_summary_contracts.sql` with the narrower `CREATE OR REPLACE VIEW core.pit_cycle_summary AS ...` body only, because re-applying the full file would also revert already-materialized public views such as `core.strategy_summary` and `core.race_progression_summary`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated at `2026-04-27T23:09:08Z`, so no staleness note is required for this round.

## Plan-audit verdict (round 3)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated at `2026-04-27T23:09:08Z`, so no staleness note is required for this round.
