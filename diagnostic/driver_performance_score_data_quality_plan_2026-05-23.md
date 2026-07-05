# Data-Quality Plan — `analytics.driver_performance_score`

**Date**: 2026-05-23
**Status**: **rev6 · audit applied + implementation shipped** (Codex rev5 audit, 2026-05-24)
**Trigger**: live response to *"Compare Verstappen vs Norris across all performance metrics for 2025"*
returns `0` for 4 of 7 axes for both drivers; one axis (`traffic_handling_axis`) returns `0` for Norris
only.

This plan splits the question into three independent branches (populate, refresh, semantic) so each can
be investigated and remediated without blocking the others. §3 catalogs every source table the matview
depends on, with the deployed migration that creates it and the exact aggregation formula it feeds.

### rev6 audit response + implementation (summary of changes vs rev5)

- **Branch C `C3` wording** — fixed the stale "via C1" reference. The historical sanity check now
  reads "via C2, with C1 logged as smoke only", consistent with C2 being the authoritative gate.
  (audit LOW #1)
- **"source matview" → "source tables/views"** — three remaining live-prose instances were swept
  for wording consistency with rev3's scope correction (raw tables are now also in the catalog).
  (audit LOW #2)
- **Branch B intro language genericized** — replaced "rev2 uses freshness comparison" with
  revision-neutral phrasing so future revs don't have to re-edit. (audit LOW #3)

**Implementation shipped end-to-end** (the code side of the plan, what doesn't require live DB
access):

- **Regression health script**:
  [`web/scripts/health/driver_performance_score_health.mjs`](web/scripts/health/driver_performance_score_health.mjs)
  runs A2, B1.5, B1.6, and the primary team-mate populate-consistency check (criterion §5.5).
  Accepts `--season=YYYY` (default 2025). Exits non-zero on any tripped check; each check emits
  a distinct stderr label so the failure mode is greppable from CI output.
- **Radar detector "partial data" caveat**:
  [`web/src/lib/mapInsight/detectors/registry.ts`](web/src/lib/mapInsight/detectors/registry.ts)
  now emits a `partial_data_axes` count on the radar `ChartSpec` when ≥ 3 axes are exactly 0 across
  every series. The chart caption surfaces *"⚠ N of 7 axes not yet populated"* so a stale season
  no longer silently renders a misleading polygon (Branch A remediation #3).
- **`error_rate_axis` semantic comment** — pinned a comment in the radar label map naming
  `migration 045` as the owner of the inversion, so any future reviewer of the chart code knows
  where the semantic lives (Branch C remediation #1).

**Implementation deliberately deferred** (requires live DB access or operator confirmation):
- Branches A1/A2/A3 queries against Neon (must be run by operator).
- Branch B `REFRESH MATERIALIZED VIEW CONCURRENTLY` — destructive on a shared system; explicit
  operator confirmation required per the project's auto-mode safety policy.
- Branch B optional `analytics._refresh_audit` table — requires DBA-level migration approval.
- Source-table backfills (Branch A remediation #1) — out of scope until A2/A3 identify which
  source slice to backfill.

### rev5 audit response (summary of changes vs rev4)

- **Acceptance criterion 3 (Branch C) no longer hard-gates on C1** — rev4 downgraded C1 to a
  smoke test in Branch C itself but criterion 3 still required `C1` to return TRUE on all regex
  columns, contradicting the demotion. rev5 reframes criterion 3 so C2 (formula-consistency,
  zero mismatches) is the only gate; C1 outcome is logged for telemetry but never fails the
  check. (audit MEDIUM #1)
- **B1.6 now covers the reverse case (matview populated, source absent)** — rev4 used
  `dps JOIN expected` which excluded matview rows whose source row had disappeared. rev5
  restructures every B1.6 axis block as `FULL OUTER JOIN` between the matview row and the
  recomputed source aggregate, and emits a distinct `issue` label per failure mode
  (`matview_populated_source_absent` / `matview_null_source_has_value` / `value_mismatch`).
  (audit MEDIUM #2)
- **B1.6 no longer uses sentinel `COALESCE` values in float comparisons** — rev4's
  `COALESCE(dps.col, -1)` / `-999` sentinels risked false-matching legitimate negative metrics
  (`avg_restart_delta` is signed). rev5 replaces every sentinel with explicit NULL handling:
  `dps.col IS NULL OR ABS(dps.col - e.expected) > 0.001`. The sentinel value never enters the
  arithmetic. (audit LOW #1)
- **Health gate wording uses "target season"** — rev4 said "current season" which contradicts the
  pinned `target_season = 2025` constant. rev5 says "target season (default 2025; script accepts
  `--season=YYYY`)". (audit LOW #2)
- **"Plan rev3 documents…" wording fixed** — replaced with "the next plan revision documents…"
  so the line doesn't have to be re-edited every rev. (audit LOW #3)

### rev4 audit response (summary of changes vs rev3)

- **B1.5 now detects stale VALUES, not just missing driver-pairs** — rev3's anti-join caught
  "source has driver, matview missed the row", but missed "matview has a row whose aggregate is
  stale". rev4 adds **B1.6** per axis: recompute the exact source-CTE aggregate
  (`AVG(...)` / `COUNT(*)`) and compare row-by-row to the surfaced raw column in
  `driver_performance_score_data`. Any per-axis diff > tolerance is a staleness signal.
  (audit MEDIUM #1)
- **B1 source-density filters now match migration 045 exactly** — rev3's B1 counted source rows
  without the same `session_name = 'Race'` / non-null-metric filters that migration 045 applies
  inside each source CTE, so B1 could report "available" rows the matview correctly ignores. rev4
  brings each B1 source subquery into byte-for-byte alignment with the corresponding CTE in 045.
  (audit MEDIUM #2)
- **Acceptance criterion 5 (health gate) now includes B1.5 + B1.6** — rev3 only listed A2 and the
  traffic team-mate check in the regression script. rev4 adds both staleness checks
  (existence + value) so the strongest new protection ships with the gate.
  (audit MEDIUM #3)
- **C1 regex demoted to a smoke test; C2 is the authoritative formula gate** — even with the
  optional `.0` accepted, a deparsed definition can carry `::double precision` casts or other
  whitespace forms that defeat the regex. The regex is widened to accept optional casts, but the
  pass/fail decision for *"is the formula correct"* now lives in **C2 (formula consistency
  recompute)**. C1 is documented as a fast smoke test only. (audit LOW #1)
- **§2 phrasing genericized** — "rev2 queries" replaced with "all diagnostic queries" so a future
  rev doesn't have to re-edit the section header. (audit LOW #2)
- **Traffic primary-pair ranking now per (driver, team)** — rev3 ranked race participation by
  `driver_number` alone, so a mid-season swap (e.g. Doohan → Colapinto at Alpine) split the same
  driver_number across two `team_name`s but counted their rows once at the global level. rev4
  ranks `(driver_number, team_name)` so each team's primary-pair selection reflects only that
  team's roster. (audit LOW #3)

### rev3 audit response (summary of changes vs rev2)

- **C1 regex now allows `10.0`** — the deployed expression is `(10.0 - LEAST(...)`, not
  `(10 - LEAST(...)`. The rev2 regex `[-.]+` greedily required a hyphen or dot in the wrong slot and
  could false-fail. Replaced with `\(10(\.0)?\s*-\s*LEAST\s*\(\s*COALESCE\s*\(\s*er\.season_penalties`.
  (audit HIGH #1)
- **B1 is now a true staleness check, not just a density check** — rev2's B1 compared row counts
  but couldn't prove "rows exist in source that the matview can't see". rev3 adds B1.5: for each
  axis, recompute the source-CTE expected `(season_year, driver_number)` pair set and
  anti-join (`EXCEPT`) against the populated rows in `driver_performance_score_data`. Non-empty
  result ⇒ matview is genuinely stale, not just sparse. (audit MEDIUM #1)
- **C2 reframed as formula-consistency, not distribution** — rev2's C2 required "dirtiest at axis
  ≤ 30", which silently fails if no 2025 driver has ≥ 7 counted penalties — even though the
  formula is correct. rev3 asserts: for every row,
  `error_rate_axis = (10 - LEAST(season_penalties, 10)) * 10`. (audit MEDIUM #2)
- **Traffic team-mate query restricted to primary roster** — rev2 used `array_length >= 2` which
  false-positives on reserve / temporary drivers. rev3 ranks drivers within each team by race
  participation (counts in `core.session_drivers ⋈ core.sessions`) and only compares the **top
  two**. Reserves are explicitly excluded and the criterion is renamed *"primary team-mate
  populate consistency"*. (audit MEDIUM #3)
- **§3 wording** — "source matviews" → "source tables/views" since raw tables (`raw.starting_grid`,
  `raw.session_result`) are included alongside analytics views. (audit LOW #1)

### rev2 audit response (summary of changes vs rev1)

- **B1 source columns** — every source view the plan queries is **session-key based**, not
  `season_year` based. rev2 joins each source to `core.sessions` on `session_key` and filters/aggregates
  by `s.year`, mirroring the matview's own CTEs in migration 045. (audit HIGH #1)
- **B1 `CURRENT_DATE`** — replaced with an explicit `target_season = 2025` parameter at the top of
  every diagnostic query. Today is 2026-05-23 but the investigated dataset is 2025. (audit HIGH #2)
- **C2 against 2024** — migration 045 hardcodes `WHERE s.year = 2025` in every source CTE, so the
  matview only ever contains 2025 rows. C2 now uses **2025** for the direction check and adds a
  separate optional source-level historical check that bypasses the matview. (audit HIGH #3)
- **A2 zero-vs-missing for count axes** — `season_overtakes = 0` and `season_penalties = 0` are
  legitimate values, not signals of missing input. rev2 detects missing input by querying
  source-CTE row existence directly (`EXISTS … FROM raw_source … JOIN core.sessions`), not by
  checking if the surfaced count is non-zero. (audit MEDIUM #1)
- **Traffic acceptance criterion** — added an explicit regression query that compares each pair of
  team-mates on `traffic_handling_axis` and flags suspect populate failures. Team change handling
  is documented. (audit MEDIUM #2)
- **C1 substring brittleness** — replaced `position(...) > 0` with a regex match on
  `definition ~* 'season_penalties.*10'` and an out-of-DB diff against the migration text. (audit LOW #1)
- **NEW: §3 Source-table catalog** — for each of the 7 axes, the plan now lists the source
  table/view, deployed migration file, key columns, and the exact aggregation formula migration 045
  uses.

---

## 1 · Observed symptoms

From [chat_transcript.jsonl](/Users/robertzehnder/Documents/coding/f1/openf1/web/logs/chat_transcript.jsonl)
for the live Compare-Verstappen-vs-Norris-2025 question:

| Driver | qualifying | race_pace | tyre_mgmt | restart | traffic_handling | overtake_difficulty | error_rate |
|---|---|---|---|---|---|---|---|
| VER (1) | 0 | 0 | 0 | 75 | **80.1** | 0 | 30 |
| NOR (4) | 0 | 0 | 0 | **100** | 0 | 0 | 60 |

Implausible because:
- VER + NOR are front-running drivers in 2025; their qualifying and race-pace axes should be near the
  top of the field, not floor-clamped at 0.
- VER and NOR ran (and finished) the same races in 2025; `traffic_handling_axis = 0` for NOR but
  `80.1` for VER is suspicious of a JOIN failure on the `traffic_axis_raw` CTE rather than missing
  source data.
- `error_rate_axis = 60` for NOR and `30` for VER is semantically meaningful **only if** the DDL's
  `(10 - season_penalties) * 10` mapping is what's actually deployed — Branch C verifies this.

**Critical caveat that drives the diagnostic strategy**: the matview's axis expressions all wrap raw
inputs in `COALESCE(..., <default>)` such that a missing input produces a **valid-looking output
value** (0 for most axes, 100 for `error_rate_axis`). Aggregations on the axis columns alone will
*not* surface the bug; A2 below queries source-CTE row existence directly so we can tell "populated
and bad" apart from "missing inputs masquerading as zero". This is especially important for
`overtake_difficulty_axis` and `error_rate_axis`, where the surfaced count of 0 is ambiguous: 0
overtakes is a legitimate value, but 0 from a missing source row also produces 0 (via the
`LEFT JOIN`-emitted NULL → `COALESCE(..., 0)` chain).

---

## 2 · Constants

All diagnostic queries below use the following parameters at the top so the audit can find them in
one place rather than reading every snippet (kept generic so future revs don't need to re-touch this
section):

```sql
-- The season under investigation. Hardcoded because:
--   (a) the matview itself is locked to s.year = 2025 in migration 045;
--   (b) "today's year" (2026) is meaningless for a 2025 data question.
\set target_season 2025
```

(Substituted as `2025` literal in non-psql contexts.)

---

## 3 · Source-table catalog

Each axis in `analytics.driver_performance_score_data` is driven by one source table or matview,
joined to `core.sessions` for the `year` filter. Migration 045 lines and column-level formulas listed
below.

### 3.1 `core.sessions` — backbone year filter

- **Definition**: `CREATE OR REPLACE VIEW core.sessions AS SELECT s.*, m.meeting_name, … FROM raw.sessions s LEFT JOIN raw.meetings m USING (meeting_key)`
  ([sql/migrations/deploy/004_constraints.sql:56-63](sql/migrations/deploy/004_constraints.sql))
- **Join key**: `session_key`
- **Filter column used by matview**: `s.year`, `s.session_name`
- **Why it matters**: every source CTE in migration 045 does `JOIN core.sessions s ON s.session_key = <src>.session_key WHERE s.year = 2025`. None of the source tables/views (raw tables included) carry `season_year` themselves.

### 3.2 `core.session_drivers` → `season_drivers` CTE

- **Definition**: `CREATE OR REPLACE VIEW core.session_drivers AS SELECT d.session_key, d.meeting_key, d.driver_number, d.full_name, d.team_name, … FROM raw.drivers d`
  ([sql/migrations/deploy/004_constraints.sql:65-74](sql/migrations/deploy/004_constraints.sql))
- **Aggregation** ([045:25-37](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  SELECT DISTINCT s.year AS season_year, sd.driver_number,
         MAX(sd.full_name) AS driver_name, MAX(sd.team_name) AS team_name
  FROM core.session_drivers sd
  JOIN core.sessions s ON s.session_key = sd.session_key
  WHERE s.year = 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
  GROUP BY s.year, sd.driver_number
  ```
- **Drives**: which (season, driver) pairs the matview emits rows for. If this CTE is sparse, every
  axis appears missing for unlisted drivers.

### 3.3 `raw.starting_grid` → `qual_axis_raw` → `qualifying_axis`

- **Source**: `raw.starting_grid` (extended by migration
  [023_starting_grid_derivation.sql](sql/migrations/deploy/023_starting_grid_derivation.sql))
- **Aggregation** ([045:39-50](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  AVG(sg.grid_position::DOUBLE PRECISION) AS avg_grid_position
  FROM raw.starting_grid sg
  JOIN core.sessions s ON s.session_key = sg.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sg.grid_position IS NOT NULL
  GROUP BY s.year, sg.driver_number
  ```
- **Axis formula** ([045:122-125](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  `GREATEST(0, LEAST(100, (21.0 - COALESCE(avg_grid_position, 21.0)) / 20.0 * 100.0))`
- **Failure mode**: if no row exists for a driver in the CTE, `avg_grid_position IS NULL` →
  `COALESCE` → 21.0 → axis = 0.

### 3.4 `raw.session_result` → `race_axis_raw` → `race_pace_axis`

- **Source**: `raw.session_result` (columns added by migration
  [022_session_result_extend_columns.sql](sql/migrations/deploy/022_session_result_extend_columns.sql))
- **Aggregation** ([045:51-62](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  AVG(sr.position::DOUBLE PRECISION) AS avg_race_position
  FROM raw.session_result sr
  JOIN core.sessions s ON s.session_key = sr.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sr.position IS NOT NULL
  GROUP BY s.year, sr.driver_number
  ```
- **Axis formula** ([045:126-128](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  `GREATEST(0, LEAST(100, (21.0 - COALESCE(avg_race_position, 21.0)) / 20.0 * 100.0))`
- **Failure mode**: same as 3.3.

### 3.5 `analytics.stint_degradation_curve` → `tyre_axis_raw` → `tyre_management_axis`

- **Source**: `analytics.stint_degradation_curve` (migration
  [033_analytics_stint_degradation_curve.sql](sql/migrations/deploy/033_analytics_stint_degradation_curve.sql))
- **Aggregation** ([045:63-72](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  AVG(sdc.degradation_per_lap_s) AS avg_deg_s
  FROM analytics.stint_degradation_curve sdc
  JOIN core.sessions s ON s.session_key = sdc.session_key
  WHERE s.year = 2025 AND sdc.degradation_per_lap_s IS NOT NULL
  GROUP BY s.year, sdc.driver_number
  ```
- **Axis formula** ([045:129-132](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  `GREATEST(0, LEAST(100, (1.0 - LEAST(COALESCE(avg_deg_s, 0.3), 0.3) / 0.3) * 100.0))`
  (0 deg = 100, 0.3 s/lap deg = 0)
- **Failure mode**: missing → `COALESCE` → 0.3 → axis = 0.

### 3.6 `analytics.restart_performance` → `restart_axis_raw` → `restart_axis`

- **Source**: `analytics.restart_performance` (migration
  [040_analytics_restart_performance.sql](sql/migrations/deploy/040_analytics_restart_performance.sql))
- **Aggregation** ([045:74-84](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  AVG(rp.position_delta::DOUBLE PRECISION) AS avg_restart_delta
  FROM analytics.restart_performance rp
  JOIN core.sessions s ON s.session_key = rp.session_key
  WHERE s.year = 2025 AND rp.position_delta IS NOT NULL
  GROUP BY s.year, rp.driver_number
  ```
- **Axis formula** ([045:133-136](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  the formula maps `-3..+1` to `100..0` (negative delta = gained positions = good).
  `COALESCE(avg_restart_delta, 0.0)` → axis ≈ 75 when missing — **note this is non-zero**, which
  matches the symptom (VER 75 / NOR 100 plausibly mean NOR has no recorded restart events while VER
  has at least one).
- **Failure mode**: missing → `COALESCE` → 0.0 → axis = 75 (not 0). Detect via raw input null count.

### 3.7 `analytics.traffic_adjusted_pace` → `traffic_axis_raw` → `traffic_handling_axis`

- **Source**: `analytics.traffic_adjusted_pace` (migration
  [039_analytics_traffic_adjusted_pace.sql](sql/migrations/deploy/039_analytics_traffic_adjusted_pace.sql))
- **Aggregation** ([045:85-95](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  AVG(tap.traffic_pace_delta_s) AS avg_traffic_delta_s
  FROM analytics.traffic_adjusted_pace tap
  JOIN core.sessions s ON s.session_key = tap.session_key
  WHERE s.year = 2025 AND tap.traffic_pace_delta_s IS NOT NULL
  GROUP BY s.year, tap.driver_number
  ```
- **Axis formula** ([045:137-140](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  `GREATEST(0, LEAST(100, (1.0 - LEAST(COALESCE(avg_traffic_delta_s, 3.0), 3.0) / 3.0) * 100.0))`
- **Failure mode**: missing → `COALESCE` → 3.0 → axis = 0.

### 3.8 `analytics.overtake_events` → `overtake_axis_raw` → `overtake_difficulty_axis`

- **Source**: `analytics.overtake_events` (migration
  [042_analytics_overtake_events.sql](sql/migrations/deploy/042_analytics_overtake_events.sql))
- **Join key surprise**: uses `overtaking_driver_number AS driver_number` (not the standard column
  name). Any diagnostic query against this source must use `oe.overtaking_driver_number`.
- **Aggregation** ([045:96-105](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  COUNT(*) AS season_overtakes
  FROM analytics.overtake_events oe
  JOIN core.sessions s ON s.session_key = oe.session_key
  WHERE s.year = 2025
  GROUP BY s.year, oe.overtaking_driver_number
  ```
- **Axis formula** ([045:141-143](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  `GREATEST(0, LEAST(100, COALESCE(season_overtakes, 0) * 2.0))`
  (50+ overtakes = 100)
- **Failure mode**: missing → `COALESCE` → 0 → axis = 0. **`season_overtakes = 0` is ambiguous**:
  could mean "this driver didn't overtake anyone all year" (legitimate) or "the source table/view
  didn't return a row" (populate failure). Branch A's `A2` must use source-row existence checks.

### 3.9 `analytics.race_control_incidents` → `error_axis_raw` → `error_rate_axis`

- **Source**: `analytics.race_control_incidents` (migration
  [034_analytics_race_control_incidents.sql](sql/migrations/deploy/034_analytics_race_control_incidents.sql))
- **Aggregation** ([045:106-115](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  ```sql
  COUNT(*) FILTER (WHERE rci.action_status IN ('time_penalty', 'drive_through', 'grid_penalty'))
    AS season_penalties
  FROM analytics.race_control_incidents rci
  JOIN core.sessions s ON s.session_key = rci.session_key
  WHERE s.year = 2025 AND rci.driver_number IS NOT NULL
  GROUP BY s.year, rci.driver_number
  ```
- **Axis formula** ([045:144-146](sql/migrations/deploy/045_analytics_driver_performance_score.sql)):
  `GREATEST(0, LEAST(100, (10.0 - LEAST(COALESCE(season_penalties, 0), 10)) * 10.0))`
  (**0 penalties = 100**, 10+ penalties = 0; **higher = better consistency — already inverted**)
- **Failure mode**: missing → `COALESCE` → 0 → axis = **100**. Same ambiguity as 3.8 — `season_penalties = 0`
  could mean "zero penalties this year" (legitimate, axis = 100) or "matview returned no row"
  (populate failure, axis = 100 misleadingly).

---

## 4 · Branches (independent · run in parallel)

### Branch A · Populate-strategy gap (4 zero axes)

**Hypothesis**: `qualifying_axis / race_pace_axis / tyre_management_axis / overtake_difficulty_axis`
have prerequisite source rows missing for 2025. The matview built fine but the underlying inputs are
NULL → COALESCE defaults trigger → axis floors at 0 (or 100 in the error_rate case).

**Investigate** — queries target the matview `analytics.driver_performance_score_data`, not the
facade view, and source row existence is detected by querying the source CTE directly (not by
checking surfaced counts, since 0 is ambiguous for `season_overtakes` / `season_penalties`).

```sql
-- A1: aggregate axis values AND raw surfaced columns side-by-side for 2025.
SELECT
  season_year,
  COUNT(*)                                         AS driver_rows,
  ROUND(AVG(qualifying_axis)::numeric, 1)          AS avg_qual_axis,
  ROUND(AVG(race_pace_axis)::numeric, 1)           AS avg_pace_axis,
  ROUND(AVG(tyre_management_axis)::numeric, 1)     AS avg_tyre_axis,
  ROUND(AVG(restart_axis)::numeric, 1)             AS avg_restart_axis,
  ROUND(AVG(traffic_handling_axis)::numeric, 1)    AS avg_traffic_axis,
  ROUND(AVG(overtake_difficulty_axis)::numeric, 1) AS avg_overtake_axis,
  ROUND(AVG(error_rate_axis)::numeric, 1)          AS avg_error_axis,
  -- raw surfaced columns: NULL = source CTE returned no row
  COUNT(avg_grid_position)        AS qual_input_populated,
  COUNT(avg_race_position)        AS pace_input_populated,
  COUNT(avg_deg_s)                AS tyre_input_populated,
  COUNT(avg_restart_delta)        AS restart_input_populated,
  COUNT(avg_traffic_delta_s)      AS traffic_input_populated
  -- NOTE: season_overtakes and season_penalties are deliberately omitted here;
  -- they're COALESCE'd to 0 inside the matview so they have no NULL signal.
  -- A2 queries the source tables/views directly for those two.
FROM analytics.driver_performance_score_data
WHERE season_year = 2025
GROUP BY season_year;

-- A2: per-axis source-row existence for 2025. Critically, the count-based axes
-- (overtake, error_rate) are checked at SOURCE level — not at the surfaced
-- count column — because 0 there is ambiguous.
WITH season_drivers AS (
  SELECT DISTINCT s.year AS season_year, sd.driver_number, sd.full_name AS driver_name
  FROM core.session_drivers sd
  JOIN core.sessions s ON s.session_key = sd.session_key
  WHERE s.year = 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
),
-- For each axis, find drivers with at least one source row in 2025.
qual_present AS (
  SELECT DISTINCT sg.driver_number
  FROM raw.starting_grid sg
  JOIN core.sessions s ON s.session_key = sg.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sg.grid_position IS NOT NULL
),
race_present AS (
  SELECT DISTINCT sr.driver_number
  FROM raw.session_result sr
  JOIN core.sessions s ON s.session_key = sr.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sr.position IS NOT NULL
),
tyre_present AS (
  SELECT DISTINCT sdc.driver_number
  FROM analytics.stint_degradation_curve sdc
  JOIN core.sessions s ON s.session_key = sdc.session_key
  WHERE s.year = 2025 AND sdc.degradation_per_lap_s IS NOT NULL
),
restart_present AS (
  SELECT DISTINCT rp.driver_number
  FROM analytics.restart_performance rp
  JOIN core.sessions s ON s.session_key = rp.session_key
  WHERE s.year = 2025 AND rp.position_delta IS NOT NULL
),
traffic_present AS (
  SELECT DISTINCT tap.driver_number
  FROM analytics.traffic_adjusted_pace tap
  JOIN core.sessions s ON s.session_key = tap.session_key
  WHERE s.year = 2025 AND tap.traffic_pace_delta_s IS NOT NULL
),
overtake_present AS (
  -- Note: overtake_events uses overtaking_driver_number
  SELECT DISTINCT oe.overtaking_driver_number AS driver_number
  FROM analytics.overtake_events oe
  JOIN core.sessions s ON s.session_key = oe.session_key
  WHERE s.year = 2025
),
error_present AS (
  SELECT DISTINCT rci.driver_number
  FROM analytics.race_control_incidents rci
  JOIN core.sessions s ON s.session_key = rci.session_key
  WHERE s.year = 2025 AND rci.driver_number IS NOT NULL
)
SELECT
  COUNT(DISTINCT sd.driver_number)                                              AS total_drivers,
  COUNT(DISTINCT sd.driver_number) FILTER (WHERE qp.driver_number    IS NOT NULL) AS qual_src_drivers,
  COUNT(DISTINCT sd.driver_number) FILTER (WHERE rp.driver_number    IS NOT NULL) AS race_src_drivers,
  COUNT(DISTINCT sd.driver_number) FILTER (WHERE tp.driver_number    IS NOT NULL) AS tyre_src_drivers,
  COUNT(DISTINCT sd.driver_number) FILTER (WHERE rsp.driver_number   IS NOT NULL) AS restart_src_drivers,
  COUNT(DISTINCT sd.driver_number) FILTER (WHERE trp.driver_number   IS NOT NULL) AS traffic_src_drivers,
  COUNT(DISTINCT sd.driver_number) FILTER (WHERE op.driver_number    IS NOT NULL) AS overtake_src_drivers,
  COUNT(DISTINCT sd.driver_number) FILTER (WHERE ep.driver_number    IS NOT NULL) AS error_src_drivers
FROM season_drivers sd
LEFT JOIN qual_present     qp  USING (driver_number)
LEFT JOIN race_present     rp  USING (driver_number)
LEFT JOIN tyre_present     tp  USING (driver_number)
LEFT JOIN restart_present  rsp USING (driver_number)
LEFT JOIN traffic_present  trp USING (driver_number)
LEFT JOIN overtake_present op  USING (driver_number)
LEFT JOIN error_present    ep  USING (driver_number);

-- A3: extract source CTEs from the matview definition (target the matview, not the facade view).
SELECT definition
FROM pg_matviews
WHERE schemaname = 'analytics' AND matviewname = 'driver_performance_score_data';
```

**Decision tree on A2 outcome**:
- `qual_src_drivers / race_src_drivers / tyre_src_drivers / overtake_src_drivers` low (e.g. < 15 of
  ~20 active drivers) → the source table/view is sparse → backfill the corresponding source slice
  (3.3 / 3.4 / 3.5 / 3.8 in the catalog above).
- `qual_src_drivers ≈ total_drivers` but `qualifying_axis` still averages near 0 in A1 → formula is
  firing correctly but values are legitimately bad (avg grid ≈ 21 = last). Document instead of fix.
- Single-axis mismatch where one driver of a known team-mate pair has source rows and the other
  doesn't → JOIN failure or driver_number mismatch (relevant for the NOR/VER traffic_handling case).

**Remediation paths** (pick after A1–A3):
1. **Source-table backfill** — re-run the populate query for whichever source CTE was sparse.
2. **Schema honesty** — if an axis is *legitimately* not yet available for in-progress seasons,
   surface that in the synthesis prompt as a known caveat so the chat answer reads
   *"qualifying axis not yet populated for in-season data"* instead of `0`.
3. **Adapter guard** — when ≥ 4 axes are zero across all drivers in a row set, the radar detector
   should annotate "partial data" on the chart caption.
4. **Remove the misleading COALESCE default** — upstream change to migration 045: let each axis emit
   `NULL` when its raw input is missing, instead of `COALESCE`-defaulting to a value that floors to 0
   or 100. The chat adapter already handles NULL gracefully (drops the axis from the radar) and the
   bug becomes visible at insert time rather than at chart time.

### Branch B · Matview refresh staleness

**Hypothesis**: matview was last refreshed before some of the 2025 axis inputs were ready, so source
rows now exist that the matview can't see.

**Investigate** — `pg_stat_user_tables` does NOT expose a refresh timestamp; this plan uses freshness
comparison against the source views, all of which are session_key based (NOT season_year based — they
must be joined to `core.sessions`).

```sql
-- B1: freshness via source-side row counts JOINed through core.sessions.
-- Each source subquery applies *exactly* the filters used by the matching
-- CTE in migration 045, so B1's row counts represent what the matview
-- *should* see — not a looser superset that would over-report freshness.
WITH per_source AS (
  SELECT 'matview'                  AS source,
         COUNT(*) AS rows_2025,
         COUNT(DISTINCT driver_number) AS drivers_2025
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
  UNION ALL
  -- tyre_axis_raw (migration 045 lines 63-72): IS NOT NULL filter on the metric.
  SELECT 'stint_degradation_curve',
         COUNT(*),
         COUNT(DISTINCT sdc.driver_number)
  FROM analytics.stint_degradation_curve sdc
  JOIN core.sessions s ON s.session_key = sdc.session_key
  WHERE s.year = 2025 AND sdc.degradation_per_lap_s IS NOT NULL
  UNION ALL
  -- restart_axis_raw (migration 045 lines 74-84): IS NOT NULL on position_delta.
  SELECT 'restart_performance',
         COUNT(*),
         COUNT(DISTINCT rp.driver_number)
  FROM analytics.restart_performance rp
  JOIN core.sessions s ON s.session_key = rp.session_key
  WHERE s.year = 2025 AND rp.position_delta IS NOT NULL
  UNION ALL
  -- traffic_axis_raw (migration 045 lines 85-95): IS NOT NULL on traffic_pace_delta_s.
  SELECT 'traffic_adjusted_pace',
         COUNT(*),
         COUNT(DISTINCT tap.driver_number)
  FROM analytics.traffic_adjusted_pace tap
  JOIN core.sessions s ON s.session_key = tap.session_key
  WHERE s.year = 2025 AND tap.traffic_pace_delta_s IS NOT NULL
  UNION ALL
  -- overtake_axis_raw (migration 045 lines 96-105): no IS NOT NULL filter; counts all events.
  SELECT 'overtake_events',
         COUNT(*),
         COUNT(DISTINCT oe.overtaking_driver_number)
  FROM analytics.overtake_events oe
  JOIN core.sessions s ON s.session_key = oe.session_key
  WHERE s.year = 2025
  UNION ALL
  -- error_axis_raw (migration 045 lines 106-115): IS NOT NULL on driver_number.
  -- COUNT(*) reflects raw rows; the matview itself applies the action_status filter inside
  -- COUNT(*) FILTER (...). B1 reports raw availability so we can spot upstream sparsity even
  -- if the filter eliminates the row at axis computation time.
  SELECT 'race_control_incidents',
         COUNT(*),
         COUNT(DISTINCT rci.driver_number)
  FROM analytics.race_control_incidents rci
  JOIN core.sessions s ON s.session_key = rci.session_key
  WHERE s.year = 2025 AND rci.driver_number IS NOT NULL
  UNION ALL
  -- qual_axis_raw (migration 045 lines 39-50): session_name='Race' AND grid_position IS NOT NULL.
  SELECT 'starting_grid (raw)',
         COUNT(*),
         COUNT(DISTINCT sg.driver_number)
  FROM raw.starting_grid sg
  JOIN core.sessions s ON s.session_key = sg.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sg.grid_position IS NOT NULL
  UNION ALL
  -- race_axis_raw (migration 045 lines 51-62): session_name='Race' AND position IS NOT NULL.
  SELECT 'session_result (raw)',
         COUNT(*),
         COUNT(DISTINCT sr.driver_number)
  FROM raw.session_result sr
  JOIN core.sessions s ON s.session_key = sr.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sr.position IS NOT NULL
)
SELECT * FROM per_source ORDER BY source;
-- Interpretation: each source subquery is what migration 045's matching CTE would
-- consume. If any *source* has rows_2025 > 0 but the matview's count of DISTINCT
-- driver_number with a populated input column for that axis (A1) is 0, the matview
-- is stale relative to that source.

-- B1.5: PER-AXIS STALENESS — for each axis, compute the set of
-- (season_year, driver_number) pairs that a fresh CTE recomputation
-- WOULD produce, then EXCEPT-anti-join against the populated rows
-- currently surfaced in driver_performance_score_data. A non-empty
-- result for any axis is a definitive staleness signal: rows exist in
-- the source today that the matview cannot see.
--
-- "Populated" on the matview side is detected by the raw surfaced
-- column being non-null (for the 5 average axes) — count-based axes
-- (overtake, error_rate) can't be checked this way because their
-- surfaced columns are COALESCE'd to 0, so they're checked via
-- driver-row presence at all.
--
-- Run each axis block independently; non-empty rows = staleness.

-- Qualifying:
SELECT 'qualifying_axis_stale' AS issue, src.driver_number
FROM (
  SELECT DISTINCT sg.driver_number
  FROM raw.starting_grid sg
  JOIN core.sessions s ON s.session_key = sg.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sg.grid_position IS NOT NULL
) src
EXCEPT
SELECT 'qualifying_axis_stale', driver_number
FROM analytics.driver_performance_score_data
WHERE season_year = 2025 AND avg_grid_position IS NOT NULL;

-- Race pace:
SELECT 'race_pace_axis_stale' AS issue, src.driver_number
FROM (
  SELECT DISTINCT sr.driver_number
  FROM raw.session_result sr
  JOIN core.sessions s ON s.session_key = sr.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sr.position IS NOT NULL
) src
EXCEPT
SELECT 'race_pace_axis_stale', driver_number
FROM analytics.driver_performance_score_data
WHERE season_year = 2025 AND avg_race_position IS NOT NULL;

-- Tyre management:
SELECT 'tyre_management_axis_stale' AS issue, src.driver_number
FROM (
  SELECT DISTINCT sdc.driver_number
  FROM analytics.stint_degradation_curve sdc
  JOIN core.sessions s ON s.session_key = sdc.session_key
  WHERE s.year = 2025 AND sdc.degradation_per_lap_s IS NOT NULL
) src
EXCEPT
SELECT 'tyre_management_axis_stale', driver_number
FROM analytics.driver_performance_score_data
WHERE season_year = 2025 AND avg_deg_s IS NOT NULL;

-- Restart:
SELECT 'restart_axis_stale' AS issue, src.driver_number
FROM (
  SELECT DISTINCT rp.driver_number
  FROM analytics.restart_performance rp
  JOIN core.sessions s ON s.session_key = rp.session_key
  WHERE s.year = 2025 AND rp.position_delta IS NOT NULL
) src
EXCEPT
SELECT 'restart_axis_stale', driver_number
FROM analytics.driver_performance_score_data
WHERE season_year = 2025 AND avg_restart_delta IS NOT NULL;

-- Traffic:
SELECT 'traffic_handling_axis_stale' AS issue, src.driver_number
FROM (
  SELECT DISTINCT tap.driver_number
  FROM analytics.traffic_adjusted_pace tap
  JOIN core.sessions s ON s.session_key = tap.session_key
  WHERE s.year = 2025 AND tap.traffic_pace_delta_s IS NOT NULL
) src
EXCEPT
SELECT 'traffic_handling_axis_stale', driver_number
FROM analytics.driver_performance_score_data
WHERE season_year = 2025 AND avg_traffic_delta_s IS NOT NULL;

-- Overtakes: count-based; staleness = source has driver but matview has no row at all
-- for that driver (the row would otherwise exist via season_drivers).
SELECT 'overtake_axis_stale' AS issue, src.driver_number
FROM (
  SELECT DISTINCT oe.overtaking_driver_number AS driver_number
  FROM analytics.overtake_events oe
  JOIN core.sessions s ON s.session_key = oe.session_key
  WHERE s.year = 2025
) src
EXCEPT
SELECT 'overtake_axis_stale', driver_number
FROM analytics.driver_performance_score_data
WHERE season_year = 2025;

-- Penalties: same shape.
SELECT 'error_rate_axis_stale' AS issue, src.driver_number
FROM (
  SELECT DISTINCT rci.driver_number
  FROM analytics.race_control_incidents rci
  JOIN core.sessions s ON s.session_key = rci.session_key
  WHERE s.year = 2025 AND rci.driver_number IS NOT NULL
) src
EXCEPT
SELECT 'error_rate_axis_stale', driver_number
FROM analytics.driver_performance_score_data
WHERE season_year = 2025;

-- B1.6: PER-AXIS VALUE STALENESS (FULL OUTER JOIN edition).
--
-- For each axis, recompute the source-CTE aggregate and FULL OUTER JOIN
-- it to the matview's surfaced raw column. This catches FOUR distinct
-- failure modes per axis:
--
--   1. value_mismatch                — both sides present, numbers differ beyond tolerance
--   2. matview_null_source_has_value — matview surfaced NULL but source has rows (stale; B1.5 also catches the no-row-at-all variant)
--   3. matview_populated_source_absent — matview has a non-null value but source no longer
--                                      has matching rows (matview stale in the reverse direction;
--                                      not caught by the inner-JOIN form in rev4)
--   4. (For count axes) value_mismatch on integer counts (no tolerance)
--
-- NULL handling: every comparison uses explicit `IS NULL` guards rather
-- than COALESCE sentinels, so a metric that legitimately goes negative
-- (e.g. avg_restart_delta) can never collide with a sentinel value.
--
-- Tolerance for averages: 0.001 (≈ float-rounding noise). Counts: exact.
-- Each block returns the offending driver_numbers with the issue label;
-- zero rows across all 7 axis blocks = pass.

-- qualifying (avg_grid_position):
WITH expected AS (
  SELECT sg.driver_number, AVG(sg.grid_position::DOUBLE PRECISION) AS expected_val
  FROM raw.starting_grid sg
  JOIN core.sessions s ON s.session_key = sg.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sg.grid_position IS NOT NULL
  GROUP BY sg.driver_number
),
mv AS (
  SELECT driver_number, avg_grid_position AS mv_val
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT
  'avg_grid_position' AS axis_input,
  COALESCE(mv.driver_number, e.driver_number) AS driver_number,
  mv.mv_val, e.expected_val,
  CASE
    WHEN mv.mv_val IS NULL     AND e.expected_val IS NOT NULL THEN 'matview_null_source_has_value'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NULL     THEN 'matview_populated_source_absent'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
         AND ABS(mv.mv_val - e.expected_val) > 0.001          THEN 'value_mismatch'
  END AS issue
FROM mv
FULL OUTER JOIN expected e USING (driver_number)
WHERE (mv.mv_val IS NULL     AND e.expected_val IS NOT NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
       AND ABS(mv.mv_val - e.expected_val) > 0.001);

-- race_pace (avg_race_position):
WITH expected AS (
  SELECT sr.driver_number, AVG(sr.position::DOUBLE PRECISION) AS expected_val
  FROM raw.session_result sr
  JOIN core.sessions s ON s.session_key = sr.session_key
  WHERE s.year = 2025 AND s.session_name = 'Race' AND sr.position IS NOT NULL
  GROUP BY sr.driver_number
),
mv AS (
  SELECT driver_number, avg_race_position AS mv_val
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT
  'avg_race_position' AS axis_input,
  COALESCE(mv.driver_number, e.driver_number) AS driver_number,
  mv.mv_val, e.expected_val,
  CASE
    WHEN mv.mv_val IS NULL     AND e.expected_val IS NOT NULL THEN 'matview_null_source_has_value'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NULL     THEN 'matview_populated_source_absent'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
         AND ABS(mv.mv_val - e.expected_val) > 0.001          THEN 'value_mismatch'
  END AS issue
FROM mv
FULL OUTER JOIN expected e USING (driver_number)
WHERE (mv.mv_val IS NULL     AND e.expected_val IS NOT NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
       AND ABS(mv.mv_val - e.expected_val) > 0.001);

-- tyre (avg_deg_s):
WITH expected AS (
  SELECT sdc.driver_number, AVG(sdc.degradation_per_lap_s) AS expected_val
  FROM analytics.stint_degradation_curve sdc
  JOIN core.sessions s ON s.session_key = sdc.session_key
  WHERE s.year = 2025 AND sdc.degradation_per_lap_s IS NOT NULL
  GROUP BY sdc.driver_number
),
mv AS (
  SELECT driver_number, avg_deg_s AS mv_val
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT
  'avg_deg_s' AS axis_input,
  COALESCE(mv.driver_number, e.driver_number) AS driver_number,
  mv.mv_val, e.expected_val,
  CASE
    WHEN mv.mv_val IS NULL     AND e.expected_val IS NOT NULL THEN 'matview_null_source_has_value'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NULL     THEN 'matview_populated_source_absent'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
         AND ABS(mv.mv_val - e.expected_val) > 0.001          THEN 'value_mismatch'
  END AS issue
FROM mv
FULL OUTER JOIN expected e USING (driver_number)
WHERE (mv.mv_val IS NULL     AND e.expected_val IS NOT NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
       AND ABS(mv.mv_val - e.expected_val) > 0.001);

-- restart (avg_restart_delta — legitimately signed):
WITH expected AS (
  SELECT rp.driver_number, AVG(rp.position_delta::DOUBLE PRECISION) AS expected_val
  FROM analytics.restart_performance rp
  JOIN core.sessions s ON s.session_key = rp.session_key
  WHERE s.year = 2025 AND rp.position_delta IS NOT NULL
  GROUP BY rp.driver_number
),
mv AS (
  SELECT driver_number, avg_restart_delta AS mv_val
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT
  'avg_restart_delta' AS axis_input,
  COALESCE(mv.driver_number, e.driver_number) AS driver_number,
  mv.mv_val, e.expected_val,
  CASE
    WHEN mv.mv_val IS NULL     AND e.expected_val IS NOT NULL THEN 'matview_null_source_has_value'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NULL     THEN 'matview_populated_source_absent'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
         AND ABS(mv.mv_val - e.expected_val) > 0.001          THEN 'value_mismatch'
  END AS issue
FROM mv
FULL OUTER JOIN expected e USING (driver_number)
WHERE (mv.mv_val IS NULL     AND e.expected_val IS NOT NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
       AND ABS(mv.mv_val - e.expected_val) > 0.001);

-- traffic (avg_traffic_delta_s):
WITH expected AS (
  SELECT tap.driver_number, AVG(tap.traffic_pace_delta_s) AS expected_val
  FROM analytics.traffic_adjusted_pace tap
  JOIN core.sessions s ON s.session_key = tap.session_key
  WHERE s.year = 2025 AND tap.traffic_pace_delta_s IS NOT NULL
  GROUP BY tap.driver_number
),
mv AS (
  SELECT driver_number, avg_traffic_delta_s AS mv_val
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT
  'avg_traffic_delta_s' AS axis_input,
  COALESCE(mv.driver_number, e.driver_number) AS driver_number,
  mv.mv_val, e.expected_val,
  CASE
    WHEN mv.mv_val IS NULL     AND e.expected_val IS NOT NULL THEN 'matview_null_source_has_value'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NULL     THEN 'matview_populated_source_absent'
    WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
         AND ABS(mv.mv_val - e.expected_val) > 0.001          THEN 'value_mismatch'
  END AS issue
FROM mv
FULL OUTER JOIN expected e USING (driver_number)
WHERE (mv.mv_val IS NULL     AND e.expected_val IS NOT NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NULL)
   OR (mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
       AND ABS(mv.mv_val - e.expected_val) > 0.001);

-- overtakes (season_overtakes — integer count; both sides can be 0).
-- Note: matview's season_overtakes is COALESCE'd to 0, so "source absent
-- but matview = 0" is INDISTINGUISHABLE from "source has 0 events". We
-- only fail when matview's count differs from the source count and at
-- least one side > 0.
WITH expected AS (
  SELECT oe.overtaking_driver_number AS driver_number, COUNT(*)::INT AS expected_cnt
  FROM analytics.overtake_events oe
  JOIN core.sessions s ON s.session_key = oe.session_key
  WHERE s.year = 2025
  GROUP BY oe.overtaking_driver_number
),
mv AS (
  SELECT driver_number, season_overtakes AS mv_cnt
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT
  'season_overtakes' AS axis_input,
  COALESCE(mv.driver_number, e.driver_number) AS driver_number,
  mv.mv_cnt AS matview_val, COALESCE(e.expected_cnt, 0) AS expected_val,
  CASE
    WHEN mv.mv_cnt IS NULL                                   THEN 'matview_missing_driver_row'
    WHEN mv.mv_cnt <> COALESCE(e.expected_cnt, 0)            THEN 'value_mismatch'
  END AS issue
FROM mv
FULL OUTER JOIN expected e USING (driver_number)
WHERE mv.mv_cnt IS NULL
   OR mv.mv_cnt <> COALESCE(e.expected_cnt, 0);

-- penalties (season_penalties — same shape; same COALESCE caveat).
WITH expected AS (
  SELECT rci.driver_number,
         COUNT(*) FILTER (WHERE rci.action_status IN ('time_penalty', 'drive_through', 'grid_penalty'))::INT
           AS expected_cnt
  FROM analytics.race_control_incidents rci
  JOIN core.sessions s ON s.session_key = rci.session_key
  WHERE s.year = 2025 AND rci.driver_number IS NOT NULL
  GROUP BY rci.driver_number
),
mv AS (
  SELECT driver_number, season_penalties AS mv_cnt
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT
  'season_penalties' AS axis_input,
  COALESCE(mv.driver_number, e.driver_number) AS driver_number,
  mv.mv_cnt AS matview_val, COALESCE(e.expected_cnt, 0) AS expected_val,
  CASE
    WHEN mv.mv_cnt IS NULL                                   THEN 'matview_missing_driver_row'
    WHEN mv.mv_cnt <> COALESCE(e.expected_cnt, 0)            THEN 'value_mismatch'
  END AS issue
FROM mv
FULL OUTER JOIN expected e USING (driver_number)
WHERE mv.mv_cnt IS NULL
   OR mv.mv_cnt <> COALESCE(e.expected_cnt, 0);

-- B2: sanity check the matview itself exists, is populated, and has its unique index.
SELECT schemaname, matviewname,
       pg_size_pretty(pg_relation_size(format('%I.%I', schemaname, matviewname)::regclass)) AS size,
       ispopulated
FROM pg_matviews
WHERE schemaname = 'analytics' AND matviewname = 'driver_performance_score_data';
```

**Refresh command** (operator action — requires explicit user confirmation before running on prod):

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.driver_performance_score_data;
```

`CONCURRENTLY` is safe because the unique index `driver_performance_score_data_pk` exists
([045:164-165](sql/migrations/deploy/045_analytics_driver_performance_score.sql)). The facade view
`analytics.driver_performance_score` is a thin `SELECT *` and does not need to be refreshed.

**Remediation paths**:
1. **One-shot refresh** — run the command above, then re-run A1/A2 to confirm 2025 values populate.
2. **Refresh cadence documentation** — if a cron / job is supposed to refresh nightly, document where
   it lives and verify it's running.
3. **Refresh observability table** — add `analytics._refresh_audit (matview_name TEXT, last_refresh TIMESTAMPTZ)`
   populated by whichever job calls `REFRESH MATERIALIZED VIEW`; B1 then becomes a one-line query.

### Branch C · `error_rate_axis` semantic direction — **verify deployed DB matches migration 045**

The deployed migration is explicit:

> `analytics.driver_performance_score` view comment (migration 045):
> *"Each axis is a 0-100 derived score (higher = better). … `error_rate_axis = (10 - season_penalties) * 10`."*

So the matview **already inverts** penalties → "higher = better". The chart-side rename
`error_rate_axis → "Consistency"` is consistent with the DDL's intent and requires no further code
change provided the deployed database matches the migration.

**Verification queries** (note: rev1's C2 against 2024 cannot work because the matview is hardcoded
to `s.year = 2025` — there is no historical data inside this matview. C2 below uses 2025; a separate
optional historical sanity check on the source table itself follows as C3):

```sql
-- C1: SMOKE TEST only. Deparsed pg_matviews definitions are not stable
-- across Postgres versions — they may carry "::double precision" casts,
-- reformat whitespace, or move parentheses. Treat C1 as a fast tripwire,
-- not as the authoritative formula check. The authoritative gate is C2
-- (formula-consistency recompute) which compares actual surfaced values
-- to the migration formula and is immune to deparse variation.
SELECT
  matviewname,
  -- presence checks
  definition ~* 'season_penalties[^)]*10'                                 AS formula_mentions_penalties_and_10,
  definition ~* 'error_rate_axis'                                         AS column_present,
  -- shape check, widened to accept:
  --   (10 - LEAST(...
  --   (10.0 - LEAST(...
  --   (10::double precision - LEAST(...
  --   (10.0::double precision - LEAST(...
  -- Optional ".0" + optional "::<type>" cast (including a two-word "double precision").
  definition ~* '\(10(\.0)?(::\w+(\s+\w+)?)?\s*-\s*LEAST\s*\(\s*COALESCE\s*\(\s*er\.season_penalties'
                                                                          AS formula_inverts_via_10_minus
FROM pg_matviews
WHERE schemaname = 'analytics' AND matviewname = 'driver_performance_score_data';

-- Out-of-DB check (run from shell):
--   diff <(psql -tAc "SELECT definition FROM pg_matviews WHERE matviewname='driver_performance_score_data';" \
--         | grep -oE '[Ee]rror[^,;]*season_penalties[^,]*') \
--        <(grep -A 2 'error_rate_axis' sql/migrations/deploy/045_analytics_driver_performance_score.sql)

-- C2: formula-consistency check (not a distribution check).
-- For every populated row, the surfaced error_rate_axis must equal
--   GREATEST(0, LEAST(100, (10 - LEAST(season_penalties, 10)) * 10))
-- to within floating-point rounding. This proves the deployed matview
-- applies the migration-045 formula correctly, regardless of how
-- penalty-light or penalty-heavy the 2025 field happens to be.
-- (Earlier rev's "dirtiest at axis ≤ 30" check could silently fail
-- against a clean season even when the formula is correct.)
WITH recomputed AS (
  SELECT
    driver_number,
    driver_name,
    season_penalties,
    error_rate_axis                                                        AS actual_axis,
    GREATEST(0, LEAST(100, (10.0 - LEAST(season_penalties, 10)) * 10.0))   AS expected_axis
  FROM analytics.driver_performance_score_data
  WHERE season_year = 2025
)
SELECT *
FROM recomputed
WHERE ABS(actual_axis - expected_axis) > 0.001
ORDER BY ABS(actual_axis - expected_axis) DESC;
-- Pass condition: zero rows. Any row indicates the deployed matview's
-- error_rate_axis expression differs from the migration formula.

-- C3 (optional historical sanity check, bypasses the matview's 2025 hard-pin):
-- If 2024 source data is loaded, this confirms direction independent of migration 045's filter.
SELECT s.year AS season_year, rci.driver_number,
       COUNT(*) FILTER (WHERE rci.action_status IN ('time_penalty', 'drive_through', 'grid_penalty'))
         AS season_penalties_observed
FROM analytics.race_control_incidents rci
JOIN core.sessions s ON s.session_key = rci.session_key
WHERE s.year IN (2024, 2025)
GROUP BY s.year, rci.driver_number
ORDER BY s.year, season_penalties_observed DESC;
-- If 2024 has rows: cross-reference top-penalty drivers against external knowledge (Hamilton 2024
-- was famously clean — should have low penalty count). If 2024 has no rows, this branch is purely
-- a deployment-consistency check via C2 (with C1 logged as smoke only).
```

**Remediation paths** (mutually exclusive — only one will apply; **C2 is the authoritative gate**):
1. **If C2 returns zero rows (formula correct)** — no code change. Pin the semantic in a comment on
   [registry.ts:608-609](web/src/lib/mapInsight/detectors/registry.ts#L608-L609)
   pointing at migration 045 so future readers know the matview owns the inversion. C1's smoke-test
   result is informational only and does not gate this decision.
2. **If C2 returns rows and the deviation is uniform** (every row off by a constant factor or sign)
   — deployed DB has drifted from migration 045; re-deploy or investigate why the matview wasn't
   rebuilt with the new formula.
3. **If C2 returns rows and the deviation looks like "axis = season_penalties * 10"** (i.e. the
   inversion is absent) — the matview is NOT inverting penalties. The smallest reversible fix is
   the chart-layer inverter: in [registry.ts](web/src/lib/mapInsight/detectors/registry.ts), the
   radar `build()` maps `error_rate_axis → consistency_axis` with `100 - value`. Longer-term, fix
   migration 045's expression so the matview owns the inversion.

---

## 5 · Acceptance criteria (whole plan)

Before declaring the data-quality issue resolved, all of the following must hold:

1. **Per-axis populate threshold** (run A1 + A2 for `season_year = 2025`):
   - `qual_src_drivers ≥ 18` AND mean `qualifying_axis` ≥ 30
   - `race_src_drivers ≥ 18` AND mean `race_pace_axis` ≥ 30
   - `tyre_src_drivers ≥ 18` AND mean `tyre_management_axis` ≥ 20
   - `overtake_src_drivers ≥ 15`. (Threshold lower because a driver with zero overtakes legitimately
     has no source row; 15-of-20 leaves room for slow-paced drivers.)
   - Source-row populated counts (`qual_src_drivers / race_src_drivers / tyre_src_drivers`) and
     surfaced raw-column populated counts (`qual_input_populated / race_input_populated /
     tyre_input_populated`) must agree to within 2 drivers. (Mismatch ⇒ JOIN bug.)
2. **`traffic_handling_axis` primary team-mate populate consistency** (explicit regression query —
   addresses audit MEDIUM #2/#3):
   ```sql
   -- Rank drivers within each team by race participation in 2025
   -- (number of race-session rows in core.session_drivers ⋈ core.sessions).
   -- The top two are the "primary roster"; anyone ranked 3+ is treated as a
   -- reserve / temporary driver and EXCLUDED from the check.
   --
   -- Participation is counted by (driver_number, team_name), NOT by
   -- driver_number alone — otherwise a mid-season swap (e.g. Doohan moving
   -- to a different team, or Colapinto stepping into Alpine) would have
   -- their session rows counted in the wrong team and disrupt either
   -- team's ranking. By keeping the team_name in the GROUP BY, a driver who
   -- raced for two teams in the same season is ranked separately within
   -- each team's roster.
   WITH race_participation AS (
     SELECT sd.driver_number, sd.team_name,
            COUNT(*) AS race_rows
     FROM core.session_drivers sd
     JOIN core.sessions s ON s.session_key = sd.session_key
     WHERE s.year = 2025 AND s.session_name = 'Race'
     GROUP BY sd.driver_number, sd.team_name
   ),
   ranked AS (
     SELECT dps.season_year, dps.team_name, dps.driver_number, dps.driver_name,
            dps.traffic_handling_axis, dps.avg_traffic_delta_s,
            ROW_NUMBER() OVER (
              PARTITION BY dps.season_year, dps.team_name
              ORDER BY COALESCE(rp.race_rows, 0) DESC, dps.driver_number
            ) AS team_rank
     FROM analytics.driver_performance_score_data dps
     LEFT JOIN race_participation rp
       ON rp.driver_number = dps.driver_number
      AND rp.team_name     = dps.team_name
     WHERE dps.season_year = 2025
   ),
   primary_pair AS (
     SELECT season_year, team_name,
            ARRAY_AGG(driver_name ORDER BY team_rank)                              AS drivers,
            ARRAY_AGG(traffic_handling_axis ORDER BY team_rank)                    AS axis_vals,
            ARRAY_AGG((avg_traffic_delta_s IS NOT NULL)::int ORDER BY team_rank)   AS input_populated_flags
     FROM ranked
     WHERE team_rank <= 2
     GROUP BY season_year, team_name
   )
   SELECT team_name, drivers, axis_vals, input_populated_flags
   FROM primary_pair
   WHERE array_length(drivers, 1) = 2  -- only teams with at least two primary entries
     AND input_populated_flags @> ARRAY[0]
     AND input_populated_flags @> ARRAY[1];
   -- Pass condition: zero rows. Any row indicates a primary team-mate populate
   -- inconsistency that needs inspection (most likely cause: stray driver_number
   -- / non-overlapping session participation in the traffic_adjusted_pace source).
   -- Reserve / 3rd-driver swaps are excluded by the team_rank <= 2 cap.
   -- Note: this is a *signal* check — a genuine asymmetry (e.g. a primary driver
   -- missed half a season due to injury) is a legitimate finding to document,
   -- not necessarily a bug to fix.
   ```
3. **`error_rate_axis` direction & formula** — Branch C `C2` (formula-consistency recompute) is
   the only hard gate: it must return **zero rows**, i.e. every populated row's `error_rate_axis`
   matches the migration formula within float-rounding (tolerance `0.001`).
   Branch C `C1` (definition-regex smoke test) is **logged but does not gate** — its result is
   captured for telemetry / debugging, but a FALSE on any regex column is not by itself a
   failure (deparsed `pg_matviews.definition` can carry cast suffixes or whitespace variants
   that defeat the pattern even when the formula is correct, which is why C2 was made
   authoritative in rev4).
4. **Caveat surfaced** — for any axis that fails (1) on a *deliberately incomplete season* (e.g.
   in-progress), the radar chart caption reads *"⚠ N of 7 axes not yet populated"* or the synthesis
   prompt emits an equivalent `key_takeaway`. Floor-clamped 0s must never silently render as a real
   data point.
5. **Regression query lives in repo** — `scripts/health/driver_performance_score_health.mjs` runs
   all four protections against the **target season** (default 2025; script accepts an explicit
   `--season=YYYY` argument so the gate doesn't drift when 2026 data lands and the matview's
   hardcoded year is bumped). Exits non-zero if any one of these trips:
   - **A2** (per-axis source-row count vs threshold)
   - **B1.5** (existence anti-join: source has driver, matview missing populated row)
   - **B1.6** (full-outer-join staleness: catches three failure modes per axis —
     `matview_null_source_has_value`, `matview_populated_source_absent`, `value_mismatch` — the
     strongest new protection introduced in rev4 and hardened in rev5)
   - **§5 criterion 2** (primary team-mate populate consistency for `traffic_handling_axis`)

   CI / Codex can verify by running it. Each check produces a distinct exit code or stderr line so
   the failure mode is identifiable from the script's output.
6. **The next plan revision documents the chosen remediation per branch + links the fix PRs.**

---

## 6 · Out of scope (deliberately)

- Other Phase-21 matviews. If they have similar gaps, a separate plan can lift the diagnostic pattern
  but this plan is scoped to `driver_performance_score_data`.
- The chat-side label cleanup (`qualifying_axis → "Qualifying"`, etc.). That shipped already, is
  purely cosmetic, and does not affect data values.
- Replacing the matview with on-demand computation. That's a roadmap-level decision; out of scope
  for a fix-the-data plan.
- Removing the matview's `WHERE s.year = 2025` hardcode. Multi-season support is a separate change
  with its own migration; this plan only fixes the *currently filtered* season.

---

## 7 · Codex audit prompt

> Re-audit this rev5 plan for: (1) internal contradictions, (2) missing branches or unstated
> assumptions (especially any audit finding from rev4 that the rev5 response failed to fully
> address — cross-check the "rev5 audit response" section at the top against the rev4 findings;
> rev0 + rev1 + rev2 + rev3 findings should still be closed), (3) scope creep, (4) any
> remediation path that would silently change user-visible behavior without a documented caveat,
> (5) the acceptance criteria's ability to detect a regression and to detect a "populated but
> bad" state distinct from "missing inputs masquerading as zero" and also distinct from
> "populated but stale value", (6) whether every source-table reference in §3 names a deployed
> migration and a column actually used by migration 045, (7) whether B1.6's `FULL OUTER JOIN`
> branches actually cover all three reverse cases without false-positives (specifically: does
> the integer-count `season_overtakes`/`season_penalties` block correctly distinguish
> "matview-missing-driver" from "both-sides-zero"?), (8) whether removing `COALESCE` sentinels
> in favor of explicit NULL guards introduces any new edge case (e.g. cross-NULL semantics in
> `ABS()`), (9) whether the health-gate script's `--season=YYYY` argument is genuinely necessary
> or whether pinning to the matview's hardcoded year is safer, and (10) whether Branch C's
> remediation paths now correctly reflect that C2 is authoritative and C1 is logged-only.
> Report a punch list of concrete edits — section by section — under 400 words. Do not rewrite
> the plan.

---

## 8 · Source context (the conversation excerpt that triggered this plan)

> Verified: typecheck + 29/29 adapter tests pass.
>
> **Label cleanup** ([registry.ts](web/src/lib/mapInsight/detectors/registry.ts), radar detector):
>
> - New `RADAR_AXIS_LABELS` map: `qualifying_axis → "Qualifying"`, `race_pace_axis → "Race Pace"`,
>   `tyre_management_axis → "Tyre Mgmt"`, `restart_axis → "Restart"`, `traffic_handling_axis → "Traffic"`,
>   `overtake_difficulty_axis → "Overtaking"`, `error_rate_axis → "Consistency"` (matches the v0 mock —
>   and inverts the awkward "higher = worse" framing).
> - Generic fallback strips a trailing `_axis` for any future columns we don't explicitly map.
>
> **On the data quality question** — your skepticism is well-founded. Looking at your result preview,
> `qualifying_axis / race_pace_axis / tyre_management_axis` are returning **0 for both drivers**, which
> is implausible for two top-3 drivers. Three diagnoses worth checking in order:
>
> 1. **Most likely**: `analytics.driver_performance_score` was built with a more aggressive
>    populate-on-write strategy than the others, and some sub-aggregations require data this view
>    doesn't yet have for 2025 (mid-season).
> 2. **Worth checking**: run an aggregation query across seasons to see if 2024 has values but 2025
>    doesn't (i.e., the matview needs a refresh).
> 3. **Edge case**: the chart-side rename treats `error_rate_axis` as already inverted; if the
>    matview literally stores an error count (higher = more errors), the polygon orientation is
>    backwards.

---

## 9 · Audit history

### rev0 audit (Codex, 2026-05-23)

- HIGH: Wrong object name in catalog queries (matview is `driver_performance_score_data`, not the
  facade `driver_performance_score`).
- HIGH: Branch B refresh SQL not executable — `pg_stat_user_tables` has no `last_refresh` column.
- MEDIUM: Branch C framed as unknown despite migration 045 documenting direction and formula.
- MEDIUM: Branch A diagnostics average away the populate failure because `COALESCE(..., default)`
  emits valid-looking values.
- MEDIUM: Acceptance criteria too weak.
- LOW: Symptom wording — "P1/P2 constructors' championship" describes teams not drivers.

All 6 closed in rev1.

### rev1 audit (Codex, 2026-05-23)

- HIGH: B1 uses source columns that likely don't exist (source views are session-key based, not
  `season_year` based).
- HIGH: `CURRENT_DATE` makes B1 wrong now (today is 2026 but investigated season is 2025).
- HIGH: C2 cannot work against migration 045 as written (matview hardcoded to `s.year = 2025`;
  there's no 2024 row inside it).
- MEDIUM: A2 still confuses "zero means missing" with legitimate zero for count axes
  (`season_overtakes` / `season_penalties`).
- MEDIUM: Acceptance criterion for traffic is under-specified SQL-wise.
- LOW: C1 substring match is brittle.

All 6 closed in rev2.

### rev2 audit (Codex, 2026-05-24)

- HIGH: C1 regex `\(10\s*[-.]+\s*LEAST...` does not allow the `.0` between `10` and the `-` —
  deployed expression is `(10.0 - LEAST(...)`. False-fails likely.
- MEDIUM: B1 is a source-density check, not a refresh-staleness check; needs source-CTE
  EXCEPT-anti-join against the matview's populated rows per axis.
- MEDIUM: C2 acceptance ("dirtiest at axis ≤ 30") can fail for a clean season even when the
  formula is correct. Reframe as formula consistency.
- MEDIUM: Traffic team-mate query uses `array_length >= 2`; reserve / 3rd-driver swaps create
  false-positive mixed flags. Restrict to primary roster (top 2 by race participation).
- LOW: §3 wording — "source matviews" should be "source tables/views" since raw tables are
  included.

All 5 closed in rev3.

### rev3 audit (Codex, 2026-05-24)

- MEDIUM: B1.5 detects only missing driver-pairs, not stale values; needs recomputed
  aggregate-vs-matview value comparisons for `avg_grid_position`, `avg_race_position`, `avg_deg_s`,
  `avg_traffic_delta_s`, `season_overtakes`, `season_penalties` (and `avg_restart_delta`).
- MEDIUM: B1 source-density query is looser than migration 045 — missing `session_name='Race'` and
  non-null metric filters on raw grid / session_result; can imply availability the matview
  correctly ignores.
- MEDIUM: Health/regression gate omits B1.5 / B1.6 — rev3's biggest new protection isn't in the
  CI script.
- LOW: C1 regex accepts `10` and `10.0` but not `10.0::double precision`; either widen or demote
  C1 to a smoke test and rely on C2 as authoritative.
- LOW: §2 still says "rev2 queries" even though it's rev3.
- LOW: Traffic primary-pair ranks race participation by `driver_number` alone, ignoring
  `team_name` — mid-season team changes distort the ranking.

All 6 closed in rev4.

### rev4 audit (Codex, 2026-05-24)

- MEDIUM: Acceptance criterion 3 still required C1 to return TRUE as a hard gate, contradicting
  Branch C's demotion of C1 to a smoke test.
- MEDIUM: B1.6 used inner JOIN `dps JOIN expected`, so the reverse case (matview has a populated
  value, source row no longer exists) was undetected. Needs FULL OUTER JOIN.
- LOW: B1.6 used sentinel `COALESCE` values (`-1`, `-999`) in float comparisons; can collide with
  legitimate negative metrics (e.g. `avg_restart_delta`). Replace with explicit NULL guards.
- LOW: Health-gate wording said "current season" but plan pins target_season = 2025; should say
  "target season" with explicit `--season=YYYY` arg.
- LOW: Acceptance criterion 6 said "Plan rev3 documents…" while the document is at rev4. Make
  generic.

All 5 closed in rev5.

### rev5 audit (Codex, 2026-05-24)

- LOW: Branch C `C3` still says "via C1" while the rest of Branch C names C2 as authoritative.
- LOW: Three live-prose instances of "source matview" remained after the rev3 scope correction
  (raw tables are now in the catalog too).
- LOW: Branch B intro said "rev2 uses freshness comparison"; should be revision-neutral.

No blocking findings. Closed in rev6 alongside end-to-end implementation; see "rev6 audit response
+ implementation" summary at the top.
