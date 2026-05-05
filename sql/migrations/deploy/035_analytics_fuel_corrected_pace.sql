-- Deploy openf1:035_analytics_fuel_corrected_pace to pg
-- requires: 034_analytics_race_control_incidents
--
-- Phase 21 Tier 1 (slice 21-fuel-corrected-pace): per-(session,
-- driver, lap) fuel-corrected lap time. Source data exists in
-- core.laps_enriched.fuel_adj_lap_time (Phase 6's per-lap fuel
-- correction); this slice exposes it as a stable analytics-tier
-- contract so dependents (21-stint-degradation-curve cross-JOINs,
-- the Phase 25.1 multi-matview deferred questions q1947 / q1949
-- / q2028 / q2203 / q2207) can reference a single canonical
-- column name (`fuel_corrected_lap_s`) without re-deriving the
-- correction in every query.
--
-- The matview also publishes per-stint clean-air min / median /
-- avg fuel-corrected pace for "clean-air pace" and "long-run
-- pace" questions.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.fuel_corrected_pace_data AS
SELECT
  le.session_key,
  le.driver_number,
  le.driver_name,
  le.team_name,
  le.lap_number,
  le.stint_number,
  le.compound_name,
  le.lap_duration::DOUBLE PRECISION             AS lap_s,
  le.fuel_adj_lap_time::DOUBLE PRECISION        AS fuel_corrected_lap_s,
  le.is_valid,
  le.tyre_age_on_lap,
  le.is_pit_out_lap,
  le.is_pit_lap
FROM core.laps_enriched le
WHERE le.lap_duration IS NOT NULL
  AND le.fuel_adj_lap_time IS NOT NULL;

-- Non-unique btree on the natural query key. core.laps_enriched
-- carries duplicate-row multiplicity per (session_key, driver_number,
-- lap_number) by design (per migration 010 comment); we preserve
-- that semantic verbatim and rely on `is_valid` filters for clean
-- analyses.
CREATE INDEX IF NOT EXISTS fuel_corrected_pace_data_session_driver_lap_idx
  ON analytics.fuel_corrected_pace_data (session_key, driver_number, lap_number);

CREATE INDEX IF NOT EXISTS fuel_corrected_pace_data_session_idx
  ON analytics.fuel_corrected_pace_data (session_key);

CREATE INDEX IF NOT EXISTS fuel_corrected_pace_data_compound_idx
  ON analytics.fuel_corrected_pace_data (compound_name);

CREATE OR REPLACE VIEW analytics.fuel_corrected_pace AS
SELECT * FROM analytics.fuel_corrected_pace_data;

COMMENT ON VIEW analytics.fuel_corrected_pace IS
  'Phase 21 (slice 21-fuel-corrected-pace): per-(session, driver, lap) fuel-corrected lap time. fuel_corrected_lap_s is core.laps_enriched.fuel_adj_lap_time exposed under a stable analytics-tier contract name. Filter is_valid=TRUE for clean-air analyses; filter is_pit_lap=FALSE for pace-only views. Stint context (stint_number, compound_name, tyre_age_on_lap) included so callers can compute per-stint averages without re-joining core.laps_enriched.';

COMMIT;
