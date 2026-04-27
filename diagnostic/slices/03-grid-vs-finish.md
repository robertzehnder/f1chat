---
slice_id: 03-grid-vs-finish
phase: 3
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T18:35:00-04:00
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, `03-strategy-summary`, and `03-race-progression-summary`) to `grid_vs_finish`: read from the preserved source-definition view `core_build.grid_vs_finish` (already shipped by `03-core-build-schema` in `sql/008_core_build_schema.sql:179` ff.), materialize into a real storage table `core.grid_vs_finish_mat` keyed on `(session_key, driver_number)`, and replace the public `core.grid_vs_finish` view with a thin facade `SELECT * FROM core.grid_vs_finish_mat`. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against `core_build.grid_vs_finish` for the deterministic three `analytic_ready` sessions plus a global rowcount equality check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as `03-driver-session-summary-prototype` Decisions §1, `03-laps-enriched-materialize` Decisions §1, `03-stint-summary` Decisions §1, `03-strategy-summary` Decisions §1, and `03-race-progression-summary` Decisions §1: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.grid_vs_finish_mat`; the public `core.grid_vs_finish` is replaced via `CREATE OR REPLACE VIEW core.grid_vs_finish AS SELECT * FROM core.grid_vs_finish_mat`. The round-0 plan body's `CREATE MATERIALIZED VIEW` framing is the conceptual pattern, not the SQL object kind. The round-0 deliverables that required `MATERIALIZED VIEW` and `REFRESH MATERIALIZED VIEW` privileges are explicitly removed.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** No live SQL dependent currently reads `core.grid_vs_finish`: the only on-disk reference at `sql/007_semantic_summary_contracts.sql:328` is inside the original aggregating body of `core.driver_session_summary`, which has since been replaced with the thin facade `SELECT * FROM core.driver_session_summary_mat` by `03-driver-session-summary-prototype` (merged at `5ec9cea`). The other matches at `sql/007_semantic_summary_contracts.sql:903` and `:907` are textual entries in the `semantic_term_glossary` insert (catalog data, not view bodies). So a `DROP VIEW … CREATE VIEW` would technically succeed, but `CREATE OR REPLACE VIEW` is preferred for three reasons: (a) consistency with every other Phase 3 materialization slice merged so far, (b) it remains correct even if a future migration introduces a new dependent on `core.grid_vs_finish` between this slice's plan and its apply, and (c) it requires no `DROP` privilege beyond the `CREATE OR REPLACE` privilege the migration role already holds. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table's column list to exactly mirror the original view's projection list, so `SELECT * FROM core.grid_vs_finish_mat` is column-compatible and the swap succeeds.
- **Grain: unique `(session_key, driver_number)` → real `PRIMARY KEY`, gated by an explicit pre-flight grain probe over the source view.** The canonical query at `sql/007_semantic_summary_contracts.sql:4` ff. (mirrored at `sql/008_core_build_schema.sql:180` ff.) builds `driver_keys` as a `UNION` (deduplicating, not `UNION ALL`) of `(session_key, driver_number)` from `core.session_drivers`, `raw.starting_grid`, `raw.session_result`, and `raw.position_history`, so `driver_keys` is unique on the pair by SQL semantics. The final SELECT then `JOIN core.sessions s` (`session_key` is the PK of `raw.sessions` per `sql/002_create_tables.sql:22`, so 1:1 on `session_key`), `LEFT JOIN core.session_drivers sd ON (session_key, driver_number)`, and `LEFT JOIN` to `grid_official` / `grid_fallback` / `finish_official` / `finish_fallback`, each of which is unique on `(session_key, driver_number)` by construction (`GROUP BY session_key, driver_number` for the official CTEs, `DISTINCT ON (session_key, driver_number)` for the fallbacks). The only LEFT JOIN whose grain is not provable from the SQL alone is `core.session_drivers`, which is `SELECT d.session_key, d.meeting_key, d.driver_number, … FROM raw.drivers d` (no DISTINCT, no GROUP BY, see `sql/004_constraints.sql:65`); if `raw.drivers` carries duplicate rows on `(session_key, driver_number)`, the LEFT JOIN multiplies the output. A pre-flight grain probe is therefore required to convert this from "plausible" to "gate-enforced", per the round-1 audit's Low item and the lesson learned from `03-race-progression-summary` round 3 (where a grain claim derived from upstream uniqueness was disproved by 174 surviving duplicates). **Gate command #0** runs before any DDL and `RAISE EXCEPTION` if `core_build.grid_vs_finish` carries any row that violates uniqueness on `(session_key, driver_number)`. If gate #0 fires, the slice is re-planned to mirror `03-laps-enriched-materialize`'s and `03-race-progression-summary`'s heap-with-indexes shape (no PK, two non-unique btree indexes), per the documented fallback in Risk / rollback. If gate #0 passes, the storage relation is `CREATE TABLE core.grid_vs_finish_mat (… PRIMARY KEY (session_key, driver_number))` and the bulk `INSERT … SELECT` in Steps §1.2 is the secondary backstop assertion.
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as `03-driver-session-summary-prototype` Decisions §2, `03-laps-enriched-materialize` Decisions §5, `03-stint-summary` Decisions §4, `03-strategy-summary` Decisions §4, and `03-race-progression-summary` Decisions §4: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. A TypeScript contract type for the matview columns would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice — `web/src/lib/queries.ts`, `web/src/lib/deterministicSql.ts`, and `web/src/lib/chatRuntime.ts` all read `core.grid_vs_finish` through the public view, which transparently swings to the matview after the facade swap), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it. The round-0 deliverables `web/src/lib/contracts/gridVsFinish.ts` and `web/scripts/tests/parity-grid-vs-finish.test.mjs` are therefore explicitly removed.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.grid_vs_finish_mat SELECT * FROM core_build.grid_vs_finish` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. Per-session incremental refresh and the ingest hook are deferred to a later Phase 3 slice.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql`; the next free integer after `sql/013_race_progression_summary_mat.sql` is `014`, so this slice ships `sql/014_grid_vs_finish_mat.sql`. The round-0 deliverable `sql/grid_vs_finish.sql` is therefore replaced.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as `03-core-build-schema`, `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, `03-strategy-summary`, and `03-race-progression-summary`: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`). Although the grain is unique on `(session_key, driver_number)` (so duplicate rows are not expected), `EXCEPT ALL` is still mandated by roadmap §4 Phase 3 step 5 for consistency across all materialization slices. The global rowcount equality check is what proves materialization completeness across all rows.
- **Prerequisite assumed: `sql/008_core_build_schema.sql` is already applied** so `core_build.grid_vs_finish` exists. This was shipped in slice `03-core-build-schema` (merged at `67bdeff`) and is a hard prerequisite — gate command #0 will fail non-zero with `relation core_build.grid_vs_finish does not exist` if applied to a database where `008` has not been run. This slice **does not** recreate or modify the `core_build.grid_vs_finish` source-definition view.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, parity SQL.
- `sql/007_semantic_summary_contracts.sql:4` ff. — current public `core.grid_vs_finish` view (column ordering / types / semantics that the `_mat` table must mirror).
- `sql/008_core_build_schema.sql:179` ff. — preserved source-definition `core_build.grid_vs_finish` (merged in slice `03-core-build-schema`; reads from `core.session_drivers`, `raw.starting_grid`, `raw.session_result`, `raw.position_history`, `core.sessions`).
- `sql/002_create_tables.sql` — raw table column types projected through to `grid_vs_finish` (`raw.sessions.session_key BIGINT`, `raw.sessions.meeting_key BIGINT`, `raw.sessions.year INTEGER`, `raw.starting_grid.grid_position INTEGER`, `raw.session_result.position INTEGER`, `raw.position_history.position INTEGER`, `raw.starting_grid.driver_number INTEGER`, etc.).
- `sql/004_constraints.sql:65` ff. — `core.session_drivers` view body (the LEFT JOIN whose grain is not provable from the SQL alone, motivating gate #0).
- `sql/009_driver_session_summary_mat.sql`, `sql/010_laps_enriched_mat.sql`, `sql/011_stint_summary_mat.sql`, `sql/012_strategy_summary_mat.sql`, and `sql/013_race_progression_summary_mat.sql` — prior materialization migrations whose pattern this slice follows verbatim.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.grid_vs_finish` and the bidirectional `EXCEPT ALL` parity pattern this slice extends; this is the prerequisite called out in the round-1 audit Medium item).
- `diagnostic/slices/03-driver-session-summary-prototype.md` (the prototype for the real-table + facade + PK + inline-`psql`-gate pattern this slice reuses; also the slice that turned `core.driver_session_summary` into a facade and removed the only live dependent on `core.grid_vs_finish`).
- `diagnostic/slices/03-laps-enriched-materialize.md` (precedent for the dependency-safe `CREATE OR REPLACE VIEW` facade-swap pattern and the heap-with-indexes fallback shape used by Risk / rollback).
- `diagnostic/slices/03-stint-summary.md` (prior `(session_key, driver_number, stint_number)` precedent for the `_mat` + facade pattern).
- `diagnostic/slices/03-strategy-summary.md` (most direct grain precedent — same `(session_key, driver_number)` PK on a non-aggregating per-driver-per-session shape; this slice reuses its gate structure verbatim with the column list and dependent name swapped).
- `diagnostic/slices/03-race-progression-summary.md` (precedent for the pre-flight grain probe (gate #0) pattern adopted here, after that slice was forced to pivot from PK to heap-with-indexes when 174 duplicate rows were discovered post-plan-approval).
- `sql/008_core_build_schema.sql` (where `core_build.grid_vs_finish` is defined, lines 179–271 — already merged; this slice **does not** recreate it).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.grid_vs_finish` view body lives, lines 4–95).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.grid_vs_finish_mat`).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.grid_vs_finish` (to read the canonical query during the pre-flight grain probe, initial population, and parity check).
  - Sufficient privilege to swap `core.grid_vs_finish` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT` and `SELECT` on `core.grid_vs_finish_mat` (implicit via ownership of the table the migration creates).
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which required statement-level `CREATE MATERIALIZED VIEW`. **No `REFRESH MATERIALIZED VIEW` is invoked anywhere in this slice.**
- `psql` available on PATH for the gate commands below (same prerequisite as the precedent slices).

## Steps
1. **Pre-flight grain probe (run BEFORE applying the migration; gate command #0 below).** Probe `core_build.grid_vs_finish` for `total_rows`, `distinct_pair`, and `duplicate_rows = total_rows - distinct_pair` on `(session_key, driver_number)`. The DO block `RAISE EXCEPTION` if `duplicate_rows <> 0`, so a non-unique grain is caught before any DDL is applied. If gate #0 fires on a future apply (e.g. because `raw.drivers` ingested duplicate rows for a `(session_key, driver_number)` pair), the slice must be re-planned to the documented heap-with-indexes fallback (see Risk / rollback).
2. Add `sql/014_grid_vs_finish_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.grid_vs_finish_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.grid_vs_finish` view** as defined at `sql/007_semantic_summary_contracts.sql:4` ff. The 15 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`, `driver_number`, `driver_name`, `team_name`, `grid_position`, `finish_position`, `positions_gained`, `grid_source`, `finish_source`. Types must match the view's projected types (sourced from `sql/002_create_tables.sql`):
      - `session_key`, `meeting_key` are `BIGINT` (from `raw.sessions.session_key BIGINT` / `raw.sessions.meeting_key BIGINT`).
      - `year`, `driver_number` are `INTEGER` (from `raw.sessions.year INTEGER` / `raw.starting_grid.driver_number INTEGER`).
      - `session_name`, `session_type`, `country_name`, `location`, `driver_name`, `team_name`, `grid_source`, `finish_source` are `TEXT`.
      - `grid_position` is `INTEGER` (`COALESCE(MIN(raw.starting_grid.grid_position INTEGER), DISTINCT-ON raw.position_history.position INTEGER)` — `MIN` over `integer` and `COALESCE` of two `integer` operands both preserve `integer`).
      - `finish_position` is `INTEGER` (`COALESCE(MIN(raw.session_result.position INTEGER), DISTINCT-ON raw.position_history.position INTEGER)`, same reasoning).
      - `positions_gained` is `INTEGER` (the `CASE` arm computes `COALESCE(...) - COALESCE(...)` of two `integer` operands, which resolves to `integer`).
      Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/007` and `sql/002`) so the `_mat` table is positionally compatible with the source-definition view. **Declare `PRIMARY KEY (session_key, driver_number)`** — the verified unique grain (gate #0 will have already proven this before this DDL is applied).
   2. `TRUNCATE core.grid_vs_finish_mat;` then `INSERT INTO core.grid_vs_finish_mat SELECT * FROM core_build.grid_vs_finish;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. The bulk `INSERT … SELECT` doubles as a backstop grain assertion: even if gate #0 were somehow bypassed, a non-unique grain on `(session_key, driver_number)` would abort the transaction with a clean PK-violation error and roll back the migration.
   3. `CREATE OR REPLACE VIEW core.grid_vs_finish AS SELECT * FROM core.grid_vs_finish_mat;` — replace the public view body in place with the facade. **Do not** use `DROP VIEW … CREATE VIEW`: although there are no current live dependents (`core.driver_session_summary` is now a facade over `core.driver_session_summary_mat` per `03-driver-session-summary-prototype`), `CREATE OR REPLACE VIEW` is preferred for the consistency / robustness reasons explained in Decisions §2. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 2.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection — Postgres allows `CREATE OR REPLACE VIEW` only when the new query produces an output column list that begins with the existing view's columns (matching by name, type, and ordinal), which this slice satisfies by construction.
3. Apply the SQL to `$DATABASE_URL` (gate command #1).
4. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), (c) the storage relation carries `PRIMARY KEY (session_key, driver_number)` in that exact column order, and (d) the public view is actually a thin facade over the matview (its only relation dependency in schemas `core` / `core_build` / `raw`, sourced from `pg_depend` joined through `pg_rewrite`, is `core.grid_vs_finish_mat`) — gate command #2. Without check (d), gate #2 would pass even if the migration accidentally left the original aggregating view body in place, since that would still be a view (`relkind = 'v'`).
5. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.grid_vs_finish` (canonical query) and `core.grid_vs_finish_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by `03-core-build-schema`, `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, `03-strategy-summary`, and `03-race-progression-summary`, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.grid_vs_finish_mat` differs from the global rowcount of `core_build.grid_vs_finish`.
6. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
7. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/014_grid_vs_finish_mat.sql` (new — single transaction; `CREATE TABLE … PRIMARY KEY (session_key, driver_number)`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.grid_vs_finish`, `CREATE OR REPLACE VIEW core.grid_vs_finish AS SELECT * FROM core.grid_vs_finish_mat`).
- `diagnostic/slices/03-grid-vs-finish.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/gridVsFinish.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-grid-vs-finish.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-3]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
# 0. Pre-flight grain probe over core_build.grid_vs_finish on (session_key, driver_number).
#    Must exit 0; the DO block RAISE EXCEPTIONs if duplicate_rows > 0 (which would
#    mean the LEFT JOIN to core.session_drivers — the only join whose grain is not
#    provable from the SQL alone — is multiplying rows). Gate #0 also fails clean
#    with "relation core_build.grid_vs_finish does not exist" if sql/008 has not
#    been applied (precondition). If gate #0 fires, switch the slice to the
#    documented heap-with-indexes fallback (see Risk / rollback).
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  total_rows bigint;
  distinct_rows bigint;
  duplicate_rows bigint;
BEGIN
  SELECT count(*) INTO total_rows FROM core_build.grid_vs_finish;
  SELECT count(*) INTO distinct_rows FROM (
    SELECT DISTINCT session_key, driver_number
    FROM core_build.grid_vs_finish
  ) d;
  duplicate_rows := total_rows - distinct_rows;
  RAISE NOTICE 'core_build.grid_vs_finish grain probe: total=% distinct_pair=% duplicate=%',
    total_rows, distinct_rows, duplicate_rows;
  IF duplicate_rows <> 0 THEN
    RAISE EXCEPTION
      'core_build.grid_vs_finish grain non-unique on (session_key, driver_number): total=%, distinct_pair=%, duplicate=%',
      total_rows, distinct_rows, duplicate_rows;
  END IF;
END $$;
SQL

# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/014_grid_vs_finish_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation is
#    a view, (c) the storage relation carries PRIMARY KEY (session_key, driver_number)
#    in that exact column order, and (d) the public view is actually a thin facade
#    over core.grid_vs_finish_mat (its only relation dependency in core/core_build/raw
#    is the matview). Must exit 0; the DO block raises (and ON_ERROR_STOP=1 forces
#    non-zero exit) unless every assertion holds. Without check (d) this gate would
#    pass even if the migration accidentally left the original aggregating view body
#    in place, since that would still be a view (relkind = 'v').
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
  WHERE n.nspname = 'core' AND c.relname = 'grid_vs_finish_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.grid_vs_finish_mat as base table (relkind r), got %', table_kind;
  END IF;

  -- (b) public relation is a view.
  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'grid_vs_finish';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.grid_vs_finish as view (relkind v), got %', view_kind;
  END IF;

  -- (c) PRIMARY KEY (session_key, driver_number) exists in that exact column order.
  -- Order is preserved by sorting attribute names by their position in c.conkey.
  SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'core'
    AND cl.relname = 'grid_vs_finish_mat'
    AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM ARRAY['session_key','driver_number']::text[] THEN
    RAISE EXCEPTION
      'expected core.grid_vs_finish_mat PRIMARY KEY (session_key, driver_number), got %',
      pk_cols;
  END IF;

  -- (d) Assert the public view is a thin facade over the matview. Walk pg_depend
  -- through the view's pg_rewrite rule to enumerate every relation it depends
  -- on, restricted to schemas core/core_build/raw (so we ignore pg_catalog and
  -- self-references). The only relation that must appear is
  -- core.grid_vs_finish_mat. If the migration accidentally left the original
  -- aggregating view body in place, this set would instead include
  -- core.session_drivers, core.sessions, raw.starting_grid, raw.session_result,
  -- raw.position_history, etc., and the assertion would fail with the offending
  -- list in the error message.
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
    AND v.relname = 'grid_vs_finish'
    AND tn.nspname IN ('core', 'core_build', 'raw')
    AND t.oid <> v.oid;
  IF facade_refs IS DISTINCT FROM ARRAY['core.grid_vs_finish_mat']::text[] THEN
    RAISE EXCEPTION
      'expected core.grid_vs_finish to be a thin facade over core.grid_vs_finish_mat, but it references: %',
      facade_refs;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.grid_vs_finish and core.grid_vs_finish_mat. Must exit 0;
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
  SELECT count(*) INTO build_rows FROM core_build.grid_vs_finish;
  SELECT count(*) INTO mat_rows   FROM core.grid_vs_finish_mat;
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
      (SELECT * FROM core_build.grid_vs_finish  WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.grid_vs_finish_mat    WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.grid_vs_finish_mat    WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.grid_vs_finish  WHERE session_key = sess.session_key)
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
- [ ] Pre-flight grain probe over `core_build.grid_vs_finish` on `(session_key, driver_number)` exits `0` (gate #0; the DO block's `RAISE EXCEPTION` branch does not fire because `duplicate_rows = 0`). If gate #0 fails, the slice is re-planned to the heap-with-indexes fallback per Risk / rollback before any DDL is applied.
- [ ] `core.grid_vs_finish_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number)` — gate #1 (`psql -f sql/014_grid_vs_finish_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` AND the table carries a primary-key constraint whose columns are exactly `['session_key','driver_number']` in that order, sourced from `pg_constraint` with `contype = 'p'`).
- [ ] `core.grid_vs_finish` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] `core.grid_vs_finish` is a thin facade over `core.grid_vs_finish_mat` — gate #2 exits `0` (the DO block's final assertion raises unless `pg_depend`-via-`pg_rewrite` reports `core.grid_vs_finish_mat` as the **only** relation the view depends on within schemas `core` / `core_build` / `raw`; this is the check that distinguishes the facade swap from the original aggregating view body, which depended on `core.sessions`, `core.session_drivers`, `raw.starting_grid`, `raw.session_result`, and `raw.position_history`).
- [ ] Global rowcount of `core.grid_vs_finish_mat` equals the global rowcount of `core_build.grid_vs_finish` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §5 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/014_grid_vs_finish_mat.sql` (new) and `diagnostic/slices/03-grid-vs-finish.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-3]_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.grid_vs_finish_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.grid_vs_finish_mat` beyond the PK (Phase 4, profile-driven).
- Materializing the other hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`web/src/lib/queries.ts`, `web/src/lib/deterministicSql.ts`, `web/src/lib/chatRuntime.ts`) to read the matview through a new typed contract — deferred until a consumer actually needs it. The facade swap means existing callers transparently benefit from the materialized storage with no code change.

## Risk / rollback
- Risk: gate #0 fires because `core.session_drivers` (the only LEFT JOIN whose grain is not provable from the SQL alone) multiplies rows in the source view. Mitigation: gate #0 runs **before** any DDL is applied and `RAISE EXCEPTION` with explicit `total / distinct_pair / duplicate` numbers, so the failure is diagnostic and no schema change has been made. **Documented heap-with-indexes fallback:** if gate #0 ever fires (whether on first apply or on a future re-apply after `raw.drivers` ingests duplicate rows), the slice must be re-planned to mirror `03-laps-enriched-materialize` and `03-race-progression-summary` exactly — drop `PRIMARY KEY` from step 2.1, add two `CREATE INDEX IF NOT EXISTS` non-unique btree indexes `(session_key, driver_number)` and `(session_key)`, switch the gate #2 assertions accordingly (no PK; both indexes present, non-unique, btree), and ship as a separate revision.
- Risk: the facade swap fails at apply time because the `_mat` table's column signature does not match the original public view. Mitigation: the swap uses `CREATE OR REPLACE VIEW`, which Postgres rejects with `cannot change name/type of view column …` if the new query produces a different column list (different names, types, or ordering) from the existing view. Step 2.1 declares the table to mirror that signature exactly, so the rewrite is dependency-safe. If the column declarations diverge from the view, gate #1 fails non-zero and the transaction rolls back; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: PK violation on `(session_key, driver_number)` if gate #0 is somehow bypassed and the source view's grain is non-unique. Secondary backstop: the bulk `INSERT … SELECT` in step 2.2 still aborts the transaction with a clean PK-violation error and no half-built state.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.grid_vs_finish`). Mitigation: gate #0 fails non-zero with a clean `relation core_build.grid_vs_finish does not exist` error before any DDL runs; the loop's slice ordering already merged `03-core-build-schema` at `67bdeff` before this slice can ship.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, use the same dependency-safe pattern as the forward migration: `CREATE OR REPLACE VIEW` to swing `core.grid_vs_finish`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction:
  ```sql
  BEGIN;
  -- Step 1: Restore core.grid_vs_finish to its original aggregating body.
  -- This MUST be CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW): even
  -- though there are currently no live SQL dependents of core.grid_vs_finish
  -- (core.driver_session_summary became a facade in 03-driver-session-summary-prototype),
  -- a future migration may introduce one between this slice's apply and its
  -- rollback. CREATE OR REPLACE VIEW is dependency-safe.
  -- The cleanest way is to re-apply sql/007_semantic_summary_contracts.sql,
  -- which uses CREATE OR REPLACE VIEW for core.grid_vs_finish and is idempotent:
  --   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/007_semantic_summary_contracts.sql
  -- (Re-applying sql/007 also re-runs CREATE OR REPLACE VIEW on every other
  -- view in that file, which is safe because each is also idempotent.)
  -- Alternatively, paste the CREATE OR REPLACE VIEW core.grid_vs_finish AS
  -- SELECT … block from sql/007_semantic_summary_contracts.sql:4 ff. verbatim.
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.grid_vs_finish_mat and DROP TABLE would fail with "cannot drop table
  -- core.grid_vs_finish_mat because other objects depend on it". After Step 1
  -- nothing depends on the table.
  DROP TABLE IF EXISTS core.grid_vs_finish_mat;
  COMMIT;
  ```

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the `CREATE MATERIALIZED VIEW` / `core_build` framing with the established Phase 3 object model: read from `core_build.grid_vs_finish`, create and populate a real storage table such as `core.grid_vs_finish_mat`, and replace public `core.grid_vs_finish` with a thin facade view.
- [x] Add executable database gate commands that apply the SQL and verify the storage object, facade view, global rowcount parity, and bidirectional session-scoped `EXCEPT ALL` parity against `core_build.grid_vs_finish` for three deterministic `analytic_ready` sessions; the current gates only run web commands and cannot prove the database objects exist or match the canonical query.
- [x] Rewrite the web gate commands so they can be executed in the listed order from one shell without failing on `cd web` after the first command, for example by using `npm --prefix web ...` for build, typecheck, and grading tests.

