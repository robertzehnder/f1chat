CREATE OR REPLACE VIEW core.grid_vs_finish AS
WITH driver_keys AS (
  SELECT session_key, driver_number FROM core.session_drivers
  UNION SELECT session_key, driver_number FROM raw.starting_grid
  UNION SELECT session_key, driver_number FROM raw.session_result
  UNION SELECT session_key, driver_number FROM raw.position_history
),
grid_official AS (
  SELECT session_key, driver_number, min(grid_position) AS grid_position
  FROM raw.starting_grid WHERE grid_position IS NOT NULL
  GROUP BY session_key, driver_number
),
-- Provisional grid from the position feed's FIRST record per driver, re-ranked
-- to a unique 1..N order (raw first-positions can tie). Deterministic tiebreak.
grid_fallback AS (
  SELECT session_key, driver_number,
    ROW_NUMBER() OVER (PARTITION BY session_key ORDER BY first_position ASC, first_date ASC, driver_number ASC)::integer AS grid_position
  FROM (
    SELECT DISTINCT ON (session_key, driver_number) session_key, driver_number,
      "position" AS first_position, date AS first_date
    FROM raw.position_history WHERE "position" IS NOT NULL
    ORDER BY session_key, driver_number, date
  ) g
),
finish_official AS (
  SELECT session_key, driver_number, min("position") AS finish_position
  FROM raw.session_result WHERE "position" IS NOT NULL
  GROUP BY session_key, driver_number
),
laps_done AS (
  SELECT session_key, driver_number, COUNT(DISTINCT lap_number) AS laps
  FROM raw.laps WHERE lap_number IS NOT NULL
  GROUP BY session_key, driver_number
),
-- Provisional finish: FIA-style classification from the feed. Rank by laps
-- completed DESC (lead-lap cars ahead of lapped) then last track position, so
-- the result is a UNIQUE 1..N order even when two cars share a last position.
-- Still a proxy (finish_source='raw.position_history:last'), not official.
finish_fallback AS (
  SELECT lp.session_key, lp.driver_number,
    ROW_NUMBER() OVER (PARTITION BY lp.session_key ORDER BY COALESCE(ld.laps,0) DESC, lp.last_position ASC, lp.driver_number ASC)::integer AS finish_position
  FROM (
    SELECT DISTINCT ON (session_key, driver_number) session_key, driver_number,
      "position" AS last_position, date AS last_date
    FROM raw.position_history WHERE "position" IS NOT NULL
    ORDER BY session_key, driver_number, date DESC
  ) lp
  LEFT JOIN laps_done ld ON ld.session_key = lp.session_key AND ld.driver_number = lp.driver_number
)
SELECT k.session_key, s.meeting_key, s.year, s.session_name, s.session_type,
  s.country_name, s.location, k.driver_number, sd.full_name AS driver_name, sd.team_name,
  COALESCE(go.grid_position, gf.grid_position) AS grid_position,
  COALESCE(fo.finish_position, ff.finish_position) AS finish_position,
  CASE WHEN COALESCE(go.grid_position, gf.grid_position) IS NULL OR COALESCE(fo.finish_position, ff.finish_position) IS NULL THEN NULL::integer
       ELSE COALESCE(go.grid_position, gf.grid_position) - COALESCE(fo.finish_position, ff.finish_position) END AS positions_gained,
  CASE WHEN go.grid_position IS NOT NULL THEN 'raw.starting_grid'::text
       WHEN gf.grid_position IS NOT NULL THEN 'raw.position_history:first'::text ELSE NULL::text END AS grid_source,
  CASE WHEN fo.finish_position IS NOT NULL THEN 'raw.session_result'::text
       WHEN ff.finish_position IS NOT NULL THEN 'raw.position_history:last'::text ELSE NULL::text END AS finish_source
FROM driver_keys k
  JOIN core.sessions s ON s.session_key = k.session_key
  LEFT JOIN core.session_drivers sd ON sd.session_key = k.session_key AND sd.driver_number = k.driver_number
  LEFT JOIN grid_official go ON go.session_key = k.session_key AND go.driver_number = k.driver_number
  LEFT JOIN grid_fallback gf ON gf.session_key = k.session_key AND gf.driver_number = k.driver_number
  LEFT JOIN finish_official fo ON fo.session_key = k.session_key AND fo.driver_number = k.driver_number
  LEFT JOIN finish_fallback ff ON ff.session_key = k.session_key AND ff.driver_number = k.driver_number;
