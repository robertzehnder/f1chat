-- Deploy openf1:036_analytics_weather_impact to pg
-- requires: 035_analytics_fuel_corrected_pace
--
-- Phase 21 Tier 1 (slice 21-weather-impact): per-(session, driver,
-- lap) wet-pace delta + session-level inter↔slick crossover laps.
--
-- wet_pace_delta_s: lap_duration MINUS the driver's dry-baseline
--   pace (median valid dry lap in this session). NULL when the lap
--   is on a dry compound. Lets callers cite "Verstappen lost X.Xs
--   per lap on inters compared to his slick pace" without re-deriving.
--
-- inter_to_slick_crossover_lap / slick_to_inter_crossover_lap:
--   session-level landmarks repeated on every row for the same
--   (session, driver) so single-row lookup answers can read them
--   without an aggregate JOIN. NULL if the driver did not change
--   tyre type in this session.
--
-- Storage matview + facade view pattern.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.weather_impact_data AS
WITH lap_with_tyre_type AS (
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number,
    le.compound_name,
    le.lap_duration::DOUBLE PRECISION AS lap_duration_s,
    le.is_valid,
    CASE
      WHEN UPPER(COALESCE(le.compound_name, '')) IN ('INTERMEDIATE', 'WET')
        THEN TRUE
      ELSE FALSE
    END AS is_wet_lap
  FROM core.laps_enriched le
  WHERE le.lap_duration IS NOT NULL
    AND le.compound_name IS NOT NULL
),
dry_baseline AS (
  SELECT
    session_key,
    driver_number,
    -- Median valid dry lap is the dry-baseline pace.
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_duration_s)::DOUBLE PRECISION
      AS driver_dry_baseline_s
  FROM lap_with_tyre_type
  WHERE is_wet_lap = FALSE AND is_valid = TRUE
  GROUP BY session_key, driver_number
),
crossovers AS (
  -- For each (session, driver), find the first lap where compound type
  -- transitions FROM dry TO wet (slick_to_inter) and vice versa.
  -- Uses LAG over (session, driver) ordered by lap_number.
  SELECT
    session_key,
    driver_number,
    lap_number,
    is_wet_lap,
    LAG(is_wet_lap) OVER (
      PARTITION BY session_key, driver_number ORDER BY lap_number
    ) AS prev_is_wet_lap
  FROM lap_with_tyre_type
),
crossover_laps AS (
  SELECT
    session_key,
    driver_number,
    MIN(lap_number) FILTER (WHERE prev_is_wet_lap = FALSE AND is_wet_lap = TRUE)
      AS slick_to_inter_crossover_lap,
    MIN(lap_number) FILTER (WHERE prev_is_wet_lap = TRUE  AND is_wet_lap = FALSE)
      AS inter_to_slick_crossover_lap
  FROM crossovers
  WHERE prev_is_wet_lap IS NOT NULL
  GROUP BY session_key, driver_number
)
SELECT
  l.session_key,
  l.driver_number,
  l.driver_name,
  l.team_name,
  l.lap_number,
  l.compound_name,
  l.lap_duration_s,
  l.is_wet_lap,
  l.is_valid,
  d.driver_dry_baseline_s,
  CASE
    WHEN l.is_wet_lap = TRUE AND d.driver_dry_baseline_s IS NOT NULL
      THEN l.lap_duration_s - d.driver_dry_baseline_s
    ELSE NULL
  END::DOUBLE PRECISION AS wet_pace_delta_s,
  c.slick_to_inter_crossover_lap,
  c.inter_to_slick_crossover_lap,
  -- crossover_lap: the canonical column the question bank asks
  -- about. Picks whichever transition fired (most questions ask
  -- about the inters→slicks dry-line transition).
  COALESCE(
    c.inter_to_slick_crossover_lap,
    c.slick_to_inter_crossover_lap
  ) AS crossover_lap
FROM lap_with_tyre_type l
LEFT JOIN dry_baseline d
  ON d.session_key = l.session_key AND d.driver_number = l.driver_number
LEFT JOIN crossover_laps c
  ON c.session_key = l.session_key AND c.driver_number = l.driver_number;

CREATE INDEX IF NOT EXISTS weather_impact_data_session_driver_lap_idx
  ON analytics.weather_impact_data (session_key, driver_number, lap_number);

CREATE INDEX IF NOT EXISTS weather_impact_data_session_idx
  ON analytics.weather_impact_data (session_key);

CREATE INDEX IF NOT EXISTS weather_impact_data_iswet_idx
  ON analytics.weather_impact_data (is_wet_lap);

CREATE OR REPLACE VIEW analytics.weather_impact AS
SELECT * FROM analytics.weather_impact_data;

COMMENT ON VIEW analytics.weather_impact IS
  'Phase 21 (slice 21-weather-impact): per-(session, driver, lap) wet-tyre pace delta + session-level inter↔slick crossover-lap landmarks. wet_pace_delta_s is lap_duration_s MINUS driver_dry_baseline_s (the median valid dry lap for that driver in that session); NULL on dry-compound laps. crossover_lap = COALESCE(inter_to_slick, slick_to_inter) for the canonical "dry-line crossover" answer; the explicit columns are also available for finer-grained analyses.';

COMMIT;
