---
slice_id: 03-lap-phase-summary
phase: 3
status: done
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T23:32:33-04:00
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, `03-strategy-summary`, `03-race-progression-summary`, `03-grid-vs-finish`, `03-pit-cycle-summary`, `03-strategy-evidence-summary`) to `lap_phase_summary`: read from the preserved source-definition view `core_build.lap_phase_summary` (already shipped by `03-core-build-schema` in `sql/008_core_build_schema.sql:482` ff.), materialize into a real storage table `core.lap_phase_summary_mat` (NOT `CREATE MATERIALIZED VIEW`) declared as a non-unique heap with two non-unique btree indexes (no `PRIMARY KEY` — see Decisions for the grain rationale), and replace the public `core.lap_phase_summary` view with a thin facade `SELECT * FROM core.lap_phase_summary_mat`. The existing 16-column projection (driver/session attributes, lap identity, stint/tyre context, lap pace + validity, derived `lap_phase`, derived `tyre_state`) is preserved verbatim. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against `core_build.lap_phase_summary` for the deterministic three `analytic_ready` sessions plus a global rowcount equality check.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as every preceding Phase 3 materialization slice: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.lap_phase_summary_mat`; the public `core.lap_phase_summary` is replaced via `CREATE OR REPLACE VIEW core.lap_phase_summary AS SELECT * FROM core.lap_phase_summary_mat`. The "matview" framing in the round-0 plan body is the conceptual pattern, not the SQL object kind.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** No SQL view in `core` / `core_build` / `raw` depends on `core.lap_phase_summary` — it is a leaf in the source-definition graph (`grep -rn "core.lap_phase_summary" sql/` returns only the canonical body in `sql/007_semantic_summary_contracts.sql:725` and the `core_build.*` clone in `sql/008_core_build_schema.sql:482`; no other SQL file references it). Web runtime callers (`web/src/lib/queries.ts`, `web/src/lib/anthropic.ts`, `web/src/lib/chatRuntime.ts`) read `core.lap_phase_summary` through the public view, which transparently swings to the matview after the facade swap. We still use `CREATE OR REPLACE VIEW` to keep the pattern uniform with every preceding Phase 3 materialization slice and to keep the slice robust against a future SQL view that adds a dependency on it. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 2.1 declares the storage table's column list to exactly mirror the original view's projection, so `SELECT * FROM core.lap_phase_summary_mat` is column-compatible and the swap succeeds.
- **No primary key. Non-unique heap with indexes — the same shape as `03-laps-enriched-materialize`.** The canonical query at `sql/008_core_build_schema.sql:482` ff. is a non-aggregating `LEFT JOIN` of `core_build.laps_enriched le` to a per-session `session_extent` CTE (one row per `session_key`). The join multiplies each `laps_enriched` row by exactly one `session_extent` row, so `core_build.lap_phase_summary` inherits `core_build.laps_enriched`'s grain row-for-row. Per `diagnostic/notes/03-laps-enriched-grain.md` (the grain-discovery deliverable that drove `03-laps-enriched-materialize`) `core_build.laps_enriched` is **non-unique**: `total_rows = 167172` vs. `distinct_5tuple = 167170`, with 7,379 duplicate rows globally over the natural triple `(session_key, driver_number, lap_number)`. Therefore `core_build.lap_phase_summary` is also non-unique on every candidate triple, and the storage table is declared with **no `PRIMARY KEY`** — exactly mirroring `03-laps-enriched-materialize`. The required non-unique btree indexes are `(session_key, driver_number, lap_number)` (the natural query key) and `(session_key)` (supports the deferred delete-then-insert refresh per `session_key`). No additional indexes in this slice — secondary indexes are deferred to a profile-driven Phase 4 slice. **No pre-flight grain probe is required** because the non-uniqueness is already a known property of the upstream `core_build.laps_enriched`; a probe would be redundant and the heap-with-indexes shape is the right answer regardless of probe outcome. (Contrast with `03-strategy-evidence-summary`, which probed because its `ROW_NUMBER … rival_rank = 1` filter could collapse upstream duplicates into a unique output grain — that situation does not apply here.)
- **Refresh semantics: delete-then-insert per `session_key`.** Per roadmap §4 Phase 3 ("non-unique heap with indexes + delete-then-insert refresh per `session_key`"). This slice ships the migration that creates the table, populates it with `TRUNCATE` + `INSERT … SELECT *` for initial idempotent migration, and swaps the facade. The actual incremental `DELETE FROM core.lap_phase_summary_mat WHERE session_key = $1; INSERT INTO core.lap_phase_summary_mat SELECT * FROM core_build.lap_phase_summary WHERE session_key = $1;` refresh helper and any ingest-hook integration are deferred to a later Phase 3 slice (out of scope here).
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as the precedent slices: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. The round-0 deliverables `web/src/lib/contracts/lapPhaseSummary.ts` and `web/scripts/tests/parity-lap-phase.test.mjs` are therefore explicitly removed from `Changed files expected` and from `Steps`. A TypeScript contract type would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice — `web/src/lib/queries.ts`, `web/src/lib/anthropic.ts`, and `web/src/lib/chatRuntime.ts` already read `core.lap_phase_summary` through the public view, which transparently swings to the matview after the facade swap), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.lap_phase_summary_mat SELECT * FROM core_build.lap_phase_summary` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. Per-session incremental refresh and the ingest hook are deferred to a later Phase 3 slice.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql` / `sql/01N_*.sql`; the next free integer after `sql/016_strategy_evidence_summary_mat.sql` is `017`, so this slice ships `sql/017_lap_phase_summary_mat.sql`. The round-0/round-1 deliverable `sql/lap_phase_summary.sql` is therefore replaced.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as every preceding Phase 3 materialization slice: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`) so duplicate-row drift is preserved — critical here precisely because the grain is non-unique (per `diagnostic/notes/03-laps-enriched-grain.md`, 7,379 duplicate rows globally over the natural triple in `laps_enriched` propagate row-for-row into `lap_phase_summary`). The global rowcount equality check is what proves materialization completeness across the entire table.
- **Prerequisite assumed: `sql/008_core_build_schema.sql` and `sql/010_laps_enriched_mat.sql` are already applied** so `core_build.lap_phase_summary` exists and resolves transitively through `core_build.laps_enriched`. Slice `03-core-build-schema` shipped at `67bdeff` and slice `03-laps-enriched-materialize` shipped at `d2adddf`. Gate command #1 will fail non-zero with a clean `relation core_build.lap_phase_summary does not exist` error if applied to a database where `008` has not been run, and the transaction will roll back. This slice **does not** recreate or modify the `core_build.lap_phase_summary` source-definition view.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, "non-unique heap with indexes + delete-then-insert refresh" recommendation.
- `sql/007_semantic_summary_contracts.sql:725` ff. — current public `core.lap_phase_summary` view (column ordering / types / semantics that the `_mat` table must mirror; the projection ends at line 760 just before `core.lap_context_summary`).
- `sql/008_core_build_schema.sql:482` ff. — preserved source-definition `core_build.lap_phase_summary` (merged in slice `03-core-build-schema`; reads from `core_build.laps_enriched`).
- `sql/009_driver_session_summary_mat.sql`, `sql/010_laps_enriched_mat.sql`, `sql/011_stint_summary_mat.sql`, `sql/012_strategy_summary_mat.sql`, `sql/013_race_progression_summary_mat.sql`, `sql/014_grid_vs_finish_mat.sql`, `sql/015_pit_cycle_summary_mat.sql`, `sql/016_strategy_evidence_summary_mat.sql` — prior materialization migrations whose pattern this slice follows verbatim. Most directly: `sql/010_laps_enriched_mat.sql` (heap-with-indexes, no PK).
- `diagnostic/notes/03-laps-enriched-grain.md` — the grain-discovery decision that established `laps_enriched` (and therefore `lap_phase_summary`) is non-unique.

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.lap_phase_summary` and the bidirectional `EXCEPT ALL` parity pattern this slice extends; this is the prerequisite called out below).
- `diagnostic/slices/03-laps-enriched-materialize.md` (most direct precedent — same heap-with-indexes shape, also no PK, same two non-unique btree indexes; the differences for this slice are the column list, the source view (`core_build.lap_phase_summary` instead of `core_build.laps_enriched`), the migration filename, and the absence of public DB dependents on the swapped facade so step 2.5 narrative is simpler).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.lap_phase_summary` view body lives, lines 725–760).
- `sql/008_core_build_schema.sql` (where `core_build.lap_phase_summary` is defined, lines 482–517 — already merged; this slice **does not** recreate it).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.lap_phase_summary_mat` and the two non-unique btree indexes on it).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.lap_phase_summary` (to read the canonical query during initial population and during the parity check).
  - Sufficient privilege to swap `core.lap_phase_summary` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT`, `DELETE`, and `SELECT` on `core.lap_phase_summary_mat` (implicit via ownership of the table the migration creates). `DELETE` is listed for completeness because the deferred refresh helper will use delete-then-insert; the migration in this slice itself only `TRUNCATE`s and `INSERT`s.
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which framed the artifact as a matview. **No `REFRESH MATERIALIZED VIEW` is invoked anywhere in this slice.**
- `psql` available on PATH for the gate commands below (same prerequisite as the precedent slices).

## Steps
1. Add `sql/017_lap_phase_summary_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.lap_phase_summary_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.lap_phase_summary` view** as defined at `sql/007_semantic_summary_contracts.sql:725` ff. The 16 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `driver_number`, `driver_name`, `team_name`, `lap_number`, `stint_number`, `compound_name`, `tyre_age_on_lap`, `lap_duration`, `is_valid`, `lap_phase`, `tyre_state`. Types must match the view's projected types (sourced from `sql/006_semantic_lap_layer.sql` / `sql/007_semantic_summary_contracts.sql` and the upstream `core.laps_enriched` / `core.laps_enriched_mat` whose types are pinned at `sql/010_laps_enriched_mat.sql`):
      - `session_key`, `meeting_key` are `BIGINT`.
      - `year`, `driver_number`, `lap_number`, `stint_number`, `tyre_age_on_lap` are `INTEGER`.
      - `session_name`, `session_type`, `driver_name`, `team_name`, `compound_name` are `TEXT`.
      - `lap_duration` is `DOUBLE PRECISION` (matches the view body's source column type in `core.laps_enriched`).
      - `is_valid` is `BOOLEAN`.
      - `lap_phase` is `TEXT` (the `CASE … END` produces `TEXT` literal branches `'opening_third' / 'middle_third' / 'final_third'` plus `NULL`).
      - `tyre_state` is `TEXT` (the `CASE … END` produces `'fresh' / 'used'`).
      Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column or by reading the source column types from `sql/006`/`sql/007`/`sql/010`) so the `_mat` table is positionally compatible with the source-definition view. **Declare no `PRIMARY KEY`** — the grain inherited from `core_build.laps_enriched` is non-unique (see Decisions).
   2. `CREATE INDEX IF NOT EXISTS lap_phase_summary_mat_session_driver_lap_idx ON core.lap_phase_summary_mat (session_key, driver_number, lap_number);` — non-unique btree on the natural query key.
   3. `CREATE INDEX IF NOT EXISTS lap_phase_summary_mat_session_idx ON core.lap_phase_summary_mat (session_key);` — non-unique btree to support the deferred delete-then-insert refresh per `session_key`.
   4. `TRUNCATE core.lap_phase_summary_mat;` then `INSERT INTO core.lap_phase_summary_mat SELECT * FROM core_build.lap_phase_summary;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. Since the table has no PK and the indexes are non-unique, the bulk insert cannot fail on duplicate-key violation — the duplicate-row multiplicity from the source view is preserved verbatim, exactly as required by the inherited non-unique grain.
   5. `CREATE OR REPLACE VIEW core.lap_phase_summary AS SELECT * FROM core.lap_phase_summary_mat;` — replace the public view body in place with the facade. Use `CREATE OR REPLACE VIEW` (not `DROP VIEW … CREATE VIEW`) for pattern consistency with every preceding Phase 3 materialization slice and for robustness against any future SQL view that depends on `core.lap_phase_summary`. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 1.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection.
