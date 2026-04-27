---
slice_id: 03-laps-enriched-materialize
phase: 3
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T15:57:02Z
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`) to `laps_enriched`: read from the preserved `core_build.laps_enriched` view, materialize into a real storage table `core.laps_enriched_mat`, and replace the public `core.laps_enriched` view with a thin facade `SELECT * FROM core.laps_enriched_mat`. Storage is a heap with non-unique indexes (no primary key), per the grain-discovery decision recorded in `diagnostic/notes/03-laps-enriched-grain.md`.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as `03-driver-session-summary-prototype` Decisions §1: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage is `CREATE TABLE core.laps_enriched_mat`; the public `core.laps_enriched` is replaced via `CREATE OR REPLACE VIEW core.laps_enriched AS SELECT * FROM core.laps_enriched_mat`. The "matview" framing in the slice goal is the conceptual pattern, not the SQL object kind.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`, because public dependents already exist.** Unlike the leaf-node `core.driver_session_summary` (which the prototype could safely drop+recreate), `core.laps_enriched` is referenced by ten public views in `sql/007_semantic_summary_contracts.sql` (`core.grid_vs_finish`, `core.stint_summary`, `core.strategy_summary`, `core.driver_session_summary`, `core.race_progression_summary`, `core.pit_cycle_summary`, `core.strategy_evidence_summary`, `core.lap_phase_summary`, `core.lap_context_summary`, `core.telemetry_lap_bridge`). A `DROP VIEW core.laps_enriched` would fail with `cannot drop view core.laps_enriched because other objects depend on it`, even inside a transaction. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view (new columns may only be appended at the end). Step 1.1 declares the storage table's column list to exactly mirror the original view's projection list, so `SELECT * FROM core.laps_enriched_mat` is column-compatible and `CREATE OR REPLACE VIEW` succeeds without disturbing any dependent.
- **No primary key. Non-unique heap with indexes.** Per `diagnostic/notes/03-laps-enriched-grain.md` (the deliverable of the merged grain-discovery slice): no candidate column tuple over `core_build.laps_enriched` is fully unique (`total_rows = 167172` vs. best-candidate `distinct_5tuple = 167170`), so the table is declared with **no `PRIMARY KEY`**. The required non-unique btree indexes are `(session_key, driver_number, lap_number)` (the natural query key, also the closest-to-canonical grain) and `(session_key)` (supports the recommended delete-then-insert refresh granularity). No additional indexes are added in this slice — secondary indexes such as `(session_key, stint_number)` are deferred to a profile-driven Phase 4 slice per the grain note.
- **Refresh semantics: delete-then-insert per `session_key`.** Per roadmap §4 Phase 3 ("non-unique heap with indexes + delete-then-insert refresh per `session_key`"). This slice ships the migration that creates the table, populates it with `TRUNCATE` + `INSERT … SELECT *` for initial idempotent migration, and swaps the facade. The actual incremental `DELETE FROM core.laps_enriched_mat WHERE session_key = $1; INSERT INTO core.laps_enriched_mat SELECT * FROM core_build.laps_enriched WHERE session_key = $1;` refresh helper and any ingest-hook integration are deferred to a later Phase 3 slice (out of scope here).
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as `03-driver-session-summary-prototype` Decisions §2: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. A TypeScript contract type for the matview columns would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.laps_enriched_mat SELECT * FROM core_build.laps_enriched` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql`; the next free integer after `sql/009_driver_session_summary_mat.sql` is `010`, so this slice ships `sql/010_laps_enriched_mat.sql`.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as `03-driver-session-summary-prototype` and `03-core-build-schema`: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`) so duplicate-row drift is preserved — critical here precisely because the grain is non-unique (the grain note records 7,379 duplicate rows globally over the natural triple).

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, "non-unique heap with indexes + delete-then-insert refresh" recommendation.
- `sql/006_semantic_lap_layer.sql:272` ff. — current public `core.laps_enriched` view (column ordering / types / semantics that the `_mat` table must mirror).
- `sql/008_core_build_schema.sql:6` ff. — preserved source-definition `core_build.laps_enriched` (merged in slice `03-core-build-schema`).
- `sql/009_driver_session_summary_mat.sql` — the prototype migration whose pattern this slice scales out to `laps_enriched`.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md`
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.laps_enriched` and the bidirectional `EXCEPT ALL` parity pattern this slice extends).
- `diagnostic/slices/03-driver-session-summary-prototype.md` (the prototype scale-out target this slice follows step-for-step, modulo the no-PK / heap-with-indexes decision).
- `diagnostic/slices/03-laps-enriched-grain-discovery.md` (the grain-discovery decision-record slice).
- `diagnostic/notes/03-laps-enriched-grain.md` (the verified grain decision: non-unique, recommended index list, refresh strategy).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.laps_enriched_mat` and the non-unique indexes on it).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.laps_enriched` (to read the canonical query during initial population and during the parity check).
  - Sufficient privilege to `DROP` and `CREATE` `core.laps_enriched` (the public-view facade swap). In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/006_semantic_lap_layer.sql:272`.
  - `INSERT`, `DELETE`, and `SELECT` on `core.laps_enriched_mat` (implicit via ownership of the table the migration creates). `DELETE` is listed for completeness because the deferred refresh helper will use delete-then-insert; the migration in this slice itself only `TRUNCATE`s and `INSERT`s.
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which required statement-level `CREATE MATERIALIZED VIEW`.
- `psql` available on PATH for the gate commands below (same prerequisite as `03-driver-session-summary-prototype` and `03-core-build-schema`).

