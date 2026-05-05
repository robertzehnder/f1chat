-- Deploy openf1:045_analytics_driver_performance_score to pg
-- requires: 044_analytics_straight_line_dominance
--
-- Phase 21 Tier 4 (slice 21-driver-performance-7axis): per-driver
-- season-aggregate seven-axis performance score. Each axis is a
-- 0-100 score derived from upstream Phase 21 matviews; higher =
-- better. The matview only ships rows for the current season's
-- Race sessions; qualifying/sprint axes use the same season's
-- non-Race sessions where appropriate.
--
-- Axes:
--   qualifying_axis        — avg starting position normalized
--   race_pace_axis         — avg race finish position normalized
--   tyre_management_axis   — inverse of avg degradation_per_lap_s
--   restart_axis           — avg restart position_delta normalized
--   traffic_handling_axis  — inverse of traffic_pace_delta_s
--   overtake_difficulty_axis — total overtakes recorded
--   error_rate_axis        — inverse of race-control-incidents count

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.driver_performance_score_data AS
WITH season_drivers AS (
  -- Drivers active in the season (have at least one race session row)
  SELECT DISTINCT
    s.year                      AS season_year,
    sd.driver_number,
    MAX(sd.full_name)           AS driver_name,
    MAX(sd.team_name)           AS team_name
  FROM core.session_drivers sd
  JOIN core.sessions s ON s.session_key = sd.session_key
  WHERE s.year = 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
  GROUP BY s.year, sd.driver_number
),
-- Per-axis raw signals
qual_axis_raw AS (
  SELECT
    s.year AS season_year,
    sg.driver_number,
    AVG(sg.grid_position::DOUBLE PRECISION) AS avg_grid_position
  FROM raw.starting_grid sg
  JOIN core.sessions s ON s.session_key = sg.session_key
  WHERE s.year = 2025
    AND s.session_name = 'Race'
    AND sg.grid_position IS NOT NULL
  GROUP BY s.year, sg.driver_number
),
race_axis_raw AS (
  SELECT
    s.year AS season_year,
    sr.driver_number,
    AVG(sr.position::DOUBLE PRECISION) AS avg_race_position
  FROM raw.session_result sr
  JOIN core.sessions s ON s.session_key = sr.session_key
  WHERE s.year = 2025
    AND s.session_name = 'Race'
    AND sr.position IS NOT NULL
  GROUP BY s.year, sr.driver_number
),
tyre_axis_raw AS (
  SELECT
    s.year AS season_year,
    sdc.driver_number,
    AVG(sdc.degradation_per_lap_s) AS avg_deg_s
  FROM analytics.stint_degradation_curve sdc
  JOIN core.sessions s ON s.session_key = sdc.session_key
  WHERE s.year = 2025
    AND sdc.degradation_per_lap_s IS NOT NULL
  GROUP BY s.year, sdc.driver_number
),
restart_axis_raw AS (
  SELECT
    s.year AS season_year,
    rp.driver_number,
    AVG(rp.position_delta::DOUBLE PRECISION) AS avg_restart_delta
  FROM analytics.restart_performance rp
  JOIN core.sessions s ON s.session_key = rp.session_key
  WHERE s.year = 2025
    AND rp.position_delta IS NOT NULL
  GROUP BY s.year, rp.driver_number
),
traffic_axis_raw AS (
  SELECT
    s.year AS season_year,
    tap.driver_number,
    AVG(tap.traffic_pace_delta_s) AS avg_traffic_delta_s
  FROM analytics.traffic_adjusted_pace tap
  JOIN core.sessions s ON s.session_key = tap.session_key
  WHERE s.year = 2025
    AND tap.traffic_pace_delta_s IS NOT NULL
  GROUP BY s.year, tap.driver_number
),
overtake_axis_raw AS (
  SELECT
    s.year AS season_year,
    oe.overtaking_driver_number AS driver_number,
    COUNT(*) AS season_overtakes
  FROM analytics.overtake_events oe
  JOIN core.sessions s ON s.session_key = oe.session_key
  WHERE s.year = 2025
  GROUP BY s.year, oe.overtaking_driver_number
),
error_axis_raw AS (
  SELECT
    s.year AS season_year,
    rci.driver_number,
    COUNT(*) FILTER (WHERE rci.action_status IN ('time_penalty', 'drive_through', 'grid_penalty')) AS season_penalties
  FROM analytics.race_control_incidents rci
  JOIN core.sessions s ON s.session_key = rci.session_key
  WHERE s.year = 2025
    AND rci.driver_number IS NOT NULL
  GROUP BY s.year, rci.driver_number
)
SELECT
  sd.season_year,
  sd.driver_number,
  sd.driver_name,
  sd.team_name,
  -- qualifying_axis: lower avg_grid_position = better.
  -- Score = (21 - position) / 20 * 100, clamped 0-100.
  GREATEST(0, LEAST(100, (21.0 - COALESCE(qa.avg_grid_position, 21.0)) / 20.0 * 100.0))::DOUBLE PRECISION
    AS qualifying_axis,
  -- race_pace_axis: same shape but for race finish positions.
  GREATEST(0, LEAST(100, (21.0 - COALESCE(ra.avg_race_position, 21.0)) / 20.0 * 100.0))::DOUBLE PRECISION
    AS race_pace_axis,
  -- tyre_management_axis: lower degradation = better. Scale so
  -- 0 deg/lap = 100; 0.3 s/lap deg = 0.
  GREATEST(0, LEAST(100, (1.0 - LEAST(COALESCE(ta.avg_deg_s, 0.3), 0.3) / 0.3) * 100.0))::DOUBLE PRECISION
    AS tyre_management_axis,
  -- restart_axis: more positions GAINED on restart = better. Negative
  -- avg_restart_delta means gained positions; map -3..+1 to 100..0.
  GREATEST(0, LEAST(100, (1.0 - LEAST(GREATEST(COALESCE(rest.avg_restart_delta, 0.0), -3.0), 1.0) / 4.0 - 0.25 + 0.25) * 100.0 / 1.0))::DOUBLE PRECISION
    AS restart_axis,
  -- traffic_handling_axis: lower traffic-pace-delta = better. 0 sec
  -- delta = 100; 3-sec delta = 0.
  GREATEST(0, LEAST(100, (1.0 - LEAST(COALESCE(tr.avg_traffic_delta_s, 3.0), 3.0) / 3.0) * 100.0))::DOUBLE PRECISION
    AS traffic_handling_axis,
  -- overtake_difficulty_axis: more overtakes = higher score. 50+ = 100.
  GREATEST(0, LEAST(100, COALESCE(ov.season_overtakes, 0) * 2.0))::DOUBLE PRECISION
    AS overtake_difficulty_axis,
  -- error_rate_axis: fewer penalties = higher score. 0 = 100; 10+ = 0.
  GREATEST(0, LEAST(100, (10.0 - LEAST(COALESCE(er.season_penalties, 0), 10)) * 10.0))::DOUBLE PRECISION
    AS error_rate_axis,
  -- helpful raw aggregates surfaced for transparency
  qa.avg_grid_position,
  ra.avg_race_position,
  ta.avg_deg_s,
  rest.avg_restart_delta,
  tr.avg_traffic_delta_s,
  COALESCE(ov.season_overtakes, 0) AS season_overtakes,
  COALESCE(er.season_penalties, 0) AS season_penalties
