---
slice_id: 03-race-progression-summary
phase: 3
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T21:36:47Z
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, and `03-strategy-summary`) to `race_progression_summary`: read from the preserved source-definition view `core_build.race_progression_summary` (already shipped by `03-core-build-schema` in `sql/008_core_build_schema.sql:415` ff.), materialize into a real storage table `core.race_progression_summary_mat` with `PRIMARY KEY (session_key, driver_number, lap_number)`, and replace the public `core.race_progression_summary` view with a thin facade `SELECT * FROM core.race_progression_summary_mat`. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against `core_build.race_progression_summary` for the deterministic three `analytic_ready` sessions plus a global rowcount equality check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as `03-driver-session-summary-prototype` Decisions §1, `03-laps-enriched-materialize` Decisions §1, `03-stint-summary` Decisions §1, and `03-strategy-summary` Decisions §1: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.race_progression_summary_mat`; the public `core.race_progression_summary` is replaced via `CREATE OR REPLACE VIEW core.race_progression_summary AS SELECT * FROM core.race_progression_summary_mat`. The "matview" framing in the round-0 plan body is the conceptual pattern, not the SQL object kind. The round-0 deliverables that required `MATERIALIZED VIEW` and `REFRESH MATERIALIZED VIEW` privileges are explicitly removed.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** A public dependent already exists: `core.pit_cycle_summary` (defined in `sql/007_semantic_summary_contracts.sql:401` ff.) reads from `core.race_progression_summary` (`LEFT JOIN core.race_progression_summary rp` at `sql/007_semantic_summary_contracts.sql:431`). A `DROP VIEW core.race_progression_summary` would fail at apply time with `cannot drop view core.race_progression_summary because other objects depend on it`, even inside a transaction. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table's column list to exactly mirror the original view's projection, so `SELECT * FROM core.race_progression_summary_mat` is column-compatible and the swap succeeds without disturbing the dependent.
- **Grain: unique `(session_key, driver_number, lap_number)` → real `PRIMARY KEY`, gated by an explicit pre-flight grain probe over the filtered source.** Per the canonical query at `sql/007_semantic_summary_contracts.sql:333` ff., the source-definition `core.race_progression_summary` is one row per filtered `core.laps_enriched` row produced by per-lap window functions over rows that satisfy `lap_number IS NOT NULL AND position_end_of_lap IS NOT NULL AND LOWER(COALESCE(session_type, session_name, '')) LIKE '%race%'`. Crucially, this is **not** a `GROUP BY` aggregation (unlike `03-driver-session-summary-prototype`, `03-stint-summary`, and `03-strategy-summary`), so uniqueness on the triple is not inherent to the projection — it is inherited from the filtered subset of `core_build.laps_enriched`. `diagnostic/notes/03-laps-enriched-grain.md` records 7,379 duplicate rows across all of `core_build.laps_enriched` on `(session_key, driver_number, lap_number)` (167,172 total / 159,793 distinct), so uniqueness on the unfiltered base relation is **already disproved**; uniqueness on `core_build.race_progression_summary` is therefore a claim about the residual triple-uniqueness *after* the three-predicate WHERE clause has run, not a derivation from the base. To address the round-3 audit item directly with explicit grain evidence (rather than relying solely on the bulk-INSERT PK-violation rollback as the assertion), the plan adds a **pre-flight grain probe** as gate command #0 that runs before the migration is applied: it queries `core_build.race_progression_summary` for `total_rows`, `distinct_triple`, and `duplicate_rows = total_rows - distinct_triple`, and **`RAISE EXCEPTION` if `duplicate_rows <> 0`**. Gate #0 fails non-zero before any DDL is run, so a non-unique triple is discovered with diagnostics rather than via opaque PK-violation rollback. If gate #0 fails on a future apply, the follow-up is to switch this slice to the heap-with-indexes pattern of `03-laps-enriched-materialize` (declared explicitly in Risk / rollback as the documented fallback). The bulk `INSERT … SELECT` in Steps §1.2 remains a secondary backstop assertion, but is no longer the *only* grain check — gate #0 is the primary, plan-time evidence the auditor asked for.
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as the precedent slices: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. The round-0 deliverables `web/src/lib/contracts/raceProgressionSummary.ts` and `web/scripts/tests/parity-race-progression.test.mjs` are therefore explicitly removed from `Changed files expected` and from `Steps`. A TypeScript contract type would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice — `web/src/lib/deterministicSql.ts` and `web/src/lib/queries.ts` already read `core.race_progression_summary` through the public view, which transparently swings to the matview after the facade swap), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.race_progression_summary_mat SELECT * FROM core_build.race_progression_summary` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. Per-session incremental refresh and the ingest hook are deferred to a later Phase 3 slice. (Per the roadmap §4 Phase 3 row-count snapshot, `core.race_progression_summary` carries ~17,864 rows, well within bulk-insert range for a single transaction.)
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql`; the next free integer after `sql/012_strategy_summary_mat.sql` is `013`, so this slice ships `sql/013_race_progression_summary_mat.sql`. The round-0 deliverable `sql/race_progression_summary.sql` is therefore replaced.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as `03-core-build-schema`, `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, and `03-strategy-summary`: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`). Although the grain is unique on `(session_key, driver_number, lap_number)` (so duplicate rows are not expected), `EXCEPT ALL` is still mandated by roadmap §4 Phase 3 step 5 for consistency across all materialization slices. A non-`%race%` session that slips through the deterministic selector will simply produce zero rows on both sides, which still satisfies bidirectional `EXCEPT ALL = 0`; the global rowcount equality check is what proves materialization completeness across all 17.8k rows.
- **Prerequisite assumed: `sql/008_core_build_schema.sql` is already applied** so `core_build.race_progression_summary` exists. This was shipped in slice `03-core-build-schema` (merged at `67bdeff`) and is a hard prerequisite — gate command #1 will fail non-zero with `relation core_build.race_progression_summary does not exist` if applied to a database where `008` has not been run, and the transaction will roll back. This slice **does not** recreate or modify the `core_build.race_progression_summary` source-definition view.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, parity SQL.
- `sql/007_semantic_summary_contracts.sql:333` ff. — current public `core.race_progression_summary` view (column ordering / types / semantics that the `_mat` table must mirror); `sql/007_semantic_summary_contracts.sql:401` ff. — `core.pit_cycle_summary` (the live public dependent at line 431 that forces `CREATE OR REPLACE VIEW`).
- `sql/008_core_build_schema.sql:415` ff. — preserved source-definition `core_build.race_progression_summary` (merged in slice `03-core-build-schema`; reads from `core_build.laps_enriched` and `core.session_drivers`).
- `sql/006_semantic_lap_layer.sql` — column definitions for `core.laps_enriched` projected through to `race_progression_summary` (`lap_end_ts TIMESTAMPTZ`, `position_end_of_lap INTEGER`, `lap_number INTEGER`).
- `sql/009_driver_session_summary_mat.sql`, `sql/010_laps_enriched_mat.sql`, `sql/011_stint_summary_mat.sql`, and `sql/012_strategy_summary_mat.sql` — prior materialization migrations whose pattern this slice follows verbatim.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.race_progression_summary` and the bidirectional `EXCEPT ALL` parity pattern this slice extends; this is the prerequisite called out in the round-1 audit Medium item).
- `diagnostic/slices/03-driver-session-summary-prototype.md` (the prototype for the real-table + facade + PK + inline-`psql`-gate pattern this slice reuses).
- `diagnostic/slices/03-laps-enriched-materialize.md` (precedent for the dependency-safe `CREATE OR REPLACE VIEW` facade-swap pattern this slice reuses because `core.pit_cycle_summary` depends on `core.race_progression_summary`; also the upstream of `core_build.laps_enriched` that `core_build.race_progression_summary` reads from).
- `diagnostic/slices/03-stint-summary.md` and `diagnostic/slices/03-strategy-summary.md` (most recent precedents for this exact pattern — same `CREATE OR REPLACE VIEW` facade swap, same gate structure; the only differences for this slice are the column list, the grain triple `(session_key, driver_number, lap_number)`, and the dependent name).
- `sql/008_core_build_schema.sql` (where `core_build.race_progression_summary` is defined, lines 414–479 — already merged; this slice **does not** recreate it).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.race_progression_summary` view body lives, lines 333–397, plus `core.pit_cycle_summary` at line 401 ff. which depends on it via the join at line 431).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.race_progression_summary_mat`).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.race_progression_summary` (to read the canonical query during initial population and during the parity check).
  - Sufficient privilege to swap `core.race_progression_summary` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT` and `SELECT` on `core.race_progression_summary_mat` (implicit via ownership of the table the migration creates).
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which required statement-level `CREATE MATERIALIZED VIEW`. **No `REFRESH MATERIALIZED VIEW` is invoked anywhere in this slice.**
- `psql` available on PATH for the gate commands below (same prerequisite as the precedent slices).

