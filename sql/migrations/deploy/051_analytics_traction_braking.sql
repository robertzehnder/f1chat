-- Deploy openf1:051_analytics_traction_braking to pg
-- requires: 050_analytics_minisector_dominance
--
-- Phase 26.2c (slice 21-traction-analysis) + Phase 26.2d (slice
-- 21-braking-performance): two related per-(session, driver,
-- corner_id) matviews bundled into one migration since they share
-- the corner-zone JOIN with f1.track_segments + the time-fraction
-- view from slice 047.
--
-- analytics.traction_analysis:
--   exit_throttle_application_pct = % of exit-zone samples on
--                                   throttle > 90%
--   exit_speed_kph                = MAX(speed) in exit window
--   avg_exit_throttle_pct         = AVG(throttle) in exit window
--
-- analytics.braking_performance:
--   brake_zone_speed_drop_kph = MAX(speed) - MIN(speed) inside
--                                a brake-zone window roughly aligned
--                                with the corner entry.
--   peak_brake_pressure_pct   = MAX(brake) in entry window
--   approach_speed_kph        = MAX(speed) in pre-brake window

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

-- Shared circuit-alias CTE pattern is repeated per matview because
-- materialized views can't reference each other's CTEs. Worth
-- factoring later if it gets unwieldy.

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.traction_analysis_data AS
WITH circuit_alias AS (
  SELECT 'Monte Carlo'::text         AS sessions_name, 'Monaco'::text         AS segments_name UNION ALL
  SELECT 'Yas Marina Circuit'::text, 'Yas Marina'::text                                         UNION ALL
  SELECT 'Hungaroring'::text,        'Hungaroring'::text                                        UNION ALL
  SELECT 'Imola'::text,              'Imola'::text                                              UNION ALL
  SELECT 'Jeddah'::text,             'Jeddah'::text                                             UNION ALL
  SELECT 'Monza'::text,              'Monza'::text                                              UNION ALL
  SELECT 'Sakhir'::text,             'Sakhir'::text                                             UNION ALL
  SELECT 'Silverstone'::text,        'Silverstone'::text                                        UNION ALL
  SELECT 'Spa-Francorchamps'::text,  'Spa-Francorchamps'::text                                  UNION ALL
  SELECT 'Suzuka'::text,             'Suzuka'::text
),
eligible_sessions AS (
  SELECT s.session_key, ca.segments_name AS circuit_short_name
  FROM core.sessions s
  JOIN circuit_alias ca ON ca.sessions_name = s.circuit_short_name
  WHERE s.year = 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
),
corners AS (
  SELECT
    es.session_key,
    ts.id            AS corner_id,
    ts.segment_index AS corner_number,
    ts.segment_label AS corner_label,
    ts.start_normalized,
    ts.end_normalized
  FROM eligible_sessions es
  JOIN f1.track_segments ts
    ON ts.circuit_short_name = es.circuit_short_name
   AND ts.segment_kind = 'corner'
),
exit_zone_samples AS (
  -- Exit window = [end_normalized - 0.005, end_normalized + 0.020].
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    cdlp.speed,
    cdlp.throttle,
    cdlp.time_fraction,
    c.corner_id,
    c.corner_number,
    c.corner_label
  FROM core.car_data_lap_position cdlp
  JOIN corners c
    ON c.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= GREATEST(0.0, c.end_normalized - 0.005)
   AND cdlp.time_fraction <= LEAST(1.0, c.end_normalized + 0.020)
  WHERE cdlp.speed IS NOT NULL
)
SELECT
  ezs.session_key,
  ezs.driver_number,
  MAX(rd.full_name)                                  AS driver_name,
  MAX(rd.team_name)                                  AS team_name,
  ezs.corner_id,
  ezs.corner_number,
  MAX(ezs.corner_label)                              AS corner_label,
  MAX(ezs.speed)::DOUBLE PRECISION                   AS exit_speed_kph,
  AVG(ezs.throttle)::DOUBLE PRECISION                AS avg_exit_throttle_pct,
  100.0 * COUNT(*) FILTER (WHERE ezs.throttle > 90)::DOUBLE PRECISION
    / NULLIF(COUNT(*), 0)::DOUBLE PRECISION          AS exit_throttle_application_pct,
  COUNT(DISTINCT ezs.lap_number)                     AS valid_lap_count,
  COUNT(*)                                           AS sample_count
FROM exit_zone_samples ezs
LEFT JOIN raw.drivers rd
  ON rd.session_key   = ezs.session_key
 AND rd.driver_number = ezs.driver_number
GROUP BY ezs.session_key, ezs.driver_number, ezs.corner_id, ezs.corner_number;

CREATE INDEX IF NOT EXISTS traction_analysis_data_session_idx
  ON analytics.traction_analysis_data (session_key);
CREATE INDEX IF NOT EXISTS traction_analysis_data_driver_idx
  ON analytics.traction_analysis_data (session_key, driver_number);

