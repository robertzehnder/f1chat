-- Deploy openf1:044_analytics_straight_line_dominance to pg
-- requires: 043_analytics_undercut_overcut_history
--
-- Phase 21 Tier 1 (slice 21-straight-line-dominance): per-(session,
-- driver) straight-line speed metrics derived from raw.car_data
-- speed samples. Without spatial attribution to specific intermediate
-- (i1 / i2 / speed_trap) zones, we use percentile proxies:
--
--   st_speed_kph   = MAX(speed)                  — top speed proxy
--   i2_speed_kph   = 95th-percentile speed       — late-straight proxy
--   i1_speed_kph   = 90th-percentile speed       — early-straight proxy
--
-- These values approximate the broadcast speed-trap / intermediate
-- readings well for a full race / qualifying session aggregate
-- without the cost of per-lap raw.car_data joins.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.straight_line_dominance_data AS
SELECT
  cd.session_key,
  cd.driver_number,
  MAX(rd.full_name)              AS driver_name,
  MAX(rd.team_name)              AS team_name,
  MAX(cd.speed)::DOUBLE PRECISION  AS st_speed_kph,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cd.speed)::DOUBLE PRECISION
                                   AS i2_speed_kph,
  PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY cd.speed)::DOUBLE PRECISION
                                   AS i1_speed_kph,
  AVG(cd.speed)::DOUBLE PRECISION AS avg_speed_kph,
  COUNT(*)                         AS speed_sample_count
FROM raw.car_data cd
LEFT JOIN raw.drivers rd
  ON rd.session_key   = cd.session_key
 AND rd.driver_number = cd.driver_number
WHERE cd.speed IS NOT NULL
  AND cd.speed > 0
GROUP BY cd.session_key, cd.driver_number;

CREATE UNIQUE INDEX IF NOT EXISTS straight_line_dominance_data_pk
  ON analytics.straight_line_dominance_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS straight_line_dominance_data_session_idx
  ON analytics.straight_line_dominance_data (session_key);

CREATE OR REPLACE VIEW analytics.straight_line_dominance AS
SELECT * FROM analytics.straight_line_dominance_data;

COMMENT ON VIEW analytics.straight_line_dominance IS
  'Phase 21 (slice 21-straight-line-dominance): per-(session, driver) straight-line speed metrics. st_speed_kph is MAX(raw.car_data.speed) — top-speed / speed-trap proxy. i2_speed_kph and i1_speed_kph use 95th and 90th percentile speeds as proxies for the late-straight and early-straight intermediate zones (precise zone attribution requires Phase 22 per-sample lap-distance derivation, not yet shipped).';

COMMIT;