2. Apply the SQL to `$DATABASE_URL` (gate command #1).
3. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), (c) the storage relation carries **no** primary-key constraint, (d) each of the two expected indexes exists exactly once and is a **non-unique btree** (`pg_index.indisunique = false`, `pg_am.amname = 'btree'`) on the **exact declared column list** (resolved via `array_position` over `ix.indkey` joined to `pg_attribute`) — name-only would silently pass a unique index, a non-btree index, or one whose column list drifted — and (e) the public view is actually a thin facade over the matview (its only relation dependency in schemas `core` / `core_build` / `raw`, sourced from `pg_depend` joined through `pg_rewrite`, is `core.lap_phase_summary_mat`) — gate command #2. Without check (e), gate #2 would pass if the migration accidentally left the original aggregating view body in place, since that would still be a view (`relkind = 'v'`).
4. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.lap_phase_summary` (canonical query) and `core.lap_phase_summary_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by every preceding Phase 3 materialization slice, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.lap_phase_summary_mat` differs from the global rowcount of `core_build.lap_phase_summary`.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/017_lap_phase_summary_mat.sql` (new — single `BEGIN; … COMMIT;` transaction; `CREATE TABLE … (no PK)`, two `CREATE INDEX IF NOT EXISTS`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.lap_phase_summary`, `CREATE OR REPLACE VIEW core.lap_phase_summary AS SELECT * FROM core.lap_phase_summary_mat` — no `DROP VIEW`, for pattern consistency with prior materialization slices).
- `diagnostic/slices/03-lap-phase-summary.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/lapPhaseSummary.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-lap-phase.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-6]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
set -euo pipefail

# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/017_lap_phase_summary_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation
#    is a view, (c) the storage relation carries NO primary-key constraint,
#    (d) each of the two expected indexes exists exactly once and is a
#    non-unique btree on the exact declared column list (per-index existence
#    count, indisunique, pg_am.amname, and the resolved column array via
#    array_position over ix.indkey -- a name-only check would silently pass
#    a unique index, a non-btree index, or one whose column list drifted),
#    and (e) the public view is actually a thin facade over
#    core.lap_phase_summary_mat (its only relation dependency in core /
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
  WHERE n.nspname = 'core' AND c.relname = 'lap_phase_summary_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.lap_phase_summary_mat as base table (relkind r), got %', table_kind;
  END IF;

  -- (b) public relation is a view.
  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'lap_phase_summary';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.lap_phase_summary as view (relkind v), got %', view_kind;
  END IF;

  -- (c) NO primary-key constraint on the storage relation.
  SELECT count(*) INTO pk_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'core'
    AND cl.relname = 'lap_phase_summary_mat'
    AND c.contype = 'p';
  IF pk_count <> 0 THEN
    RAISE EXCEPTION
      'expected core.lap_phase_summary_mat to have no PRIMARY KEY, found % pk constraint(s)',
      pk_count;
  END IF;

  -- (d) Each expected index must be a non-unique btree on the exact declared
  --     column list. A name-only check (the prior version) would silently pass
  --     a unique index, a non-btree index, or one whose column list drifted —
  --     so we verify (per index) existence-by-name, indisunique, the joined
  --     pg_am.amname, and the resolved column array via array_position over
  --     ix.indkey. Counts are taken over pg_index/pg_class without joining
  --     pg_attribute (so the count is index relations, not column-multiplied);
  --     the column list is computed in a separate aggregating query.

  -- (d.1) (session_key, driver_number, lap_number) non-unique btree index.
  SELECT count(*) INTO triple_idx_count
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname = 'core'
    AND tc.relname = 'lap_phase_summary_mat'
    AND ic.relname = 'lap_phase_summary_mat_session_driver_lap_idx';
  IF triple_idx_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one index named lap_phase_summary_mat_session_driver_lap_idx, found %',
      triple_idx_count;
  END IF;

  SELECT ix.indisunique, am.amname
    INTO triple_idx_unique, triple_idx_am
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_am am ON am.oid = ic.relam
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname = 'core'
    AND tc.relname = 'lap_phase_summary_mat'
    AND ic.relname = 'lap_phase_summary_mat_session_driver_lap_idx';
  IF triple_idx_unique THEN
    RAISE EXCEPTION
      'expected lap_phase_summary_mat_session_driver_lap_idx to be non-unique (grain is non-unique), it is unique';
  END IF;
  IF triple_idx_am IS DISTINCT FROM 'btree' THEN
    RAISE EXCEPTION
      'expected lap_phase_summary_mat_session_driver_lap_idx access method btree, got %',
      triple_idx_am;
  END IF;

  SELECT array_agg(a.attname ORDER BY array_position(ix.indkey::int[], a.attnum::int))
    INTO triple_idx_cols
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ANY(ix.indkey)
  WHERE n.nspname = 'core'
    AND tc.relname = 'lap_phase_summary_mat'
    AND ic.relname = 'lap_phase_summary_mat_session_driver_lap_idx';
  IF triple_idx_cols IS DISTINCT FROM ARRAY['session_key','driver_number','lap_number']::text[] THEN
    RAISE EXCEPTION
      'expected lap_phase_summary_mat_session_driver_lap_idx columns (session_key, driver_number, lap_number), got %',
      triple_idx_cols;
  END IF;

  -- (d.2) (session_key) non-unique btree index.
  SELECT count(*) INTO session_idx_count
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname = 'core'
    AND tc.relname = 'lap_phase_summary_mat'
    AND ic.relname = 'lap_phase_summary_mat_session_idx';
  IF session_idx_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly one index named lap_phase_summary_mat_session_idx, found %',
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
    AND tc.relname = 'lap_phase_summary_mat'
    AND ic.relname = 'lap_phase_summary_mat_session_idx';
  IF session_idx_unique THEN
    RAISE EXCEPTION
      'expected lap_phase_summary_mat_session_idx to be non-unique, it is unique';
  END IF;
  IF session_idx_am IS DISTINCT FROM 'btree' THEN
    RAISE EXCEPTION
      'expected lap_phase_summary_mat_session_idx access method btree, got %',
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
    AND tc.relname = 'lap_phase_summary_mat'
    AND ic.relname = 'lap_phase_summary_mat_session_idx';
  IF session_idx_cols IS DISTINCT FROM ARRAY['session_key']::text[] THEN
    RAISE EXCEPTION
      'expected lap_phase_summary_mat_session_idx columns (session_key), got %',
      session_idx_cols;
  END IF;

  -- (e) Assert the public view is a thin facade over the matview. Walk
  --     pg_depend through the view's pg_rewrite rule to enumerate every
  --     relation it depends on, restricted to schemas core/core_build/raw
  --     (so we ignore pg_catalog and self-references). The only relation
  --     that must appear is core.lap_phase_summary_mat. If the migration
  --     accidentally left the original aggregating view body in place, this
  --     set would instead include core.laps_enriched (and indirectly its
  --     own facade target), and the assertion would fail with the offending
  --     list in the error message.
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
    AND v.relname = 'lap_phase_summary'
    AND tn.nspname IN ('core', 'core_build', 'raw')
    AND t.oid <> v.oid;
  IF facade_refs IS DISTINCT FROM ARRAY['core.lap_phase_summary_mat']::text[] THEN
    RAISE EXCEPTION
      'expected core.lap_phase_summary to be a thin facade over core.lap_phase_summary_mat, but it references: %',
      facade_refs;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.lap_phase_summary and core.lap_phase_summary_mat. Must exit 0;
