---
slice_id: 03-driver-session-summary-prototype
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T10:45:14-04:00
---

## Goal
Prototype the materialization pattern that every later Phase 3 hot-contract slice will follow, using `driver_session_summary` as the first cut: read from the preserved source-definition view `core_build.driver_session_summary` (already shipped by slice `03-core-build-schema`), materialize into a real storage table `core.driver_session_summary_mat`, swap the public `core.driver_session_summary` view to a thin facade `SELECT * FROM core.driver_session_summary_mat`, and prove parity with a bidirectional, session-scoped `EXCEPT ALL` check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Per roadmap §3 ("Refresh cost is real… Prefer session-scoped real tables populated incrementally at ingest over full matview refreshes") and §4 Phase 3 ("source-definition strategy" → `core.<name>_mat` real table + `core.<name>` facade), Neon makes `MATERIALIZED VIEW REFRESH` a poor fit (full-table refresh cost, opaque semantics under the pooled endpoint, no clean parity story). The storage relation is therefore `CREATE TABLE core.driver_session_summary_mat`, and the public `core.driver_session_summary` is replaced by a thin `SELECT *` view over that table. The slice's "matview" framing in the goal is the conceptual pattern, not the SQL object kind.
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** This slice mirrors the shape of the merged `03-core-build-schema` slice: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. A TypeScript contract type for the matview columns would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it.
- **Grain.** Per roadmap §4 Phase 3 step 2, the verified grain for `driver_session_summary` is `(session_key, driver_number)` (the canonical query groups by exactly that pair plus per-session immutable attributes carried through `MAX()` / GROUP BY). The `_mat` table declares `PRIMARY KEY (session_key, driver_number)`. A grain-discovery query is not added as a separate gate because if the grain were non-unique on this pair, the bulk `INSERT … SELECT` in Steps §1.2 would abort the migration with a clean PK-violation error and roll back the transaction — the assertion is stronger than a separate SELECT.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.driver_session_summary_mat SELECT * FROM core_build.driver_session_summary` so the facade view is non-empty from first apply. Per-session incremental refresh and the ingest hook are deferred to a later slice.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql`; this slice ships `sql/009_driver_session_summary_mat.sql`. (Roadmap §8 anticipated `sql/009_perf_indexes.sql` for Phase 4; that file does not exist yet, and Phase 4 ordering puts indexes after Phase 3, so a future indexes slice will pick the next free integer rather than colliding with this one.)

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, parity SQL, prototype-before-scaling-out sequencing.
- `sql/008_core_build_schema.sql` — preserved source-definition `core_build.driver_session_summary` (merged in slice `03-core-build-schema`).
- `sql/007_semantic_summary_contracts.sql:239` ff. — current public `core.driver_session_summary` view (column ordering / types / semantics that the `_mat` table must mirror).

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md`
- `diagnostic/slices/03-core-build-schema.md` (the parity-check pattern this slice scales out to per-contract `_mat` storage).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.driver_session_summary_mat`).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.driver_session_summary` (to read the canonical query during initial population and during the parity check).
  - Sufficient privilege to `DROP` and `CREATE` `core.driver_session_summary` (the public-view facade swap). In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT` and `SELECT` on `core.driver_session_summary_mat` (implicit via ownership of the table the migration creates).
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`.
- `psql` available on PATH for the gate commands below (same prerequisite as slice `03-core-build-schema`).

## Steps
1. Add `sql/009_driver_session_summary_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.driver_session_summary_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.driver_session_summary` view** as defined at `sql/007_semantic_summary_contracts.sql:239` ff. The 37 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`, `circuit_short_name`, `driver_number`, `driver_name`, `team_name`, `lap_count`, `valid_lap_count`, `best_lap`, `avg_lap`, `median_lap`, `lap_stddev`, `best_valid_lap`, `avg_valid_lap`, `median_valid_lap`, `valid_lap_stddev`, `best_s1`, `best_s2`, `best_s3`, `avg_s1`, `avg_s2`, `avg_s3`, `total_stints`, `pit_stop_count`, `strategy_type`, `compounds_used`, `total_pit_duration_seconds`, `grid_position`, `finish_position`, `positions_gained`, `grid_source`, `finish_source`. Types must match the view's projected types; the `ROUND(...::numeric, 3)` columns project as `numeric`, the `COUNT(*) FILTER (...)` columns as `bigint`, and the `MAX(le.driver_name)` / `MAX(le.team_name)` / pass-through columns inherit from the source columns in `core.laps_enriched`, `core.strategy_summary`, and `core.grid_vs_finish`. Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/006`/`sql/007`) so the `_mat` table is positionally compatible with the source-definition view. Declare `PRIMARY KEY (session_key, driver_number)`.
   2. `TRUNCATE core.driver_session_summary_mat;` then `INSERT INTO core.driver_session_summary_mat SELECT * FROM core_build.driver_session_summary;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent.
   3. `DROP VIEW IF EXISTS core.driver_session_summary;` followed by `CREATE VIEW core.driver_session_summary AS SELECT * FROM core.driver_session_summary_mat;` to replace the public view with the facade. Column order is preserved by `SELECT *` because step 1.1 declared the table columns in the same order as the original view.
2. Apply the SQL to `$DATABASE_URL` (gate command #1).
3. Verify the storage relation is a base table and the public relation is a view (gate command #2).
4. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.driver_session_summary` (canonical query) and `core.driver_session_summary_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by slice `03-core-build-schema`, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0`, or (c) the global rowcount of `core.driver_session_summary_mat` differs from the global rowcount of `core_build.driver_session_summary`.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/009_driver_session_summary_mat.sql` (new — single transaction; `CREATE TABLE … PRIMARY KEY`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.driver_session_summary`, `DROP VIEW IF EXISTS` + facade `CREATE VIEW`).
- `diagnostic/slices/03-driver-session-summary-prototype.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files, no parity test `.mjs` files, no application code, no edits to `sql/00[1-8]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/009_driver_session_summary_mat.sql

