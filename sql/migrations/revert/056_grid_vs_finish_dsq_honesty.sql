-- Revert openf1:056_grid_vs_finish_dsq_honesty from pg
-- Restores the pre-056 full view definition (per-driver finish fallback,
-- as it ran on prod; the sqitch chain's 014 facade over
-- core.grid_vs_finish_mat is NOT restored — the plain view is
-- column-compatible and the mat table was already unused on prod).

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
)
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
  COALESCE(fo.finish_position, ff.finish_position) AS finish_position,
  CASE
    WHEN COALESCE(go.grid_position, gf.grid_position) IS NULL
      OR COALESCE(fo.finish_position, ff.finish_position) IS NULL THEN NULL
    ELSE COALESCE(go.grid_position, gf.grid_position)
       - COALESCE(fo.finish_position, ff.finish_position)
  END AS positions_gained,
  CASE
    WHEN go.grid_position IS NOT NULL THEN 'raw.starting_grid'
    WHEN gf.grid_position IS NOT NULL THEN 'raw.position_history:first'
    ELSE NULL
  END AS grid_source,
  CASE
    WHEN fo.finish_position IS NOT NULL THEN 'raw.session_result'
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
LEFT JOIN finish_fallback ff
  ON ff.session_key = k.session_key AND ff.driver_number = k.driver_number;

COMMIT;
