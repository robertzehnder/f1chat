---
slice_id: 03-core-build-schema
phase: 3
status: pending_plan_audit
owner: codex
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T14:10:05Z
---

## Goal
Bootstrap the `core_build` schema and clone the *current* aggregating SELECT of every hot semantic view as a `core_build.<name>` source-definition view. This realizes Phase 3 step 1 only — the canonical query is preserved before any downstream slice replaces a public `core.<name>` view with a thin facade over a `core.<name>_mat` table. **No materialized views, no `_mat` storage tables, no refresh, and no public-view facade swap are in scope here** — those each have dedicated slices (e.g. `03-driver-session-summary-prototype`, `03-laps-enriched-materialize`, …).

## Decisions
- **Scope narrowed to option (b) of the round-1 audit.** Source-definition views only. Materialization, `_mat` tables, ingest hooks, and facade swap are explicitly punted to per-contract slices, in line with the roadmap's "prototype before scaling out" sequencing.
- Hot view list comes from the roadmap §4 Phase 3 prototype (`core.driver_session_summary`) plus the scale-out priority list (`laps_enriched`, `stint_summary`, `strategy_summary`, `race_progression_summary`, `grid_vs_finish`, `pit_cycle_summary`, `strategy_evidence_summary`, `lap_phase_summary`, `lap_context_summary`, `telemetry_lap_bridge`). Each gets a `core_build.<name>` view with the identical SELECT body and column ordering as the current `core.<name>` view.
- The names `core.lap_clean`, `core.session_summary`, `core.driver_summary` from the round-1 plan were placeholders that do not exist in `sql/004..007`. They have been replaced with the actual hot contract names.

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 (source-definition strategy + scale-out priority list)
- `sql/006_semantic_lap_layer.sql` (current `core.laps_enriched` definition)
- `sql/007_semantic_summary_contracts.sql` (current definitions for the remaining hot contracts)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop must have `CREATE` on the database (to add the `core_build` schema) and `USAGE`/`SELECT` on `raw.*` and `core.*` (so the cloned SELECTs resolve). No `MATERIALIZED VIEW` privilege is needed in this slice.
- `psql` available on PATH for the gate commands below.