# 2. Confirm the storage relation is a base table and the public relation is a view.
#    Must exit 0; the DO block raises (and ON_ERROR_STOP=1 forces non-zero exit) unless
#    `core.driver_session_summary_mat` has relkind 'r' AND `core.driver_session_summary`
#    has relkind 'v'.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  view_kind text;
BEGIN
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'driver_session_summary_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.driver_session_summary_mat as base table (relkind r), got %', table_kind;
  END IF;

  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'driver_session_summary';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.driver_session_summary as view (relkind v), got %', view_kind;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.driver_session_summary and core.driver_session_summary_mat. Must
#    exit 0; the block raises if (a) fewer than 3 analytic_ready sessions are
#    available, (b) any session reports diff_rows > 0, or (c) global rowcounts
#    differ. Inline heredoc — no .parity.sql file.
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
  SELECT count(*) INTO build_rows FROM core_build.driver_session_summary;
  SELECT count(*) INTO mat_rows   FROM core.driver_session_summary_mat;
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
      (SELECT * FROM core_build.driver_session_summary WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.driver_session_summary_mat   WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.driver_session_summary_mat   WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.driver_session_summary WHERE session_key = sess.session_key)
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
- [ ] `core.driver_session_summary_mat` exists as a base table with `PRIMARY KEY (session_key, driver_number)` — gate #1 applies without error and gate #2 exits `0` (its DO block raises and ON_ERROR_STOP=1 forces non-zero exit unless `relkind = 'r'`; PK violation in gate #1's `INSERT` would have aborted the migration before gate #2 runs).
- [ ] `core.driver_session_summary` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] Global rowcount of `core.driver_session_summary_mat` equals the global rowcount of `core_build.driver_session_summary` — gate #3 exits `0` (rowcount inequality raises).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §4 — gate #3 exits `0` (the DO block raises on `diff <> 0` or on a sub-3 session count).
- [ ] `npm --prefix web run build`, `npm --prefix web run typecheck`, and `npm --prefix web run test:grading` all exit `0`.
- [ ] The only files modified by this slice are `sql/009_driver_session_summary_mat.sql` (new) and `diagnostic/slices/03-driver-session-summary-prototype.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-8]_*.sql`, no application code.

