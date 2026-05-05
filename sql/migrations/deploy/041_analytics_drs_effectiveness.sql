-- Deploy openf1:041_analytics_drs_effectiveness to pg
-- requires: 040_analytics_restart_performance
--
-- Phase 21 Tier 1 (slice 21-drs-effectiveness): per-(session,
-- driver) DRS-activation aggregate. The earlier per-lap JOIN
-- against raw.car_data + core.laps_enriched was too expensive on
-- Neon (raw.car_data is multi-million rows; a lap-windowed JOIN
-- ran 12+ minutes without completing). This matview aggregates
-- DRS samples directly per (session, driver) without the lap
-- window, producing reasonable session-level DRS metrics without
-- the per-lap cost.
--
--   drs_active             — TRUE if any sample was DRS-active
--   drs_active_samples     — count of DRS-active samples
--   total_drs_samples      — total samples in raw.car_data for the
--                            (session, driver)
--   drs_active_pct         — drs_active_samples / total_drs_samples
--   drs_zone_index         — NULL until f1.track_segments ships
--   gap_at_detection_s     — NULL until per-lap detection-line
--                            window is feasible
--
-- DRS state codes (per OpenF1): 0/1 off, 8 detected, 10/12/14 active.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.drs_effectiveness_data AS
SELECT
  cd.session_key,
  cd.driver_number,
  MAX(rd.full_name)            AS driver_name,
  MAX(rd.team_name)            AS team_name,
  COUNT(*) FILTER (WHERE cd.drs IN (10, 12, 14)) AS drs_active_samples,
  COUNT(*)                      AS total_drs_samples,
  CASE
    WHEN COUNT(*) > 0 THEN
      (COUNT(*) FILTER (WHERE cd.drs IN (10, 12, 14)))::DOUBLE PRECISION / COUNT(*)::DOUBLE PRECISION
    ELSE NULL
  END                           AS drs_active_pct,
  BOOL_OR(cd.drs IN (10, 12, 14))::BOOLEAN AS drs_active,
  NULL::INTEGER                 AS drs_zone_index,
  NULL::DOUBLE PRECISION        AS gap_at_detection_s
FROM raw.car_data cd
LEFT JOIN raw.drivers rd
  ON rd.session_key   = cd.session_key
 AND rd.driver_number = cd.driver_number
WHERE cd.drs IS NOT NULL
GROUP BY cd.session_key, cd.driver_number;

CREATE UNIQUE INDEX IF NOT EXISTS drs_effectiveness_data_pk
  ON analytics.drs_effectiveness_data (session_key, driver_number);

CREATE INDEX IF NOT EXISTS drs_effectiveness_data_session_idx
  ON analytics.drs_effectiveness_data (session_key);

CREATE OR REPLACE VIEW analytics.drs_effectiveness AS
SELECT * FROM analytics.drs_effectiveness_data;

COMMENT ON VIEW analytics.drs_effectiveness IS
  'Phase 21 (slice 21-drs-effectiveness): per-(session, driver) DRS aggregate. drs_active_samples / total_drs_samples / drs_active_pct give session-level DRS activity. drs_zone_index is NULL (Phase 20-A/B f1.track_segments not deployed). gap_at_detection_s is NULL (per-lap detection-line windowing was too expensive on Neon during the 2026-05-04 deploy attempt).';

COMMIT;
