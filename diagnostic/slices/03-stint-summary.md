---
slice_id: 03-stint-summary
phase: 3
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T12:30:29-04:00
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype` and `03-laps-enriched-materialize`) to `stint_summary`: read from the preserved source-definition view `core_build.stint_summary` (already shipped by `03-core-build-schema`), materialize into a real storage table `core.stint_summary_mat` with `PRIMARY KEY (session_key, driver_number, stint_number)`, and replace the public `core.stint_summary` view with a thin facade `SELECT * FROM core.stint_summary_mat`. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against the canonical query for the deterministic three `analytic_ready` sessions plus a global rowcount equality check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as `03-driver-session-summary-prototype` Decisions §1 and `03-laps-enriched-materialize` Decisions §1: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.stint_summary_mat`; the public `core.stint_summary` is replaced via `CREATE OR REPLACE VIEW core.stint_summary AS SELECT * FROM core.stint_summary_mat`. The "matview" framing in the round-0 plan body is the conceptual pattern, not the SQL object kind.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** A public dependent already exists: `core.strategy_summary` (defined in `sql/007_semantic_summary_contracts.sql:159` ff.) reads from `core.stint_summary` (`FROM core.stint_summary ss` at `sql/007_semantic_summary_contracts.sql:165`). A `DROP VIEW core.stint_summary` would fail at apply time with `cannot drop view core.stint_summary because other objects depend on it`, even inside a transaction. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table's column list to exactly mirror the original view's projection list, so `SELECT * FROM core.stint_summary_mat` is column-compatible and `CREATE OR REPLACE VIEW` succeeds without disturbing the dependent.
- **Grain: unique `(session_key, driver_number, stint_number)` → real `PRIMARY KEY`.** Per roadmap §4 Phase 3 step 2, the canonical aggregating query for `core.stint_summary` (`sql/007_semantic_summary_contracts.sql:98` ff.) `GROUP BY`s on `(st.session_key, st.driver_number, st.stint_number)` plus per-stint immutable attributes carried through the GROUP BY (compound, lap_start, lap_end, tyre_age_at_start, fresh_tyre, plus session-immutable attributes from `core.sessions` / `core.session_drivers`). The triple `(session_key, driver_number, stint_number)` is the verified unique grain, so the `_mat` table declares `PRIMARY KEY (session_key, driver_number, stint_number)`. A grain-discovery query is not added as a separate gate because if the grain were non-unique on this triple, the bulk `INSERT … SELECT` in Steps §1.2 would abort the migration with a clean PK-violation error and roll back the transaction — the assertion is stronger than a separate SELECT (same logic as `03-driver-session-summary-prototype` Decisions §3).
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as `03-driver-session-summary-prototype` Decisions §2 and `03-laps-enriched-materialize` Decisions §5: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. A TypeScript contract type for the matview columns would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it. The round-0 deliverables `web/src/lib/contracts/stintSummary.ts` and `web/scripts/tests/parity-stint-summary.test.mjs` are therefore explicitly removed.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.stint_summary_mat SELECT * FROM core_build.stint_summary` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. Per-session incremental refresh and the ingest hook are deferred to a later Phase 3 slice.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql`; the next free integer after `sql/010_laps_enriched_mat.sql` is `011`, so this slice ships `sql/011_stint_summary_mat.sql`. The round-0 deliverable `sql/stint_summary.sql` is therefore replaced.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as `03-core-build-schema`, `03-driver-session-summary-prototype`, and `03-laps-enriched-materialize`: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`). Although the grain is unique here (so duplicate rows are not expected), `EXCEPT ALL` is still mandated by roadmap §4 Phase 3 step 5 for consistency across all materialization slices.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, parity SQL.
- `sql/007_semantic_summary_contracts.sql:98` ff. — current public `core.stint_summary` view (column ordering / types / semantics that the `_mat` table must mirror).
- `sql/008_core_build_schema.sql` — preserved source-definition `core_build.stint_summary` (merged in slice `03-core-build-schema`; reads from `core_build.laps_enriched`, `core.sessions`, `core.session_drivers`, `raw.stints`).
- `sql/009_driver_session_summary_mat.sql` and `sql/010_laps_enriched_mat.sql` — prior materialization migrations whose pattern this slice follows.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md`
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.stint_summary` and the bidirectional `EXCEPT ALL` parity pattern this slice extends).
- `diagnostic/slices/03-driver-session-summary-prototype.md` (the prototype this slice scales out to a second hot contract; same real-table + facade + PK + inline-`psql`-gate pattern).
- `diagnostic/slices/03-laps-enriched-materialize.md` (the dependency-safe `CREATE OR REPLACE VIEW` facade-swap pattern this slice reuses because `core.strategy_summary` depends on `core.stint_summary`).
- `sql/008_core_build_schema.sql` (where `core_build.stint_summary` is defined).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.stint_summary` view body lives, lines 98–156, plus `core.strategy_summary` at line 159 ff. which depends on it).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.stint_summary_mat`).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.stint_summary` (to read the canonical query during initial population and during the parity check).
  - Sufficient privilege to swap `core.stint_summary` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT` and `SELECT` on `core.stint_summary_mat` (implicit via ownership of the table the migration creates).
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which required statement-level `CREATE MATERIALIZED VIEW`.
- `psql` available on PATH for the gate commands below (same prerequisite as `03-core-build-schema`, `03-driver-session-summary-prototype`, and `03-laps-enriched-materialize`).

## Steps
1. Add `sql/011_stint_summary_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.stint_summary_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.stint_summary` view** as defined at `sql/007_semantic_summary_contracts.sql:98` ff. The 24 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`, `driver_number`, `driver_name`, `team_name`, `stint_number`, `compound_name`, `lap_start`, `lap_end`, `tyre_age_at_start`, `fresh_tyre`, `stint_length_laps`, `lap_count`, `valid_lap_count`, `avg_lap`, `best_lap`, `avg_valid_lap`, `best_valid_lap`, `degradation_per_lap`. Types must match the view's projected types: `session_key`/`meeting_key` are `BIGINT` (raw `BIGINT` columns from `raw.sessions` / `raw.meetings`); `year`/`driver_number`/`stint_number`/`lap_start`/`lap_end`/`tyre_age_at_start`/`stint_length_laps` are `INTEGER` (raw `INTEGER` columns from `raw.stints` plus the `(lap_end - lap_start + 1)` arithmetic which resolves to `integer`); `session_name`/`session_type`/`country_name`/`location`/`driver_name`/`team_name`/`compound_name` are `TEXT`; `fresh_tyre` is `BOOLEAN`; `lap_count`/`valid_lap_count` are `BIGINT` (`COUNT(le.lap_number)` and `COUNT(*) FILTER (...)` resolve to `bigint`); `avg_lap`/`best_lap`/`avg_valid_lap`/`best_valid_lap`/`degradation_per_lap` are `NUMERIC` (`ROUND(...::numeric, N)` resolves to `numeric`). Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/007`) so the `_mat` table is positionally compatible with the source-definition view. **Declare `PRIMARY KEY (session_key, driver_number, stint_number)`** — the verified unique grain.
   2. `TRUNCATE core.stint_summary_mat;` then `INSERT INTO core.stint_summary_mat SELECT * FROM core_build.stint_summary;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. The bulk `INSERT … SELECT` doubles as a grain assertion: a non-unique grain on `(session_key, driver_number, stint_number)` would abort the transaction with a clean PK-violation error and roll back the migration.
   3. `CREATE OR REPLACE VIEW core.stint_summary AS SELECT * FROM core.stint_summary_mat;` — replace the public view body in place with the facade. **Do not** use `DROP VIEW … CREATE VIEW`: `core.strategy_summary` (`sql/007_semantic_summary_contracts.sql:159` ff., specifically the `FROM core.stint_summary ss` reference at `sql/007_semantic_summary_contracts.sql:165`) depends on `core.stint_summary` and would block the drop, even in a single transaction. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 1.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection — Postgres allows `CREATE OR REPLACE VIEW` only when the new query produces an output column list that begins with the existing view's columns (matching by name, type, and ordinal), which this slice satisfies by construction.
2. Apply the SQL to `$DATABASE_URL` (gate command #1).
3. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), and (c) the storage relation carries `PRIMARY KEY (session_key, driver_number, stint_number)` in that exact column order — gate command #2.
4. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.stint_summary` (canonical query) and `core.stint_summary_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by `03-core-build-schema`, `03-driver-session-summary-prototype`, and `03-laps-enriched-materialize`, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.stint_summary_mat` differs from the global rowcount of `core_build.stint_summary`.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/011_stint_summary_mat.sql` (new — single transaction; `CREATE TABLE … PRIMARY KEY (session_key, driver_number, stint_number)`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.stint_summary`, `CREATE OR REPLACE VIEW core.stint_summary AS SELECT * FROM core.stint_summary_mat` — no `DROP VIEW`, because `core.strategy_summary` depends on `core.stint_summary`).
- `diagnostic/slices/03-stint-summary.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/stintSummary.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-stint-summary.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/010_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/011_stint_summary_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation is
#    a view, and (c) the storage relation carries PRIMARY KEY
#    (session_key, driver_number, stint_number) in that exact column order. Must
#    exit 0; the DO block raises (and ON_ERROR_STOP=1 forces non-zero exit)
#    unless every assertion holds.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  view_kind text;
  pk_cols text[];
BEGIN
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'stint_summary_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.stint_summary_mat as base table (relkind r), got %', table_kind;
  END IF;

  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'stint_summary';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.stint_summary as view (relkind v), got %', view_kind;
  END IF;

  -- Assert PRIMARY KEY (session_key, driver_number, stint_number) exists in
  -- that exact column order. Order is preserved by sorting attribute names by
  -- their position in c.conkey.
  SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'core'
    AND cl.relname = 'stint_summary_mat'
    AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM ARRAY['session_key','driver_number','stint_number']::text[] THEN
    RAISE EXCEPTION
      'expected core.stint_summary_mat PRIMARY KEY (session_key, driver_number, stint_number), got %',
      pk_cols;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.stint_summary and core.stint_summary_mat. Must exit 0; the
#    block raises if (a) fewer than 3 analytic_ready sessions are available,
#    (b) any session reports diff_rows > 0, or (c) global rowcounts differ.
#    Inline heredoc -- no .parity.sql file.
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
  SELECT count(*) INTO build_rows FROM core_build.stint_summary;
  SELECT count(*) INTO mat_rows   FROM core.stint_summary_mat;
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
      (SELECT * FROM core_build.stint_summary WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.stint_summary_mat   WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.stint_summary_mat   WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.stint_summary WHERE session_key = sess.session_key)
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
- [ ] `core.stint_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number, stint_number)` — gate #1 (`psql -f sql/011_stint_summary_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` AND the table carries a primary-key constraint whose columns are exactly `['session_key','driver_number','stint_number']` in that order, sourced from `pg_constraint` with `contype = 'p'`).
- [ ] `core.stint_summary` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] Global rowcount of `core.stint_summary_mat` equals the global rowcount of `core_build.stint_summary` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §4 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/011_stint_summary_mat.sql` (new) and `diagnostic/slices/03-stint-summary.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/010_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.stint_summary_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.stint_summary_mat` beyond the PK (Phase 4, profile-driven).
- Materializing the other hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`deterministicSql.ts`, `chatRuntime.ts`, etc.) to read the matview through a new typed contract (deferred until a consumer actually needs it).

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.stint_summary`. `core.strategy_summary` depends on it (`sql/007_semantic_summary_contracts.sql:165`). Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents, provided the new query produces the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe. A `DROP VIEW` would have failed at apply time with `cannot drop view core.stint_summary because other objects depend on it` and rolled back the whole transaction.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 1.1 are explicit and ordered to match `core.stint_summary` as defined in `sql/007_semantic_summary_contracts.sql:98` ff.; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: PK violation on `(session_key, driver_number, stint_number)` if the source view's grain is non-unique on that triple. Mitigation: this is intentionally asserted by the bulk `INSERT … SELECT` in step 1.2 — a violation aborts the transaction with a clean error and no half-built state. The grain `(session_key, driver_number, stint_number)` is the verified grain for `stint_summary` per the canonical query's GROUP BY. If the assertion fires, that is itself a signal worth surfacing rather than silencing.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.stint_summary`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.stint_summary does not exist` error and the transaction rolls back; the loop's slice ordering already merges `03-core-build-schema` first.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, the public dependent `core.strategy_summary` must continue to work throughout. Use the same dependency-safe pattern as the forward migration: `CREATE OR REPLACE VIEW` to swing `core.stint_summary`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction:
  ```sql
  BEGIN;
  -- Step 1: Restore core.stint_summary to its original aggregating body.
  -- This MUST be CREATE OR REPLACE VIEW, NOT DROP VIEW + CREATE VIEW: dropping
  -- the view would fail with "cannot drop view core.stint_summary because
  -- other objects depend on it" because core.strategy_summary references it.
  -- The cleanest way is to re-apply sql/007_semantic_summary_contracts.sql,
  -- which uses CREATE OR REPLACE VIEW for core.stint_summary and is idempotent:
  --   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/007_semantic_summary_contracts.sql
  -- (Re-applying sql/007 also re-runs CREATE OR REPLACE VIEW on every other
  -- view in that file, which is safe because each is also idempotent.)
  -- Alternatively, paste the CREATE OR REPLACE VIEW core.stint_summary AS
  -- SELECT … block from sql/007_semantic_summary_contracts.sql:98 ff. verbatim.
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.stint_summary_mat and DROP TABLE would fail with "cannot drop table
  -- core.stint_summary_mat because other objects depend on it". After Step 1
  -- nothing depends on the table.
  DROP TABLE IF EXISTS core.stint_summary_mat;
  COMMIT;
  ```

## Slice-completion note

- **Branch:** `slice/03-stint-summary` (off `integration/perf-roadmap`).
- **Implementation commit:** filled in by the same commit that flips `status=awaiting_audit` (see `git log slice/03-stint-summary`).
- **Files changed (verified `git diff --name-only integration/perf-roadmap...HEAD`):**
  - `sql/011_stint_summary_mat.sql` (new)
  - `diagnostic/slices/03-stint-summary.md` (frontmatter + this note only)
  No other files were touched. No `.parity.sql`, no TypeScript contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/010_*.sql`.
