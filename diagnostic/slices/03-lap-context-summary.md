---
slice_id: 03-lap-context-summary
phase: 3
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T23:55:00-0400
---

## Goal
Scale the Phase 3 source-definition pattern (proven by `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, `03-stint-summary`, `03-strategy-summary`, `03-race-progression-summary`, `03-grid-vs-finish`, `03-pit-cycle-summary`, `03-strategy-evidence-summary`, `03-lap-phase-summary`) to `lap_context_summary`: read from the preserved source-definition view `core_build.lap_context_summary` (already shipped by `03-core-build-schema` in `sql/008_core_build_schema.sql:520` ff.), materialize into a real storage table `core.lap_context_summary_mat` (NOT `CREATE MATERIALIZED VIEW`) declared with a real `PRIMARY KEY (session_key, lap_number)` enforcing the canonical query's `GROUP BY` identity, and replace the public `core.lap_context_summary` view with a thin facade `SELECT * FROM core.lap_context_summary_mat`. The existing 12-column projection (session attributes, `lap_number`, valid-driver count + lap-pace stats per lap-number) is preserved verbatim. Parity is proved by an inline `psql` heredoc gate using bidirectional, multiplicity-preserving `EXCEPT ALL` against `core_build.lap_context_summary` for the deterministic three `analytic_ready` sessions plus a global rowcount equality check. The round-0 plan body's framing of "traffic ahead/behind, gap deltas, sector flags" was inaccurate — `core.lap_context_summary` is a per-`(session_key, lap_number)` lap-pace context summary, not a per-driver-lap relative-position summary; this slice materializes the contract as it actually exists today.

## Decisions
- **Object model: real table + facade view, NOT `CREATE MATERIALIZED VIEW`.** Same rationale as every preceding Phase 3 materialization slice: roadmap §3 / §4 Phase 3 prescribe real `_mat` tables refreshed incrementally, not Postgres materialized views (full-refresh cost, opaque semantics under the pooled Neon endpoint, no clean parity story). Storage relation is `CREATE TABLE core.lap_context_summary_mat`; the public `core.lap_context_summary` is replaced via `CREATE OR REPLACE VIEW core.lap_context_summary AS SELECT * FROM core.lap_context_summary_mat`. The "matview" framing in the round-0 plan body is the conceptual pattern, not the SQL object kind.
- **Facade swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW`.** No SQL view in `core` / `core_build` / `raw` depends on `core.lap_context_summary` — it is a leaf in the source-definition graph (`grep -rn "core\.lap_context_summary\|core_build\.lap_context_summary" sql/` returns only the canonical body in `sql/007_semantic_summary_contracts.sql:763` and the `core_build.*` clone in `sql/008_core_build_schema.sql:520`; no other SQL file references it). Web runtime callers (`web/src/lib/anthropic.ts:60`, `web/src/lib/queries.ts:81/129`, `web/src/lib/chatRuntime.ts:174`, `web/src/lib/deterministicSql.ts:1110`) read `core.lap_context_summary` through the public view, which transparently swings to the matview after the facade swap. We still use `CREATE OR REPLACE VIEW` to keep the pattern uniform with every preceding Phase 3 materialization slice and to keep the slice robust against a future SQL view that adds a dependency on it. `CREATE OR REPLACE VIEW` is dependency-safe in Postgres provided the new view returns the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table's column list to exactly mirror the original view's projection, so `SELECT * FROM core.lap_context_summary_mat` is column-compatible and the swap succeeds.
- **Real `PRIMARY KEY (session_key, lap_number)` — same shape as `03-stint-summary` and the other aggregating Phase 3 slices.** The canonical query at `sql/008_core_build_schema.sql:520` ff. is a `GROUP BY le.session_key, le.meeting_key, le.year, le.session_name, le.session_type, le.country_name, le.location, le.lap_number` with `WHERE le.lap_number IS NOT NULL`. The six non-grain columns in the GROUP BY (`meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`) are session attributes functionally determined by `session_key` (they are 1:1 with `session_key` in `core.sessions`), so the effective output identity is `(session_key, lap_number)` — exactly one row per `(session_key, lap_number)` group. Therefore the storage table declares `PRIMARY KEY (session_key, lap_number)`. This (a) enforces grain at write time — the `INSERT INTO … SELECT * FROM core_build.lap_context_summary` in step 1.4 will abort with a clean PK-violation and roll the whole transaction back if the upstream ever drifts to non-unique, (b) doubles as the natural query index, and (c) matches the precedent set by `03-stint-summary` (`PRIMARY KEY (session_key, driver_number, stint_number)`) and the other aggregating Phase 3 materialization slices. **No additional indexes** in this slice — the PK-implied unique btree on `(session_key, lap_number)` already supports the deferred per-`session_key` delete-then-insert refresh (its leading column is `session_key`), and secondary indexes are deferred to a profile-driven Phase 4 slice. **No pre-flight grain probe is required**: the GROUP BY identity makes uniqueness on `(session_key, lap_number)` an algebraic property of the canonical query, not an empirical one. (Contrast with `03-laps-enriched-materialize` and `03-lap-phase-summary`, which inherit non-uniqueness from `core_build.laps_enriched` and therefore declare no PK.)
- **Refresh semantics: delete-then-insert per `session_key`.** Per roadmap §4 Phase 3 ("non-unique heap with indexes + delete-then-insert refresh per `session_key`", which extends naturally to unique-grain heaps with a PK whose leading column is `session_key`). This slice ships the migration that creates the table, populates it with `TRUNCATE` + `INSERT … SELECT *` for initial idempotent migration, and swaps the facade. The actual incremental `DELETE FROM core.lap_context_summary_mat WHERE session_key = $1; INSERT INTO core.lap_context_summary_mat SELECT * FROM core_build.lap_context_summary WHERE session_key = $1;` refresh helper and any ingest-hook integration are deferred to a later Phase 3 slice (out of scope here).
- **Single SQL migration; no TypeScript contract or `.mjs` parity test.** Same rationale as the precedent slices: one numbered SQL file plus an inline `psql` heredoc parity check in the gate. The round-0 deliverables `web/src/lib/contracts/lapContextSummary.ts` and `web/scripts/tests/parity-lap-context.test.mjs` are therefore explicitly removed from `Changed files expected` and from `Steps`. A TypeScript contract type would duplicate the public view's column list with no current caller (no runtime path is being switched in this slice — `web/src/lib/anthropic.ts`, `web/src/lib/queries.ts`, `web/src/lib/chatRuntime.ts`, and `web/src/lib/deterministicSql.ts` already read `core.lap_context_summary` through the public view, which transparently swings to the matview after the facade swap), and a `.mjs` parity script would split the parity logic across two languages and CI surfaces when one migration-time SQL check is sufficient and matches the proven pattern. Round-1 audit Low item asked whether a TS contract is generated or maintained manually; the answer is **neither** — it is removed from this slice's scope. If a future runtime path needs the typed columns, it can land in its own slice next to the consumer that needs it.
- **Initial population at migration time.** The migration `TRUNCATE` + `INSERT INTO core.lap_context_summary_mat SELECT * FROM core_build.lap_context_summary` so the facade view is non-empty from first apply. Re-running the migration is idempotent because of the `TRUNCATE` before `INSERT`. The PRIMARY KEY ensures any duplicate-row drift in the upstream surfaces immediately as a clean PK violation that rolls the whole transaction back.
- **Numbered SQL filename.** Existing convention is `sql/00N_*.sql` / `sql/01N_*.sql`; the next free integer after `sql/017_lap_phase_summary_mat.sql` (shipped by the just-merged `03-lap-phase-summary` slice) is `018`, so this slice ships `sql/018_lap_context_summary_mat.sql`. The round-0 deliverable `sql/lap_context_summary.sql` is therefore replaced by the numbered name.
- **Parity is bidirectional, multiplicity-preserving, and session-scoped.** Same selector and method as every preceding Phase 3 materialization slice: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`, with `EXCEPT ALL` (not plain `EXCEPT`) so duplicate-row drift is preserved. Although the unique PK makes duplicate rows impossible in this contract, `EXCEPT ALL` is still mandated for pattern uniformity across all Phase 3 materialization slices. The global rowcount equality check is what proves materialization completeness across the entire table.
- **Prerequisite assumed: `sql/008_core_build_schema.sql` and `sql/010_laps_enriched_mat.sql` are already applied** so `core_build.lap_context_summary` exists and resolves transitively through `core_build.laps_enriched`. Slice `03-core-build-schema` shipped at `67bdeff` and slice `03-laps-enriched-materialize` shipped at `d2adddf`. Gate command #1 will fail non-zero with a clean `relation core_build.lap_context_summary does not exist` error if applied to a database where `008` has not been run, and the transaction will roll back. This slice **does not** recreate or modify the `core_build.lap_context_summary` source-definition view.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 — source-definition strategy, scale-out priority list, "non-unique heap with indexes + delete-then-insert refresh" recommendation (this slice's grain is unique so it uses a PK rather than heap, but the delete-then-insert refresh pattern is the same).
- `sql/007_semantic_summary_contracts.sql:763` ff. — current public `core.lap_context_summary` view (column ordering / types / semantics that the `_mat` table must mirror; the projection ends at line 790 just before `core.telemetry_lap_bridge`).
- `sql/008_core_build_schema.sql:520` ff. — preserved source-definition `core_build.lap_context_summary` (merged in slice `03-core-build-schema`; reads from `core_build.laps_enriched`).
- `sql/009_driver_session_summary_mat.sql`, `sql/010_laps_enriched_mat.sql`, `sql/011_stint_summary_mat.sql`, `sql/012_strategy_summary_mat.sql`, `sql/013_race_progression_summary_mat.sql`, `sql/014_grid_vs_finish_mat.sql`, `sql/015_pit_cycle_summary_mat.sql`, `sql/016_strategy_evidence_summary_mat.sql`, `sql/017_lap_phase_summary_mat.sql` — prior materialization migrations whose pattern this slice follows verbatim. Most directly: `sql/011_stint_summary_mat.sql` (aggregating GROUP BY view, real PK on the GROUP BY identity, `TRUNCATE` + `INSERT … SELECT *`, `CREATE OR REPLACE VIEW` facade swap, single transaction).

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3
- `diagnostic/slices/03-core-build-schema.md` (established `core_build.lap_context_summary` and the bidirectional `EXCEPT ALL` parity pattern this slice extends; this is the prerequisite called out in Decisions).
- `diagnostic/slices/03-stint-summary.md` (most direct precedent — same aggregating-GROUP-BY shape, same real-PK-on-GROUP-BY-identity pattern, same `TRUNCATE` + `INSERT … SELECT *` + `CREATE OR REPLACE VIEW` facade swap).
- `diagnostic/slices/03-lap-phase-summary.md` (most recent precedent — same `core_build.<contract>` source view, same gate-check structure for table/view/index/facade verification and parity; differs in that lap_phase_summary is non-unique heap with explicit indexes while this slice is unique-grain with a PK).
- `sql/007_semantic_summary_contracts.sql` (where the public `core.lap_context_summary` view body lives, lines 763–790).
- `sql/008_core_build_schema.sql` (where `core_build.lap_context_summary` is defined, lines 520–547 — already merged; this slice **does not** recreate it).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - `CREATE` on schema `core` (to add `core.lap_context_summary_mat` and the implicit unique btree backing the PRIMARY KEY).
  - `USAGE` on schema `core_build` and `SELECT` on `core_build.lap_context_summary` (to read the canonical query during initial population and during the parity check).
  - Sufficient privilege to swap `core.lap_context_summary` via `CREATE OR REPLACE VIEW`. In practice this is ownership of the existing view, which the loop's migration role already holds since it created the view in `sql/007_semantic_summary_contracts.sql`.
  - `INSERT`, `DELETE`, and `SELECT` on `core.lap_context_summary_mat` (implicit via ownership of the table the migration creates). `DELETE` is listed for completeness because the deferred refresh helper will use delete-then-insert; the migration in this slice itself only `TRUNCATE`s and `INSERT`s.
  - `SELECT` on `core.session_completeness` (the parity gate's deterministic session selector).
  - **No `MATERIALIZED VIEW` privilege is required** — the storage relation is a base table, not a `MATERIALIZED VIEW`. This explicitly supersedes the round-0 plan body, which framed the artifact as a matview. **No `REFRESH MATERIALIZED VIEW` is invoked anywhere in this slice.**
- `psql` available on PATH for the gate commands below (same prerequisite as the precedent slices). The implementer must verify `psql --version` exits `0` before running gate command #1; the gate list assumes `psql` is the parity-execution tool.

## Steps
1. Add `sql/018_lap_context_summary_mat.sql`, wrapped in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built. Contents in this order:
   1. `CREATE TABLE IF NOT EXISTS core.lap_context_summary_mat ( … )` declaring the **exact column list, types, and ordering of the public `core.lap_context_summary` view** as defined at `sql/007_semantic_summary_contracts.sql:763` ff. The 12 columns, in order, are: `session_key`, `meeting_key`, `year`, `session_name`, `session_type`, `country_name`, `location`, `lap_number`, `valid_driver_count`, `fastest_valid_lap_on_number`, `avg_valid_lap_on_number`, `rep_valid_lap_on_number`. Types must match the view's projected types (sourced from `sql/006_semantic_lap_layer.sql` / `sql/007_semantic_summary_contracts.sql` and the upstream `core.laps_enriched` / `core.laps_enriched_mat` whose types are pinned at `sql/010_laps_enriched_mat.sql`):
      - `session_key`, `meeting_key` are `BIGINT`.
      - `year`, `lap_number` are `INTEGER`.
      - `session_name`, `session_type`, `country_name`, `location` are `TEXT`.
      - `valid_driver_count` is `BIGINT` (`COUNT(*) FILTER (...)` produces `BIGINT`).
      - `fastest_valid_lap_on_number`, `avg_valid_lap_on_number`, `rep_valid_lap_on_number` are `NUMERIC` (the `ROUND(...::numeric, 3)` projection produces `NUMERIC`).
      Implementation: copy the column-and-type signature from the existing view (e.g. via `pg_typeof()` on each column, or by reading the source column types from `sql/006`/`sql/007`/`sql/010`) so the `_mat` table is positionally compatible with the source-definition view. Mark `session_key`, `lap_number` `NOT NULL` (both are part of the PK; `lap_number` is also constrained `IS NOT NULL` by the canonical query's `WHERE` clause at `sql/008_core_build_schema.sql:537`). Declare `PRIMARY KEY (session_key, lap_number)` — the GROUP BY identity in the canonical query (see Decisions). The PK creates an implicit unique btree on `(session_key, lap_number)` that doubles as both grain enforcement and the deferred refresh's per-`session_key` lookup index, so no additional `CREATE INDEX` statements are emitted by this migration.
   2. `TRUNCATE core.lap_context_summary_mat;` then `INSERT INTO core.lap_context_summary_mat SELECT * FROM core_build.lap_context_summary;` for initial population. The `TRUNCATE` before `INSERT` makes re-running the migration idempotent. The PRIMARY KEY enforces grain at write time: any duplicate-row drift in the upstream surfaces as a clean PK violation that rolls the whole transaction back.
   3. `CREATE OR REPLACE VIEW core.lap_context_summary AS SELECT * FROM core.lap_context_summary_mat;` — replace the public view body in place with the facade. Use `CREATE OR REPLACE VIEW` (not `DROP VIEW … CREATE VIEW`) for pattern consistency with every preceding Phase 3 materialization slice and for robustness against any future SQL view that depends on `core.lap_context_summary`. `CREATE OR REPLACE VIEW` succeeds dependency-free because step 1.1 declares the storage table's columns in exactly the same names, types, and order as the original view's projection.
2. Apply the SQL to `$DATABASE_URL` (gate command #1).
3. Verify (a) the storage relation is a base table (`relkind = 'r'`), (b) the public relation is a view (`relkind = 'v'`), (c) the storage relation carries **exactly one** primary-key constraint whose column list, resolved via `array_position` over the constraint's `conkey` joined to `pg_attribute`, is exactly `[session_key, lap_number]` in that order — name-only would silently pass a PK on the wrong columns, and a check that ignores order would silently pass a PK declared `(lap_number, session_key)`, which would not support the deferred per-`session_key` refresh — and (d) the public view is actually a thin facade over the matview (its only relation dependency in schemas `core` / `core_build` / `raw`, sourced from `pg_depend` joined through `pg_rewrite`, is `core.lap_context_summary_mat`) — gate command #2. Without check (d), gate #2 would pass if the migration accidentally left the original aggregating view body in place, since that would still be a view (`relkind = 'v'`).
4. Run the bidirectional, session-scoped, multiplicity-preserving `EXCEPT ALL` parity check between `core_build.lap_context_summary` (canonical query) and `core.lap_context_summary_mat` (storage) for the **3 deterministic `analytic_ready` sessions** selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   This is the same deterministic selector used by every preceding Phase 3 materialization slice, so implementers and auditors test the same sessions. Plus a global rowcount-equality check across the whole table. Gate command #3 is a single `psql` heredoc that performs both. The block fails non-zero if (a) fewer than 3 `analytic_ready` sessions are returned by the selector, (b) any session reports `diff_rows > 0` (bidirectional `EXCEPT ALL`), or (c) the global rowcount of `core.lap_context_summary_mat` differs from the global rowcount of `core_build.lap_context_summary`.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should be untouched and ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/018_lap_context_summary_mat.sql` (new — single `BEGIN; … COMMIT;` transaction; `CREATE TABLE … (… PRIMARY KEY (session_key, lap_number))`, `TRUNCATE`/`INSERT … SELECT * FROM core_build.lap_context_summary`, `CREATE OR REPLACE VIEW core.lap_context_summary AS SELECT * FROM core.lap_context_summary_mat` — no `DROP VIEW`, no separate `CREATE INDEX` statements, for pattern consistency with prior aggregating-grain materialization slices).
- `diagnostic/slices/03-lap-context-summary.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

No TypeScript contract files (the round-0 `web/src/lib/contracts/lapContextSummary.ts` is removed from scope), no parity test `.mjs` files (the round-0 `web/scripts/tests/parity-lap-context.test.mjs` is removed from scope), no application code, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-7]_*.sql`. The parity check is run as an inline heredoc in gate command #3 — no separate `.parity.sql` file is permitted. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
set -euo pipefail

# 0. Prerequisite: psql must be on PATH. Must exit 0.
psql --version

# 1. Apply the migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/018_lap_context_summary_mat.sql

# 2. Confirm (a) the storage relation is a base table, (b) the public relation
#    is a view, (c) the storage relation carries exactly one PRIMARY KEY
#    constraint whose column list (resolved via array_position over conkey) is
#    exactly [session_key, lap_number] in that order, and (d) the public view
#    is actually a thin facade over core.lap_context_summary_mat (its only
#    relation dependency in core / core_build / raw is the matview). Must exit
#    0; the DO block raises (and ON_ERROR_STOP=1 forces non-zero exit) unless
#    every assertion holds. Without check (d) this gate would pass even if the
#    migration accidentally left the original aggregating view body in place,
#    since that would still be a view (relkind = 'v').
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_kind text;
  view_kind text;
  pk_count int;
  pk_cols text[];
  facade_refs text[];
BEGIN
  -- (a) storage relation is a base table.
  SELECT c.relkind::text INTO table_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'lap_context_summary_mat';
  IF table_kind IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'expected core.lap_context_summary_mat as base table (relkind r), got %', table_kind;
  END IF;

  -- (b) public relation is a view.
  SELECT c.relkind::text INTO view_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'lap_context_summary';
  IF view_kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION
      'expected core.lap_context_summary as view (relkind v), got %', view_kind;
  END IF;

  -- (c) Exactly one PRIMARY KEY constraint, columns [session_key, lap_number]
  --     in that order. Resolved via array_position over conkey so a PK with
  --     the columns in the wrong order (e.g. (lap_number, session_key)) is
  --     rejected -- that order would not support the deferred per-session_key
  --     refresh.
  SELECT count(*) INTO pk_count
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'core'
    AND cl.relname = 'lap_context_summary_mat'
    AND c.contype = 'p';
  IF pk_count <> 1 THEN
    RAISE EXCEPTION
      'expected core.lap_context_summary_mat to have exactly one PRIMARY KEY, found %',
      pk_count;
  END IF;

  SELECT array_agg(a.attname ORDER BY array_position(c.conkey::int[], a.attnum::int))
    INTO pk_cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = ANY(c.conkey)
  WHERE n.nspname = 'core'
    AND cl.relname = 'lap_context_summary_mat'
    AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM ARRAY['session_key','lap_number']::text[] THEN
    RAISE EXCEPTION
      'expected core.lap_context_summary_mat PRIMARY KEY columns (session_key, lap_number) in order, got %',
      pk_cols;
  END IF;

  -- (d) Assert the public view is a thin facade over the matview. Walk
  --     pg_depend through the view's pg_rewrite rule to enumerate every
  --     relation it depends on, restricted to schemas core/core_build/raw
  --     (so we ignore pg_catalog and self-references). The only relation
  --     that must appear is core.lap_context_summary_mat. If the migration
  --     accidentally left the original aggregating view body in place, this
  --     set would instead include core.laps_enriched (now itself a facade
  --     over core.laps_enriched_mat) and the assertion would fail with the
  --     offending list in the error message.
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
    AND v.relname = 'lap_context_summary'
    AND tn.nspname IN ('core', 'core_build', 'raw')
    AND t.oid <> v.oid;
  IF facade_refs IS DISTINCT FROM ARRAY['core.lap_context_summary_mat']::text[] THEN
    RAISE EXCEPTION
      'expected core.lap_context_summary to be a thin facade over core.lap_context_summary_mat, but it references: %',
      facade_refs;
  END IF;
END $$;
SQL

# 3. Bidirectional, session-scoped EXCEPT ALL parity for the deterministic 3
#    analytic_ready sessions, PLUS a global rowcount equality check between
#    core_build.lap_context_summary and core.lap_context_summary_mat. Must
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
  SELECT count(*) INTO build_rows FROM core_build.lap_context_summary;
  SELECT count(*) INTO mat_rows   FROM core.lap_context_summary_mat;
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
      (SELECT * FROM core_build.lap_context_summary  WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core.lap_context_summary_mat    WHERE session_key = sess.session_key)
      UNION ALL
      (SELECT * FROM core.lap_context_summary_mat    WHERE session_key = sess.session_key
       EXCEPT ALL
       SELECT * FROM core_build.lap_context_summary  WHERE session_key = sess.session_key)
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
- [ ] `core.lap_context_summary_mat` exists as a base table with **exactly one** primary-key constraint whose columns, in order, are `(session_key, lap_number)` — gate #1 (`psql -f sql/018_lap_context_summary_mat.sql`) exits `0` and gate #2 exits `0` (its DO block raises unless `relkind = 'r'`, the table carries exactly one `pg_constraint` row with `contype = 'p'`, and the column array resolved via `array_position(c.conkey::int[], a.attnum::int)` is exactly `[session_key, lap_number]`).
- [ ] `core.lap_context_summary` exists as a view (the facade) — gate #2 exits `0` (the same DO block raises unless `relkind = 'v'`).
- [ ] `core.lap_context_summary` is a thin facade over `core.lap_context_summary_mat` — gate #2 exits `0` (the DO block's final assertion raises unless `pg_depend`-via-`pg_rewrite` reports `core.lap_context_summary_mat` as the **only** relation the view depends on within schemas `core` / `core_build` / `raw`; this is the check that distinguishes the facade swap from the original aggregating view body, which depended on `core.laps_enriched`).
- [ ] Global rowcount of `core.lap_context_summary_mat` equals the global rowcount of `core_build.lap_context_summary` — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'global rowcount mismatch …'` branch does not fire).
- [ ] Bidirectional `EXCEPT ALL` parity returns `0` for each of the 3 deterministic `analytic_ready` sessions selected per Steps §4 — gate #3 exits `0` (the DO block's `RAISE EXCEPTION 'parity drift …'` branch does not fire and the sub-3 session-count guard does not trigger).
- [ ] `psql --version` exits `0` (gate #0 — prerequisite check that `psql` is on PATH so gates #1–#3 can run).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The only files modified by this slice are `sql/018_lap_context_summary_mat.sql` (new) and `diagnostic/slices/03-lap-context-summary.md` (this slice file — frontmatter + Slice-completion note only; no plan-body edits beyond filling that section, no edits to prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes). No `.parity.sql` file, no `.ts` contract, no `.mjs` test, no edits to `sql/00[1-9]_*.sql` or `sql/01[0-7]_*.sql`, no application code — verified via `git diff --name-only integration/perf-roadmap...HEAD`.

## Out of scope
- Refresh helper / script and the per-session ingest hook (`DELETE … WHERE session_key = $1; INSERT … WHERE session_key = $1;` against `core.lap_context_summary_mat`) — later Phase 3 slice, per roadmap §4 Phase 3 steps 3 and 4. This slice ships only the migration-time `TRUNCATE` + bulk `INSERT … SELECT *`.
- Indexes on `core.lap_context_summary_mat` beyond the implicit unique btree on `(session_key, lap_number)` backing the PRIMARY KEY (Phase 4, profile-driven).
- Materializing the remaining hot contract `core.telemetry_lap_bridge` (later Phase 3 slice, per roadmap §4 priority order).
- Refresh strategy / cron decision (D-3, later phase).
- Cutover of any TypeScript runtime path (`web/src/lib/anthropic.ts`, `web/src/lib/queries.ts`, `web/src/lib/chatRuntime.ts`, `web/src/lib/deterministicSql.ts`) to read the matview through a new typed contract — deferred until a consumer actually needs it. The facade swap means existing callers transparently benefit from the materialized storage with no code change.

## Risk / rollback
- Risk: the facade swap could break public dependents of `core.lap_context_summary`. No SQL view in `core` / `core_build` / `raw` currently depends on it (it is a leaf in the source-definition graph; verified by grepping `sql/`), so the immediate dependent set is empty. Web callers (`web/src/lib/anthropic.ts`, `web/src/lib/queries.ts`, `web/src/lib/chatRuntime.ts`, `web/src/lib/deterministicSql.ts`) read it through the public view, so the facade swap is transparent at the SQL boundary. Mitigation: the swap uses `CREATE OR REPLACE VIEW`, not `DROP VIEW … CREATE VIEW` — Postgres's `CREATE OR REPLACE VIEW` rewrites the view body in place without disturbing dependents (current or future), provided the new query produces the same column names, types, and ordering as the existing view. Step 1.1 declares the storage table to mirror that signature exactly, so the rewrite is dependency-safe.
- Risk: column order or type mismatch between the new `_mat` table and the original public view would (a) cause `CREATE OR REPLACE VIEW` to fail with `cannot change name/type of view column …` and roll back the migration, or (b) silently shift the public column signature under `SELECT *`. Mitigation: the table's column declarations in step 1.1 are explicit and ordered to match `core.lap_context_summary` as defined in `sql/007_semantic_summary_contracts.sql:763` ff.; if the declarations diverge from the view, `CREATE OR REPLACE VIEW` rejects the migration in gate #1; gate #3's `EXCEPT ALL` parity is positional and type-strict, so any reordering or implicit type coercion that does slip past `CREATE OR REPLACE VIEW` still fails the gate.
- Risk: applying the migration on a database where slice `03-core-build-schema` has not yet been applied (no `core_build.lap_context_summary`). Mitigation: gate #1 fails non-zero with a clean `relation core_build.lap_context_summary does not exist` error and the transaction rolls back; the loop's slice ordering already merged `03-core-build-schema` at `67bdeff` and `03-laps-enriched-materialize` at `d2adddf` before this slice can ship.
- Risk: upstream grain drifts to non-unique on `(session_key, lap_number)`. Mitigation: the `PRIMARY KEY (session_key, lap_number)` constraint causes the bulk `INSERT … SELECT * FROM core_build.lap_context_summary` to abort with a clean PK violation, rolling back the whole transaction. The next deterministic-session parity gate would never run, so the slice fails loudly at gate #1.
- Rollback: `git revert <commit>` reverts the SQL file. To return the live DB to its pre-slice state after revert, no public DB dependent has to be preserved through the swap (the leaf-view property), but to keep the rollback path uniform with the precedent slices use `CREATE OR REPLACE VIEW` to swing `core.lap_context_summary`'s body off the `_mat` table and back to the original aggregating query, then drop the now-orphan storage table. Run inside one transaction. **Do NOT re-apply `sql/007_semantic_summary_contracts.sql`** as a shortcut: that file also defines `core.strategy_summary`, `core.race_progression_summary`, `core.pit_cycle_summary`, `core.strategy_evidence_summary`, `core.lap_phase_summary`, and other contracts that have since been materialized by their own slices and now exist as facade views over their own `_mat` tables; re-running `sql/007` would clobber those facade swaps and replace them with the original aggregating bodies, silently breaking the other materializations. Paste **only** the `CREATE OR REPLACE VIEW core.lap_context_summary AS …` body from `sql/007_semantic_summary_contracts.sql:763` ff. verbatim:
  ```sql
  BEGIN;
  -- Step 1: Restore core.lap_context_summary to its original aggregating body.
  -- Use CREATE OR REPLACE VIEW for symmetry with the forward migration and so
  -- that any future SQL view that comes to depend on this view is not
  -- disturbed. Paste ONLY the core.lap_context_summary view definition from
  -- sql/007_semantic_summary_contracts.sql:763 ff. verbatim — do NOT re-run
  -- the whole file, because that would also revert the facade swaps for
  -- core.strategy_summary, core.race_progression_summary,
  -- core.pit_cycle_summary, core.strategy_evidence_summary,
  -- core.lap_phase_summary, and other views that have since been materialized
  -- by later slices.
  CREATE OR REPLACE VIEW core.lap_context_summary AS
    -- … exact body copied from sql/007_semantic_summary_contracts.sql:763 ff. …
  ;
  -- Step 2: Drop the now-orphan storage table. This is safe ONLY after Step 1,
  -- because before Step 1 the public view's body still references
  -- core.lap_context_summary_mat and DROP TABLE would fail with
  -- "cannot drop table core.lap_context_summary_mat because other objects
  -- depend on it". After Step 1 nothing depends on the table.
  DROP TABLE IF EXISTS core.lap_context_summary_mat;
  COMMIT;
  ```

## Slice-completion note
(filled by Claude)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the `CREATE MATERIALIZED VIEW` plan with the Phase 3 contract-materialization shape already established by prior context: preserve `core_build.lap_context_summary` as the source-definition view and define the slice around the actual materialized contract object/facade the roadmap expects, or explicitly narrow the goal so it no longer claims to materialize the contract.
- [x] Add database gate commands that apply the SQL and verify object existence plus parity against the live query for 3 deterministic sessions; the current gate list only runs web commands and cannot prove the contract was created or matches source output.

### Medium
- [x] Expand `Changed files expected` to include the slice file itself for the required frontmatter and slice-completion-note edits, or explicitly state that audit-process edits are excluded from the scope list.
- [x] Make the acceptance criteria testable by naming the concrete contract object that must exist and by tying parity to a command or exit-0 gate rather than the generic statement "Parity test passes."
- [x] Specify how the parity-test sessions are chosen and what tool executes the parity check so the implementer has a reproducible DB-side procedure, including any `psql`/PATH prerequisite if that is the intended gate mechanism.

### Low
- [x] Clarify whether the TypeScript contract type is generated from the SQL contract shape or maintained manually so the step is auditable against stable column ordering.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current enough to use; no staleness note needed.
- The build-before-typecheck gate ordering already matches the current auditor note.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High

### Medium
- [x] Remove the stale `## Audit verdict` placeholder so the appended `## Plan-audit verdict (round N)` sections remain the slice's single audit-status surface.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current enough to use; no staleness note needed.
- Every path listed under `## Prior context` resolved on disk.