#    the block raises if (a) fewer than 3 analytic_ready sessions are
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
  SELECT count(*) INTO build_rows FROM core_build.lap_phase_summary;
  SELECT count(*) INTO mat_rows   FROM core.lap_phase_summary_mat;
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
      (SELECT * FROM core_build.lap_phase_summary  WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.lap_phase_summary_mat    WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.lap_phase_summary_mat    WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.lap_phase_summary  WHERE session_key = sess.session_key)
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
- [ ] `core.lap_phase_summary_mat` exists as a base table with **no** primary-key constraint — gate #1 (`psql -f sql/017_lap_phase_summary_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'` and the table carries zero `pg_constraint` rows with `contype = 'p'`).
- [ ] `core.lap_phase_summary_mat` carries the non-unique btree index `lap_phase_summary_mat_session_driver_lap_idx` on `(session_key, driver_number, lap_number)` — gate #2 exits `0` (raises unless exactly one index relation by that name exists with `pg_index.indisunique = false`, `pg_am.amname = 'btree'`, and the column array resolved via `array_position(ix.indkey::int[], a.attnum::int)` is exactly `[session_key, driver_number, lap_number]` in that order).
- [ ] `core.lap_phase_summary_mat` carries the non-unique btree index `lap_phase_summary_mat_session_idx` on `(session_key)` — gate #2 exits `0` (raises unless exactly one index relation by that name exists with `pg_index.indisunique = false`, `pg_am.amname = 'btree'`, and the column array is exactly `[session_key]`).
- [ ] `core.lap_phase_summary` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] `core.lap_phase_summary` is a thin facade over `core.lap_phase_summary_mat` — gate #2 exits `0` (the DO block's final assertion raises unless `pg_depend`-via-`pg_rewrite` reports `core.lap_phase_summary_mat` as the **only** relation the view depends on within schemas `core` / `core_build` / `raw`; this is the check that distinguishes the facade swap from the original aggregating view body, which depended on `core.laps_enriched`).
- [ ] Global rowcount of `core.lap_phase_summary_mat` equals the global rowcount of `core_build.lap_phase_summary` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §4 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/017_lap_phase_summary_mat.sql` (new) and `diagnostic/slices/03-lap-phase-summary.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-6]_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.lap_phase_summary_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.lap_phase_summary_mat` beyond the two declared above (Phase 4, profile-driven).
- Materializing the other remaining hot contracts (later Phase 3 slices, scaled out per the roadmap §4 priority order — `core.lap_context_summary`, `core.telemetry_lap_bridge`).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`web/src/lib/queries.ts`, `web/src/lib/anthropic.ts`, `web/src/lib/chatRuntime.ts`) to read the matview through a new typed contract — deferred until a consumer actually needs it. The facade swap means existing callers transparently benefit from the materialized storage with no code change.

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.lap_phase_summary`. No SQL view in `core` / `core_build` / `raw` currently depends on it (it is a leaf in the source-definition graph; verified by grepping `sql/`), so the immediate dependent set is empty. Web callers (`web/src/lib/queries.ts`, `web/src/lib/anthropic.ts`, `web/src/lib/chatRuntime.ts`) read it through the public view, so the facade swap is transparent at the SQL boundary. Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents (current or future), provided the new query produces the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 1.1 are explicit and ordered to match `core.lap_phase_summary` as defined in `sql/007_semantic_summary_contracts.sql:725` ff.; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.lap_phase_summary`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.lap_phase_summary does not exist` error and the transaction rolls back; the loop's slice ordering already merged `03-core-build-schema` at `67bdeff` and `03-laps-enriched-materialize` at `d2adddf` before this slice can ship.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, no public DB dependent has to be preserved through the swap (the leaf-view property), but to keep the rollback path uniform with the precedent slices use `CREATE OR REPLACE VIEW` to swing `core.lap_phase_summary`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction. **Do NOT re-apply `sql/007_semantic_summary_contracts.sql`** as a shortcut: that file also defines `core.strategy_summary`, `core.race_progression_summary`, `core.pit_cycle_summary`, `core.strategy_evidence_summary`, and other contracts that have since been materialized by their own slices and now exist as facade views over their own `_mat` tables; re-running `sql/007` would clobber those facade swaps and replace them with the original aggregating bodies, silently breaking the other materializations. Paste **only** the `CREATE OR REPLACE VIEW core.lap_phase_summary AS …` body from `sql/007_semantic_summary_contracts.sql:725` ff. verbatim:
  ```sql
  BEGIN;
  -- Step 1: Restore core.lap_phase_summary to its original aggregating body.
  -- Use CREATE OR REPLACE VIEW for symmetry with the forward migration and so
  -- that any future SQL view that comes to depend on this view is not
  -- disturbed. Paste ONLY the core.lap_phase_summary view definition from
  -- sql/007_semantic_summary_contracts.sql:725 ff. verbatim — do NOT re-run
  -- the whole file, because that would also revert the facade swaps for
  -- core.strategy_summary, core.race_progression_summary,
  -- core.pit_cycle_summary, core.strategy_evidence_summary, and other views
  -- that have since been materialized by later slices.
  CREATE OR REPLACE VIEW core.lap_phase_summary AS
    -- … exact body copied from sql/007_semantic_summary_contracts.sql:725 ff. …
  ;
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.lap_phase_summary_mat and DROP TABLE would fail with
  -- "cannot drop table core.lap_phase_summary_mat because other objects
  -- depend on it". After Step 1 nothing depends on the table.
  DROP TABLE IF EXISTS core.lap_phase_summary_mat;
  COMMIT;
  ```