- **Decisions executed verbatim from the approved plan:**
  - Storage relation is a real base table `core.stint_summary_mat` with `PRIMARY KEY (session_key, driver_number, stint_number)`. The 24 columns are declared in the exact order, names, and types of the public `core.stint_summary` view (`sql/007_semantic_summary_contracts.sql:98` ff.): `BIGINT` for `session_key`/`meeting_key`; `INTEGER` for `year`/`driver_number`/`stint_number`/`lap_start`/`lap_end`/`tyre_age_at_start`/`stint_length_laps`; `TEXT` for `session_name`/`session_type`/`country_name`/`location`/`driver_name`/`team_name`/`compound_name`; `BOOLEAN` for `fresh_tyre`; `BIGINT` for `lap_count`/`valid_lap_count`; `NUMERIC` for `avg_lap`/`best_lap`/`avg_valid_lap`/`best_valid_lap`/`degradation_per_lap`.
  - Initial population at migration time via `TRUNCATE` then `INSERT INTO core.stint_summary_mat SELECT * FROM core_build.stint_summary` — idempotent on re-apply, and the bulk insert doubles as the grain assertion (a non-unique grain would have aborted with a PK-violation and rolled the transaction back).
  - Facade swap uses `CREATE OR REPLACE VIEW core.stint_summary AS SELECT * FROM core.stint_summary_mat;` — **not** `DROP VIEW … CREATE VIEW`. The dependent `core.strategy_summary` (`sql/007_semantic_summary_contracts.sql:165`) would have blocked any drop. The replace succeeds because the storage table mirrors the original view's projection signature exactly.
  - One numbered SQL migration (`sql/011_stint_summary_mat.sql`); no TypeScript contract, no `.mjs` parity test (the round-0 `web/src/lib/contracts/stintSummary.ts` and `web/scripts/tests/parity-stint-summary.test.mjs` were explicitly removed from scope by the approved plan).
