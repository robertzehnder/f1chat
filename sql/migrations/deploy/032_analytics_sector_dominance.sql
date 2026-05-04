-- Deploy openf1:032_analytics_sector_dominance to pg
-- requires: 031_intervals_parser
--
-- Phase 21 Tier 1 (slice 21-sector-dominance): per-driver per-sector
-- dominance count over a session. The matview groups core.laps_enriched_mat
-- by (session_key, driver_number, sector_index) and counts how many
-- valid laps each driver was the fastest in that sector relative to
-- the field. The facade view exposes the LLM-stable contract name
-- analytics.sector_dominance.
--
-- Storage matview + facade view pattern (Phase 18-C) so dependents
-- (Phase 21 Tier 3 21-track-dominance-gps) stay relkind-stable across
-- refreshes.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.sector_dominance_data AS
WITH per_lap_sectors AS (
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number,
    le.is_valid,
    1::SMALLINT AS sector_index,
    le.duration_sector_1 AS sector_duration
  FROM core.laps_enriched_mat le
  WHERE le.is_valid = TRUE AND le.duration_sector_1 IS NOT NULL
  UNION ALL
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number,
    le.is_valid,
    2::SMALLINT,
    le.duration_sector_2
  FROM core.laps_enriched_mat le
  WHERE le.is_valid = TRUE AND le.duration_sector_2 IS NOT NULL
  UNION ALL
  SELECT
    le.session_key,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number,
    le.is_valid,
    3::SMALLINT,
    le.duration_sector_3
  FROM core.laps_enriched_mat le
  WHERE le.is_valid = TRUE AND le.duration_sector_3 IS NOT NULL
),
ranked AS (
  -- Rank drivers' lap-by-lap sector durations within each session +
  -- sector_index. Rank 1 = fastest lap in that sector for that lap_number.
  SELECT
    pls.*,
    DENSE_RANK() OVER (
      PARTITION BY pls.session_key, pls.sector_index, pls.lap_number
      ORDER BY pls.sector_duration ASC
    ) AS lap_sector_rank
  FROM per_lap_sectors pls
)
SELECT
  session_key,
  driver_number,
  MAX(driver_name)                     AS driver_name,
  MAX(team_name)                       AS team_name,
  sector_index,
  COUNT(*)                             AS valid_lap_count,
  COUNT(*) FILTER (WHERE lap_sector_rank = 1) AS dominant_count,
  AVG(sector_duration)::DOUBLE PRECISION AS avg_sector_duration,
  MIN(sector_duration)::DOUBLE PRECISION AS best_sector_duration
FROM ranked
GROUP BY session_key, driver_number, sector_index;

CREATE UNIQUE INDEX IF NOT EXISTS sector_dominance_data_pk
  ON analytics.sector_dominance_data (session_key, driver_number, sector_index);

CREATE INDEX IF NOT EXISTS sector_dominance_data_session_idx
  ON analytics.sector_dominance_data (session_key);

-- Facade view — the LLM-stable contract.
CREATE OR REPLACE VIEW analytics.sector_dominance AS
SELECT * FROM analytics.sector_dominance_data;

COMMENT ON VIEW analytics.sector_dominance IS
  'Phase 21 (slice 21-sector-dominance): per-driver per-sector dominance count over a session. dominant_count = number of laps the driver was fastest in that sector.';

COMMIT;
