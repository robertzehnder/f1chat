-- Deploy openf1:037_analytics_pit_loss_per_circuit to pg
-- requires: 036_analytics_weather_impact
--
-- Phase 21 Tier 1 (slice 21-pit-loss-per-circuit): per-(session,
-- driver, stop_number) pit-stop time loss. Pit-loss is the gap
-- between the in-lap + out-lap pace and the driver's clean-air
-- baseline pace, summed across the in-lap and out-lap pair.
--
-- Source data: core.laps_enriched gives is_pit_lap, is_pit_out_lap,
-- and lap_duration. The driver-session median valid lap is the
-- baseline. pit_loss_s = (pit_in_lap_s + pit_out_lap_s) - 2 * baseline.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.pit_loss_per_circuit_data AS
WITH driver_baseline AS (
  -- The driver's clean-air baseline lap is the median valid lap
  -- (excluding pit-lane laps and the pit-out lap).
  SELECT
    le.session_key,
    le.driver_number,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY le.lap_duration)::DOUBLE PRECISION
      AS baseline_lap_s
  FROM core.laps_enriched le
  WHERE le.is_valid = TRUE
    AND COALESCE(le.is_pit_lap, FALSE) = FALSE
    AND COALESCE(le.is_pit_out_lap, FALSE) = FALSE
    AND le.lap_duration IS NOT NULL
  GROUP BY le.session_key, le.driver_number
),
pit_pairs AS (
  -- Pair each pit-in lap with the next pit-out lap for the same
  -- (session, driver). Use ROW_NUMBER over (session, driver,
  -- pit-flag) to associate the in-lap and out-lap.
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number,
    le.lap_duration::DOUBLE PRECISION AS lap_duration_s,
    le.is_pit_lap,
    le.is_pit_out_lap,
    le.compound_name,
    le.stint_number
  FROM core.laps_enriched le
  WHERE (COALESCE(le.is_pit_lap, FALSE) = TRUE
      OR COALESCE(le.is_pit_out_lap, FALSE) = TRUE)
    AND le.lap_duration IS NOT NULL
),
pit_in_laps AS (
  SELECT
    session_key,
    driver_number,
    driver_name,
    team_name,
    lap_number,
    lap_duration_s,
    ROW_NUMBER() OVER (
      PARTITION BY session_key, driver_number ORDER BY lap_number
    ) AS stop_number
  FROM pit_pairs
  WHERE is_pit_lap = TRUE
),
pit_out_laps AS (
  SELECT
    session_key,
    driver_number,
    lap_number     AS out_lap_number,
    lap_duration_s AS out_lap_duration_s,
    compound_name  AS new_compound_name,
    stint_number   AS new_stint_number,
    ROW_NUMBER() OVER (
      PARTITION BY session_key, driver_number ORDER BY lap_number
    ) AS stop_number
  FROM pit_pairs
  WHERE is_pit_out_lap = TRUE
)
SELECT
  pi.session_key,
  pi.driver_number,
  pi.driver_name,
  pi.team_name,
  pi.stop_number,
  pi.lap_number               AS pit_in_lap_number,
  po.out_lap_number,
  pi.lap_duration_s           AS pit_in_lap_s,
  po.out_lap_duration_s       AS pit_out_lap_s,
  po.new_compound_name,
  po.new_stint_number,
  db.baseline_lap_s,
  -- pit_loss_s: how many seconds the pit-cycle cost vs. running
  -- two clean-air laps. Positive = the stop cost time. NULL when
  -- baseline can't be computed (very short sessions).
  ((pi.lap_duration_s + COALESCE(po.out_lap_duration_s, 0)) - 2.0 * db.baseline_lap_s)::DOUBLE PRECISION
    AS pit_loss_s
FROM pit_in_laps pi
LEFT JOIN pit_out_laps po
  ON po.session_key   = pi.session_key
 AND po.driver_number = pi.driver_number
 AND po.stop_number   = pi.stop_number
LEFT JOIN driver_baseline db
  ON db.session_key   = pi.session_key
 AND db.driver_number = pi.driver_number;

CREATE INDEX IF NOT EXISTS pit_loss_per_circuit_data_session_idx
  ON analytics.pit_loss_per_circuit_data (session_key);

CREATE INDEX IF NOT EXISTS pit_loss_per_circuit_data_driver_idx
  ON analytics.pit_loss_per_circuit_data (session_key, driver_number);

CREATE OR REPLACE VIEW analytics.pit_loss_per_circuit AS
SELECT * FROM analytics.pit_loss_per_circuit_data;

COMMENT ON VIEW analytics.pit_loss_per_circuit IS
  'Phase 21 (slice 21-pit-loss-per-circuit): per-(session, driver, stop_number) pit-stop time loss. pit_loss_s = (pit_in_lap_s + pit_out_lap_s) - 2 * baseline_lap_s, where baseline_lap_s is the driver-session median valid clean-air lap. Positive = pit cost time vs running two clean laps. Filter session_key to compare per-circuit; aggregate by team for team-level comparisons.';

COMMIT;
