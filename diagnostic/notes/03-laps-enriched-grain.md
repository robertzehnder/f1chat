# `core.laps_enriched` grain note

Slice: `diagnostic/slices/03-laps-enriched-grain-discovery.md` (Phase 3, documentation-only).

Probes run against `core_build.laps_enriched` (the verbatim source-definition clone introduced by `03-core-build-schema`); set-wise identical to `core.laps_enriched` per `03-core-build-schema` gate #3.

Deterministic per-session sample: the first three `analytic_ready` sessions ordered by `session_key ASC` from `core.session_completeness`:
`9102`, `9110`, `9118`.

## 1. Raw numbers

### Gate #1 — global grain-discovery probe

```sql
SELECT 'total_rows' AS metric, count(*)::text AS value FROM core_build.laps_enriched
UNION ALL
SELECT 'distinct_triple',
       count(*)::text
  FROM (SELECT DISTINCT session_key, driver_number, lap_number FROM core_build.laps_enriched) d
UNION ALL
SELECT 'duplicate_rows',
       ((SELECT count(*) FROM core_build.laps_enriched)
        - (SELECT count(*) FROM (SELECT DISTINCT session_key, driver_number, lap_number FROM core_build.laps_enriched) d))::text;
```

Captured output (verbatim):

```
total_rows|167172
distinct_triple|159793
duplicate_rows|7379
```

The `total_rows > distinct_triple` inequality is the expected finding the slice exists to record (roadmap §4 Phase 3 step 2 counterexample reproduces here).

### Gate #2 — per-session grain probe (sessions 9102, 9110, 9118)