- **Gate command exit codes (run in order):**
  1. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/011_stint_summary_mat.sql` → exit `0`. Output: `BEGIN / CREATE TABLE / TRUNCATE TABLE / INSERT 0 20654 / CREATE VIEW / COMMIT`.
  2. Structural-assertion `DO` block (`relkind='r'` for `core.stint_summary_mat`, `relkind='v'` for `core.stint_summary`, `pg_constraint`-derived PK column array equals `['session_key','driver_number','stint_number']` in that order) → exit `0`. Output: `DO`.
  3. Parity heredoc (deterministic 3-session selector via `core.session_completeness` `analytic_ready` ASC, global `count(*)` equality `core_build.stint_summary` vs `core.stint_summary_mat`, plus per-session bidirectional `EXCEPT ALL`) → exit `0`. Output: `DO` (no `RAISE EXCEPTION` branches fired).
  4. `npm --prefix web run build` → exit `0`. Next.js production build completed; all 19 routes compiled.
  5. `npm --prefix web run typecheck` → exit `0`. `tsc --noEmit` reported no errors.
  6. `npm --prefix web run test:grading` → exit `0`. 31 tests, 21 pass, 10 skipped (the skipped tests gate on `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`, which is the expected default in this loop), 0 fail.
- **Database side effects observed:**
  - `INSERT 0 20654` rows materialized into `core.stint_summary_mat` from `core_build.stint_summary` — global rowcount equality with `core_build.stint_summary` was independently re-asserted by the parity gate's `count(*)` comparison.
  - `core.stint_summary` is now a thin facade view over `core.stint_summary_mat`; the dependent `core.strategy_summary` was preserved unchanged through the `CREATE OR REPLACE VIEW` swap (no dependent objects were dropped or recreated).
- **Self-checks:**
  - `git diff --name-only integration/perf-roadmap...HEAD` confirms only the two expected paths changed.
  - The slice file edits are confined to the frontmatter (`status`, `owner`, `updated`) and this `Slice-completion note`; no plan-body edits, no edits to prior `## Plan-audit verdict` sections beyond the round-1 checkboxes that were already ticked at plan-revise time.
  - No scope alarms.