## Steps
1. **Pre-flight grain probe (run BEFORE applying the migration).** Execute gate command #0 below to confirm that `core_build.race_progression_summary` is unique on `(session_key, driver_number, lap_number)`. If gate #0 reports `duplicate_rows <> 0`, **stop**: the PK plan is invalid and the slice must be re-planned as a heap-with-indexes (mirroring `03-laps-enriched-materialize`) before any DDL is run. If gate #0 exits `0`, proceed.
2. Add `sql/013_race_progression_summary_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.race_progression_summary_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.race_progression_summary` view** as defined at `sql/007_semantic_summary_contracts.sql:333` ff. The 19 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`, `driver_number`, `driver_name`, `team_name`, `lap_number`, `frame_time`, `position_end_of_lap`, `previous_position`, `positions_gained_this_lap`, `opening_position`, `latest_position`, `best_position`, `worst_position`. Types must match the view's projected types (sourced from `sql/006_semantic_lap_layer.sql` and `sql/010_laps_enriched_mat.sql`):
      - `session_key`, `meeting_key` are `BIGINT` (raw `BIGINT` columns from `raw.sessions` / `raw.meetings`).
      - `year`, `driver_number` are `INTEGER` (raw `INTEGER` columns).
      - `session_name`, `session_type`, `country_name`, `location`, `driver_name`, `team_name` are `TEXT`.
      - `lap_number` is `INTEGER` (`core.laps_enriched.lap_number INTEGER`, see `sql/010_laps_enriched_mat.sql`).
      - `frame_time` is `TIMESTAMPTZ` (projected from `le.lap_end_ts`, declared `TIMESTAMPTZ` at `sql/010_laps_enriched_mat.sql:26`).
      - `position_end_of_lap`, `previous_position`, `positions_gained_this_lap`, `opening_position`, `latest_position`, `best_position`, `worst_position` are `INTEGER` (the underlying `position_end_of_lap` is declared `INTEGER` at `sql/010_laps_enriched_mat.sql:40`; `LAG`, `FIRST_VALUE`, `LAST_VALUE`, `MIN`, `MAX` over an `integer` preserve type; `previous_position - position_end_of_lap` of two `integer` operands also resolves to `integer`).
      Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/007` and `sql/010`) so the `_mat` table is positionally compatible with the source-definition view. **Declare `PRIMARY KEY (session_key, driver_number, lap_number)`** — gated by gate #0's pre-flight grain probe (Steps §1).
   2. `TRUNCATE core.race_progression_summary_mat;` then `INSERT INTO core.race_progression_summary_mat SELECT * FROM core_build.race_progression_summary;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. The bulk `INSERT … SELECT` is a secondary grain backstop: even if some future change to the canonical view body sneaks duplicates past gate #0, a non-unique grain on `(session_key, driver_number, lap_number)` would abort the transaction with a clean PK-violation error and roll back the migration.
   3. `CREATE OR REPLACE VIEW core.race_progression_summary AS SELECT * FROM core.race_progression_summary_mat;` — replace the public view body in place with the facade. **Do not** use `DROP VIEW … CREATE VIEW`: `core.pit_cycle_summary` (`sql/007_semantic_summary_contracts.sql:401` ff., specifically the `LEFT JOIN core.race_progression_summary rp` at `sql/007_semantic_summary_contracts.sql:431`) depends on `core.race_progression_summary` and would block the drop, even in a single transaction. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 2.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection.
3. Apply the SQL to `$DATABASE_URL` (gate command #1).
4. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), (c) the storage relation carries `PRIMARY KEY (session_key, driver_number, lap_number)` in that exact column order, and (d) the public view is actually a thin facade over the matview (its only relation dependency in schemas `core` / `core_build` / `raw`, sourced from `pg_depend` joined through `pg_rewrite`, is `core.race_progression_summary_mat`) — gate command #2. Without check (d), gate #2 would pass if the migration accidentally left the original aggregating view body in place, since that would still be a view (`relkind = 'v'`).
5. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.race_progression_summary` (canonical query) and `core.race_progression_summary_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by `03-core-build-schema`, `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, and `03-strategy-summary`, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.race_progression_summary_mat` differs from the global rowcount of `core_build.race_progression_summary`.
6. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
7. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/013_race_progression_summary_mat.sql` (new — single transaction; `CREATE TABLE … PRIMARY KEY (session_key, driver_number, lap_number)`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.race_progression_summary`, `CREATE OR REPLACE VIEW core.race_progression_summary AS SELECT * FROM core.race_progression_summary_mat` — no `DROP VIEW`, because `core.pit_cycle_summary` depends on `core.race_progression_summary`).
- `diagnostic/slices/03-race-progression-summary.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/raceProgressionSummary.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-race-progression.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-2]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
# 0. Pre-flight grain probe over core_build.race_progression_summary. Must exit 0,
#    AND must report duplicate_rows = 0, BEFORE the migration is applied. This is
#    the explicit grain evidence the round-3 audit asked for: the canonical query
#    is a per-row window-function projection over filtered core_build.laps_enriched
#    (NOT a GROUP BY aggregation), and core_build.laps_enriched is documented as
#    non-unique on (session_key, driver_number, lap_number) per
#    diagnostic/notes/03-laps-enriched-grain.md (7,379 duplicate rows of 167,172).
#    Whether the residual triple is unique after the WHERE clause
#      lap_number IS NOT NULL AND position_end_of_lap IS NOT NULL
#      AND LOWER(COALESCE(session_type, session_name, '')) LIKE '%race%'
#    is what this gate verifies. The DO block RAISES if duplicate_rows <> 0; if it
#    raises, the PK plan is invalid and the slice must be re-planned as
#    heap-with-indexes (mirroring 03-laps-enriched-materialize) before any DDL is
#    applied.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  total_rows bigint;
  distinct_rows bigint;
  duplicate_rows bigint;
