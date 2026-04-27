---
slice_id: 03-laps-enriched-grain-discovery
phase: 3
status: revising_plan
owner: claude
user_approval_required: no
created: 2026-04-26
updated: 2026-04-27T15:22:16Z
---

## Goal
Discover and document the canonical grain (one-row-per-X) of `core.laps_enriched` via SQL discovery queries, and capture the chosen grain plus a recommendation for the future materialization slice (`03-laps-enriched-materialize`). **Output is documentation only.** No SQL objects, no TypeScript contracts, no application code, and no materialized views are created here — those are explicitly deferred to dedicated downstream slices per the same sequencing decision made in `03-core-build-schema`.

## Decisions
- **Scope is documentation-only.** Per `03-core-build-schema` (round-1 audit decision) and roadmap §4 Phase 3, materialization, `_mat` tables, refresh, and facade swap are each their own slice. This slice produces a single grain note.
- **Why grain discovery is its own slice.** Roadmap §4 Phase 3 step 2 ("Discover and assert grain before defining keys") cites a verified counterexample: `core.laps_enriched` has 167,172 rows but only 159,793 distinct `(session_key, driver_number, lap_number)`. A naive PK on that triple would fail at table-create time. Materialization slices need this grain decision as a prerequisite — without it the `_mat` table cannot define indexes or refresh strategy.
- **Deliverable shape.** A markdown note at `diagnostic/notes/03-laps-enriched-grain.md` containing (a) raw discovery numbers, (b) the chosen canonical grain (a column tuple, possibly with a discriminator), (c) reasoning, and (d) the implication for the future `core.laps_enriched_mat` (PK column list, OR "non-unique heap with indexes + delete-then-insert refresh").

## Inputs
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3 step 2 (grain-discovery requirement, naive-PK counterexample)
- `sql/006_semantic_lap_layer.sql` (current `core.laps_enriched` definition)

## Prior context
- `diagnostic/_state.md`
- `diagnostic/roadmap_2026-04_performance_and_upgrade.md` §4 Phase 3
- `diagnostic/slices/03-core-build-schema.md` (parent slice — established the source-definition view `core_build.laps_enriched`; defines the precedent that grain discovery is documentation-only and materialization is per-contract)

## Required services / env
- `DATABASE_URL` (Neon Postgres). The role used by the loop needs `USAGE` on `core` and `SELECT` on `core.laps_enriched`, `core.session_completeness`. **No** `CREATE` privilege and **no** `MATERIALIZED VIEW` privilege is required by this slice — gate commands are read-only `SELECT`s.
- `psql` available on PATH for the gate commands below.

## Steps
1. Pick three deterministic `analytic_ready` sessions for per-session grain probes using the same selector as `03-core-build-schema` gate #3:
   ```sql
   SELECT session_key
   FROM core.session_completeness
   WHERE completeness_status = 'analytic_ready'
   ORDER BY session_key ASC
   LIMIT 3;
   ```
