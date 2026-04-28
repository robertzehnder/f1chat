---
slice_id: 04-perf-indexes-sql
phase: 4
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-28T10:00:00Z
---

## Goal
Add the schema-verified indexes from roadmap §4 Phase 4 to support common access patterns (driver+session+lap lookup on `raw.laps`, valid-lap and sector filters on `raw.laps`, stint-window joins on `raw.stints`, pit-in derivation on `raw.pit`, position-history time scans on `raw.position_history`). Slice is SQL-only: ship one numbered migration that creates the indexes with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, and prove the indexes exist and are picked by representative query plans via inline `psql` heredoc gates. Pre/post `EXPLAIN ANALYZE` capture and the per-benchmark p50/p95 delta belong to the sibling slice `04-explain-before-after`, not here.

## Decisions
- **Scope: `raw.*` indexes only.** The roadmap §4 Phase 4 bullet "Indexes on `core.*_mat` keyed by `(session_key, driver_number, …)` per Phase 3 grain" is already covered by the PRIMARY KEYs declared by every Phase 3 materialization slice (each `core.*_mat` declares a PK leading with `(session_key, driver_number, …)` per its grain — see `sql/009_driver_session_summary_mat.sql` … `sql/019_telemetry_lap_bridge_mat.sql`). Postgres uses the leading prefix of a btree PK for `(session_key)` and `(session_key, driver_number)` predicates, so no additional matview indexes are needed. Adding `(session_key, driver_number)` btrees on top of the existing PKs would be redundant storage for no plan-cost gain.
- **Numbered SQL filename `sql/020_perf_indexes.sql`.** The roadmap text suggests `sql/009_perf_indexes.sql`, but `sql/009_driver_session_summary_mat.sql` already occupies that slot. The next free integer after `sql/019_telemetry_lap_bridge_mat.sql` is `020`, so this slice ships `sql/020_perf_indexes.sql`. The sibling slice `04-explain-before-after` references `sql/perf_indexes.sql` in its current plan body; that sibling will pick up the rename in its own plan-revise round and is out of scope for this slice.
- **No `BEGIN; … COMMIT;` wrapper.** `CREATE INDEX CONCURRENTLY` cannot run inside an explicit transaction block — Postgres rejects it with `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. The migration ships as a series of `CREATE INDEX CONCURRENTLY IF NOT EXISTS …;` statements; gate #1 applies the file with `psql -f` (no `-1` / `--single-transaction`) so each statement runs in its own implicit transaction. This is a deliberate deviation from the Phase 3 materialization-slice pattern, which wraps the whole migration in `BEGIN; … COMMIT;`.
- **Index naming convention.** Each index name embeds the schema, table, and column-list intent (e.g. `idx_raw_laps_session_driver_lap`) so gate #2 can look the index up by name in `pg_indexes` without ambiguity.
- **EXPLAIN gate is inline `psql` heredoc, not a `.mjs` test.** Same rationale as the Phase 3 materialization-slice precedent (`03-strategy-evidence-summary`): one migration plus an inline `psql` heredoc check in the gate, no second-language test surface. The round-0 deliverable `web/scripts/tests/perf-indexes.test.mjs` is therefore removed from `Changed files expected`.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 4 — the schema-verified Phase 4 index list (also enumerated below in Steps §1).
- `sql/002_create_tables.sql` — column-level schema verification for the `raw.laps`, `raw.stints`, `raw.pit`, and `raw.position_history` tables.
- `sql/003_indexes.sql` — the existing 30-line Phase 0 index file (the Phase 4 list deliberately does not modify it; new indexes go in the new `020_*` file).

## Prior context
- `diagnostic/_state.md`
- `diagnostic/artifacts/perf/01-baseline-snapshot_2026-04-26.json` (pre-Phase-4 perf baseline; the post-Phase-4 perf delta is captured by the sibling slice `04-explain-before-after`, not in this slice).
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 4
- `diagnostic/slices/03-strategy-evidence-summary.md` (the pattern this slice's gate structure follows: inline `psql` heredoc gates, deterministic-session selector via `core.session_completeness`, `RAISE EXCEPTION` on assertion failure with `ON_ERROR_STOP=1`).

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have:
  - **The right to create indexes on the existing `raw.*` tables.** In Postgres, `CREATE INDEX` on a pre-existing table is gated by table-level authority, not schema-level `CREATE`: the role must either (a) own the target table, (b) be a member of the role that owns the target table, (c) have the `MAINTAIN` privilege on the table (Postgres ≥ 17), or (d) be a superuser. The schema-level `CREATE` privilege governs creating *new* relations under the schema and is **not** sufficient on its own to add an index to a table the role does not own. The loop's DB role on Neon already owns the `raw.*` tables (it created them via `sql/002_create_tables.sql`); if the role is rotated or this slice is replayed under a different role, that role must be granted membership in the table-owning role (or, on PG ≥ 17, `GRANT MAINTAIN ON TABLE raw.laps, raw.stints, raw.pit, raw.position_history TO <role>;`) before gate #1 will succeed. Failure surfaces as `must be owner of table <name>` and aborts gate #1 under `ON_ERROR_STOP=1`.
  - `USAGE` on schema `raw` and `SELECT` on `raw.laps`, `raw.stints`, `raw.pit`, `raw.position_history` (read access is needed for `EXPLAIN` to plan the queries — `EXPLAIN` without `ANALYZE` does not execute the query, but it still requires the same privileges as a regular `SELECT`).
  - `SELECT` on `core.session_completeness` (the deterministic-session selector for the EXPLAIN gate).
- **`CREATE INDEX CONCURRENTLY` constraint: cannot run inside an explicit transaction block.** The migration file ships as a series of statements with no `BEGIN; … COMMIT;` wrapper. Gate #1 invokes `psql -f sql/020_perf_indexes.sql` **without** `-1` / `--single-transaction`, so each statement runs in its own implicit transaction. `ON_ERROR_STOP=1` aborts the run on the first failure.
- **The target tables must already exist** in the database before this slice can run. The required prerequisite migrations are `sql/002_create_tables.sql` (which creates `raw.laps`, `raw.stints`, `raw.pit`, `raw.position_history`) and `sql/008_core_build_schema.sql` plus `sql/009_*.sql` … `sql/019_*.sql` (which establish `core.session_completeness` used by gate #3's deterministic-session selector). If a target raw table is missing, the corresponding `CREATE INDEX CONCURRENTLY` aborts with `relation … does not exist` and gate #1 exits non-zero. If `core.session_completeness` is missing, gate #3 aborts with the same kind of error.
- `psql` available on PATH for the gate commands below (same prerequisite as the Phase 3 materialization slices).

## Steps
1. Author `sql/020_perf_indexes.sql` listing one `CREATE INDEX CONCURRENTLY IF NOT EXISTS …;` statement per access pattern from roadmap §4 Phase 4, with a one-line `--` comment above each statement naming the access pattern it supports. No `BEGIN; … COMMIT;` wrapper. The exact statements (column lists schema-verified against `sql/002_create_tables.sql`):
   1. `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_laps_session_driver_lap ON raw.laps (session_key, driver_number, lap_number);` — driver+session+lap primary access pattern.
   2. `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_laps_session_include ON raw.laps (session_key) INCLUDE (lap_duration, is_pit_out_lap, duration_sector_1, duration_sector_2, duration_sector_3);` — index-only scans for valid-lap and sector filters. Schema-verified: `raw.laps` has `is_pit_out_lap` but **not** `is_pit_in_lap`, and **no compound column** (compound is on `raw.stints`); pit-in is derived from `raw.pit` at the semantic layer.
   3. `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_stints_session_driver_window ON raw.stints (session_key, driver_number, lap_start, lap_end) INCLUDE (compound);` — compound dimension and stint-window join key.
   4. `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_pit_session_driver_lap ON raw.pit (session_key, driver_number, lap_number);` — pit-in lap derivation.
   5. `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_position_history_session_date ON raw.position_history (session_key, date);` — position-history time scans.
   6. `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_laps_session_driver_valid_partial ON raw.laps (session_key, driver_number) WHERE lap_duration IS NOT NULL;` — partial index for the valid-lap filter.
2. Apply the migration via gate #1 (no `--single-transaction`; each `CREATE INDEX CONCURRENTLY` runs in its own implicit transaction).
3. Verify every declared index exists AND is valid by asserting `pg_index.indisvalid = true` for each of the six index names under schema `raw` — gate #2. (Pure-existence in `pg_indexes` is insufficient: a `CREATE INDEX CONCURRENTLY` that aborts mid-build leaves an INVALID index the planner will skip, so gate #3 could fall back to Seq Scan even though the index "exists".)
4. Run `EXPLAIN (FORMAT JSON)` on a deterministic set of representative queries (Q1–Q6 enumerated inline in gate #3, where Q3 is a real stint-window predicate `lap_start <= L AND lap_end >= L` and Q6 is a dedicated assertion that the partial index `idx_raw_laps_session_driver_valid_partial` is picked on its own) pinned to the first `analytic_ready` session selected by:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 1;
   ```
   Same deterministic-session pattern used by Phase 3 materialization slices, so the EXPLAINs always run against real data with stable cardinalities. Each plan must reference the corresponding new index name and must not contain `"Node Type": "Seq Scan"` against the parent table.
