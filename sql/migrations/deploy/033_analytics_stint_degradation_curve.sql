-- Deploy openf1:033_analytics_stint_degradation_curve to pg
-- requires: 032_analytics_sector_dominance
--
-- Phase 21 Tier 1 (slice 21-stint-degradation-curve): per-driver
-- per-stint linear-fit lap-time degradation. Each row covers one
-- (session_key, driver_number, stint_number) tuple and reports
-- the fitted slope of valid lap_duration vs lap_number — the
-- canonical "degradation per lap" metric F1 analysts cite.
--
-- Storage matview + facade view pattern (Phase 18-C) so dependents
-- (Phase 21 Tier 4 driver-performance-7axis aggregator) stay
-- relkind-stable across refreshes.
--
-- Phase 25.2 ship: lifts q2020 / q2024 / q2026 to A directly
-- (single-matview questions). q1947 / q1949 / q2028 / q2203 / q2207
-- additionally need 21-fuel-corrected-pace and / or 21-weather-impact
-- and ship to A when those slices land.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.stint_degradation_curve_data AS
WITH per_lap AS (
  -- Pull only valid laps; pit-out / pit-in laps and any lap flagged
  -- invalid by the validity layer are excluded so the regression
  -- isn't dominated by outliers (entry / exit laps in particular
  -- are systematically slow but not degradation-driven).
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.stint_number,
    le.compound_name,
    le.lap_number,
    le.lap_duration,
    le.fuel_adj_lap_time
  FROM core.laps_enriched_mat le
  WHERE le.is_valid = TRUE
    AND le.stint_number IS NOT NULL
    AND le.lap_duration IS NOT NULL
)
SELECT
  pl.session_key,
  pl.driver_number,
  MAX(pl.driver_name)                                                        AS driver_name,
  MAX(pl.team_name)                                                          AS team_name,
  pl.stint_number,
  -- compound_name is constant within a stint; MAX is just an aggregator.
  MAX(pl.compound_name)                                                      AS compound_name,
  MIN(pl.lap_number)                                                         AS lap_start,
  MAX(pl.lap_number)                                                         AS lap_end,
  (MAX(pl.lap_number) - MIN(pl.lap_number) + 1)                              AS stint_length_laps,
  COUNT(*)                                                                   AS valid_lap_count,
  -- REGR_SLOPE returns the fitted slope of (Y, X) where Y is the
  -- dependent variable (lap_duration) and X is the predictor
  -- (lap_number). Positive value = lap times grow as the stint
  -- progresses (the canonical "deg per lap" interpretation).
  -- NULL when fewer than 2 valid laps remain in the stint.
  REGR_SLOPE(pl.lap_duration, pl.lap_number)::DOUBLE PRECISION               AS degradation_per_lap_s,
  REGR_INTERCEPT(pl.lap_duration, pl.lap_number)::DOUBLE PRECISION           AS intercept_lap_s,
  REGR_R2(pl.lap_duration, pl.lap_number)::DOUBLE PRECISION                  AS regression_r2,
  -- Fuel-corrected slope mirrors the raw slope but uses
  -- fuel_adj_lap_time (Phase 6's per-lap fuel correction) when
  -- available. Lets downstream answers cite the "fuel-corrected
  -- deg" figure without needing a JOIN to 21-fuel-corrected-pace
  -- for the canonical case.
  REGR_SLOPE(pl.fuel_adj_lap_time, pl.lap_number)::DOUBLE PRECISION          AS fuel_corrected_degradation_per_lap_s,
  MIN(pl.lap_duration)::DOUBLE PRECISION                                     AS best_lap_s,
  MAX(pl.lap_duration)::DOUBLE PRECISION                                     AS worst_lap_s,
  AVG(pl.lap_duration)::DOUBLE PRECISION                                     AS avg_lap_s
FROM per_lap pl
GROUP BY pl.session_key, pl.driver_number, pl.stint_number;

CREATE UNIQUE INDEX IF NOT EXISTS stint_degradation_curve_data_pk
  ON analytics.stint_degradation_curve_data (session_key, driver_number, stint_number);

CREATE INDEX IF NOT EXISTS stint_degradation_curve_data_session_idx
  ON analytics.stint_degradation_curve_data (session_key);

CREATE INDEX IF NOT EXISTS stint_degradation_curve_data_compound_idx
  ON analytics.stint_degradation_curve_data (compound_name);

-- Facade view — the LLM-stable contract.
CREATE OR REPLACE VIEW analytics.stint_degradation_curve AS
SELECT * FROM analytics.stint_degradation_curve_data;

COMMENT ON VIEW analytics.stint_degradation_curve IS
  'Phase 21 (slice 21-stint-degradation-curve): per-(session, driver, stint) linear-fit lap-time degradation. degradation_per_lap_s is the REGR_SLOPE of lap_duration vs lap_number across the valid laps of the stint. fuel_corrected_degradation_per_lap_s applies the same regression to fuel_adj_lap_time when available. Filter on session_key + driver_number for per-stint deg curves; filter on compound_name for compound-comparison answers.';

COMMIT;