## Slice-completion note

- **Branch:** `slice/03-lap-phase-summary` (off `integration/perf-roadmap`).
- **Implementation commits:** `add979b` (initial migration: `sql/017_lap_phase_summary_mat.sql`) on top of round-4 plan-approved commit `20c32e4`; this slice-completion-note refresh re-runs every gate against the current worktree state and re-records exit codes after the round-1 audit's `.next/types`-missing failure was traced to a stale worktree (gate #4a `npm --prefix web run build` regenerates `.next/types/**` before gate #4b `npm --prefix web run typecheck` reads them, so when run in the documented order all three web gates exit `0`).
- **Files changed (matches "Changed files expected" exactly — verified `git diff --name-only integration/perf-roadmap...HEAD`):**
  - `sql/017_lap_phase_summary_mat.sql` (new)
  - `diagnostic/slices/03-lap-phase-summary.md` (frontmatter status/owner/timestamp transitions and this Slice-completion note only)
- **Decisions executed verbatim from the approved plan:**
  - Real `CREATE TABLE core.lap_phase_summary_mat` (NOT `CREATE MATERIALIZED VIEW`), with explicit 16-column declaration mirroring `core.lap_phase_summary` at `sql/007_semantic_summary_contracts.sql:725` ff. and **no `PRIMARY KEY`** (grain inherited from `core_build.laps_enriched` is non-unique per `diagnostic/notes/03-laps-enriched-grain.md`).
  - Two non-unique btree indexes: `lap_phase_summary_mat_session_driver_lap_idx (session_key, driver_number, lap_number)` and `lap_phase_summary_mat_session_idx (session_key)`.
  - `TRUNCATE` + `INSERT INTO core.lap_phase_summary_mat SELECT * FROM core_build.lap_phase_summary` for idempotent population.
  - Public view swapped via `CREATE OR REPLACE VIEW core.lap_phase_summary AS SELECT * FROM core.lap_phase_summary_mat` (not `DROP VIEW … CREATE VIEW`), inside the same `BEGIN; … COMMIT;` transaction.
  - No TypeScript contract (`web/src/lib/contracts/lapPhaseSummary.ts`), no `.mjs` parity script (`web/scripts/tests/parity-lap-phase.test.mjs`), no edits to `sql/00[1-9]_*.sql` or `sql/01[0-6]_*.sql`, no application code, no `.parity.sql` file — parity check runs as inline `psql` heredoc in gate command #3.