The DO-block SQL is reproduced verbatim in `diagnostic/slices/03-laps-enriched-grain-discovery.md` (gate command #2). Captured `RAISE NOTICE` output:

```
NOTICE:  session_key=9102 total=1312 distinct_triple=1312 duplicate_rows=0
NOTICE:  session_key=9110 total=1352 distinct_triple=1318 duplicate_rows=34
NOTICE:  session_key=9110 candidate-discriminator distribution (column, distinct_with_column, dup_after_column):
NOTICE:    stint_number → distinct=1350, dup_after=2
NOTICE:    compound_name → distinct=1340, dup_after=12
NOTICE:    compound_raw → distinct=1340, dup_after=12
NOTICE:    is_pit_out_lap → distinct=1318, dup_after=34
NOTICE:    is_pit_lap → distinct=1318, dup_after=34
NOTICE:    is_valid → distinct=1318, dup_after=34
NOTICE:    is_personal_best_proxy → distinct=1318, dup_after=34
NOTICE:  session_key=9118 total=1355 distinct_triple=1355 duplicate_rows=0
DO
```

Sessions 9102 and 9118 have `duplicate_rows = 0`: the triple `(session_key, driver_number, lap_number)` is unique for those sessions. Only session 9110 carries duplicate-bearing rows in the deterministic sample, and within that session adding `stint_number` to the triple leaves only `dup_after = 2` residual duplicates — i.e. the four boolean discriminator columns and `compound_*` add far less disambiguation than `stint_number`, but even `stint_number` does not collapse all duplicates.

### Gate #3 — global candidate-grain + nullability probe

Captured output (verbatim):

```
total_rows|167172
distinct_triple|159793
distinct_4tuple_with_stint_number|167170
distinct_4tuple_with_compound_name|161978
distinct_4tuple_with_compound_raw|161978
distinct_4tuple_with_is_pit_out_lap|159793
distinct_4tuple_with_is_pit_lap|159793
distinct_4tuple_with_is_valid|159812
distinct_4tuple_with_is_personal_best_proxy|159793
distinct_5tuple_with_stint_and_compound_name|167170
distinct_5tuple_with_stint_and_is_pit_out_lap|167170
distinct_5tuple_with_stint_and_is_pit_lap|167170
null_count_session_key|0
null_count_driver_number|0
null_count_lap_number|0
null_count_stint_number|1059
null_count_compound_name|0
null_count_compound_raw|1155
null_count_is_pit_out_lap|0
null_count_is_pit_lap|0
null_count_is_valid|0
null_count_is_personal_best_proxy|10
```

## 2. Chosen canonical grain

**Canonical grain: non-unique** — there is no fully-unique candidate column tuple over `core_build.laps_enriched`.

The grain that is *closest* to canonical is the triple `(session_key, driver_number, lap_number)`, supplemented by `stint_number` as a soft discriminator. Adding `stint_number` reduces `total - distinct` from `7379` to `2` globally (`167172 − 167170`), but residual duplicates remain even after adding any tested discriminator (4-tuple or 5-tuple). The triple alone is therefore the natural query key for downstream materialization, with the understanding that two laps may share it.

## 3. Reasoning

PK-eligibility rule from the slice (Steps §5): a candidate column tuple is PK-eligible only if (a) `distinct_*tuple = total_rows = 167172` AND (b) `null_count_<col> = 0` for every column in the tuple.

Walking the candidate list against gate #3:

| Candidate tuple | distinct | == 167172? | nullable cols | PK-eligible |
| --- | ---: | :---: | --- | :---: |
| `(session_key, driver_number, lap_number)` | 159793 | no | none | no |
| `+ stint_number` | 167170 | no | `stint_number` (1059 NULLs) | no |
| `+ compound_name` | 161978 | no | none | no |
| `+ compound_raw` | 161978 | no | `compound_raw` (1155 NULLs) | no |
| `+ is_pit_out_lap` | 159793 | no | none | no |
| `+ is_pit_lap` | 159793 | no | none | no |
| `+ is_valid` | 159812 | no | none | no |
| `+ is_personal_best_proxy` | 159793 | no | `is_personal_best_proxy` (10 NULLs) | no |
| `+ stint_number, compound_name` | 167170 | no | `stint_number` (1059 NULLs) | no |
| `+ stint_number, is_pit_out_lap` | 167170 | no | `stint_number` (1059 NULLs) | no |
| `+ stint_number, is_pit_lap` | 167170 | no | `stint_number` (1059 NULLs) | no |

**No candidate tuple is fully unique.** The strongest candidates (`+ stint_number` and the three 5-tuples extending it) all stop at `167170` distinct rows, two short of `167172`. Even ignoring nullability, the uniqueness criterion (a) fails for every probed tuple, so criterion (b) is moot — the decision is forced by criterion (a) alone.

Per slice Steps §5, when no candidate tuple is PK-eligible (whether because no tuple is fully unique, or because every fully-unique tuple has at least one nullable column) the canonical grain is **non-unique**, and the future `core.laps_enriched_mat` must be a heap-with-indexes (no PK) with delete-then-insert refresh per `session_key`. Coalesce/sentinel-derived PK columns are explicitly out of scope for this slice (Steps §5: a sentinel would require a sentinel-absence probe that is intentionally not in gate #3); a future slice may revisit sentinel-PK if needed.

## 4. Recommendation for `03-laps-enriched-materialize`

- **Storage shape:** heap table `core.laps_enriched_mat`, **no primary key**.
- **Indexes (non-unique):**
  - btree on `(session_key, driver_number, lap_number)` — primary lookup pattern; the natural query key even though it is not unique.
  - btree on `(session_key)` — supports the recommended delete-then-insert refresh granularity.
  - Additional secondary indexes (e.g. `(session_key, stint_number)`) are deferred to the materialize slice if profiling there shows they are warranted.
- **Refresh strategy:** delete-then-insert per `session_key`, per roadmap §4 Phase 3 ("non-unique heap with indexes + delete-then-insert refresh per `session_key`"). Inside a transaction: `DELETE FROM core.laps_enriched_mat WHERE session_key = $1; INSERT INTO core.laps_enriched_mat SELECT * FROM core_build.laps_enriched WHERE session_key = $1;`.
- **Source of truth for the load:** `core_build.laps_enriched` (the source-definition clone), per `03-core-build-schema` Steps §1 rewrite #2. This decouples the matview load from any future facade swap of `core.laps_enriched`.
- **Out-of-scope reminders for the materialize slice:** TypeScript contract for `laps_enriched`, parity testing of the matview output, refresh cron / D-3 decision, and route.ts cutover are each separate slices.
- **If the materialize slice disagrees with this recommendation:** all raw counts in §1 are reproducible by re-running the gate-command SQL verbatim against `core_build.laps_enriched`; the decision tree in §3 can be re-evaluated from those numbers alone without re-querying the database.