## Steps
1. Add `sql/010_laps_enriched_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.laps_enriched_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.laps_enriched` view** as defined at `sql/006_semantic_lap_layer.sql:358` ff. (the projection list of the final `SELECT` against the `candidate`/`session_stats`/`lap_number_stats`/`session_extent` CTEs). Types must match the view's projected types: `session_key`/`meeting_key` are `BIGINT` (raw `BIGINT` columns from `raw.sessions` / `raw.meetings`); `year`/`driver_number`/`lap_number`/`stint_number`/`tyre_age_at_start`/`tyre_age_on_lap`/`position_end_of_lap`/`validity_rule_version` are `INTEGER`; `session_name`/`session_type`/`country_name`/`location`/`circuit_short_name`/`driver_name`/`team_name`/`compound_raw`/`compound_name`/`track_flag`/`validity_policy_key`/`invalid_reason` are `TEXT`; `is_slick`/`is_pit_out_lap`/`is_pit_lap`/`is_personal_best_proxy`/`is_valid` are `BOOLEAN`; `lap_start_ts`/`lap_end_ts` are `TIMESTAMPTZ`; `lap_duration`/`duration_sector_1`/`duration_sector_2`/`duration_sector_3`/`pit_duration`/`rep_lap_session`/`fastest_valid_lap`/`lap_rep_time`/`delta_to_rep`/`pct_from_rep`/`delta_to_fastest`/`pct_from_fastest`/`delta_to_lap_rep`/`pct_from_lap_rep`/`fuel_adj_lap_time` are `DOUBLE PRECISION`. Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/006`) so the `_mat` table is positionally compatible with the source-definition view. **Declare no `PRIMARY KEY`** — the grain note proved no candidate tuple is fully unique.
   2. `CREATE INDEX IF NOT EXISTS laps_enriched_mat_session_driver_lap_idx ON core.laps_enriched_mat (session_key, driver_number, lap_number);` — non-unique btree on the natural query key (closest-to-canonical grain).
   3. `CREATE INDEX IF NOT EXISTS laps_enriched_mat_session_idx ON core.laps_enriched_mat (session_key);` — non-unique btree to support the deferred delete-then-insert refresh per `session_key`.
   4. `TRUNCATE core.laps_enriched_mat;` then `INSERT INTO core.laps_enriched_mat SELECT * FROM core_build.laps_enriched;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. Since the table has no PK and the indexes are non-unique, the bulk insert cannot fail on duplicate-key violation — the duplicate-row multiplicity from the source view is preserved verbatim, exactly as required by the grain decision.
   5. `CREATE OR REPLACE VIEW core.laps_enriched AS SELECT * FROM core.laps_enriched_mat;` — replace the public view body in place with the facade. **Do not** use `DROP VIEW … CREATE VIEW`: ten public views in `sql/007_semantic_summary_contracts.sql` depend on `core.laps_enriched` (see Decisions for the full list) and would block the drop, even in a single transaction. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 1.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection — Postgres allows `CREATE OR REPLACE VIEW` only when the new query produces an output column list that begins with the existing view's columns (matching by name, type, and ordinal), which this slice satisfies by construction.
2. Apply the SQL to `$DATABASE_URL` (gate command #1).
3. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), (c) the storage relation carries no primary-key constraint, and (d) the storage relation carries the two expected non-unique btree indexes — gate command #2.
4. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.laps_enriched` (canonical query) and `core.laps_enriched_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by `03-core-build-schema` and `03-driver-session-summary-prototype`, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.laps_enriched_mat` differs from the global rowcount of `core_build.laps_enriched`.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/010_laps_enriched_mat.sql` (new — single transaction; `CREATE TABLE … (no PK)`, two `CREATE INDEX IF NOT EXISTS`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.laps_enriched`, `CREATE OR REPLACE VIEW core.laps_enriched AS SELECT * FROM core.laps_enriched_mat` — no `DROP VIEW`, because ten public views depend on `core.laps_enriched`).
- `diagnostic/slices/03-laps-enriched-materialize.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files, no parity test `.mjs` files, no application code, no edits to `sql/00[1-9]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/010_laps_enriched_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation is a view,
#    (c) the storage relation has NO primary-key constraint (per the grain decision), and
#    (d) the storage relation carries the two expected non-unique btree indexes
#    (session_key, driver_number, lap_number) and (session_key). Each index check is
#    split into three queries -- a count over pg_index/pg_class only (no pg_attribute
#    join, so the count returns 1 for a single index regardless of column arity), a
#    properties query that joins pg_am to assert btree access method and indisunique,
#    and a columns query that joins pg_attribute to assert exact column ordering.
#    Must exit 0; the DO block raises (and ON_ERROR_STOP=1 forces non-zero exit)
#    unless every assertion holds.
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
BEGIN
  -- (a) storage relation is a base table.
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'laps_enriched_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.laps_enriched_mat as base table (relkind r), got %', table_kind;
  END IF;

  -- (b) public relation is a view.
  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'laps_enriched';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.laps_enriched as view (relkind v), got %', view_kind;
  END IF;

  -- (c) storage relation must have NO primary-key constraint.
  SELECT count(*) INTO pk_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'core'
    AND cl.relname = 'laps_enriched_mat'
    AND c.contype = 'p';
  IF pk_count <> 0 THEN
    RAISE EXCEPTION
      'expected core.laps_enriched_mat to have no PRIMARY KEY (grain is non-unique), found % PK constraint(s)',
      pk_count;
  END IF;

  -- (d) the (session_key, driver_number, lap_number) non-unique btree index must exist.
  -- Count over pg_index/pg_class only -- no pg_attribute join, so the count is the
  -- number of index relations, not column-multiplied.
  SELECT count(*) INTO triple_idx_count
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname = 'core'
    AND tc.relname = 'laps_enriched_mat'
    AND ic.relname = 'laps_enriched_mat_session_driver_lap_idx';
  IF triple_idx_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one index named laps_enriched_mat_session_driver_lap_idx, found %',
      triple_idx_count;
  END IF;

  -- Properties: indisunique + access method (btree).
  SELECT ix.indisunique, am.amname
    INTO triple_idx_unique, triple_idx_am
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname = 'core'
    AND tc.relname = 'laps_enriched_mat'
    AND ic.relname = 'laps_enriched_mat_session_driver_lap_idx';
  IF triple_idx_unique THEN
    RAISE EXCEPTION
      'expected laps_enriched_mat_session_driver_lap_idx to be non-unique (grain is non-unique), it is unique';
  END IF;
  IF triple_idx_am IS DISTINCT FROM 'btree' THEN
    RAISE EXCEPTION
      'expected laps_enriched_mat_session_driver_lap_idx access method btree, got %',
      triple_idx_am;
  END IF;

  -- Columns (joins pg_attribute, multiplies rows -- aggregate to one array).
  SELECT array_agg(a.attname ORDER BY array_position(ix.indkey::int[], a.attnum::int))
    INTO triple_idx_cols
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(ix.indkey)
  WHERE n.nspname = 'core'
    AND tc.relname = 'laps_enriched_mat'
    AND ic.relname = 'laps_enriched_mat_session_driver_lap_idx';
  IF triple_idx_cols IS DISTINCT FROM ARRAY['session_key','driver_number','lap_number']::text[] THEN
    RAISE EXCEPTION
      'expected laps_enriched_mat_session_driver_lap_idx columns (session_key, driver_number, lap_number), got %',
      triple_idx_cols;
  END IF;

  -- (d) the (session_key) non-unique btree index must exist.
  SELECT count(*) INTO session_idx_count
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname = 'core'
    AND tc.relname = 'laps_enriched_mat'
    AND ic.relname = 'laps_enriched_mat_session_idx';
  IF session_idx_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one index named laps_enriched_mat_session_idx, found %',
      session_idx_count;
  END IF;

  SELECT ix.indisunique, am.amname
    INTO session_idx_unique, session_idx_am
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname = 'core'
    AND tc.relname = 'laps_enriched_mat'
    AND ic.relname = 'laps_enriched_mat_session_idx';
  IF session_idx_unique THEN
    RAISE EXCEPTION
      'expected laps_enriched_mat_session_idx to be non-unique, it is unique';
  END IF;
  IF session_idx_am IS DISTINCT FROM 'btree' THEN
    RAISE EXCEPTION
      'expected laps_enriched_mat_session_idx access method btree, got %',
      session_idx_am;
  END IF;

  SELECT array_agg(a.attname ORDER BY array_position(ix.indkey::int[], a.attnum::int))
    INTO session_idx_cols
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(ix.indkey)
  WHERE n.nspname = 'core'
    AND tc.relname = 'laps_enriched_mat'
    AND ic.relname = 'laps_enriched_mat_session_idx';
  IF session_idx_cols IS DISTINCT FROM ARRAY['session_key']::text[] THEN
    RAISE EXCEPTION
      'expected laps_enriched_mat_session_idx columns (session_key), got %',
      session_idx_cols;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.laps_enriched and core.laps_enriched_mat. Must exit 0; the block
