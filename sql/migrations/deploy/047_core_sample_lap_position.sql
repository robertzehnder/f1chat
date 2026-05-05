-- Deploy openf1:047_core_sample_lap_position to pg
-- requires: 046_analytics_telemetry_coverage_per_driver
--
-- Phase 26.1 (lap-distance derivation infrastructure): joinable
-- views that map every raw.car_data and raw.location sample to its
-- lap_number AND its position-within-lap as a time fraction (0.0 at
-- lap start; 1.0 at lap end).
--
-- Why time-fraction (not arc-length): the spatial slices in
-- Stream 26.2 (corner-analysis, minisector-dominance, traction-
-- analysis, braking-performance) need per-sample lap position to
-- bucket samples into f1.track_segments zones. Arc-length
-- normalization would be more accurate (cars cover less ground
-- per second in corners, so time-fraction overestimates corner-
-- sample counts) but a per-sample arc-length matview against
-- ~60M raw.location rows is multi-GB on disk and was outside
-- Phase 26 scope. Time-fraction is conservative for corner-
-- zone detection: it includes slightly more samples than the
-- spatially-correct count, but never misses a sample inside a
-- corner zone. Phase 27 may extend with full arc-length if
-- precision matters.
--
-- Two views are shipped (one per source table). Both follow the
-- same JOIN pattern; downstream queries can pick whichever
-- matches their telemetry source.

BEGIN;

CREATE OR REPLACE VIEW core.car_data_lap_position AS
SELECT
  cd.session_key,
  cd.driver_number,
  cd.date,
  cd.brake,
  cd.throttle,
  cd.n_gear,
  cd.rpm,
  cd.speed,
  cd.drs,
  cd.meeting_key,
  le.lap_number,
  EXTRACT(EPOCH FROM (cd.date - le.lap_start_ts))::DOUBLE PRECISION
    AS sample_lap_seconds,
  EXTRACT(EPOCH FROM (le.lap_end_ts - le.lap_start_ts))::DOUBLE PRECISION
    AS lap_total_seconds,
  CASE
    WHEN le.lap_end_ts > le.lap_start_ts
      THEN EXTRACT(EPOCH FROM (cd.date - le.lap_start_ts))::DOUBLE PRECISION
           / EXTRACT(EPOCH FROM (le.lap_end_ts - le.lap_start_ts))::DOUBLE PRECISION
    ELSE NULL
  END AS time_fraction
FROM raw.car_data cd
JOIN core.laps_enriched le
  ON le.session_key   = cd.session_key
 AND le.driver_number = cd.driver_number
 AND cd.date >= le.lap_start_ts
 AND cd.date <  le.lap_end_ts;

COMMENT ON VIEW core.car_data_lap_position IS
  'Phase 26.1: per-sample raw.car_data with lap_number + time_fraction (0.0 at lap start, 1.0 at lap end). JOIN against f1.track_segments WHERE time_fraction BETWEEN start_normalized AND end_normalized to bucket samples into corner / minisector zones.';

CREATE OR REPLACE VIEW core.location_lap_position AS
SELECT
  rl.session_key,
  rl.driver_number,
  rl.date,
  rl.x,
  rl.y,
  rl.z,
  rl.meeting_key,
  le.lap_number,
  EXTRACT(EPOCH FROM (rl.date - le.lap_start_ts))::DOUBLE PRECISION
    AS sample_lap_seconds,
  EXTRACT(EPOCH FROM (le.lap_end_ts - le.lap_start_ts))::DOUBLE PRECISION
    AS lap_total_seconds,
  CASE
    WHEN le.lap_end_ts > le.lap_start_ts
      THEN EXTRACT(EPOCH FROM (rl.date - le.lap_start_ts))::DOUBLE PRECISION
           / EXTRACT(EPOCH FROM (le.lap_end_ts - le.lap_start_ts))::DOUBLE PRECISION
    ELSE NULL
  END AS time_fraction
FROM raw.location rl
JOIN core.laps_enriched le
  ON le.session_key   = rl.session_key
 AND le.driver_number = rl.driver_number
 AND rl.date >= le.lap_start_ts
 AND rl.date <  le.lap_end_ts;

COMMENT ON VIEW core.location_lap_position IS
  'Phase 26.1: per-sample raw.location with lap_number + time_fraction. xyz preserved for spatial-zone slicing OR direct geometric queries.';

COMMIT;