## Out of scope
- Refresh script `src/refresh_summaries.py` and the per-session ingest hook (later Phase 3 slice — roadmap §4 Phase 3 steps 3 and 4).
- Indexes on `core.driver_session_summary_mat` beyond the PK (Phase 4).
- Materializing the other ten hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order once this prototype proves the pattern).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`deterministicSql.ts`, `chatRuntime.ts`, etc.) to read the matview through a new typed contract (deferred until a consumer actually needs it).

## Risk / rollback
- Risk: the facade swap (`DROP VIEW` followed by `CREATE VIEW`) leaves no public `core.driver_session_summary` between the two statements. Mitigation: both statements live inside the same `BEGIN; … COMMIT;` transaction, so concurrent readers see either the old view or the new facade — never a missing relation.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would silently change the public column order or type signature under `SELECT *`. Mitigation: the table's column declarations in step 1.1 are explicit and ordered to match `core.driver_session_summary` as defined in `sql/007_semantic_summary_contracts.sql:239`; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion fails the gate.
- Risk: PK violation on `(session_key, driver_number)` if the source view's grain is non-unique on that pair. Mitigation: this is intentionally asserted by the bulk `INSERT … SELECT` in step 1.2 — a violation aborts the transaction with a clean error and no half-built state. The grain `(session_key, driver_number)` is the verified grain for `driver_session_summary` per roadmap §4 Phase 3 step 2; if the assertion fires, that is itself a signal worth surfacing rather than silencing.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.driver_session_summary`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.driver_session_summary does not exist` error and the transaction rolls back; the loop's slice ordering already merges `03-core-build-schema` first.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, run inside one transaction: `DROP VIEW core.driver_session_summary;` then re-create the original aggregating view from `sql/007_semantic_summary_contracts.sql:239` ff. (or simply re-apply `sql/007_semantic_summary_contracts.sql`, which uses `CREATE OR REPLACE VIEW`), then `DROP TABLE core.driver_session_summary_mat;`. Safe — nothing depends on `core.driver_session_summary_mat` until later slices land.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the `CREATE MATERIALIZED VIEW` / `core_build` wording with the Phase 3 pattern established by `03-core-build-schema`: read from `core_build.driver_session_summary` and materialize into an explicitly named storage relation such as `core.driver_session_summary_mat`, or explicitly justify any different object model in the plan.
- [x] Add executable database gate commands that apply the SQL and verify the acceptance criteria, including rowcount parity and bidirectional session-scoped `EXCEPT ALL` parity for at least three sessions; the current gates only run web commands and cannot prove the materialized relation exists or matches the live query.

### Medium
- [x] Specify a deterministic selector for the parity-test sessions, preferably `core.session_completeness` rows with `completeness_status = 'analytic_ready'` ordered by `session_key`, so implementers and auditors test the same sessions.
- [x] Clarify how the parity test file is executed by the gate commands, either by adding a direct `node web/scripts/tests/parity-driver-session-summary.test.mjs` gate or by stating the existing npm script that includes it.
- [x] Expand `Required services / env` to include `psql` on PATH and the exact database privileges needed for the final object model, not only statement-level `CREATE MATERIALIZED VIEW`.
- [x] Expand `Changed files expected` to include the slice file itself for the Slice-completion note/frontmatter updates, or state why this loop's required slice-file edit is excluded from scope accounting.

### Low
- [x] Rename `sql/driver_session_summary.sql` to fit the existing numbered SQL migration convention, or explicitly state why this slice should use an unnumbered SQL file.

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so its timestamp is current for this audit.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- _None._

### Medium
- [ ] Add an executable primary-key assertion to the database gates, because gate #2 currently verifies only `relkind = 'r'` for `core.driver_session_summary_mat` and does not prove the acceptance criterion that `PRIMARY KEY (session_key, driver_number)` exists.

### Low
- _None._

### Notes (informational only — no action)
- `diagnostic/_state.md` was last updated on 2026-04-27, so its timestamp is current for this audit.
