-- Deploy openf1:050_analytics_minisector_dominance to pg
-- requires: 049_analytics_corner_analysis_alias_fix
--
-- Phase 26.2b (slice 21-minisector-dominance): per-(session,
-- driver, minisector_index) dominance count. A driver "dominates"
-- a minisector on a lap when their average speed inside the
-- minisector's [start_normalized, end_normalized] zone is the
-- highest of all drivers on that lap. dominant_count = how many
-- laps the driver had rank 1.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.minisector_dominance_data AS
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
minisectors AS (
  SELECT
    es.session_key,
    es.circuit_short_name,
    ts.id            AS minisector_id,
    ts.segment_index AS minisector_index,
    ts.start_normalized,
    ts.end_normalized
  FROM eligible_sessions es
  JOIN f1.track_segments ts
    ON ts.circuit_short_name = es.circuit_short_name
   AND ts.segment_kind = 'minisector'
),
per_lap_minisector AS (
  SELECT
    cdlp.session_key,
    cdlp.driver_number,
    cdlp.lap_number,
    m.minisector_id,
    m.minisector_index,
    AVG(cdlp.speed)::DOUBLE PRECISION AS avg_speed_kph
  FROM core.car_data_lap_position cdlp
  JOIN minisectors m
    ON m.session_key = cdlp.session_key
   AND cdlp.time_fraction IS NOT NULL
   AND cdlp.time_fraction >= m.start_normalized
   AND cdlp.time_fraction <= m.end_normalized
  WHERE cdlp.speed IS NOT NULL AND cdlp.speed > 0
  GROUP BY cdlp.session_key, cdlp.driver_number, cdlp.lap_number, m.minisector_id, m.minisector_index
),
ranked AS (
  SELECT
    *,
    RANK() OVER (PARTITION BY session_key, lap_number, minisector_id ORDER BY avg_speed_kph DESC) AS lap_rank
  FROM per_lap_minisector
)
SELECT
  ranked.session_key,
  ranked.driver_number,
  MAX(rd.full_name)              AS driver_name,
  MAX(rd.team_name)              AS team_name,
  ranked.minisector_index,
  ranked.minisector_id,
  COUNT(*)                       AS valid_lap_count,
  COUNT(*) FILTER (WHERE ranked.lap_rank = 1) AS dominant_count,
  AVG(ranked.avg_speed_kph)::DOUBLE PRECISION AS avg_speed_kph,
  MAX(ranked.avg_speed_kph)::DOUBLE PRECISION AS max_avg_speed_kph
FROM ranked
LEFT JOIN raw.drivers rd
  ON rd.session_key   = ranked.session_key
 AND rd.driver_number = ranked.driver_number
GROUP BY ranked.session_key, ranked.driver_number, ranked.minisector_index, ranked.minisector_id;

CREATE UNIQUE INDEX IF NOT EXISTS minisector_dominance_data_pk
  ON analytics.minisector_dominance_data (session_key, driver_number, minisector_id);

CREATE INDEX IF NOT EXISTS minisector_dominance_data_session_idx
  ON analytics.minisector_dominance_data (session_key);

CREATE OR REPLACE VIEW analytics.minisector_dominance AS
SELECT * FROM analytics.minisector_dominance_data;

COMMENT ON VIEW analytics.minisector_dominance IS
  'Phase 21 (slice 21-minisector-dominance): per-(session, driver, minisector) dominance count. A driver dominates a minisector on a lap when their avg-speed-in-minisector ranks 1st among drivers for that (session, lap, minisector). dominant_count = laps with rank-1 finish. valid_lap_count = laps where the driver had any speed data in the minisector. Time-fraction approximation; first-cut at named-minisector / per-sector level.';

COMMIT;