### Medium
- [x] Remove or justify the TypeScript contract and `.mjs` parity-test deliverables, because the merged Phase 3 materialization slices use a numbered SQL migration plus inline `psql` parity gates rather than `web/src/lib/contracts/*` files or standalone parity tests.
- [x] Expand `Prior context` to include the merged Phase 3 materialization precedents and source definitions this slice depends on, especially `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3, `diagnostic/slices/03-driver-session-summary-prototype.md`, `diagnostic/slices/03-laps-enriched-materialize.md`, `diagnostic/slices/03-stint-summary.md`, `diagnostic/slices/03-strategy-summary.md`, `diagnostic/slices/03-race-progression-summary.md`, `sql/008_core_build_schema.sql`, and `sql/007_semantic_summary_contracts.sql`.
- [x] Specify the expected SQL filename and file scope using the repo's numbered migration convention, likely `sql/014_grid_vs_finish_mat.sql`, and include the slice file itself as an allowed frontmatter/completion-note change.
- [x] Expand acceptance criteria so each criterion maps to a specific gate command and exit condition, rather than only saying the parity test passes.
- [x] Correct the required services / env block to state the privileges needed for the real-table + facade pattern (`CREATE` on `core`, `USAGE`/`SELECT` on `core_build`, ownership or sufficient privilege to `CREATE OR REPLACE VIEW core.grid_vs_finish`, and `psql` on PATH), and remove the `CREATE MATERIALIZED VIEW` privilege requirement unless the revised plan explicitly justifies a different architecture.

### Low
- [x] Document the expected grain and storage constraint for `grid_vs_finish`, such as `PRIMARY KEY (session_key, driver_number)` if the source query guarantees uniqueness, or add a pre-flight grain probe if the plan cannot justify that constraint from the SQL.
- [x] Replace the generic rollback note with a DB rollback outline that restores the original `core.grid_vs_finish` view body dependency-safely before dropping the storage table.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T21:56:32Z`).
