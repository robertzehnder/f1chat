-- Deploy openf1:038_analytics_tyre_warmup to pg
-- requires: 037_analytics_pit_loss_per_circuit
--
-- Phase 21 Tier 1 (slice 21-tyre-warmup-curves): per-(session,
-- driver, stint) tyre warmup metric. warmup_laps_to_target is the
-- lap-offset within the stint (1-based; lap 1 = the first valid lap
-- of the stint) at which the driver first achieves a lap time
-- within 0.5s of the stint's best non-warmup lap.
--
-- Note: the question bank's expected_tables reference
-- `analytics.tyre_warmup` (singular), so the facade view uses that
-- name even though the slice_id is `21-tyre-warmup-curves`.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.tyre_warmup_data AS
WITH stint_laps AS (
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.stint_number,
    le.compound_name,
    le.lap_number,
    le.lap_duration::DOUBLE PRECISION AS lap_duration_s,
    le.is_valid,
    le.tyre_age_on_lap,
    -- Lap offset within the stint (1 = first lap of the stint).
    ROW_NUMBER() OVER (
      PARTITION BY le.session_key, le.driver_number, le.stint_number
      ORDER BY le.lap_number
    ) AS lap_in_stint
  FROM core.laps_enriched le
  WHERE le.lap_duration IS NOT NULL
    AND le.stint_number IS NOT NULL
),
stint_best AS (
  -- Each stint's best non-pit-out lap is the warmup target.
  SELECT
    session_key,
    driver_number,
    stint_number,
    MIN(lap_duration_s) FILTER (WHERE is_valid = TRUE AND lap_in_stint > 1) AS best_non_warmup_lap_s,
    COUNT(*) FILTER (WHERE is_valid = TRUE) AS valid_lap_count,
    MAX(lap_in_stint) AS stint_length_laps
  FROM stint_laps
  GROUP BY session_key, driver_number, stint_number
)
SELECT
  sl.session_key,
  sl.driver_number,
  MAX(sl.driver_name)              AS driver_name,
  MAX(sl.team_name)                AS team_name,
  sl.stint_number,
  MAX(sl.compound_name)            AS compound_name,
  MAX(sb.stint_length_laps)        AS stint_length_laps,
  MAX(sb.valid_lap_count)          AS valid_lap_count,
  MAX(sb.best_non_warmup_lap_s)    AS best_non_warmup_lap_s,
  -- warmup_laps_to_target: first lap-in-stint where lap_duration is
  -- within 0.5s of the stint best. NULL if the stint never reaches
  -- the threshold (very short stints). For pit-out laps (lap 1 of
  -- the stint), we still consider them — but typically lap 2-3 hits
  -- the target.
  MIN(sl.lap_in_stint) FILTER (
    WHERE sl.lap_duration_s <= sb.best_non_warmup_lap_s + 0.5
  ) AS warmup_laps_to_target,
  MIN(sl.lap_number)                AS lap_start,
  MAX(sl.lap_number)                AS lap_end
FROM stint_laps sl
JOIN stint_best sb
  ON sb.session_key   = sl.session_key
 AND sb.driver_number = sl.driver_number
 AND sb.stint_number  = sl.stint_number
GROUP BY sl.session_key, sl.driver_number, sl.stint_number;

CREATE UNIQUE INDEX IF NOT EXISTS tyre_warmup_data_pk
  ON analytics.tyre_warmup_data (session_key, driver_number, stint_number);

CREATE INDEX IF NOT EXISTS tyre_warmup_data_session_idx
  ON analytics.tyre_warmup_data (session_key);

CREATE INDEX IF NOT EXISTS tyre_warmup_data_compound_idx
  ON analytics.tyre_warmup_data (compound_name);

CREATE OR REPLACE VIEW analytics.tyre_warmup AS
SELECT * FROM analytics.tyre_warmup_data;

COMMENT ON VIEW analytics.tyre_warmup IS
  'Phase 21 (slice 21-tyre-warmup-curves): per-(session, driver, stint) tyre warmup metric. warmup_laps_to_target is the lap-offset within the stint (1-based) at which the driver first achieves a lap time within 0.5s of the stint best (non-warmup) lap. Filter compound_name for compound-specific warmup answers; per-stint best lap also exposed for comparison context.';

COMMIT;