CREATE OR REPLACE VIEW analytics.traction_analysis AS
SELECT * FROM analytics.traction_analysis_data;

COMMENT ON VIEW analytics.traction_analysis IS
  'Phase 21 (slice 21-traction-analysis): per-(session, driver, corner) corner-exit traction metrics. exit_throttle_application_pct = % of exit-zone samples on throttle > 90; exit_speed_kph = MAX(speed) in exit window. Time-fraction approximation; first-cut at named-corner level.';


CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.braking_performance_data AS
WITH circuit_alias AS (
  SELECT 'Monte Carlo'::text         AS sessions_name, 'Monaco'::text         AS segments_name UNION ALL
  SELECT 'Yas Marina Circuit'::text, 'Yas Marina'::text                                         UNION ALL
  SELECT 'Hungaroring'::text,        'Hungaroring'::text                                        UNION ALL
  SELECT 'Imola'::text,              'Imola'::text                                              UNION ALL
  SELECT 'Jeddah'::text,             'Jeddah'::text                                             UNION ALL
  SELECT 'Monza'::text,              'Monza'::text                                              UNION ALL
  SELECT 'Sakhir'::text,             'Sakhir'::text                                             UNION ALL
  SELECT 'Silverstone'::text,        'Silverstone'::text                                        UNION ALL
  SELECT 'Spa-Francorchamps'::text,  'Spa-Francorchamps'::text                                  UNION ALL
  SELECT 'Suzuka'::text,             'Suzuka'::text
),
eligible_sessions AS (
  SELECT s.session_key, ca.segments_name AS circuit_short_name
  FROM core.sessions s
  JOIN circuit_alias ca ON ca.sessions_name = s.circuit_short_name
  WHERE s.year = 2025
    AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
),
corners AS (
  SELECT
    es.session_key,
    ts.id            AS corner_id,
    ts.segment_index AS corner_number,
    ts.segment_label AS corner_label,
    ts.start_normalized,
    ts.end_normalized
  FROM eligible_sessions es
  JOIN f1.track_segments ts
    ON ts.circuit_short_name = es.circuit_short_name
   AND ts.segment_kind = 'corner'
),
brake_zone_samples AS (
  -- Entry / brake-zone window = [start_normalized - 0.020,
  -- start_normalized + 0.005]. Captures the deceleration phase.
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    cdlp.speed,
    cdlp.brake,
    cdlp.time_fraction,
    c.corner_id,
    c.corner_number,
    c.corner_label
  FROM core.car_data_lap_position cdlp
  JOIN corners c
    ON c.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= GREATEST(0.0, c.start_normalized - 0.020)
   AND cdlp.time_fraction <= LEAST(1.0, c.start_normalized + 0.005)
  WHERE cdlp.speed IS NOT NULL
)
SELECT
  bzs.session_key,
  bzs.driver_number,
  MAX(rd.full_name)                                          AS driver_name,
  MAX(rd.team_name)                                          AS team_name,
  bzs.corner_id,
  bzs.corner_number,
  MAX(bzs.corner_label)                                      AS corner_label,
  MAX(bzs.speed)::DOUBLE PRECISION                           AS approach_speed_kph,
  MIN(bzs.speed)::DOUBLE PRECISION                           AS min_brake_zone_speed_kph,
  (MAX(bzs.speed) - MIN(bzs.speed))::DOUBLE PRECISION        AS brake_zone_speed_drop_kph,
  MAX(bzs.brake)::DOUBLE PRECISION                           AS peak_brake_pressure_pct,
  AVG(bzs.brake)::DOUBLE PRECISION                           AS avg_brake_pressure_pct,
  COUNT(DISTINCT bzs.lap_number)                             AS valid_lap_count,
  COUNT(*)                                                   AS sample_count
FROM brake_zone_samples bzs
LEFT JOIN raw.drivers rd
  ON rd.session_key   = bzs.session_key
 AND rd.driver_number = bzs.driver_number
GROUP BY bzs.session_key, bzs.driver_number, bzs.corner_id, bzs.corner_number;

CREATE INDEX IF NOT EXISTS braking_performance_data_session_idx
  ON analytics.braking_performance_data (session_key);
CREATE INDEX IF NOT EXISTS braking_performance_data_driver_idx
  ON analytics.braking_performance_data (session_key, driver_number);

CREATE OR REPLACE VIEW analytics.braking_performance AS
SELECT * FROM analytics.braking_performance_data;

COMMENT ON VIEW analytics.braking_performance IS
  'Phase 21 (slice 21-braking-performance): per-(session, driver, corner) brake-zone metrics. brake_zone_speed_drop_kph = approach_speed minus min-brake-zone-speed. peak_brake_pressure_pct = MAX(brake) in entry window. Time-fraction approximation; first-cut at named-corner level.';

COMMIT;
