-- Deploy openf1:046_analytics_telemetry_coverage_per_driver to pg
-- requires: 045_analytics_driver_performance_score
--
-- Phase 25 follow-up (Track 4): per-(session, driver) car-data
-- telemetry coverage. Phase 19 baseline q2182 ("Which 2025 race
-- sessions are missing more than 5% of car telemetry samples for
-- any driver?") was manifest-capped at B because no per-driver
-- coverage matview existed. This slice ships that coverage so
-- q2182 can lift to A.
--
-- Approach: aggregate raw.car_data sample counts per (session_key,
-- driver_number) and compare against the session-level expected
-- sample count per driver (median across drivers in the session).
-- A driver is "missing > X% of samples" when their count is below
-- (median * (1 - X)).

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.telemetry_coverage_per_driver_data AS
WITH per_driver_counts AS (
  SELECT
    cd.session_key,
    cd.driver_number,
    COUNT(*) AS car_data_samples
  FROM raw.car_data cd
  GROUP BY cd.session_key, cd.driver_number
),
session_median AS (
  SELECT
    session_key,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY car_data_samples)::DOUBLE PRECISION
      AS median_samples_per_driver,
    MAX(car_data_samples) AS max_samples_per_driver
  FROM per_driver_counts
  GROUP BY session_key
)
SELECT
  pdc.session_key,
  pdc.driver_number,
  MAX(rd.full_name)            AS driver_name,
  MAX(rd.team_name)            AS team_name,
  pdc.car_data_samples,
  sm.median_samples_per_driver,
  sm.max_samples_per_driver,
  -- Missing-percentage relative to session median.
  CASE
    WHEN sm.median_samples_per_driver > 0
      THEN (1.0 - pdc.car_data_samples::DOUBLE PRECISION / sm.median_samples_per_driver) * 100.0
    ELSE NULL
  END AS missing_pct_vs_median,
  -- Boolean convenience flags for the question's "more than 5%" / "more than 10%" thresholds.
  CASE
    WHEN sm.median_samples_per_driver > 0
      AND pdc.car_data_samples::DOUBLE PRECISION < sm.median_samples_per_driver * 0.95
    THEN TRUE
    ELSE FALSE
  END AS missing_more_than_5pct,
  CASE
    WHEN sm.median_samples_per_driver > 0
      AND pdc.car_data_samples::DOUBLE PRECISION < sm.median_samples_per_driver * 0.90
    THEN TRUE
    ELSE FALSE
  END AS missing_more_than_10pct
FROM per_driver_counts pdc
LEFT JOIN raw.drivers rd
  ON rd.session_key   = pdc.session_key
 AND rd.driver_number = pdc.driver_number
JOIN session_median sm ON sm.session_key = pdc.session_key
GROUP BY
  pdc.session_key, pdc.driver_number, pdc.car_data_samples,
  sm.median_samples_per_driver, sm.max_samples_per_driver;

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_coverage_per_driver_data_pk
  ON analytics.telemetry_coverage_per_driver_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS telemetry_coverage_per_driver_data_session_idx
  ON analytics.telemetry_coverage_per_driver_data (session_key);

CREATE INDEX IF NOT EXISTS telemetry_coverage_per_driver_data_missing_idx
  ON analytics.telemetry_coverage_per_driver_data (missing_more_than_5pct);

CREATE OR REPLACE VIEW analytics.telemetry_coverage_per_driver AS
SELECT * FROM analytics.telemetry_coverage_per_driver_data;

COMMENT ON VIEW analytics.telemetry_coverage_per_driver IS
  'Per-(session, driver) car-data sample count vs the session median. missing_more_than_5pct flags drivers whose sample count is below 95% of the session median (a proxy for FIA "missing > 5% of telemetry"). Lift target for Phase 19 q2182 (was manifest B-cap pending this matview).';

COMMIT;
