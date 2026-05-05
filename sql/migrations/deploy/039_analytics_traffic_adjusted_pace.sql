-- Deploy openf1:039_analytics_traffic_adjusted_pace to pg
-- requires: 038_analytics_tyre_warmup
--
-- Phase 21 Tier 1 (slice 21-traffic-adjusted-pace): per-(session,
-- driver) clean-air vs traffic pace decomposition. A lap is
-- "in_traffic" when the driver's minimum gap to the car ahead
-- (interval) during that lap was < 1.5s — broadly the threshold
-- F1 analysts cite as the dirty-air pace-loss zone.
--
--   traffic_pace_s    = AVG(lap_duration) over traffic laps
--   clean_air_pace_s  = AVG(lap_duration) over clean-air laps
--   traffic_laps      = COUNT of traffic laps
--   clean_air_laps    = COUNT of clean-air laps

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.traffic_adjusted_pace_data AS
WITH lap_intervals AS (
  -- Per-lap minimum interval to car ahead. JOIN raw.intervals
  -- samples to core.laps_enriched on (session_key, driver_number,
  -- date BETWEEN lap_start_ts AND lap_end_ts).
  SELECT
    le.session_key,
    le.driver_number,
    le.lap_number,
    -- raw.intervals.interval is TEXT; cast carefully (DNF / +1L /
    -- empty entries). PARSE on the regex-friendly pattern, fallback
    -- to NULL when not numeric.
    MIN(
      CASE WHEN ri.interval ~ '^[+\-]?\d+(\.\d+)?$' THEN ri.interval::DOUBLE PRECISION ELSE NULL END
    ) AS min_interval_s,
    AVG(
      CASE WHEN ri.interval ~ '^[+\-]?\d+(\.\d+)?$' THEN ri.interval::DOUBLE PRECISION ELSE NULL END
    ) AS avg_interval_s
  FROM core.laps_enriched le
  LEFT JOIN raw.intervals ri
    ON ri.session_key   = le.session_key
   AND ri.driver_number = le.driver_number
   AND ri.date >= le.lap_start_ts
   AND ri.date <  le.lap_end_ts
  WHERE le.lap_duration IS NOT NULL
    AND le.is_valid = TRUE
  GROUP BY le.session_key, le.driver_number, le.lap_number
),
classified_laps AS (
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number,
    le.lap_duration::DOUBLE PRECISION AS lap_duration_s,
    le.compound_name,
    le.stint_number,
    li.min_interval_s,
    li.avg_interval_s,
    -- Treat samples-missing laps as clean-air to avoid false-traffic
    -- attribution from gap data.
    CASE
      WHEN li.min_interval_s IS NULL              THEN FALSE
      WHEN li.min_interval_s < 1.5                THEN TRUE
      ELSE                                              FALSE
    END AS is_in_traffic
  FROM core.laps_enriched le
  LEFT JOIN lap_intervals li
    ON li.session_key   = le.session_key
   AND li.driver_number = le.driver_number
   AND li.lap_number    = le.lap_number
  WHERE le.lap_duration IS NOT NULL
    AND le.is_valid = TRUE
)
SELECT
  cl.session_key,
  cl.driver_number,
  MAX(cl.driver_name)                                      AS driver_name,
  MAX(cl.team_name)                                        AS team_name,
  COUNT(*) FILTER (WHERE cl.is_in_traffic = TRUE)          AS traffic_laps,
  COUNT(*) FILTER (WHERE cl.is_in_traffic = FALSE)         AS clean_air_laps,
  AVG(cl.lap_duration_s) FILTER (WHERE cl.is_in_traffic = TRUE)::DOUBLE PRECISION
                                                            AS traffic_pace_s,
  AVG(cl.lap_duration_s) FILTER (WHERE cl.is_in_traffic = FALSE)::DOUBLE PRECISION
                                                            AS clean_air_pace_s,
  -- traffic-induced delta: positive value = laps in traffic were
  -- slower than clean-air baseline. NULL if either side is empty.
  (
    AVG(cl.lap_duration_s) FILTER (WHERE cl.is_in_traffic = TRUE)
    - AVG(cl.lap_duration_s) FILTER (WHERE cl.is_in_traffic = FALSE)
  )::DOUBLE PRECISION AS traffic_pace_delta_s
FROM classified_laps cl
GROUP BY cl.session_key, cl.driver_number;

CREATE UNIQUE INDEX IF NOT EXISTS traffic_adjusted_pace_data_pk
  ON analytics.traffic_adjusted_pace_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS traffic_adjusted_pace_data_session_idx
  ON analytics.traffic_adjusted_pace_data (session_key);

CREATE OR REPLACE VIEW analytics.traffic_adjusted_pace AS
SELECT * FROM analytics.traffic_adjusted_pace_data;

COMMENT ON VIEW analytics.traffic_adjusted_pace IS
  'Phase 21 (slice 21-traffic-adjusted-pace): per-(session, driver) clean-air vs traffic pace decomposition. A lap is "in traffic" when min_interval_s (the minimum gap to the car ahead during the lap, from raw.intervals) was < 1.5s. clean_air_pace_s and traffic_pace_s are the AVG lap_duration over each bucket; traffic_pace_delta_s is the difference (positive = traffic cost time). Filter session_key for per-race answers; aggregate by team for team-level dirty-air analysis.';

COMMIT;