BEGIN
  SELECT count(*) INTO total_rows FROM core_build.race_progression_summary;
  SELECT count(*) INTO distinct_rows FROM (
    SELECT DISTINCT session_key, driver_number, lap_number
    FROM core_build.race_progression_summary
  ) d;
  duplicate_rows := total_rows - distinct_rows;
  RAISE NOTICE 'core_build.race_progression_summary grain probe: total=% distinct_triple=% duplicate=%',
    total_rows, distinct_rows, duplicate_rows;
  IF duplicate_rows <> 0 THEN
    RAISE EXCEPTION
      'grain non-unique on (session_key, driver_number, lap_number): total=% distinct=% duplicate=% — PK plan invalid, re-plan as heap-with-indexes before applying migration',
      total_rows, distinct_rows, duplicate_rows;
  END IF;
END $$;
SQL

# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/013_race_progression_summary_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation is
#    a view, (c) the storage relation carries PRIMARY KEY
#    (session_key, driver_number, lap_number) in that exact column order, and
#    (d) the public view is actually a thin facade over core.race_progression_summary_mat
#    (its only relation dependency in core/core_build/raw is the matview).
#    Must exit 0; the DO block raises (and ON_ERROR_STOP=1 forces non-zero exit)
#    unless every assertion holds. Without check (d) this gate would pass even
#    if the migration accidentally left the original aggregating view body in
#    place, since that would still be a view (relkind = 'v').
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  view_kind text;
  pk_cols text[];
  facade_refs text[];
