-- Deploy openf1:056_grid_vs_finish_dsq_honesty to pg
-- requires: 055_driver_identity_pairs
--
-- The 2026-08 session_result backfill exposed a mixed-source bug in
-- core.grid_vs_finish: the finish fallback was per-DRIVER, so a driver
-- whose OFFICIAL position is NULL (DSQ / unclassified) fell back to
-- raw.position_history's last on-track position and reclaimed a place
-- the stewards took away — Las Vegas 2025 (session 9858) showed both
-- Norris (DSQ, on-track P2) and Russell (official P2) at finish P2,
-- tripping A-gate INV3 (duplicate finish_position).
--
-- Fix: the position_history fallback applies only when the SESSION has
-- no official finish rows at all. Where official results exist, an
-- unclassified driver keeps finish_position NULL with finish_source
-- 'raw.session_result:unclassified' (honest, and positions_gained
-- stays NULL).
--
-- Note: this also converges environments — prod always ran the full
-- 007-style definition, while the sqitch chain had 014's facade over
-- core.grid_vs_finish_mat. After this migration both run the same
-- plain view; the mat table and core_build.grid_vs_finish become
-- unused (left in place, dev-only).

BEGIN;

CREATE OR REPLACE VIEW core.grid_vs_finish AS
WITH driver_keys AS (
  SELECT session_key, driver_number FROM core.session_drivers
  UNION
  SELECT session_key, driver_number FROM raw.starting_grid
  UNION
  SELECT session_key, driver_number FROM raw.session_result
  UNION
  SELECT session_key, driver_number FROM raw.position_history
),
grid_official AS (
  SELECT session_key, driver_number, MIN(grid_position) AS grid_position
  FROM raw.starting_grid
  WHERE grid_position IS NOT NULL
  GROUP BY session_key, driver_number
),
grid_fallback AS (
  SELECT g.session_key, g.driver_number,
         ROW_NUMBER() OVER (
           PARTITION BY g.session_key
           ORDER BY g.first_position, g.first_date, g.driver_number
         )::INTEGER AS grid_position
  FROM (
    SELECT DISTINCT ON (ph.session_key, ph.driver_number)
      ph.session_key, ph.driver_number,
      ph.position AS first_position,
      ph.date AS first_date
    FROM raw.position_history ph
    WHERE ph.position IS NOT NULL
    ORDER BY ph.session_key, ph.driver_number, ph.date
  ) g
),
finish_official AS (
  SELECT session_key, driver_number, MIN(position) AS finish_position
  FROM raw.session_result
  WHERE position IS NOT NULL
  GROUP BY session_key, driver_number
),
finish_official_sessions AS (
  -- Sessions where ANY official finish exists: within these, official
  -- classification is the ONLY finish source (a NULL means DSQ /
  -- unclassified, not "fall back to on-track order").
  SELECT DISTINCT session_key
  FROM raw.session_result
  WHERE position IS NOT NULL
),
laps_done AS (
  SELECT session_key, driver_number, COUNT(DISTINCT lap_number) AS laps
  FROM raw.laps
  WHERE lap_number IS NOT NULL
  GROUP BY session_key, driver_number
),
finish_fallback AS (
  SELECT lp.session_key, lp.driver_number,
         ROW_NUMBER() OVER (
           PARTITION BY lp.session_key
           ORDER BY COALESCE(ld.laps, 0) DESC, lp.last_position, lp.driver_number
         )::INTEGER AS finish_position
  FROM (
    SELECT DISTINCT ON (ph.session_key, ph.driver_number)
      ph.session_key, ph.driver_number,
      ph.position AS last_position,
      ph.date AS last_date
    FROM raw.position_history ph
    WHERE ph.position IS NOT NULL
    ORDER BY ph.session_key, ph.driver_number, ph.date DESC
  ) lp
  LEFT JOIN laps_done ld
    ON ld.session_key = lp.session_key AND ld.driver_number = lp.driver_number
),
resolved AS (
  SELECT
    k.session_key,
    s.meeting_key,
    s.year,
    s.session_name,
    s.session_type,
    s.country_name,
    s.location,
    k.driver_number,
    sd.full_name AS driver_name,
    sd.team_name,
    COALESCE(go.grid_position, gf.grid_position) AS grid_position,
    CASE
      WHEN fos.session_key IS NOT NULL THEN fo.finish_position
      ELSE COALESCE(fo.finish_position, ff.finish_position)
    END AS finish_position,
    CASE
      WHEN go.grid_position IS NOT NULL THEN 'raw.starting_grid'
      WHEN gf.grid_position IS NOT NULL THEN 'raw.position_history:first'
      ELSE NULL
    END AS grid_source,
    CASE
      WHEN fo.finish_position IS NOT NULL THEN 'raw.session_result'
      WHEN fos.session_key IS NOT NULL THEN 'raw.session_result:unclassified'
      WHEN ff.finish_position IS NOT NULL THEN 'raw.position_history:last'
      ELSE NULL
    END AS finish_source
  FROM driver_keys k
  JOIN core.sessions s ON s.session_key = k.session_key
  LEFT JOIN core.session_drivers sd
    ON sd.session_key = k.session_key AND sd.driver_number = k.driver_number
  LEFT JOIN grid_official go
    ON go.session_key = k.session_key AND go.driver_number = k.driver_number
  LEFT JOIN grid_fallback gf
    ON gf.session_key = k.session_key AND gf.driver_number = k.driver_number
  LEFT JOIN finish_official fo
    ON fo.session_key = k.session_key AND fo.driver_number = k.driver_number
  LEFT JOIN finish_official_sessions fos
    ON fos.session_key = k.session_key
  LEFT JOIN finish_fallback ff
    ON ff.session_key = k.session_key AND ff.driver_number = k.driver_number
)
SELECT
  session_key,
  meeting_key,
  year,
  session_name,
  session_type,
  country_name,
  location,
  driver_number,
  driver_name,
  team_name,
  grid_position,
  finish_position,
  CASE
    WHEN grid_position IS NULL OR finish_position IS NULL THEN NULL
    ELSE grid_position - finish_position
  END AS positions_gained,
  grid_source,
  finish_source
FROM resolved;

COMMIT;
