-- Deploy openf1:040_analytics_restart_performance to pg
-- requires: 039_analytics_traffic_adjusted_pace
--
-- Phase 21 Tier 1 (slice 21-restart-performance): per-(session,
-- driver, restart_lap) position delta on race-start and SC/VSC
-- restart laps. Restart laps are identified via raw.race_control
-- (SC restart messages) plus the canonical lap-1 race start.
--
--   position_delta = position_end_of_lap[restart_lap] - position_end_of_lap[restart_lap-1]
--   (negative = gained positions; positive = lost positions)

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.restart_performance_data AS
WITH restart_laps AS (
  -- Lap 1 of every race + every lap immediately after an SC RESTART
  -- or VSC ENDING message.
  SELECT DISTINCT
    rc.session_key,
    rc.lap_number AS restart_lap,
    'race_start'::TEXT AS restart_kind
  FROM raw.race_control rc
  WHERE rc.lap_number = 1
    AND rc.session_key IN (
      SELECT session_key FROM core.sessions WHERE session_name = 'Race'
    )
  UNION
  SELECT
    rc.session_key,
    rc.lap_number AS restart_lap,
    CASE
      WHEN UPPER(rc.message) LIKE '%VSC ENDING%' THEN 'vsc_restart'
      WHEN UPPER(rc.message) LIKE '%SAFETY CAR%ENDING%'
        OR UPPER(rc.message) LIKE '%SAFETY CAR IN THIS LAP%'
        OR UPPER(rc.message) LIKE '%RESTART%'
                                                   THEN 'sc_restart'
      ELSE 'other'
    END AS restart_kind
  FROM raw.race_control rc
  WHERE (
        UPPER(rc.message) LIKE '%VSC ENDING%'
     OR UPPER(rc.message) LIKE '%SAFETY CAR ENDING%'
     OR UPPER(rc.message) LIKE '%SAFETY CAR IN THIS LAP%'
     OR UPPER(rc.message) LIKE '%RESTART%'
  )
    AND rc.lap_number IS NOT NULL
),
position_at_lap AS (
  -- Use core.race_progression_summary if available; fall back to
  -- raw.position_history aggregation per lap.
  SELECT
    rps.session_key,
    rps.driver_number,
    rps.driver_name,
    rps.team_name,
    rps.lap_number,
    rps.position_end_of_lap
  FROM core.race_progression_summary rps
  WHERE rps.position_end_of_lap IS NOT NULL
)
SELECT
  rl.session_key,
  pa.driver_number,
  pa.driver_name,
  pa.team_name,
  rl.restart_lap,
  rl.restart_kind,
  pa_prev.position_end_of_lap AS position_before,
  pa.position_end_of_lap      AS position_after,
  -- Negative = gained positions during the restart lap; positive = lost
  (pa.position_end_of_lap - pa_prev.position_end_of_lap)::INTEGER AS position_delta
FROM restart_laps rl
LEFT JOIN position_at_lap pa
  ON pa.session_key = rl.session_key
 AND pa.lap_number  = rl.restart_lap
LEFT JOIN position_at_lap pa_prev
  ON pa_prev.session_key   = rl.session_key
 AND pa_prev.driver_number = pa.driver_number
 AND pa_prev.lap_number    = rl.restart_lap - 1
WHERE pa.driver_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS restart_performance_data_session_idx
  ON analytics.restart_performance_data (session_key);

CREATE INDEX IF NOT EXISTS restart_performance_data_driver_idx
  ON analytics.restart_performance_data (session_key, driver_number);

CREATE OR REPLACE VIEW analytics.restart_performance AS
SELECT * FROM analytics.restart_performance_data;

COMMENT ON VIEW analytics.restart_performance IS
  'Phase 21 (slice 21-restart-performance): per-(session, driver, restart_lap) position delta on race-start and SC/VSC restart laps. position_delta = position_after - position_before; negative = gained positions during the restart, positive = lost. Filter restart_kind for race_start vs sc_restart vs vsc_restart subsets.';

COMMIT;