BEGIN
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'race_progression_summary_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.race_progression_summary_mat as base table (relkind r), got %', table_kind;
  END IF;

  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'race_progression_summary';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.race_progression_summary as view (relkind v), got %', view_kind;
  END IF;

  -- Assert PRIMARY KEY (session_key, driver_number, lap_number) exists in
  -- that exact column order. Order is preserved by sorting attribute names by
  -- their position in c.conkey.
  SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'core'
    AND cl.relname = 'race_progression_summary_mat'
    AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM ARRAY['session_key','driver_number','lap_number']::text[] THEN
    RAISE EXCEPTION
      'expected core.race_progression_summary_mat PRIMARY KEY (session_key, driver_number, lap_number), got %',
      pk_cols;
  END IF;

  -- Assert the public view is a thin facade over the matview. Walk pg_depend
  -- through the view's pg_rewrite rule to enumerate every relation it depends
  -- on, restricted to schemas core/core_build/raw (so we ignore pg_catalog and
  -- self-references). The only relation that must appear is
  -- core.race_progression_summary_mat. If the migration accidentally left the
  -- original aggregating view body in place, this set would instead include
  -- core.laps_enriched, core.session_drivers, raw.sessions, raw.meetings, etc.,
  -- and the assertion would fail with the offending list in the error message.
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
    AND v.relname = 'race_progression_summary'
    AND tn.nspname IN ('core', 'core_build', 'raw')
    AND t.oid <> v.oid;
  IF facade_refs IS DISTINCT FROM ARRAY['core.race_progression_summary_mat']::text[] THEN
    RAISE EXCEPTION
      'expected core.race_progression_summary to be a thin facade over core.race_progression_summary_mat, but it references: %',
      facade_refs;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.race_progression_summary and core.race_progression_summary_mat.