## Steps
1. Add `sql/008_core_build_schema.sql`:
   - `CREATE SCHEMA IF NOT EXISTS core_build;`
   - For each hot contract listed in **Decisions**, emit `CREATE OR REPLACE VIEW core_build.<name> AS <SELECT body of core.<name>>` with stable column ordering matching the current `core.<name>` view. Preserve the original SELECT verbatim **except** for these two rewrites:
     1. The schema-qualified name on the `CREATE` line (`core.<name>` → `core_build.<name>`).
     2. Any reference inside the SELECT body to another hot contract in **Decisions** (e.g. `core.laps_enriched`, `core.stint_summary`) is rewritten to its `core_build.*` counterpart. References to non-hot relations (`raw.*`, helper/internal views not in the hot list, lookup tables) remain unchanged.
     The intent of rewrite #2 is that the `core_build.*` source-definition graph is closed under itself for hot contracts, so when later materialization slices replace public `core.<name>` with a facade over `core.<name>_mat`, refreshing `core.<name>_mat` via `INSERT … SELECT * FROM core_build.<name>` does not read its own (potentially stale) materialized output. The parity check in gate command #3 still holds at this slice because `core_build.<x>` and `core.<x>` are set-wise identical at the moment of this slice. A future audit can confirm semantic non-drift by diffing each `core_build.<name>` SELECT against the original `core.<name>` SELECT after applying the same two rewrites.
   - Emit the eleven `CREATE OR REPLACE VIEW` statements in this **dependency-safe order** (topological sort over the hot-contract `core_build.*` references introduced by rewrite #2). Postgres does not allow forward references between non-temporary views, so any other order will fail with `relation "core_build.<x>" does not exist` during apply:
     1. `core_build.laps_enriched` — no hot-contract deps (depends only on `core.lap_semantic_bridge`, `core.valid_lap_policy`, which are non-hot and stay `core.*`).
     2. `core_build.grid_vs_finish` — no hot-contract deps (only `core.sessions`, `core.session_drivers`, `raw.*`).
     3. `core_build.stint_summary` — depends on `core_build.laps_enriched` (1).
     4. `core_build.strategy_summary` — depends on `core_build.stint_summary` (3).
     5. `core_build.race_progression_summary` — depends on `core_build.laps_enriched` (1).
     6. `core_build.lap_phase_summary` — depends on `core_build.laps_enriched` (1).
     7. `core_build.lap_context_summary` — depends on `core_build.laps_enriched` (1).
     8. `core_build.telemetry_lap_bridge` — depends on `core_build.laps_enriched` (1).
     9. `core_build.driver_session_summary` — depends on `core_build.laps_enriched` (1), `core_build.strategy_summary` (4), `core_build.grid_vs_finish` (2).
     10. `core_build.pit_cycle_summary` — depends on `core_build.strategy_summary` (4), `core_build.race_progression_summary` (5), `core_build.laps_enriched` (1).
     11. `core_build.strategy_evidence_summary` — depends on `core_build.pit_cycle_summary` (10).
   - Wrap the file in a single `BEGIN; … COMMIT;` so partial application cannot leave the schema half-built.
2. Apply the SQL to the database referenced by `DATABASE_URL` (gate command #1 below).
3. Verify schema and view existence (gate command #2).
4. For each hot contract, run a bidirectional, session-scoped, multiplicity-preserving parity check between `core_build.<name>` and `core.<name>` for **3 deterministic sessions** selected as:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
   Parity SQL per contract per `session_key`:
   ```sql
   SELECT count(*) AS diff_rows FROM (
     (SELECT * FROM core_build.<name> WHERE session_key = $1
      EXCEPT ALL
      SELECT * FROM core.<name>           WHERE session_key = $1)
     UNION ALL
     (SELECT * FROM core.<name>           WHERE session_key = $1
      EXCEPT ALL
      SELECT * FROM core_build.<name> WHERE session_key = $1)
   ) AS diff;
   ```
   `diff_rows` must be `0` for every (contract, session_key) pair. `EXCEPT ALL` (not plain `EXCEPT`) is mandatory per roadmap §4 Phase 3 step 5 so duplicate-row drift is preserved for non-unique-grain contracts (`laps_enriched`, etc.).
5. Run web gate commands to confirm no upstream code regressed (the SQL change is additive and these should be untouched, but we still run them so the slice ships green).
6. Capture command outputs into the slice-completion note.

## Changed files expected
- `sql/008_core_build_schema.sql` (new — schema + eleven source-definition views)
- `diagnostic/slices/03-core-build-schema.md` (this file — frontmatter + slice-completion note)

No separate parity SQL file, no TypeScript contract files, no parity test `.mjs` files, no application code, and no edits to existing `sql/00[1-7]_*.sql` are expected. The parity check is run as an inline heredoc in gate command #3 (see below). If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Gate commands
```bash
# 1. Apply the schema migration. Must exit 0.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/008_core_build_schema.sql

# 2. Confirm the schema and all eleven views exist. Fails non-zero (via
#    RAISE EXCEPTION + ON_ERROR_STOP=1) unless the count is exactly 11.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.views
  WHERE table_schema = 'core_build'
    AND table_name IN (
      'driver_session_summary','laps_enriched','stint_summary','strategy_summary',
      'race_progression_summary','grid_vs_finish','pit_cycle_summary',
      'strategy_evidence_summary','lap_phase_summary','lap_context_summary',
      'telemetry_lap_bridge'
    );
  IF n <> 11 THEN
    RAISE EXCEPTION 'expected 11 core_build views, found %', n;
  END IF;
END $$;
SQL

# 3. Pick 3 analytic-ready sessions and run bidirectional EXCEPT ALL parity for every
#    (contract, session_key) pair as an inline heredoc. Must exit 0; the block
#    fails non-zero if (a) fewer than 3 analytic_ready sessions are available, or
#    (b) any (contract, session_key) pair reports diff_rows > 0. Implementation MUST
#    keep this inline — no separate parity SQL file.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
\set ON_ERROR_STOP on
DO $$
DECLARE
  contracts text[] := ARRAY[
    'driver_session_summary','laps_enriched','stint_summary','strategy_summary',
    'race_progression_summary','grid_vs_finish','pit_cycle_summary',
    'strategy_evidence_summary','lap_phase_summary','lap_context_summary',
    'telemetry_lap_bridge'
  ];
  sess record;
  c text;
  diff bigint;
  sess_count int;
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
  FOR sess IN
    SELECT session_key
    FROM core.session_completeness
    WHERE completeness_status = 'analytic_ready'
    ORDER BY session_key ASC
    LIMIT 3
  LOOP
    FOREACH c IN ARRAY contracts LOOP
      EXECUTE format($f$
        SELECT count(*) FROM (
          (SELECT * FROM core_build.%1$I WHERE session_key = $1
           EXCEPT ALL
           SELECT * FROM core.%1$I        WHERE session_key = $1)
          UNION ALL
          (SELECT * FROM core.%1$I        WHERE session_key = $1
           EXCEPT ALL
           SELECT * FROM core_build.%1$I WHERE session_key = $1)
        ) d
      $f$, c) INTO diff USING sess.session_key;
      IF diff <> 0 THEN
        RAISE EXCEPTION 'parity drift: contract=% session_key=% diff_rows=%',
          c, sess.session_key, diff;
      END IF;
    END LOOP;
  END LOOP;
END $$;
SQL

# 4. Web side (no code change expected, but run for regression safety). Use
#    --prefix so the three commands chain from a single shell without nested cds.
npm --prefix web run build
npm --prefix web run typecheck
npm --prefix web run test:grading
```

## Acceptance criteria
- [ ] `core_build` schema exists.
- [ ] All eleven `core_build.<name>` views in **Decisions** exist — gate command #2 exits `0` (its DO block raises `RAISE EXCEPTION` and ON_ERROR_STOP=1 forces a non-zero exit unless the count of matching `information_schema.views` rows is exactly `11`; the block does not return the integer `11` itself).
- [ ] For each hot contract in **Decisions**, the bidirectional `EXCEPT ALL` parity check returns `0` for **each** of the 3 deterministic `analytic_ready` sessions selected by the query in step 4.
- [ ] `npm --prefix web run build`, `npm --prefix web run typecheck`, and `npm --prefix web run test:grading` all exit 0.
- [ ] The only files modified by this slice are `sql/008_core_build_schema.sql` (new) and `diagnostic/slices/03-core-build-schema.md` (this slice file — frontmatter + Slice-completion note only; no body edits beyond filling that section). The parity check is an inline heredoc in gate command #3 — no `.parity.sql` file is permitted.

## Out of scope
- `core.<name>_mat` storage tables (each contract's own slice).
- Refresh script `src/refresh_summaries.py` (later Phase 3 slice).
- Replacing public `core.<name>` views with thin `SELECT * FROM core.<name>_mat` facades (per-contract slices).
- Ingest hook integration in `src/ingest.py` (later Phase 3 slice).
- Indexes on `core.*_mat` (Phase 4).
- Refresh strategy / cron decision (D-3, later phase).

## Risk / rollback
- Risk: a `core_build.<name>` view that drifts from its `core.<name>` source would silently propagate divergence to every downstream materialize slice. Mitigated by the bidirectional `EXCEPT ALL` parity check in the gate; any drift surfaces as `diff_rows > 0` and fails the slice.
- Risk: the role used by the loop lacks `CREATE` on the database. Mitigated by the explicit env note above; failure mode is a clean `psql` error, not partial state, because the migration is wrapped in a transaction.
- Rollback: `git revert <commit>` reverts the SQL file. To remove the schema from the live DB after revert: `DROP SCHEMA core_build CASCADE;` (safe — nothing else depends on `core_build` until later slices land).

## Slice-completion note
(filled by Claude)

## Audit verdict
_Pending implementation. Filled by Codex post-implementation (PASS / FAIL). Plan-audit
status lives in the appended `## Plan-audit verdict (round N)` sections below — do not
conflate the two._

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Align the plan with the roadmap's Phase 3 architecture: use `core_build.<name>` as preserved source-definition views plus `core.<name>_mat` real tables and a public facade, or explicitly narrow this slice to source-definition views only; do not require `MATERIALIZED VIEW` objects or `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- [x] Add executable DB gate commands that apply the SQL and verify the acceptance criteria, including rowcount and parity checks against at least three session keys; the current gate list only runs web build/typecheck/tests and cannot prove the database objects exist.
- [x] Expand `Changed files expected` to include every file implied by the steps, including the TypeScript contract file and parity test file, or remove those steps from this slice.

### Medium
- [x] Correct the target relation names and schema qualification so they match the existing semantic layer and Phase 3 roadmap; `core.session_summary`, `core.driver_summary`, and `core.lap_clean` are not referenced elsewhere, while the hot existing contract is `core.driver_session_summary`.
- [x] Specify how the three parity-test sessions are selected, preferably from `core.session_completeness` analytic-ready sessions, so the test is deterministic and reproducible.

### Low
- [x] Replace the self-reference in `## Prior context` with the roadmap Phase 3 section or relevant benchmark/perf artifacts, since listing this slice as its own prior context adds no audit value.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T05:12:12Z`).

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Reconcile the hot-contract count everywhere: the Decisions list and SQL definitions contain eleven views, but Steps/Changed files/Gate command #2 say ten and gate #2 expects rowcount `10`; make the list, prose, SQL existence query, and expected rowcount all agree.
- [x] Rewrite the web gate commands so they can be executed in the listed order from one shell without failing on `cd web` after the first command, for example by using `npm --prefix web ...` or a single subshell.

### Medium
- [x] Add `sql/008_core_build_schema.parity.sql` to `Changed files expected` when the gate references it as the default parity command, or make the gate explicitly require an inline heredoc and remove the optional file allowance from Acceptance criteria.

### Low
- [x] Remove or fill the stale `## Audit verdict` placeholder so the appended `## Plan-audit verdict` sections remain the single source of audit status.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T05:12:12Z`).
- Prior context path `diagnostic/roadmap_2026-04_performance_and_upgrade.md` exists and was consulted for Phase 3 source-definition sequencing.

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Make gate command #2 fail non-zero unless exactly all eleven expected `core_build` views exist; the current `SELECT count(*)` exits 0 even when the count is not `11`.
- [x] Make gate command #3 fail non-zero unless the deterministic session selector returns exactly 3 `analytic_ready` sessions; the current DO block silently passes if it loops over fewer than 3 sessions.

### Medium
- [x] Reconcile the scope rule for the slice file itself: `Changed files expected` includes `diagnostic/slices/03-core-build-schema.md`, but Acceptance criteria currently says no file outside `sql/008_core_build_schema.sql` is modified.

### Low
- [x] Clarify whether "verbatim SELECT body" should preserve dependencies on `core.*` views or rewrite hot-contract dependencies to `core_build.*`, so later materialization slices do not have to infer the intended source-definition dependency graph.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T05:12:12Z`).
- Prior context path `diagnostic/roadmap_2026-04_performance_and_upgrade.md` exists and was consulted for Phase 3 source-definition sequencing.

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Specify a dependency-safe `CREATE OR REPLACE VIEW` order for `sql/008_core_build_schema.sql` after hot-contract references are rewritten to `core_build.*`, so no view is created before another `core_build` view it references.

### Medium
- [x] Reword the Acceptance criteria for gate command #2 to say the command exits 0 after verifying exactly eleven views exist, because the current DO block does not return the value `11`.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T05:12:12Z`).
- Prior context path `diagnostic/roadmap_2026-04_performance_and_upgrade.md` exists and was consulted for Phase 3 source-definition sequencing.