FROM season_drivers sd
LEFT JOIN qual_axis_raw     qa   ON qa.season_year   = sd.season_year AND qa.driver_number   = sd.driver_number
LEFT JOIN race_axis_raw     ra   ON ra.season_year   = sd.season_year AND ra.driver_number   = sd.driver_number
LEFT JOIN tyre_axis_raw     ta   ON ta.season_year   = sd.season_year AND ta.driver_number   = sd.driver_number
LEFT JOIN restart_axis_raw  rest ON rest.season_year = sd.season_year AND rest.driver_number = sd.driver_number
LEFT JOIN traffic_axis_raw  tr   ON tr.season_year   = sd.season_year AND tr.driver_number   = sd.driver_number
LEFT JOIN overtake_axis_raw ov   ON ov.season_year   = sd.season_year AND ov.driver_number   = sd.driver_number
LEFT JOIN error_axis_raw    er   ON er.season_year   = sd.season_year AND er.driver_number   = sd.driver_number;

CREATE UNIQUE INDEX IF NOT EXISTS driver_performance_score_data_pk
  ON analytics.driver_performance_score_data (season_year, driver_number);

CREATE INDEX IF NOT EXISTS driver_performance_score_data_year_idx
  ON analytics.driver_performance_score_data (season_year);

CREATE OR REPLACE VIEW analytics.driver_performance_score AS
SELECT * FROM analytics.driver_performance_score_data;

COMMENT ON VIEW analytics.driver_performance_score IS
  'Phase 21 Tier 4 (slice 21-driver-performance-7axis): per-(season, driver) seven-axis performance score. Each axis is a 0-100 derived score (higher = better). qualifying_axis uses avg grid position; race_pace_axis uses avg race-finish position; tyre_management_axis is the inverse of avg stint_degradation_curve.degradation_per_lap_s; restart_axis is the inverse of avg restart_performance.position_delta; traffic_handling_axis is the inverse of avg traffic_adjusted_pace.traffic_pace_delta_s; overtake_difficulty_axis = season_overtakes * 2 (capped at 100); error_rate_axis = (10 - season_penalties) * 10. Helpful raw aggregates surfaced for transparency.';

COMMIT;