#    Must exit 0; the block raises if (a) fewer than 3 analytic_ready sessions
#    are available, (b) any session reports diff_rows > 0, or (c) global
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
  SELECT count(*) INTO build_rows FROM core_build.race_progression_summary;
  SELECT count(*) INTO mat_rows   FROM core.race_progression_summary_mat;
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
      (SELECT * FROM core_build.race_progression_summary  WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.race_progression_summary_mat    WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.race_progression_summary_mat    WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.race_progression_summary  WHERE session_key = sess.session_key)
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
- [ ] Pre-flight grain probe over `core_build.race_progression_summary` reports `duplicate_rows = 0` — gate #0 exits `0` (its DO block does **not** raise the `grain non-unique on (session_key, driver_number, lap_number) … PK plan invalid` exception). This must be true before gate #1 is run.
- [ ] `core.race_progression_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number, lap_number)` — gate #1 (`psql -f sql/013_race_progression_summary_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` AND the table carries a primary-key constraint whose columns are exactly `['session_key','driver_number','lap_number']` in that order, sourced from `pg_constraint` with `contype = 'p'`).
- [ ] `core.race_progression_summary` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] `core.race_progression_summary` is a thin facade over `core.race_progression_summary_mat` — gate #2 exits `0` (the DO block's fourth assertion raises unless `pg_depend`-via-`pg_rewrite` reports `core.race_progression_summary_mat` as the **only** relation the view depends on within schemas `core` / `core_build` / `raw`; this is the check that distinguishes the facade swap from the original aggregating view body, which depended on `core.laps_enriched`, `core.session_drivers`, etc.).
- [ ] Global rowcount of `core.race_progression_summary_mat` equals the global rowcount of `core_build.race_progression_summary` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §5 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/013_race_progression_summary_mat.sql` (new) and `diagnostic/slices/03-race-progression-summary.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-2]_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.race_progression_summary_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.race_progression_summary_mat` beyond the PK (Phase 4, profile-driven).
- Materializing the other hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`web/src/lib/deterministicSql.ts`, `web/src/lib/queries.ts`, `web/src/lib/chatRuntime.ts`) to read the matview through a new typed contract — deferred until a consumer actually needs it. The facade swap means existing callers transparently benefit from the materialized storage with no code change.

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.race_progression_summary`. `core.pit_cycle_summary` depends on it (`sql/007_semantic_summary_contracts.sql:431`). Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents, provided the new query produces the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe. A `DROP VIEW` would have failed at apply time with `cannot drop view core.race_progression_summary because other objects depend on it` and rolled back the whole transaction.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 2.1 are explicit and ordered to match `core.race_progression_summary` as defined in `sql/007_semantic_summary_contracts.sql:333` ff.; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: PK violation on `(session_key, driver_number, lap_number)` if the source view's grain is non-unique on that triple. Primary mitigation: gate #0's pre-flight grain probe runs before any DDL is applied and `RAISE EXCEPTION` if `duplicate_rows <> 0`, so a non-unique triple is caught with explicit numbers (`total / distinct / duplicate`) rather than via the opaque PK-violation rollback. **Documented heap-with-indexes fallback:** if gate #0 ever fires (whether on first apply, or on a future re-apply after the canonical view body changes), the slice must be re-planned to mirror `03-laps-enriched-materialize` exactly — drop `PRIMARY KEY`, declare two non-unique btree indexes `(session_key, driver_number, lap_number)` and `(session_key)`, switch the gate #2 assertions accordingly, and ship as a separate revision. Secondary backstop: even if gate #0 is somehow bypassed, the bulk `INSERT … SELECT` in step 2.2 still aborts the transaction with a clean PK-violation error and no half-built state. The grain claim for the **filtered** subset is plausible per the canonical query's per-lap window-function projection over the WHERE-filtered `core.laps_enriched` rows, but is not assumed — it is gate-enforced.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.race_progression_summary`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.race_progression_summary does not exist` error and the transaction rolls back; the loop's slice ordering already merged `03-core-build-schema` at `67bdeff` before this slice can ship.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, the public dependent `core.pit_cycle_summary` must continue to work throughout. Use the same dependency-safe pattern as the forward migration: `CREATE OR REPLACE VIEW` to swing `core.race_progression_summary`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction:
  ```sql
  BEGIN;
  -- Step 1: Restore core.race_progression_summary to its original aggregating body.
  -- This MUST be CREATE OR REPLACE VIEW, NOT DROP VIEW + CREATE VIEW: dropping
  -- the view would fail with "cannot drop view core.race_progression_summary because
  -- other objects depend on it" because core.pit_cycle_summary references it.
  -- The cleanest way is to re-apply sql/007_semantic_summary_contracts.sql,
  -- which uses CREATE OR REPLACE VIEW for core.race_progression_summary and is idempotent:
  --   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/007_semantic_summary_contracts.sql
  -- (Re-applying sql/007 also re-runs CREATE OR REPLACE VIEW on every other
  -- view in that file, which is safe because each is also idempotent.)
  -- Alternatively, paste the CREATE OR REPLACE VIEW core.race_progression_summary AS
  -- SELECT … block from sql/007_semantic_summary_contracts.sql:333 ff. verbatim.
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.race_progression_summary_mat and DROP TABLE would fail with "cannot drop
  -- table core.race_progression_summary_mat because other objects depend on it".
  -- After Step 1 nothing depends on the table.
  DROP TABLE IF EXISTS core.race_progression_summary_mat;
  COMMIT;
  ```

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the slice body with the actual Phase 3 materialization pattern for `race_progression_summary`: use the existing `core_build.race_progression_summary` source-definition view, create a real `core.race_progression_summary_mat` table, refresh it from `core_build`, and swap `core.race_progression_summary` to a thin facade; do not introduce a PostgreSQL materialized view or require `REFRESH MATERIALIZED VIEW`.
- [x] Add executable DB gate commands that apply the SQL and verify `core.race_progression_summary_mat` exists, the facade points at it, the refresh/population step succeeds, and bidirectional session-scoped `EXCEPT ALL` parity returns zero for at least three deterministic analytic-ready sessions.
- [x] Fix the step/file-scope mismatch: either include all implementation files required for the materialization pattern, including SQL and any refresh/parity support files, or remove the TypeScript contract and web parity-test steps from this slice if they are not part of the intended implementation.