- **Frontmatter transition:** `status=awaiting_audit`, `owner=codex`, `updated=2026-04-27T12:21:48-04:00`.

## Audit verdict

**PASS**

[slice:03-stint-summary][pass]

Gate exit codes observed by audit agent:
- `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/011_stint_summary_mat.sql` -> exit `0`. Output included `BEGIN`, an already-exists notice for `stint_summary_mat`, `CREATE TABLE`, `TRUNCATE TABLE`, `INSERT 0 20654`, `CREATE VIEW`, and `COMMIT`.
- Structural relkind + primary-key assertion DO block -> exit `0`. Output: `DO`.
- Global rowcount + three-session bidirectional `EXCEPT ALL` parity DO block -> exit `0`. Output: `DO`.
- `npm --prefix web run build` -> exit `0`.
- `npm --prefix web run typecheck` -> exit `0`.
- `npm --prefix web run test:grading` -> exit `0` (`tests 31`, `pass 21`, `skipped 10`, `fail 0`).

Scope-diff result:
- `git diff --name-only integration/perf-roadmap...HEAD` returned only `diagnostic/slices/03-stint-summary.md` and `sql/011_stint_summary_mat.sql`.
- This is a subset of "Changed files expected"; the slice file is explicitly allowed by audit policy.

Criterion-by-criterion:
- `core.stint_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number, stint_number)`: verified by gate #1 exit `0` and gate #2 exit `0`; the DO block did not raise on relkind or PK column order.
- `core.stint_summary` exists as a view facade: verified by gate #2 exit `0`; the DO block did not raise on relkind.
- Global rowcount of `core.stint_summary_mat` equals `core_build.stint_summary`: verified by gate #3 exit `0`; the rowcount mismatch branch did not fire.
- Bidirectional, session-scoped, multiplicity-preserving parity holds for the three deterministic `analytic_ready` sessions: verified by gate #3 exit `0`; the session-count and nonzero-`diff_rows` branches did not fire.
- Web regression gates passed: build, typecheck, and grading tests all exited `0`.
- File scope and artifact constraints hold: no `.parity.sql` file, no TypeScript contract, no `.mjs` test, no application code, and no edits to `sql/00[1-9]_*.sql` or `sql/010_*.sql` appear in the branch diff.