#    raises if (a) fewer than 3 analytic_ready sessions are available, (b) any
#    session reports diff_rows > 0, or (c) global rowcounts differ. Inline
#    heredoc -- no .parity.sql file. EXCEPT ALL (not plain EXCEPT) is mandatory
#    because laps_enriched has a non-unique grain and the duplicate-row
#    multiplicity must be preserved by the matview.
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
  SELECT count(*) INTO build_rows FROM core_build.laps_enriched;
  SELECT count(*) INTO mat_rows   FROM core.laps_enriched_mat;
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
      (SELECT * FROM core_build.laps_enriched WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.laps_enriched_mat   WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.laps_enriched_mat   WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.laps_enriched WHERE session_key = sess.session_key)
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
- [ ] `core.laps_enriched_mat` exists as a base table with **no primary key** — gate #1 applies without error and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` AND no row in `pg_constraint` with `contype = 'p'` references the table).
- [ ] `core.laps_enriched` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] `core.laps_enriched_mat` carries the non-unique btree index `laps_enriched_mat_session_driver_lap_idx` on `(session_key, driver_number, lap_number)` — gate #2 exits `0` (raises unless exactly one index relation by that name exists with `pg_am.amname = 'btree'`, `indisunique = false`, and exactly those columns in that order).
- [ ] `core.laps_enriched_mat` carries the non-unique btree index `laps_enriched_mat_session_idx` on `(session_key)` — gate #2 exits `0` (raises unless exactly one index relation by that name exists with `pg_am.amname = 'btree'`, `indisunique = false`, and exactly that column).
- [ ] Global rowcount of `core.laps_enriched_mat` equals the global rowcount of `core_build.laps_enriched` — gate #3 exits `0` (rowcount inequality raises).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §4 — gate #3 exits `0` (the DO block raises on `diff <> 0` or on a sub-3 session count).
- [ ] `npm --prefix web run build`, `npm --prefix web run typecheck`, and `npm --prefix web run test:grading` all exit `0`.
- [ ] The only files modified by this slice are `sql/010_laps_enriched_mat.sql` (new) and `diagnostic/slices/03-laps-enriched-materialize.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql`, no application code.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Additional secondary indexes on `core.laps_enriched_mat` beyond the two declared above (e.g. `(session_key, stint_number)`, partial indexes on `is_valid`) — Phase 4, profile-driven.
- TypeScript contract type for `laps_enriched_mat` — created next to a consumer that needs it, in its own slice.
- Materializing the other nine hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order; this slice is the second scale-out application of the prototype after `03-driver-session-summary-prototype`).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`deterministicSql.ts`, `chatRuntime.ts`, etc.) to read the matview through a new typed contract (deferred until a consumer actually needs it).

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.laps_enriched` (ten views in `sql/007_semantic_summary_contracts.sql` reference it). Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents, provided the new query produces the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe. A `DROP VIEW` would have failed at apply time with `cannot drop view core.laps_enriched because other objects depend on it` and rolled back the whole transaction.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 1.1 are explicit and ordered to match `core.laps_enriched` as defined in `sql/006_semantic_lap_layer.sql:358`; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.laps_enriched`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.laps_enriched does not exist` error and the transaction rolls back; the loop's slice ordering already merges `03-core-build-schema` before this slice.
- Risk: a future audit or contributor incorrectly assumes `core.laps_enriched_mat` has a primary key (e.g. `(session_key, driver_number, lap_number)`) and writes a refresh helper that relies on `ON CONFLICT`. Mitigation: gate #2 explicitly asserts `pk_count = 0`, and the grain note (`diagnostic/notes/03-laps-enriched-grain.md`) records the canonical reasoning. The deferred refresh helper slice must use delete-then-insert per `session_key`, never `UPSERT`.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, the public dependents of `core.laps_enriched` (ten views in `core.*` per the Decisions list) must continue to work throughout. Use the same dependency-safe pattern as the forward migration: `CREATE OR REPLACE VIEW` to swing `core.laps_enriched`'s body off the `_mat` table and back to the original CTE-based query, then drop the now-orphan storage table. Run inside one transaction:
  ```sql
  BEGIN;
  -- Step 1: Restore core.laps_enriched to its original aggregating CTE-based body.
  -- This MUST be CREATE OR REPLACE VIEW, NOT DROP VIEW + CREATE VIEW: dropping the view
  -- would fail with "cannot drop view core.laps_enriched because other objects depend
  -- on it" because core.grid_vs_finish, core.stint_summary, core.strategy_summary,
  -- core.driver_session_summary, core.race_progression_summary, core.pit_cycle_summary,
  -- core.strategy_evidence_summary, core.lap_phase_summary, core.lap_context_summary,
  -- and core.telemetry_lap_bridge all reference it. CREATE OR REPLACE VIEW rewrites the
  -- body in place provided the resulting column names, types, and ordering match what
  -- the dependents already see -- which is preserved here because the original view and
  -- the matview-facade view share the same projection by construction. The cleanest
  -- way to do this is to re-apply sql/006_semantic_lap_layer.sql, which uses
  -- CREATE OR REPLACE VIEW for core.laps_enriched and is idempotent:
  --   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/006_semantic_lap_layer.sql
  -- (Re-applying sql/006 also re-runs CREATE OR REPLACE VIEW on every other view in
  -- that file, which is safe because each is also idempotent.) Alternatively, paste the
  -- CREATE OR REPLACE VIEW core.laps_enriched AS WITH default_policy AS (...) ... block
  -- from sql/006_semantic_lap_layer.sql:272 ff. verbatim.
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1, because
  -- before Step 1 the public view's body still references core.laps_enriched_mat and
  -- DROP TABLE would fail with "cannot drop table core.laps_enriched_mat because other
  -- objects depend on it". After Step 1 nothing depends on the table.
  DROP TABLE IF EXISTS core.laps_enriched_mat;
  COMMIT;
  ```
  The `DROP TABLE` cascades the two non-unique indexes (`laps_enriched_mat_session_driver_lap_idx`, `laps_enriched_mat_session_idx`) automatically. Public dependents see no interruption: their resolved-column references against `core.laps_enriched` continue to match because Step 1 produces the same projection signature.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the `CREATE MATERIALIZED VIEW` / matview object model with the established Phase 3 pattern: create and populate `core.laps_enriched_mat` as a real heap table sourced from `core_build.laps_enriched`, then replace `core.laps_enriched` with a thin facade view over the table.
- [x] Incorporate the completed grain-discovery decision for `laps_enriched`: the storage table must have no primary key, must use non-unique indexes including at least `(session_key, driver_number, lap_number)` and `(session_key)`, and must use delete-then-insert refresh semantics by `session_key`.
- [x] Add executable database gate commands that apply the SQL and verify the acceptance criteria, including relation-kind checks, global rowcount equality, and bidirectional session-scoped `EXCEPT ALL` parity between `core_build.laps_enriched` and `core.laps_enriched_mat` for the deterministic three `analytic_ready` sessions.
- [x] Replace the TypeScript contract and `.mjs` parity-test steps with the SQL-only migration and inline `psql` heredoc parity pattern established by `03-driver-session-summary-prototype`, or explicitly justify why this scale-out slice needs a different test/runtime surface.

### Medium
- [x] Add the required prior-context artifacts that this plan depends on, especially `diagnostic/slices/03-driver-session-summary-prototype.md`, `diagnostic/slices/03-laps-enriched-grain-discovery.md`, and `diagnostic/notes/03-laps-enriched-grain.md`.
- [x] Rename the expected SQL file to the next numbered migration path consistent with the existing `sql/00N_*.sql` convention instead of `sql/laps_enriched.sql`.
- [x] Expand `Required services / env` to include `psql` on PATH and the exact privileges needed for a base table, facade view swap, source read from `core_build.laps_enriched`, parity selector read from `core.session_completeness`, and non-unique index creation; remove the materialized-view privilege requirement.
- [x] Make the acceptance criteria directly testable by tying each criterion to a gate command exit code rather than only saying rowcount and parity "match".

### Low
- [x] Add rollback instructions for restoring the original aggregating `core.laps_enriched` view from `sql/006_semantic_lap_layer.sql` and dropping `core.laps_enriched_mat`, not only `git revert <commit>`.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27 and is current for this audit.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace the `DROP VIEW IF EXISTS core.laps_enriched; CREATE VIEW ...` facade swap with `CREATE OR REPLACE VIEW core.laps_enriched AS SELECT * FROM core.laps_enriched_mat`, or explicitly add a dependency-safe strategy for preserving/recreating every existing public view that depends on `core.laps_enriched`.
- [x] Fix gate #2's `laps_enriched_mat_session_driver_lap_idx` assertion so it counts index relations, not joined `pg_attribute` rows; the current `count(*)` returns `3` for a correct three-column index and will fail at runtime.

### Medium
- [x] Extend gate #2 to assert both expected indexes use the btree access method, since the acceptance criteria require non-unique btree indexes but the current gate only verifies name, uniqueness, and column order.
- [x] Update the rollback SQL to avoid dropping `core.laps_enriched` while dependent public views still reference it; use the same dependency-safe view replacement strategy as the forward migration.

### Low
_None._

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27T15:44:11Z, so its timestamp is current for this audit.