### Medium
- [x] Specify the deterministic session selector for parity checks, preferably the same `core.session_completeness` `analytic_ready` query used by prior Phase 3 slices.
- [x] Include the prerequisite from prior context that `sql/008_core_build_schema.sql` has already created `core_build.race_progression_summary`, so the implementer does not try to recreate the preserved source-definition view in this slice.

### Low
- [x] Replace the vague SQL filename `sql/race_progression_summary.sql` with the repository's Phase 3 migration naming convention or explicitly justify the new path.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so it is current for this audit.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Add a gate assertion that `core.race_progression_summary` is actually a thin facade over `core.race_progression_summary_mat` (for example via `pg_depend` or `pg_get_viewdef`), because the current gate only proves the public relation is some view and would pass if the migration left the original aggregating view in place.

### Medium

### Low

### Notes (informational only — no action)
- Round 1's materialization-pattern, file-scope, deterministic-selector, prerequisite, and filename items are addressed in the revised plan body.
- `diagnostic/_state.md` was last updated on 2026-04-27, so it is current for this audit.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Add explicit grain evidence for `core_build.race_progression_summary` before declaring `PRIMARY KEY (session_key, driver_number, lap_number)`, or change the storage shape to a non-unique heap/index plan if the triple is not globally unique; the current rationale derives uniqueness from `core_build.laps_enriched`, whose `(session_key, driver_number, lap_number)` triple is already documented as non-unique.

### Medium

### Low

### Notes (informational only — no action)
- Round 2's facade-dependency gate item is addressed by gate #2's `pg_depend` / `pg_rewrite` assertion.
- All listed Prior context paths exist and were consulted.
- `diagnostic/_state.md` was last updated on 2026-04-27, so it is current for this audit.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- Round 3's grain-evidence item is addressed by gate #0's pre-flight uniqueness probe over `core_build.race_progression_summary`, with an explicit heap-with-indexes fallback if duplicates are found.
- All listed Prior context paths exist and were consulted.
- `diagnostic/_state.md` was last updated on 2026-04-27, so it is current for this audit.
