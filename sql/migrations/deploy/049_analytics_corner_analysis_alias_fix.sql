-- Deploy openf1:049_analytics_corner_analysis_alias_fix to pg
-- requires: 048_analytics_corner_analysis
--
-- Phase 26.2a fix: f1.track_segments uses "Monaco" / "Yas Marina"
-- while core.sessions uses "Monte Carlo" / "Yas Marina Circuit".
-- The slice 048 matview JOIN missed these venues entirely.
-- Drop + recreate analytics.corner_analysis_data with a
-- circuit-alias normalization step so Monaco and Abu Dhabi corners
-- attribute correctly.

BEGIN;

-- Drop the existing matview + facade view (CASCADE so dependents
-- don't block). The facade view will be recreated below; downstream
-- queries against analytics.corner_analysis just need to wait for
-- the rebuild.
DROP MATERIALIZED VIEW IF EXISTS analytics.corner_analysis_data CASCADE;

CREATE MATERIALIZED VIEW analytics.corner_analysis_data AS
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
    es.circuit_short_name,
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
samples_in_corner_zone AS (
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    cdlp.speed,
    cdlp.time_fraction,
    c.corner_id,
    c.corner_number,
    c.corner_label,
    c.start_normalized,
    c.end_normalized
  FROM core.car_data_lap_position cdlp
  JOIN corners c
    ON c.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= GREATEST(0.0, c.start_normalized - 0.015)
   AND cdlp.time_fraction <= LEAST(1.0, c.end_normalized + 0.015)
  WHERE cdlp.speed IS NOT NULL
)
SELECT
  scz.session_key,
  scz.driver_number,
  MAX(rd.full_name)            AS driver_name,
  MAX(rd.team_name)            AS team_name,
  scz.lap_number,
  scz.corner_id,
  scz.corner_number,
  MAX(scz.corner_label)        AS corner_label,
  MAX(scz.start_normalized)    AS start_normalized,
  MAX(scz.end_normalized)      AS end_normalized,
  MAX(scz.speed) FILTER (
    WHERE scz.time_fraction >= GREATEST(0.0, scz.start_normalized - 0.01)
      AND scz.time_fraction <= scz.start_normalized + 0.005
  )::DOUBLE PRECISION                   AS entry_speed_kph,
  MIN(scz.speed) FILTER (
    WHERE scz.time_fraction >= scz.start_normalized
      AND scz.time_fraction <= scz.end_normalized
  )::DOUBLE PRECISION                   AS apex_min_speed_kph,
  MAX(scz.speed) FILTER (
    WHERE scz.time_fraction >= scz.end_normalized - 0.005
      AND scz.time_fraction <= LEAST(1.0, scz.end_normalized + 0.01)
  )::DOUBLE PRECISION                   AS exit_speed_kph,
  COUNT(*)                              AS sample_count
FROM samples_in_corner_zone scz
LEFT JOIN raw.drivers rd
  ON rd.session_key   = scz.session_key
 AND rd.driver_number = scz.driver_number
GROUP BY scz.session_key, scz.driver_number, scz.lap_number, scz.corner_id, scz.corner_number;

CREATE INDEX IF NOT EXISTS corner_analysis_data_session_idx
  ON analytics.corner_analysis_data (session_key);

CREATE INDEX IF NOT EXISTS corner_analysis_data_driver_idx
  ON analytics.corner_analysis_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS corner_analysis_data_corner_idx
  ON analytics.corner_analysis_data (session_key, corner_id);

CREATE OR REPLACE VIEW analytics.corner_analysis AS
SELECT * FROM analytics.corner_analysis_data;

COMMENT ON VIEW analytics.corner_analysis IS
  'Phase 21 (slice 21-corner-analysis): per-(session, driver, lap, corner_id) entry / apex / exit speeds. Filter session_key + driver_number + corner_label for "what was X driver''s apex speed at Turn N?" answers. Time-fraction approximation may slightly overestimate corner-sample counts vs spatially-normalized arc-length; first-cut accurate at named-corner level. Circuit-alias CTE handles core.sessions vs f1.track_segments naming differences (Monte Carlo / Monaco; Yas Marina Circuit / Yas Marina).';

COMMIT;
