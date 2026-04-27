---
slice_id: 03-strategy-summary
phase: 3
status: pending
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T12:40:50-04:00
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, and `03-stint-summary`) to `strategy_summary`: read from the preserved source-definition view `core_build.strategy_summary` (already shipped by `03-core-build-schema`), materialize into a real storage table `core.strategy_summary_mat` with `PRIMARY KEY (session_key, driver_number)`, and replace the public `core.strategy_summary` view with a thin facade `SELECT * FROM core.strategy_summary_mat`. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against the canonical query for the deterministic three `analytic_ready` sessions plus a global rowcount equality check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as `03-driver-session-summary-prototype` Decisions §1, `03-laps-enriched-materialize` Decisions §1, and `03-stint-summary` Decisions §1: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.strategy_summary_mat`; the public `core.strategy_summary` is replaced via `CREATE OR REPLACE VIEW core.strategy_summary AS SELECT * FROM core.strategy_summary_mat`. The "matview" framing in the round-0 plan body is the conceptual pattern, not the SQL object kind.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** A public dependent already exists: `core.pit_cycle_summary` (defined in `sql/007_semantic_summary_contracts.sql:401` ff.) reads from `core.strategy_summary` (`FROM core.strategy_summary ss` at `sql/007_semantic_summary_contracts.sql:419`). A `DROP VIEW core.strategy_summary` would fail at apply time with `cannot drop view core.strategy_summary because other objects depend on it`, even inside a transaction. (Note: `core.driver_session_summary` was originally also a public dependent of `core.strategy_summary` per `sql/007:325`, but is now a thin facade `SELECT * FROM core.driver_session_summary_mat` after `03-driver-session-summary-prototype`, so its live view body no longer references `core.strategy_summary`. The `pit_cycle_summary` reference is the one that still blocks a drop.) `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table's column list to exactly mirror the original view's projection list, so `SELECT * FROM core.strategy_summary_mat` is column-compatible and `CREATE OR REPLACE VIEW` succeeds without disturbing the dependent.
- **Grain: unique `(session_key, driver_number)` → real `PRIMARY KEY`.** Per roadmap §4 Phase 3 step 2, the canonical aggregating query for `core.strategy_summary` (`sql/007_semantic_summary_contracts.sql:159` ff.) is the LEFT JOIN of `stint_rollup` (one row per `(session_key, driver_number)` plus session-immutable attributes carried through GROUP BY) and `pit_rollup` (one row per `(session_key, driver_number)` from `raw.pit`). The pair `(session_key, driver_number)` is the verified unique grain, so the `_mat` table declares `PRIMARY KEY (session_key, driver_number)`. A grain-discovery query is not added as a separate gate because if the grain were non-unique on this pair, the bulk `INSERT … SELECT` in Steps §1.2 would abort the migration with a clean PK-violation error and roll back the transaction — the assertion is stronger than a separate SELECT (same logic as `03-driver-session-summary-prototype` Decisions §3 and `03-stint-summary` Decisions §3).
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as `03-driver-session-summary-prototype` Decisions §2, `03-laps-enriched-materialize` Decisions §5, and `03-stint-summary` Decisions §4: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. A TypeScript contract type for the matview columns would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it. The round-0 deliverables `web/src/lib/contracts/strategySummary.ts` and `web/scripts/tests/parity-strategy-summary.test.mjs` are therefore explicitly removed.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.strategy_summary_mat SELECT * FROM core_build.strategy_summary` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. Per-session incremental refresh and the ingest hook are deferred to a later Phase 3 slice.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql`; the next free integer after `sql/011_stint_summary_mat.sql` is `012`, so this slice ships `sql/012_strategy_summary_mat.sql`. The round-0 deliverable `sql/strategy_summary.sql` is therefore replaced.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as `03-core-build-schema`, `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, and `03-stint-summary`: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`). Although the grain is unique here (so duplicate rows are not expected), `EXCEPT ALL` is still mandated by roadmap §4 Phase 3 step 5 for consistency across all materialization slices.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, parity SQL.
- `sql/007_semantic_summary_contracts.sql:159` ff. — current public `core.strategy_summary` view (column ordering / types / semantics that the `_mat` table must mirror); `sql/007_semantic_summary_contracts.sql:401` ff. — `core.pit_cycle_summary` (the live public dependent that forces `CREATE OR REPLACE VIEW`).
- `sql/008_core_build_schema.sql:335` ff. — preserved source-definition `core_build.strategy_summary` (merged in slice `03-core-build-schema`; reads from `core_build.stint_summary` and `raw.pit`).
- `sql/009_driver_session_summary_mat.sql`, `sql/010_laps_enriched_mat.sql`, and `sql/011_stint_summary_mat.sql` — prior materialization migrations whose pattern this slice follows.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md`
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.strategy_summary` and the bidirectional `EXCEPT ALL` parity pattern this slice extends).
- `diagnostic/slices/03-driver-session-summary-prototype.md` (the prototype for the real-table + facade + PK + inline-`psql`-gate pattern this slice reuses; grain `(session_key, driver_number)` is identical).
- `diagnostic/slices/03-laps-enriched-materialize.md` (precedent for the dependency-safe `CREATE OR REPLACE VIEW` facade-swap pattern this slice reuses because `core.pit_cycle_summary` depends on `core.strategy_summary`).
- `diagnostic/slices/03-stint-summary.md` (most direct precedent — same `CREATE OR REPLACE VIEW` facade swap, same gate structure; only the column list, grain triple→pair, and dependent-name change for this slice).
- `sql/008_core_build_schema.sql` (where `core_build.strategy_summary` is defined, lines 334–412).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.strategy_summary` view body lives, lines 159–236, plus `core.pit_cycle_summary` at line 401 ff. which depends on it).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.strategy_summary_mat`).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.strategy_summary` (to read the canonical query during initial population and during the parity check).
  - Sufficient privilege to swap `core.strategy_summary` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT` and `SELECT` on `core.strategy_summary_mat` (implicit via ownership of the table the migration creates).
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which required statement-level `CREATE MATERIALIZED VIEW`.
- `psql` available on PATH for the gate commands below (same prerequisite as `03-core-build-schema`, `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, and `03-stint-summary`).

## Steps
1. Add `sql/012_strategy_summary_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.strategy_summary_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.strategy_summary` view** as defined at `sql/007_semantic_summary_contracts.sql:159` ff. The 21 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`, `driver_number`, `driver_name`, `team_name`, `total_stints`, `pit_stop_count`, `pit_event_rows`, `compounds_used`, `opening_stint_laps`, `closing_stint_laps`, `shortest_stint_laps`, `longest_stint_laps`, `total_pit_duration_seconds`, `pit_laps`, `strategy_type`. Types must match the view's projected types: `session_key`/`meeting_key` are `BIGINT` (raw `BIGINT` columns from `raw.sessions` / `raw.meetings`); `year`/`driver_number` are `INTEGER` (raw `INTEGER` columns from `raw.sessions` / `raw.session_drivers`); `session_name`/`session_type`/`country_name`/`location`/`driver_name`/`team_name`/`strategy_type` are `TEXT`; `total_stints` is `BIGINT` (`COUNT(*)` resolves to `bigint`); `pit_stop_count` is `BIGINT` (`GREATEST(total_stints - 1, 0)` where `total_stints` is `bigint` resolves to `bigint`); `pit_event_rows` is `BIGINT` (`COALESCE(COUNT(*), 0)` resolves to `bigint`); `compounds_used` is `TEXT[]` (`ARRAY_AGG(DISTINCT compound_name …)`); `opening_stint_laps`/`closing_stint_laps`/`shortest_stint_laps`/`longest_stint_laps` are `INTEGER` (`MAX`/`MIN` over `stint_length_laps`, which is `integer`, preserves the input type); `total_pit_duration_seconds` is `NUMERIC` (`ROUND(…::numeric, 3)` resolves to `numeric`); `pit_laps` is `INTEGER[]` (`ARRAY_AGG(lap_number ORDER BY lap_number)` from `raw.pit.lap_number`, which is `integer`). Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/007`) so the `_mat` table is positionally compatible with the source-definition view. **Declare `PRIMARY KEY (session_key, driver_number)`** — the verified unique grain.
   2. `TRUNCATE core.strategy_summary_mat;` then `INSERT INTO core.strategy_summary_mat SELECT * FROM core_build.strategy_summary;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. The bulk `INSERT … SELECT` doubles as a grain assertion: a non-unique grain on `(session_key, driver_number)` would abort the transaction with a clean PK-violation error and roll back the migration.
   3. `CREATE OR REPLACE VIEW core.strategy_summary AS SELECT * FROM core.strategy_summary_mat;` — replace the public view body in place with the facade. **Do not** use `DROP VIEW … CREATE VIEW`: `core.pit_cycle_summary` (`sql/007_semantic_summary_contracts.sql:401` ff., specifically the `FROM core.strategy_summary ss` reference at `sql/007_semantic_summary_contracts.sql:419`) depends on `core.strategy_summary` and would block the drop, even in a single transaction. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 1.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection — Postgres allows `CREATE OR REPLACE VIEW` only when the new query produces an output column list that begins with the existing view's columns (matching by name, type, and ordinal), which this slice satisfies by construction.
2. Apply the SQL to `$DATABASE_URL` (gate command #1).
3. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), and (c) the storage relation carries `PRIMARY KEY (session_key, driver_number)` in that exact column order — gate command #2.
4. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.strategy_summary` (canonical query) and `core.strategy_summary_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by `03-core-build-schema`, `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, and `03-stint-summary`, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.strategy_summary_mat` differs from the global rowcount of `core_build.strategy_summary`.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/012_strategy_summary_mat.sql` (new — single transaction; `CREATE TABLE … PRIMARY KEY (session_key, driver_number)`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.strategy_summary`, `CREATE OR REPLACE VIEW core.strategy_summary AS SELECT * FROM core.strategy_summary_mat` — no `DROP VIEW`, because `core.pit_cycle_summary` depends on `core.strategy_summary`).
- `diagnostic/slices/03-strategy-summary.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/strategySummary.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-strategy-summary.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/01[01]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/012_strategy_summary_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation is
#    a view, and (c) the storage relation carries PRIMARY KEY
#    (session_key, driver_number) in that exact column order. Must exit 0;
#    the DO block raises (and ON_ERROR_STOP=1 forces non-zero exit) unless
#    every assertion holds.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  view_kind text;
  pk_cols text[];
BEGIN
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'strategy_summary_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.strategy_summary_mat as base table (relkind r), got %', table_kind;
  END IF;

  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'strategy_summary';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.strategy_summary as view (relkind v), got %', view_kind;
  END IF;

  -- Assert PRIMARY KEY (session_key, driver_number) exists in
  -- that exact column order. Order is preserved by sorting attribute names by
  -- their position in c.conkey.
  SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'core'
    AND cl.relname = 'strategy_summary_mat'
    AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM ARRAY['session_key','driver_number']::text[] THEN
    RAISE EXCEPTION
      'expected core.strategy_summary_mat PRIMARY KEY (session_key, driver_number), got %',
      pk_cols;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.strategy_summary and core.strategy_summary_mat. Must exit 0;
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
  SELECT count(*) INTO build_rows FROM core_build.strategy_summary;
  SELECT count(*) INTO mat_rows   FROM core.strategy_summary_mat;
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
      (SELECT * FROM core_build.strategy_summary  WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.strategy_summary_mat    WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.strategy_summary_mat    WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.strategy_summary  WHERE session_key = sess.session_key)
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
- [ ] `core.strategy_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number)` — gate #1 (`psql -f sql/012_strategy_summary_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` AND the table carries a primary-key constraint whose columns are exactly `['session_key','driver_number']` in that order, sourced from `pg_constraint` with `contype = 'p'`).
- [ ] `core.strategy_summary` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] Global rowcount of `core.strategy_summary_mat` equals the global rowcount of `core_build.strategy_summary` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §4 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/012_strategy_summary_mat.sql` (new) and `diagnostic/slices/03-strategy-summary.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[01]_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.strategy_summary_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.strategy_summary_mat` beyond the PK (Phase 4, profile-driven).
- Materializing the other hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`deterministicSql.ts`, `chatRuntime.ts`, etc.) to read the matview through a new typed contract (deferred until a consumer actually needs it).

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.strategy_summary`. `core.pit_cycle_summary` depends on it (`sql/007_semantic_summary_contracts.sql:419`). Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents, provided the new query produces the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe. A `DROP VIEW` would have failed at apply time with `cannot drop view core.strategy_summary because other objects depend on it` and rolled back the whole transaction.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 1.1 are explicit and ordered to match `core.strategy_summary` as defined in `sql/007_semantic_summary_contracts.sql:159` ff.; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: PK violation on `(session_key, driver_number)` if the source view's grain is non-unique on that pair. Mitigation: this is intentionally asserted by the bulk `INSERT … SELECT` in step 1.2 — a violation aborts the transaction with a clean error and no half-built state. The grain `(session_key, driver_number)` is the verified grain for `strategy_summary` per the canonical query's stint_rollup GROUP BY (which groups by all session-immutable attributes plus `driver_number`) and the pit_rollup GROUP BY (`session_key, driver_number`). If the assertion fires, that is itself a signal worth surfacing rather than silencing.
- Risk: applying the migration on a database where slice `03-core-build-schema` or `03-stint-summary` has not yet been applied (no `core_build.strategy_summary`, since `core_build.strategy_summary` reads from `core_build.stint_summary`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.strategy_summary does not exist` error and the transaction rolls back; the loop's slice ordering already merges `03-core-build-schema` and `03-stint-summary` first.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, the public dependent `core.pit_cycle_summary` must continue to work throughout. Use the same dependency-safe pattern as the forward migration: `CREATE OR REPLACE VIEW` to swing `core.strategy_summary`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction:
  ```sql
  BEGIN;
  -- Step 1: Restore core.strategy_summary to its original aggregating body.
  -- This MUST be CREATE OR REPLACE VIEW, NOT DROP VIEW + CREATE VIEW: dropping
  -- the view would fail with "cannot drop view core.strategy_summary because
  -- other objects depend on it" because core.pit_cycle_summary references it.
  -- The cleanest way is to re-apply sql/007_semantic_summary_contracts.sql,
  -- which uses CREATE OR REPLACE VIEW for core.strategy_summary and is idempotent:
  --   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/007_semantic_summary_contracts.sql
  -- (Re-applying sql/007 also re-runs CREATE OR REPLACE VIEW on every other
  -- view in that file, which is safe because each is also idempotent.)
  -- Alternatively, paste the CREATE OR REPLACE VIEW core.strategy_summary AS
  -- SELECT … block from sql/007_semantic_summary_contracts.sql:159 ff. verbatim.
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.strategy_summary_mat and DROP TABLE would fail with "cannot drop table
  -- core.strategy_summary_mat because other objects depend on it". After Step 1
  -- nothing depends on the table.
  DROP TABLE IF EXISTS core.strategy_summary_mat;
  COMMIT;
  ```

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the `CREATE MATERIALIZED VIEW` / unnumbered SQL-file framing with the established Phase 3 object model: read from `core_build.strategy_summary`, create and populate a real storage table `core.strategy_summary_mat`, and replace public `core.strategy_summary` with a thin facade view.
- [x] Add executable database gate commands that apply the SQL and verify the storage object, facade view, global rowcount parity, and bidirectional session-scoped `EXCEPT ALL` parity against `core_build.strategy_summary` for three deterministic `analytic_ready` sessions.
- [x] Define the `_mat` table schema, exact column order, types, and grain/key assertion for `strategy_summary`, including an executable gate that proves the expected primary key or chosen non-unique storage strategy.

### Medium
- [x] Replace `sql/strategy_summary.sql` with the next numbered SQL migration path and include this slice file itself in `Changed files expected` for frontmatter and Slice-completion note updates.
- [x] Remove or justify the TypeScript contract and `.mjs` parity-test deliverables, because the merged Phase 3 materialization slices use SQL migrations plus inline `psql` parity gates rather than `web/src/lib/contracts/*` files or standalone parity tests.
- [x] Expand `Prior context` to include the merged Phase 3 materialization precedent and source definitions this slice depends on, especially `diagnostic/slices/03-driver-session-summary-prototype.md`, `diagnostic/slices/03-laps-enriched-materialize.md`, `diagnostic/slices/03-stint-summary.md`, `sql/008_core_build_schema.sql`, and `sql/007_semantic_summary_contracts.sql`.

### Low
- [x] Expand acceptance criteria so each criterion maps to a specific gate command and exit condition, rather than only saying the parity test passes.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T16:32:09Z`).

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- Round 1 action items are addressed in the revised plan.
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T16:32:09Z`).