5. Run web gate commands to confirm no upstream code regressed (purely SQL change; these should ship green). Use `npm --prefix web …` so the three commands chain from one shell.
6. Capture command outputs into the slice-completion note.

## Changed files expected
Files the implementer will add or edit during this slice:
- `sql/020_perf_indexes.sql` (new — six `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statements per Steps §1, no `BEGIN; … COMMIT;` wrapper).
- `diagnostic/slices/04-perf-indexes-sql.md` (this file — frontmatter status/owner/timestamp transitions and the Slice-completion note only; no edits to the plan body or to any prior `## Plan-audit verdict` sections beyond ticking already-addressed checkboxes).

Pre-existing branch modification (NOT added by the implementer; carried in from a prior loop step):
- `diagnostic/_state.md` — an auditor-note commit already on `slice/04-perf-indexes-sql` (see commit `3d3eda2 [state-note] add auditor lesson for multi-index gates`). It will appear in `git diff --name-only integration/perf-roadmap...HEAD` but the implementer must NOT touch it during this slice.

No `web/scripts/tests/perf-indexes.test.mjs` (removed from scope per Decisions — the EXPLAIN check ships as inline `psql` heredoc in gate #3, matching the Phase 3 materialization-slice pattern). No edits to `sql/00[1-9]_*.sql` or `sql/01[0-9]_*.sql`. No application code.

## Artifact paths
None.

## Gate commands
```bash
set -euo pipefail

# 1. Apply the migration. CREATE INDEX CONCURRENTLY cannot run inside an
#    explicit transaction block, so DO NOT pass --single-transaction / -1.
#    Each statement runs in its own implicit transaction; ON_ERROR_STOP=1
#    aborts the run on the first failure.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql

# 2. Confirm every declared index exists AND is VALID. We check
#    pg_index.indisvalid (not just pg_indexes existence) because a
#    CREATE INDEX CONCURRENTLY that aborts mid-build leaves an INVALID
#    index that pg_indexes still lists; the planner skips invalid indexes,
#    so EXPLAIN gate #3 could fall back to Seq Scan even though the index
#    "exists". The DO block raises (and ON_ERROR_STOP=1 forces non-zero
#    exit) if any expected index is missing OR exists but is invalid.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  expected text[] := ARRAY[
    'idx_raw_laps_session_driver_lap',
    'idx_raw_laps_session_include',
    'idx_raw_stints_session_driver_window',
    'idx_raw_pit_session_driver_lap',
    'idx_raw_position_history_session_date',
    'idx_raw_laps_session_driver_valid_partial'
  ];
  idx text;
  is_valid bool;
BEGIN
  FOREACH idx IN ARRAY expected LOOP
    SELECT i.indisvalid
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'raw' AND c.relname = idx
    INTO is_valid;
    IF is_valid IS NULL THEN
      RAISE EXCEPTION 'expected index raw.% missing from pg_index', idx;
    END IF;
    IF NOT is_valid THEN
      RAISE EXCEPTION 'expected index raw.% exists but is INVALID (pg_index.indisvalid = false); drop and re-create with CREATE INDEX CONCURRENTLY', idx;
    END IF;
  END LOOP;
END $$;
SQL

# 3. EXPLAIN the representative query shapes from roadmap §4 Phase 4 against
#    the first analytic_ready session. Each plan must reference the
#    corresponding new index name and must not contain a Seq Scan on the
#    parent raw table. Q2 (valid-lap filter) accepts either the include-index
#    path or the partial-index path because both are legitimate plans for
#    that predicate. The DO block raises on any failure.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  s_key bigint;
  plan_text text;
  failures text := '';
BEGIN
  SELECT session_key INTO s_key
  FROM core.session_completeness
  WHERE completeness_status = 'analytic_ready'
  ORDER BY session_key ASC
  LIMIT 1;
  IF s_key IS NULL THEN
    RAISE EXCEPTION 'no analytic_ready session available for EXPLAIN gate';
  END IF;

  -- Q1: driver+session+lap lookup -> idx_raw_laps_session_driver_lap
  EXECUTE format($q$EXPLAIN (FORMAT JSON) SELECT * FROM raw.laps
                    WHERE session_key = %s AND driver_number = 1 AND lap_number = 1$q$, s_key)
    INTO plan_text;
  IF plan_text NOT LIKE '%idx_raw_laps_session_driver_lap%'
     OR plan_text LIKE '%"Node Type": "Seq Scan"%' THEN
    failures := failures || ' Q1';
  END IF;

  -- Q2: valid-lap + sector filter -> idx_raw_laps_session_include OR
  --     idx_raw_laps_session_driver_valid_partial (planner's choice).
  EXECUTE format($q$EXPLAIN (FORMAT JSON) SELECT lap_duration, is_pit_out_lap,
                      duration_sector_1, duration_sector_2, duration_sector_3
                    FROM raw.laps WHERE session_key = %s AND lap_duration IS NOT NULL$q$, s_key)
    INTO plan_text;
  IF (plan_text NOT LIKE '%idx_raw_laps_session_include%'
      AND plan_text NOT LIKE '%idx_raw_laps_session_driver_valid_partial%')
     OR plan_text LIKE '%"Node Type": "Seq Scan"%' THEN
    failures := failures || ' Q2';
  END IF;

  -- Q3: stint-window predicate that constrains a lap against
  --     raw.stints.lap_start / lap_end (the access pattern named in the Goal
  --     and Steps §1.3) -> idx_raw_stints_session_driver_window. The literal
  --     lap_number = 10 is hard-coded because EXPLAIN only plans the query;
  --     no row need actually match for the planner to pick the index.
  EXECUTE format($q$EXPLAIN (FORMAT JSON) SELECT compound
                    FROM raw.stints
                    WHERE session_key = %s
                      AND driver_number = 1
                      AND lap_start <= 10
                      AND lap_end   >= 10$q$, s_key)
    INTO plan_text;
  IF plan_text NOT LIKE '%idx_raw_stints_session_driver_window%'
     OR plan_text LIKE '%"Node Type": "Seq Scan"%' THEN
    failures := failures || ' Q3';
  END IF;

  -- Q4: pit-in lookup -> idx_raw_pit_session_driver_lap
  EXECUTE format($q$EXPLAIN (FORMAT JSON) SELECT * FROM raw.pit
                    WHERE session_key = %s AND driver_number = 1 AND lap_number = 10$q$, s_key)
    INTO plan_text;
  IF plan_text NOT LIKE '%idx_raw_pit_session_driver_lap%'
     OR plan_text LIKE '%"Node Type": "Seq Scan"%' THEN
    failures := failures || ' Q4';
  END IF;

  -- Q5: position history time scan -> idx_raw_position_history_session_date
  EXECUTE format($q$EXPLAIN (FORMAT JSON) SELECT * FROM raw.position_history
                    WHERE session_key = %s
                    ORDER BY date LIMIT 100$q$, s_key)
    INTO plan_text;
  IF plan_text NOT LIKE '%idx_raw_position_history_session_date%'
     OR plan_text LIKE '%"Node Type": "Seq Scan"%' THEN
    failures := failures || ' Q5';
  END IF;

  -- Q6: dedicated partial-index assertion. The query shape
  --     (session_key, driver_number, lap_duration IS NOT NULL) matches the
  --     partial index's predicate exactly, so the planner should pick
  --     idx_raw_laps_session_driver_valid_partial here. This is separate
  --     from Q2 (which accepts either lap index) so that an invalid or
  --     never-selected partial index cannot let gate #3 exit 0.
  EXECUTE format($q$EXPLAIN (FORMAT JSON) SELECT count(*)
                    FROM raw.laps
                    WHERE session_key = %s
                      AND driver_number = 1
                      AND lap_duration IS NOT NULL$q$, s_key)
    INTO plan_text;
  IF plan_text NOT LIKE '%idx_raw_laps_session_driver_valid_partial%'
     OR plan_text LIKE '%"Node Type": "Seq Scan"%' THEN
    failures := failures || ' Q6';
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'EXPLAIN gate failures (queries that did not pick the expected index or fell back to Seq Scan):%', failures;
  END IF;
END $$;
SQL

# 4. Web side regression safety. Use --prefix so the three commands chain from one shell.
npm --prefix web run build
npm --prefix web run typecheck
npm --prefix web run test:grading
```

## Acceptance criteria
- [ ] `sql/020_perf_indexes.sql` applies cleanly against the live DB — gate #1 (`psql -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql`) exits `0`.
- [ ] All six declared indexes exist under schema `raw` AND are valid (`pg_index.indisvalid = true`) — gate #2 exits `0` (the DO block raises if any of `idx_raw_laps_session_driver_lap`, `idx_raw_laps_session_include`, `idx_raw_stints_session_driver_window`, `idx_raw_pit_session_driver_lap`, `idx_raw_position_history_session_date`, `idx_raw_laps_session_driver_valid_partial` is missing **or** exists with `indisvalid = false`). The validity check is what guarantees `idx_raw_laps_session_include` is usable on its own even though gate #3's Q2 accepts either lap index.
- [ ] EXPLAIN against Q1–Q6 (gate #3, pinned to the deterministic first `analytic_ready` session from `core.session_completeness`) reports the corresponding new index name in the plan and does **not** contain `"Node Type": "Seq Scan"` — gate #3 exits `0`. Q2 accepts either `idx_raw_laps_session_include` or `idx_raw_laps_session_driver_valid_partial` (both are legitimate plans for the valid-lap predicate). Q3 uses a stint-window predicate (`lap_start <= L AND lap_end >= L`) that exercises the lap-range columns, not just the `(session_key, driver_number)` prefix. Q6 is a dedicated assertion that requires the partial index `idx_raw_laps_session_driver_valid_partial` specifically (so an invalid-but-named partial index cannot let the gate pass).
- [ ] `npm --prefix web run build` exits `0`.
- [ ] `npm --prefix web run typecheck` exits `0`.
- [ ] `npm --prefix web run test:grading` exits `0`.
- [ ] The set of files modified by this branch versus `integration/perf-roadmap` is exactly `sql/020_perf_indexes.sql` (new), `diagnostic/slices/04-perf-indexes-sql.md` (this slice file — frontmatter + Slice-completion note only), and `diagnostic/_state.md` (the pre-existing auditor-note commit already on `slice/04-perf-indexes-sql` — the implementer must NOT add or remove edits to this path). Verified via `git diff --name-only integration/perf-roadmap...HEAD`, which must produce exactly those three lines (and no others).

## Out of scope
- Pre/post `EXPLAIN (ANALYZE, BUFFERS)` capture for the top-N slowest benchmark queries and the per-benchmark p50/p95 delta — owned by the sibling slice `04-explain-before-after`.
- Indexes on `core.*_mat` tables — every Phase 3 materialization slice declared a PK leading with `(session_key, driver_number, …)` per its grain, so the leading-prefix property already covers `(session_key)` and `(session_key, driver_number)` predicates without redundant indexes (see Decisions).
- Indexes for query shapes the roadmap does not explicitly call out (no speculative coverage; the index list in Steps §1 is the schema-verified set in roadmap §4 Phase 4).
- Edits to `sql/003_indexes.sql` or any other existing migration — the Phase 4 indexes ship in a new `sql/020_*.sql` file.
- Application code (no edits to `web/src/lib/queries.ts`, `web/src/lib/chatRuntime.ts`, etc.).
- Refresh helpers, cron, or any non-DDL operational change.

## Risk / rollback
- Risk: an index name collision with a pre-existing index. Mitigation: every statement uses `IF NOT EXISTS`, so re-applying the migration is idempotent on the index name.
- Risk: a `CREATE INDEX CONCURRENTLY` build aborts mid-way (deadlock, session kill) and Postgres leaves an `INVALID` index on the table. The `IF NOT EXISTS` clause matches by name, so a follow-up apply does **not** retry the build. Gate #2 catches this directly: it asserts `pg_index.indisvalid = true` for every declared index, so an invalid index causes gate #2 to exit non-zero with the diagnostic `expected index raw.<name> exists but is INVALID`. Manual recovery: `DROP INDEX CONCURRENTLY raw.<name>;` then re-run gate #1.
- Risk: privilege denial on `CREATE INDEX`. Mitigation: see Required services / env above; gate #1 fails fast with `permission denied for table …` and the migration leaves the schema unchanged.
- Risk: `core.session_completeness` is missing or has zero `analytic_ready` sessions when gate #3 runs. Mitigation: gate #3's `IF s_key IS NULL THEN RAISE EXCEPTION` branch fires with a clear diagnostic; the prerequisite (Phase 3 materialization migrations applied) is documented in Required services / env.
- Rollback: `git revert <commit>` reverts the SQL file. To remove the indexes from the live DB after revert, run `DROP INDEX CONCURRENTLY IF EXISTS raw.<name>;` for each of the six indexes. `DROP INDEX CONCURRENTLY` (like `CREATE INDEX CONCURRENTLY`) cannot run inside an explicit transaction block, so issue each `DROP` as its own statement (no `BEGIN; … COMMIT;`).

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Replace the web-only gate list with DB-backed gate commands that actually validate this slice's acceptance criteria, including applying/parsing `sql/perf_indexes.sql` against the target database and running the EXPLAIN checks for the indexed query shapes.
- [x] Add the missing artifact or exact source for the "representative queries from the catalog" so the EXPLAIN step and acceptance criteria are reproducible instead of relying on an undefined catalog.

### Medium
- [x] Fix the `## Prior context` block because `diagnostic/artifacts/perf/01-baseline-snapshot-v2_2026-04-26.json` does not exist in the worktree.
- [x] Reconcile `## Steps` with `## Changed files expected` by explicitly planning the test artifact under `web/scripts/tests/perf-indexes.test.mjs` or removing it from expected changes if the slice is SQL-only.

### Low
- [x] Clarify the required DB state for `CREATE INDEX CONCURRENTLY`, including that the gate must run outside a transaction against a database where the target tables already exist.

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T04:35:20Z, so no stale-state note is needed this round.

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace Q3 in gate #3 with an actual stint-window predicate or join shape that constrains a lap against `raw.stints.lap_start` / `lap_end`, so the plan verifies the access pattern named in the Goal and in Steps §1.3 instead of only re-testing the `(session_key, driver_number)` prefix of the index.
- [x] Add a dedicated gate assertion that proves `idx_raw_laps_session_driver_valid_partial` is usable on its own; the current Q2 check accepts either lap index, so gate #3 can exit `0` even if the partial index is invalid or never selected.

### Medium
- [x] Correct `## Required services / env` to state the real privilege prerequisite for creating indexes on existing `raw.*` tables; `CREATE` on schema `raw` is not sufficient by itself for `CREATE INDEX CONCURRENTLY` on those tables.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` remains fresh enough to use without a stale-state note this round.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Add a dedicated assertion for `idx_raw_laps_session_include` or require `pg_index.indisvalid = true` for every declared index; as written, gate #2 accepts invalid indexes and gate #3 never requires `idx_raw_laps_session_include`, so this slice can pass with a broken declared index.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T04:35:20Z, so no stale-state note is needed this round.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High

### Medium
- [x] Reconcile the changed-files scope with the branch's existing `diagnostic/_state.md` diff against `integration/perf-roadmap`; either allow that path in `## Changed files expected` and the final diff acceptance check, or redefine the verification so the implementer is not blocked by a prior auditor note commit already on this slice branch.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was updated on 2026-04-28T04:35:20Z, so no stale-state note is needed this round.