2. Run the global grain-discovery probe (gate command #1 below): total rows of `core.laps_enriched` and distinct `(session_key, driver_number, lap_number)` count. The *expected* result per the roadmap is `total_rows > distinct_triple` (multiplicity drift exists). The gate captures both numbers and the delta but does not fail on `total_rows != distinct_triple` — that inequality *is* the finding the slice exists to record.
3. For each of the three deterministic sessions, run the per-session grain probe (gate command #2 below): rows, distinct triples, and the column distributions that most plausibly disambiguate duplicates. The candidate discriminator columns are fixed for the duration of this slice and are exactly the columns named in gate #2: `stint_number`, `compound_name`, `compound_raw`, `is_pit_out_lap`, `is_pit_lap`, `is_valid`, `is_personal_best_proxy`. These are all columns projected by `core.laps_enriched` per `sql/006_semantic_lap_layer.sql`. Capture raw counts verbatim.
4. Run the global candidate-grain probe (gate command #3 below). This computes `count(DISTINCT …)` for every candidate 4-tuple `(session_key, driver_number, lap_number, <discriminator>)` and selected 5-tuples over the entire `core.laps_enriched` relation, so any PK recommendation in the note is justified by every-row evidence rather than three-session sampling.
5. Inspect the captured numbers and choose the canonical grain. The decision tree (recorded explicitly in the note):
   - **PK-eligibility rule.** A candidate column tuple is PK-eligible only if (a) gate #3 reports it as fully unique across all rows (`distinct_*tuple = total_rows`) AND (b) every column in the tuple has `null_count_<column> = 0` per gate #3's nullability probes. PostgreSQL forbids NULL in any PK column, so a nullable-but-otherwise-unique tuple cannot be promoted to PK as-is.
   - If a 4-tuple `(session_key, driver_number, lap_number, <discriminator>)` is PK-eligible → canonical grain = that 4-tuple; future `core.laps_enriched_mat` gets a PK on that 4-tuple.
   - Else if a 5-tuple is PK-eligible → canonical grain = that 5-tuple; future `core.laps_enriched_mat` gets a PK on that 5-tuple.
   - Else if a candidate tuple is fully unique but has one or more nullable columns, the note may recommend either (i) a non-PK heap-with-indexes strategy (default), OR (ii) a PK on an explicitly NULL-replaced/coalesced derived column (e.g., `stint_number_pk = COALESCE(stint_number, -1)`). In case (ii), the note must record the coalesce expression and sentinel value verbatim, plus a one-sentence justification that the sentinel cannot collide with any real value, so the materialize slice can implement it without re-deciding.
   - Else (no candidate tuple is fully unique) → canonical grain is non-unique; future `core.laps_enriched_mat` is a heap-with-indexes (no PK) with delete-then-insert refresh per `session_key`, per roadmap §4 Phase 3.
6. Write `diagnostic/notes/03-laps-enriched-grain.md` with the four required sections (Decisions §3): raw numbers, chosen grain, reasoning, recommendation for the materialize slice. Quote the SQL probes verbatim so they are reproducible.
7. Run web regression gates (gate command #4 below). The slice does not touch web code; these are run for regression safety only.
8. Capture all gate command outputs into the slice-completion note.

## Changed files expected
- `diagnostic/notes/03-laps-enriched-grain.md` (new — grain note, four sections)
- `diagnostic/slices/03-laps-enriched-grain-discovery.md` (this file — frontmatter + slice-completion note only; no body edits beyond filling that section)

No SQL files, no TypeScript files, no test files, no application code. If implementation finds it must touch any other path, that is a scope alarm and should be flagged in the slice-completion note before submission.

## Artifact paths
None.

## Gate commands
```bash
# 1. Global grain-discovery probe. Must exit 0. Captures both numbers; the inequality
#    total_rows > distinct_triple is the expected finding (it is what motivates this
#    slice), so the gate does not raise on inequality. Implementer copies the printed
#    numbers verbatim into the grain note.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'total_rows' AS metric, count(*)::text AS value FROM core.laps_enriched
UNION ALL
SELECT 'distinct_triple',
       count(*)::text
  FROM (SELECT DISTINCT session_key, driver_number, lap_number FROM core.laps_enriched) d
UNION ALL
SELECT 'duplicate_rows',
       ((SELECT count(*) FROM core.laps_enriched)
        - (SELECT count(*) FROM (SELECT DISTINCT session_key, driver_number, lap_number FROM core.laps_enriched) d))::text;
SQL

# 2. Per-session grain probe over the three deterministic analytic_ready sessions.
#    Must exit 0. Hard-fails non-zero if fewer than 3 analytic_ready sessions are
#    available (same gating rule as 03-core-build-schema gate #3). For each session
#    it prints (session_key, total_rows, distinct_triple, duplicate_rows) plus, when
#    duplicates exist, the row counts grouped by candidate discriminator columns so
#    the implementer can pick the canonical grain. The candidate column list is
#    fixed (matches the columns projected by core.laps_enriched in
#    sql/006_semantic_lap_layer.sql); it must not be edited during implementation.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  sess record;
  sess_count int;
  total bigint; distinct_t bigint; dups bigint;
BEGIN
  SELECT count(*) INTO sess_count FROM (
    SELECT session_key
    FROM core.session_completeness
    WHERE completeness_status = 'analytic_ready'
    ORDER BY session_key ASC
    LIMIT 3
  ) s;
  IF sess_count <> 3 THEN
    RAISE EXCEPTION
      'expected 3 analytic_ready sessions for grain probe, found %', sess_count;
  END IF;

  FOR sess IN
    SELECT session_key
    FROM core.session_completeness
    WHERE completeness_status = 'analytic_ready'
    ORDER BY session_key ASC
    LIMIT 3
  LOOP
    SELECT count(*) INTO total
      FROM core.laps_enriched WHERE session_key = sess.session_key;
    SELECT count(*) INTO distinct_t FROM (
      SELECT DISTINCT session_key, driver_number, lap_number
      FROM core.laps_enriched WHERE session_key = sess.session_key
    ) d;
    dups := total - distinct_t;

    RAISE NOTICE 'session_key=% total=% distinct_triple=% duplicate_rows=%',
      sess.session_key, total, distinct_t, dups;

    IF dups > 0 THEN
      -- Print per-discriminator row counts for the duplicate-bearing rows so the
      -- note can record which column(s) disambiguate. Columns are taken from
      -- core.laps_enriched as defined in sql/006_semantic_lap_layer.sql.
      RAISE NOTICE
        'session_key=% candidate-discriminator distribution (column, distinct_with_column, dup_after_column):',
        sess.session_key;
      RAISE NOTICE '  stint_number → distinct=%, dup_after=%',
        (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, stint_number
           FROM core.laps_enriched WHERE session_key = sess.session_key) d),
        total - (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, stint_number
           FROM core.laps_enriched WHERE session_key = sess.session_key) d);
      RAISE NOTICE '  compound_name → distinct=%, dup_after=%',
        (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, compound_name
           FROM core.laps_enriched WHERE session_key = sess.session_key) d),
        total - (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, compound_name
           FROM core.laps_enriched WHERE session_key = sess.session_key) d);
      RAISE NOTICE '  compound_raw → distinct=%, dup_after=%',
        (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, compound_raw
           FROM core.laps_enriched WHERE session_key = sess.session_key) d),
        total - (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, compound_raw
           FROM core.laps_enriched WHERE session_key = sess.session_key) d);
      RAISE NOTICE '  is_pit_out_lap → distinct=%, dup_after=%',
        (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_pit_out_lap
           FROM core.laps_enriched WHERE session_key = sess.session_key) d),
        total - (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_pit_out_lap
           FROM core.laps_enriched WHERE session_key = sess.session_key) d);
      RAISE NOTICE '  is_pit_lap → distinct=%, dup_after=%',
        (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_pit_lap
           FROM core.laps_enriched WHERE session_key = sess.session_key) d),
        total - (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_pit_lap
           FROM core.laps_enriched WHERE session_key = sess.session_key) d);
      RAISE NOTICE '  is_valid → distinct=%, dup_after=%',
        (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_valid
           FROM core.laps_enriched WHERE session_key = sess.session_key) d),
        total - (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_valid
           FROM core.laps_enriched WHERE session_key = sess.session_key) d);
      RAISE NOTICE '  is_personal_best_proxy → distinct=%, dup_after=%',
        (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_personal_best_proxy
           FROM core.laps_enriched WHERE session_key = sess.session_key) d),
        total - (SELECT count(*) FROM (
           SELECT DISTINCT session_key, driver_number, lap_number, is_personal_best_proxy
           FROM core.laps_enriched WHERE session_key = sess.session_key) d);
    END IF;
  END LOOP;
END $$;
SQL

# 3. Global candidate-grain + nullability probe. Must exit 0. Computes count(*),
#    count(DISTINCT …) over every candidate 4-tuple
#    (session_key, driver_number, lap_number, <discriminator>) plus the most
#    plausible 5-tuple combinations, AND a per-column NULL count for every
#    column that could appear in a candidate PK tuple, all evaluated across
#    every row of core.laps_enriched. The NULL counts are required because a
#    PostgreSQL PK forbids NULL in any of its columns, so the recommendation
#    in the grain note must consider both uniqueness and non-null. The
#    discriminator list matches gate #2.
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'total_rows' AS metric, count(*)::text AS value FROM core.laps_enriched
UNION ALL
SELECT 'distinct_triple',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_4tuple_with_stint_number',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, stint_number
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_4tuple_with_compound_name',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, compound_name
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_4tuple_with_compound_raw',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, compound_raw
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_4tuple_with_is_pit_out_lap',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, is_pit_out_lap
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_4tuple_with_is_pit_lap',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, is_pit_lap
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_4tuple_with_is_valid',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, is_valid
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_4tuple_with_is_personal_best_proxy',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, is_personal_best_proxy
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_5tuple_with_stint_and_compound_name',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, stint_number, compound_name
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_5tuple_with_stint_and_is_pit_out_lap',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, stint_number, is_pit_out_lap
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'distinct_5tuple_with_stint_and_is_pit_lap',
       count(*)::text FROM (
         SELECT DISTINCT session_key, driver_number, lap_number, stint_number, is_pit_lap
         FROM core.laps_enriched
       ) d
UNION ALL
SELECT 'null_count_session_key',
       count(*)::text FROM core.laps_enriched WHERE session_key IS NULL
UNION ALL
SELECT 'null_count_driver_number',
       count(*)::text FROM core.laps_enriched WHERE driver_number IS NULL
UNION ALL
SELECT 'null_count_lap_number',
       count(*)::text FROM core.laps_enriched WHERE lap_number IS NULL
UNION ALL
SELECT 'null_count_stint_number',
       count(*)::text FROM core.laps_enriched WHERE stint_number IS NULL
UNION ALL
SELECT 'null_count_compound_name',
       count(*)::text FROM core.laps_enriched WHERE compound_name IS NULL
UNION ALL
SELECT 'null_count_compound_raw',
       count(*)::text FROM core.laps_enriched WHERE compound_raw IS NULL
UNION ALL
SELECT 'null_count_is_pit_out_lap',
       count(*)::text FROM core.laps_enriched WHERE is_pit_out_lap IS NULL
UNION ALL
SELECT 'null_count_is_pit_lap',
       count(*)::text FROM core.laps_enriched WHERE is_pit_lap IS NULL
UNION ALL
SELECT 'null_count_is_valid',
       count(*)::text FROM core.laps_enriched WHERE is_valid IS NULL
UNION ALL
SELECT 'null_count_is_personal_best_proxy',
       count(*)::text FROM core.laps_enriched WHERE is_personal_best_proxy IS NULL;
SQL

# 4. Web regression gates. Use --prefix so the three commands chain from a single
#    shell without nested cds (matches 03-core-build-schema gate #4).
npm --prefix web run build
npm --prefix web run typecheck
npm --prefix web run test:grading
```

## Acceptance criteria
- [ ] `psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL' …` (gate #1 — global probe) exits `0`; captured numbers (`total_rows`, `distinct_triple`, `duplicate_rows`) are quoted verbatim in the grain note.
- [ ] Gate #2 (per-session probe over three deterministic `analytic_ready` sessions) exits `0`; the DO block does not raise its 3-session-minimum check; per-session `(total, distinct_triple, duplicate_rows)` and discriminator distributions for any session with `duplicate_rows > 0` are quoted verbatim in the grain note.
- [ ] Gate #3 (global candidate-grain + nullability probe) exits `0`; every emitted `distinct_*` and `null_count_*` row is quoted verbatim in the grain note. A PK is recommended only when the chosen tuple has both `distinct_*tuple = total_rows` AND `null_count_<col> = 0` for every column in the tuple. If the unique-but-nullable path is chosen, the note records the coalesce/sentinel expression verbatim plus the no-collision justification per Step 5; if no candidate is fully unique, the note explicitly recommends the heap-with-indexes path.
- [ ] `diagnostic/notes/03-laps-enriched-grain.md` exists and contains the four required sections (raw numbers, chosen grain, reasoning, recommendation for `03-laps-enriched-materialize`).
- [ ] `npm --prefix web run build`, `npm --prefix web run typecheck`, and `npm --prefix web run test:grading` all exit `0`.
- [ ] The only files modified by this slice are `diagnostic/notes/03-laps-enriched-grain.md` (new) and `diagnostic/slices/03-laps-enriched-grain-discovery.md` (this slice file — frontmatter + Slice-completion note only). No SQL files, no TypeScript files, no test files, no application code.

## Out of scope
- `CREATE MATERIALIZED VIEW` of any kind — explicitly punted to `03-laps-enriched-materialize`.
- `core.laps_enriched_mat` storage table, indexes, refresh script, ingest hook, public-view facade swap — each is its own dedicated slice per the precedent set by `03-core-build-schema`.
- TypeScript contract type for `laps_enriched` — created by the future materialize slice, not here.
- Parity testing of any matview output — there is no matview in this slice to test.
- Refresh strategy / cron decision (D-3, later phase).
- Cutover from live query to matview in route.ts (later).

## Risk / rollback
- Risk: a misclassified grain propagates into the materialize slice as either a failing PK constraint (false-unique chosen here) or unnecessarily wide indexes (false-non-unique chosen here). Mitigated by gate #2 quoting raw discriminator distributions for every duplicate-bearing session — the materialize slice can re-derive the decision from the captured numbers if it disagrees.
- Risk: the role used by the loop lacks `SELECT` on `core.laps_enriched` or `core.session_completeness`. Mitigated by the explicit env note above; failure mode is a clean `psql` permission error before any state change.
- Rollback: `git revert <commit>` removes the grain note. No DB state is created or modified by this slice, so there is nothing to roll back on the database side.

## Slice-completion note
(filled by Claude)

## Audit verdict
(filled by Codex — implementation-audit slot. Plan audits are tracked separately in the appended `## Plan-audit verdict (round N)` sections below.)

## Plan-audit verdict (round 1)

**Status: REVISE**

### High
- [x] Reconcile the slice scope: either make the steps/env/gates describe a grain-discovery documentation slice only, or expand the goal, changed-files list, DB gates, and acceptance criteria to cover materializing `laps_enriched`.
- [x] Add executable DB gate commands for any plan that defines SQL objects or parity tests; the current gates only run web commands and cannot prove matview creation, column ordering, or parity.
- [x] Expand `Changed files expected` to include every file implied by the implementation steps, including SQL, TypeScript contract, parity test, and the slice file itself, or remove those implementation steps.

### Medium
- [x] Fix the web gate command ordering so all three commands can run from one shell, for example by using `npm --prefix web ...` instead of repeated `cd web && ...`.
- [x] Specify deterministic session selection for the `>=3` parity sessions, preferably from analytic-ready sessions in `core.session_completeness`, if parity testing remains in scope.
- [x] Clarify whether `CREATE MATERIALIZED VIEW` is actually in scope, since `03-core-build-schema` explicitly deferred materialization to dedicated later slices and this slice's stated goal is grain discovery.

### Low
- [x] Replace the stale `## Audit verdict` placeholder with the appended `## Plan-audit verdict` section as the single audit-status location.

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T15:03:18Z`).

## Plan-audit verdict (round 2)

**Status: REVISE**

### High
- [x] Replace the gate #2 candidate discriminator columns with columns that actually exist on `core.laps_enriched` in `sql/006_semantic_lap_layer.sql`, or add an explicit preflight query that derives the candidate list from `information_schema` before referencing it.
- [x] Add a global candidate-grain probe that verifies any proposed discriminator tuple over all rows of `core.laps_enriched`, because a future PK recommendation cannot be justified from only three sampled sessions.

### Medium
- [x] Reconcile the step text and gate SQL so they name the same candidate columns; the steps mention `lap_source`, but gate #2 does not query it.
- [x] Remove or rewrite the instruction that the implementer should update the gate's candidate-column list during implementation, since the changed-files scope only allows the slice file frontmatter and completion note to change after planning.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T15:03:18Z`).

## Plan-audit verdict (round 3)

**Status: REVISE**

### High
- [x] Fix gate #1's `duplicate_rows` SQL expression so both operands are numeric before subtraction; the current expression subtracts a `text` value from a `bigint` and will fail before the grain note can be produced.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T15:03:18Z`).

## Plan-audit verdict (round 4)

**Status: REVISE**

### High
- [x] Add a global nullability/non-null probe for every candidate discriminator tuple and require the decision tree to recommend a future PK only when all PK columns are both globally unique and non-null; otherwise recommend a non-PK strategy or an explicitly defined non-null/coalesced discriminator.

### Medium

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T15:03:18Z`).

## Plan-audit verdict (round 5)

**Status: REVISE**

### High
- [ ] Add gate evidence for any coalesced/sentinel PK recommendation path, such as min/max or sentinel-absence probes for nullable candidate columns, or remove that optional path and require the default non-PK heap-with-indexes recommendation when a unique tuple contains NULLs.

### Medium
- [ ] Reconcile the target relation for discovery with the Phase 3 source-definition architecture: either run the discovery probes against `core_build.laps_enriched`, or explicitly justify why probing `core.laps_enriched` is equivalent for this slice after `03-core-build-schema`.
- [ ] Reconcile gate #2 with the plan text by either making the SQL emit actual duplicate-bearing row distributions grouped by candidate discriminator values, or changing the prose and acceptance criteria to describe the current `distinct_with_column` / `dup_after_column` summary counts.

### Low

### Notes (informational only — no action)
- `diagnostic/_state.md` was current for this audit (`last updated: 2026-04-27T15:03:18Z`).