Decision: PASS. Phase 3 slice, post Phase 0 sign-off; frontmatter set to `status=ready_to_merge`, `owner=codex`.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the `CREATE MATERIALIZED VIEW` / `core_build` framing with the established Phase 3 object model: read from `core_build.stint_summary`, create and populate a real storage table such as `core.stint_summary_mat`, and replace public `core.stint_summary` with a thin facade view.
- [x] Add executable database gate commands that apply the SQL and verify the materialized storage object, facade view, global rowcount parity, and bidirectional session-scoped `EXCEPT ALL` parity against `core_build.stint_summary` for three deterministic `analytic_ready` sessions.
- [x] Define the `_mat` table schema, column order, types, and key/grain assertion for one row per driver-session-stint, including an executable gate that proves the expected primary key or chosen non-unique storage strategy.

### Medium
- [x] Replace `sql/stint_summary.sql` with the next numbered SQL migration path and include the slice file itself in `Changed files expected` for the implementation completion note.
- [x] Remove or justify the TypeScript contract and `.mjs` parity-test deliverables, because the merged Phase 3 materialization slices use SQL migrations plus inline `psql` parity gates rather than `web/src/lib/contracts/*` files or standalone parity tests.
- [x] Expand `Prior context` to include the merged Phase 3 materialization precedent and source definitions this slice depends on, especially `diagnostic/slices/03-driver-session-summary-prototype.md`, `sql/008_core_build_schema.sql`, and `sql/007_semantic_summary_contracts.sql`.

### Low
- [x] Expand acceptance criteria so each criterion maps to a specific gate command and exit condition, rather than only saying the parity test passes.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so it is current for this audit.

## Plan-audit verdict (round 2)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- Verified the round-1 items are resolved in the revised plan: real `_mat` table plus facade view, numbered SQL migration, inline `psql` parity gates, deterministic session selector, and dependency-safe `CREATE OR REPLACE VIEW` for the `core.strategy_summary` dependency.