- **Gate results (run order matches the slice's "Gate commands" block — all exit 0):**
  - Gate #1 (`psql -f sql/017_lap_phase_summary_mat.sql`): exit `0`. Output: `BEGIN / CREATE TABLE / CREATE INDEX / CREATE INDEX / TRUNCATE TABLE / INSERT 0 167172 / CREATE VIEW / COMMIT`.
  - Gate #2 (storage relation is base table; public relation is view; storage relation has no PK constraint; each of the two indexes exists exactly once and is non-unique btree on the exact declared column list `[session_key, driver_number, lap_number]` and `[session_key]` respectively; public view's `pg_depend`-via-`pg_rewrite` references in schemas `core` / `core_build` / `raw` are exactly `{core.lap_phase_summary_mat}`): exit `0` (DO block raised on no assertion). Output: `DO`.
  - Gate #3 (deterministic 3 `analytic_ready` sessions + global rowcount equality + bidirectional `EXCEPT ALL` parity per session): exit `0`. Output: `DO`. Insert count from gate #1 (`INSERT 0 167172`) confirms global rowcount equality with `core_build.lap_phase_summary`.
  - Gate #4a (`npm --prefix web run build`): exit `0`.
  - Gate #4b (`npm --prefix web run typecheck`): exit `0`.
  - Gate #4c (`npm --prefix web run test:grading`): exit `0` (21 pass, 10 skip, 0 fail — skipped tests are gated on `OPENF1_RUN_CHAT_INTEGRATION_TESTS=1`, identical to prior precedent slices).
- **Self-checks against acceptance criteria:**
  - [x] `core.lap_phase_summary_mat` exists as base table with **no** primary-key constraint — gates #1 and #2 exit `0`.
  - [x] `core.lap_phase_summary_mat` carries non-unique btree index `lap_phase_summary_mat_session_driver_lap_idx` on `(session_key, driver_number, lap_number)` — gate #2 exit `0`.
  - [x] `core.lap_phase_summary_mat` carries non-unique btree index `lap_phase_summary_mat_session_idx` on `(session_key)` — gate #2 exit `0`.
  - [x] `core.lap_phase_summary` exists as a view (the facade) — gate #2 exit `0`.
  - [x] `core.lap_phase_summary` is a thin facade over `core.lap_phase_summary_mat` (sole `pg_depend`-via-`pg_rewrite` reference in `core` / `core_build` / `raw`) — gate #2 exit `0`.
  - [x] Global rowcount equality `core_build.lap_phase_summary` = `core.lap_phase_summary_mat` (both 167172 rows) — gate #3 exit `0`.
  - [x] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions — gate #3 exit `0`.
  - [x] `npm --prefix web run build` exit `0`.
  - [x] `npm --prefix web run typecheck` exit `0`.
  - [x] `npm --prefix web run test:grading` exit `0`.
  - [x] Only `sql/017_lap_phase_summary_mat.sql` (new) and `diagnostic/slices/03-lap-phase-summary.md` (frontmatter + this note) modified — verified via `git diff --name-only integration/perf-roadmap...HEAD` immediately prior to push.
- **Scope alarms:** none.
- **Out-of-scope items:** unchanged from plan (refresh helper / per-session ingest hook, additional indexes beyond the two declared, materialization of remaining hot contracts, refresh-strategy decision, runtime-path cutover) — all deferred to later Phase 3 slices, no work done in this slice.

## Audit verdict
**PASS**

[slice:03-lap-phase-summary][pass]

Gate exit codes observed:
- Gate #1 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/017_lap_phase_summary_mat.sql` -> exit `0`
- Gate #2 storage/view/index/facade DO block -> exit `0`
- Gate #3 rowcount + 3-session bidirectional `EXCEPT ALL` parity DO block -> exit `0`
- Gate #4a `npm --prefix web run build` -> exit `0`
- Gate #4b `npm --prefix web run typecheck` -> exit `0`
- Gate #4c `npm --prefix web run test:grading` -> exit `0`

Scope-diff result:
- `git diff --name-only integration/perf-roadmap...HEAD` -> `diagnostic/slices/03-lap-phase-summary.md`, `sql/017_lap_phase_summary_mat.sql` only; scope OK

Criterion-by-criterion:
- PASS: `core.lap_phase_summary_mat` exists as a base table with no primary key; gates #1-#2 exit `0`
- PASS: `lap_phase_summary_mat_session_driver_lap_idx` exists exactly once as a non-unique btree on `(session_key, driver_number, lap_number)`; gate #2 exit `0`
- PASS: `lap_phase_summary_mat_session_idx` exists exactly once as a non-unique btree on `(session_key)`; gate #2 exit `0`
- PASS: `core.lap_phase_summary` exists as a view and is a thin facade over `core.lap_phase_summary_mat`; gate #2 exit `0`
- PASS: global rowcount matches between `core_build.lap_phase_summary` and `core.lap_phase_summary_mat`; gate #3 exit `0`
- PASS: bidirectional `EXCEPT ALL` parity is clean for the 3 deterministic `analytic_ready` sessions; gate #3 exit `0`
- PASS: `npm --prefix web run build` exits `0`
- PASS: `npm --prefix web run typecheck` exits `0`
- PASS: `npm --prefix web run test:grading` exits `0`
- PASS: diff stays within the allowed file set

Decision:
- PASS

Rationale:
- All acceptance criteria were verified directly by gate execution, parity checks, and the scope-diff check.

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Add database gate commands for this materialization slice in addition to the web gates, and make them prove apply/existence/parity success; the current gate list at `diagnostic/slices/03-lap-phase-summary.md:38` only runs web commands and does not satisfy the Phase 3 DB-gate rule from `diagnostic/_state.md`.
- [x] Make the acceptance criteria at `diagnostic/slices/03-lap-phase-summary.md:45` executable by requiring the SQL apply/existence check and the parity check to exit `0`, not only that a generic parity test "passes."

### Medium
- [x] Add the slice file itself to `Changed files expected` at `diagnostic/slices/03-lap-phase-summary.md:30`, because implementation will update this file's frontmatter and `Slice-completion note`.
- [x] Specify the deterministic session selector for the ">=3 sessions" parity check in `diagnostic/slices/03-lap-phase-summary.md:27`, preferably using analytic-ready sessions from `core.session_completeness`, so repeated audits run the same coverage.
- [x] State how the new parity test in `diagnostic/slices/03-lap-phase-summary.md:27` is actually executed by the gate list at `diagnostic/slices/03-lap-phase-summary.md:38`; if it is a standalone script, add the command explicitly instead of assuming `npm run test:grading` covers it.

### Low
- [x] Add `psql` on PATH to `Required services / env` at `diagnostic/slices/03-lap-phase-summary.md:21` if the revised gate list applies SQL directly, so the execution prerequisites are complete.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T01:09:52Z, so no stale-state note is required for this round.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace the `core.lap_phase_summary` materialized-view plan with the established Phase 3 contract pattern from `diagnostic/slices/03-core-build-schema.md`: materialize into a real `core.lap_phase_summary_mat` relation sourced from `core_build.lap_phase_summary`, then restore `core.lap_phase_summary` as the public facade the web contract reads.
- [x] Rewrite the gate commands and acceptance criteria to prove the artifacts from that Phase 3 pattern exist and are parity-clean, instead of only asserting a single `core.lap_phase_summary` matview exists; the current plan at `diagnostic/slices/03-lap-phase-summary.md:43` and `diagnostic/slices/03-lap-phase-summary.md:71` would pass while leaving no public facade in place.

### Medium
- [x] Update `Required services / env` and `Changed files expected` so they match the corrected storage-plus-facade plan, including any additional SQL artifacts needed to create `core.lap_phase_summary_mat` and the public `core.lap_phase_summary` facade rather than only a standalone matview file.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T01:09:52Z, so no stale-state note is required for this round.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [ ] None.

### Medium
- [x] Strengthen gate command `#2` and the matching acceptance criteria so they prove each expected index is a non-unique `btree` on the exact declared column list, not only that the two expected index names exist; the current `pg_index` check would pass a unique or wrong-column index if it kept the expected names.

### Low
- [ ] None.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T01:09:52Z, so no stale-state note is required for this round.

## Plan-audit verdict (round 4)

**Status: APPROVED**

### High

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T01:09:52Z, so no stale-state note is required for this round.
