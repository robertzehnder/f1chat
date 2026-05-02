BEGIN;

CREATE SCHEMA IF NOT EXISTS core_build;

-- 1. core_build.laps_enriched -- no hot-contract dependencies.
CREATE OR REPLACE VIEW core_build.laps_enriched AS
WITH default_policy AS (
  SELECT
    policy_key,
    policy_version,
    min_lap_seconds,
    max_lap_seconds,
    exclude_pit_out_laps,
    exclude_pit_in_laps,
    require_sector_data,
    require_known_compound,
    require_slick_compound,
    fuel_seconds_per_lap
  FROM core.valid_lap_policy
  WHERE is_default
  ORDER BY policy_version DESC
  LIMIT 1
),
policy AS (
  SELECT * FROM default_policy
  UNION ALL
  SELECT
    'openf1_semantic'::TEXT AS policy_key,
    1::INTEGER AS policy_version,
    50::DOUBLE PRECISION AS min_lap_seconds,
    200::DOUBLE PRECISION AS max_lap_seconds,
    TRUE::BOOLEAN AS exclude_pit_out_laps,
    TRUE::BOOLEAN AS exclude_pit_in_laps,
    TRUE::BOOLEAN AS require_sector_data,
    TRUE::BOOLEAN AS require_known_compound,
    TRUE::BOOLEAN AS require_slick_compound,
    0.03::DOUBLE PRECISION AS fuel_seconds_per_lap
  WHERE NOT EXISTS (SELECT 1 FROM default_policy)
),
candidate AS (
  SELECT
    b.*,
    p.policy_key,
    p.policy_version,
    p.fuel_seconds_per_lap,
    (
      b.duration_sector_1 IS NOT NULL AND b.duration_sector_1 > 0
      AND b.duration_sector_2 IS NOT NULL AND b.duration_sector_2 > 0
      AND b.duration_sector_3 IS NOT NULL AND b.duration_sector_3 > 0
    ) AS has_sector_data,
    (
      b.lap_duration IS NOT NULL
      AND b.lap_duration BETWEEN p.min_lap_seconds AND p.max_lap_seconds
      AND (NOT p.exclude_pit_out_laps OR COALESCE(b.is_pit_out_lap, FALSE) = FALSE)
      AND (NOT p.exclude_pit_in_laps OR COALESCE(b.is_pit_lap, FALSE) = FALSE)
      AND (NOT p.require_sector_data OR (
        b.duration_sector_1 IS NOT NULL AND b.duration_sector_1 > 0
        AND b.duration_sector_2 IS NOT NULL AND b.duration_sector_2 > 0
        AND b.duration_sector_3 IS NOT NULL AND b.duration_sector_3 > 0
      ))
      AND (NOT p.require_known_compound OR b.normalized_compound IS NOT NULL)
      AND (NOT p.require_slick_compound OR COALESCE(b.is_slick, FALSE))
    ) AS is_valid
  FROM core.lap_semantic_bridge b
  CROSS JOIN policy p
),
session_stats AS (
  SELECT
    session_key,
    MIN(lap_duration) AS fastest_valid_lap,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_duration) AS rep_lap_session
  FROM candidate
  WHERE is_valid
  GROUP BY session_key
),
lap_number_stats AS (
  SELECT
    session_key,
    lap_number,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_duration) AS lap_rep_time
  FROM candidate
  WHERE is_valid
    AND COALESCE(is_pit_out_lap, FALSE) = FALSE
    AND COALESCE(is_pit_lap, FALSE) = FALSE
  GROUP BY session_key, lap_number
),
session_extent AS (
  SELECT session_key, MAX(lap_number) AS max_lap_number
  FROM candidate
  GROUP BY session_key
)
SELECT
  c.session_key,
  c.meeting_key,
  c.year,
  c.session_name,
  c.session_type,
  c.country_name,
  c.location,
  c.circuit_short_name,
  c.driver_number,
  c.driver_name,
  c.team_name,
  c.lap_number,
  c.lap_start_ts,
  c.lap_end_ts,
  c.lap_duration,
  c.duration_sector_1,
  c.duration_sector_2,
  c.duration_sector_3,
  c.stint_number,
  c.compound_raw,
  COALESCE(c.normalized_compound, 'UNKNOWN') AS compound_name,
  c.is_slick,
  c.tyre_age_at_start,
  c.tyre_age_on_lap,
  c.is_pit_out_lap,
  c.is_pit_lap,
  c.pit_duration,
  c.position_end_of_lap,
  c.track_flag,
  c.is_personal_best_proxy,
  c.policy_key AS validity_policy_key,
  c.policy_version AS validity_rule_version,
  c.is_valid,
  NULLIF(
    CONCAT_WS(
      ';',
      CASE WHEN c.lap_duration IS NULL OR c.lap_duration <= 0 THEN 'missing_or_nonpositive_lap_duration' END,
      CASE WHEN c.lap_duration IS NOT NULL AND (c.lap_duration < 50 OR c.lap_duration > 200) THEN 'duration_out_of_bounds' END,
      CASE WHEN COALESCE(c.is_pit_out_lap, FALSE) THEN 'pit_out_lap' END,
      CASE WHEN COALESCE(c.is_pit_lap, FALSE) THEN 'pit_in_lap' END,
      CASE WHEN c.has_sector_data = FALSE THEN 'missing_sector_data' END,
      CASE WHEN c.normalized_compound IS NULL THEN 'unknown_compound' END,
      CASE WHEN COALESCE(c.is_slick, FALSE) = FALSE THEN 'non_slick_compound' END
    ),
    ''
  ) AS invalid_reason,
  ss.rep_lap_session,
  ss.fastest_valid_lap,
  ln.lap_rep_time,
  CASE
    WHEN ss.rep_lap_session IS NULL OR c.lap_duration IS NULL THEN NULL
    ELSE c.lap_duration - ss.rep_lap_session
  END AS delta_to_rep,
  CASE
    WHEN ss.rep_lap_session IS NULL OR ss.rep_lap_session = 0 OR c.lap_duration IS NULL THEN NULL
    ELSE (100.0 * (c.lap_duration - ss.rep_lap_session) / ss.rep_lap_session)
  END AS pct_from_rep,
  CASE
    WHEN ss.fastest_valid_lap IS NULL OR c.lap_duration IS NULL THEN NULL
    ELSE c.lap_duration - ss.fastest_valid_lap
  END AS delta_to_fastest,
  CASE
    WHEN ss.fastest_valid_lap IS NULL OR ss.fastest_valid_lap = 0 OR c.lap_duration IS NULL THEN NULL
    ELSE (100.0 * (c.lap_duration - ss.fastest_valid_lap) / ss.fastest_valid_lap)
  END AS pct_from_fastest,
  CASE
    WHEN ln.lap_rep_time IS NULL OR c.lap_duration IS NULL THEN NULL
    ELSE c.lap_duration - ln.lap_rep_time
  END AS delta_to_lap_rep,
  CASE
    WHEN ln.lap_rep_time IS NULL OR ln.lap_rep_time = 0 OR c.lap_duration IS NULL THEN NULL
    ELSE (100.0 * (c.lap_duration - ln.lap_rep_time) / ln.lap_rep_time)
  END AS pct_from_lap_rep,
  CASE
    WHEN c.lap_duration IS NULL OR sx.max_lap_number IS NULL THEN NULL
    ELSE c.lap_duration - ((sx.max_lap_number - c.lap_number) * c.fuel_seconds_per_lap)
  END AS fuel_adj_lap_time
FROM candidate c
LEFT JOIN session_stats ss
  ON ss.session_key = c.session_key
LEFT JOIN lap_number_stats ln
  ON ln.session_key = c.session_key
 AND ln.lap_number = c.lap_number
LEFT JOIN session_extent sx
  ON sx.session_key = c.session_key;

-- 2. core_build.grid_vs_finish -- no hot-contract dependencies.
CREATE OR REPLACE VIEW core_build.grid_vs_finish AS
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
  SELECT
    session_key,
    driver_number,
    MIN(grid_position) AS grid_position
  FROM raw.starting_grid
  WHERE grid_position IS NOT NULL
  GROUP BY session_key, driver_number
),
grid_fallback AS (
  SELECT DISTINCT ON (session_key, driver_number)
    session_key,
    driver_number,
    position AS grid_position
  FROM raw.position_history
  WHERE position IS NOT NULL
  ORDER BY session_key, driver_number, date ASC
),
finish_official AS (
  SELECT
    session_key,
    driver_number,
    MIN(position) AS finish_position
  FROM raw.session_result
  WHERE position IS NOT NULL
  GROUP BY session_key, driver_number
),
finish_fallback AS (
  SELECT DISTINCT ON (session_key, driver_number)
    session_key,
    driver_number,
    position AS finish_position
  FROM raw.position_history
  WHERE position IS NOT NULL
  ORDER BY session_key, driver_number, date DESC
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
    ELSE COALESCE(go.grid_position, gf.grid_position) - COALESCE(fo.finish_position, ff.finish_position)
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
JOIN core.sessions s
  ON s.session_key = k.session_key
LEFT JOIN core.session_drivers sd
  ON sd.session_key = k.session_key
 AND sd.driver_number = k.driver_number
LEFT JOIN grid_official go
  ON go.session_key = k.session_key
 AND go.driver_number = k.driver_number
LEFT JOIN grid_fallback gf
  ON gf.session_key = k.session_key
 AND gf.driver_number = k.driver_number
LEFT JOIN finish_official fo
  ON fo.session_key = k.session_key
 AND fo.driver_number = k.driver_number
LEFT JOIN finish_fallback ff
  ON ff.session_key = k.session_key
 AND ff.driver_number = k.driver_number;

-- 3. core_build.stint_summary -- depends on core_build.laps_enriched.
CREATE OR REPLACE VIEW core_build.stint_summary AS
SELECT
  st.session_key,
  cs.meeting_key,
  cs.year,
  cs.session_name,
  cs.session_type,
  cs.country_name,
  cs.location,
  st.driver_number,
  sd.full_name AS driver_name,
  sd.team_name,
  st.stint_number,
  COALESCE(MAX(le.compound_name), st.compound) AS compound_name,
  st.lap_start,
  st.lap_end,
  st.tyre_age_at_start,
  st.fresh_tyre,
  (st.lap_end - st.lap_start + 1) AS stint_length_laps,
  COUNT(le.lap_number) AS lap_count,
  COUNT(*) FILTER (WHERE le.is_valid) AS valid_lap_count,
  ROUND(AVG(le.lap_duration)::numeric, 3) AS avg_lap,
  ROUND(MIN(le.lap_duration)::numeric, 3) AS best_lap,
  ROUND(AVG(le.lap_duration) FILTER (WHERE le.is_valid)::numeric, 3) AS avg_valid_lap,
  ROUND(MIN(le.lap_duration) FILTER (WHERE le.is_valid)::numeric, 3) AS best_valid_lap,
  ROUND(
    REGR_SLOPE(
      le.lap_duration,
      COALESCE(le.tyre_age_on_lap, st.tyre_age_at_start + (le.lap_number - st.lap_start))
    )::numeric,
    4
  ) AS degradation_per_lap
FROM raw.stints st
JOIN core.sessions cs
  ON cs.session_key = st.session_key
LEFT JOIN core.session_drivers sd
  ON sd.session_key = st.session_key
 AND sd.driver_number = st.driver_number
LEFT JOIN core_build.laps_enriched le
  ON le.session_key = st.session_key
 AND le.driver_number = st.driver_number
 AND le.lap_number BETWEEN st.lap_start AND st.lap_end
GROUP BY
  st.session_key,
  cs.meeting_key,
  cs.year,
  cs.session_name,
  cs.session_type,
  cs.country_name,
  cs.location,
  st.driver_number,
  sd.full_name,
  sd.team_name,
  st.stint_number,
  st.compound,
  st.lap_start,
  st.lap_end,
  st.tyre_age_at_start,
  st.fresh_tyre;

-- 4. core_build.strategy_summary -- depends on core_build.stint_summary.
CREATE OR REPLACE VIEW core_build.strategy_summary AS
WITH ranked_stints AS (
  SELECT
    ss.*,
    ROW_NUMBER() OVER (PARTITION BY ss.session_key, ss.driver_number ORDER BY ss.stint_number ASC) AS first_stint_rank,
    ROW_NUMBER() OVER (PARTITION BY ss.session_key, ss.driver_number ORDER BY ss.stint_number DESC) AS last_stint_rank
  FROM core_build.stint_summary ss
),
stint_rollup AS (
  SELECT
    session_key,
    meeting_key,
    year,
    session_name,
    session_type,
    country_name,
    location,
    driver_number,
    MAX(driver_name) AS driver_name,
    MAX(team_name) AS team_name,
    COUNT(*) AS total_stints,
    ARRAY_AGG(DISTINCT compound_name ORDER BY compound_name) AS compounds_used,
    MAX(CASE WHEN first_stint_rank = 1 THEN stint_length_laps END) AS opening_stint_laps,
    MAX(CASE WHEN last_stint_rank = 1 THEN stint_length_laps END) AS closing_stint_laps,
    MIN(stint_length_laps) AS shortest_stint_laps,
    MAX(stint_length_laps) AS longest_stint_laps
  FROM ranked_stints
  GROUP BY
    session_key,
    meeting_key,
    year,
    session_name,
    session_type,
    country_name,
    location,
    driver_number
),
pit_rollup AS (
  SELECT
    session_key,
    driver_number,
    COUNT(*) AS pit_stop_count_raw,
    ROUND(SUM(pit_duration)::numeric, 3) AS total_pit_duration_seconds,
    ARRAY_AGG(lap_number ORDER BY lap_number) AS pit_laps
  FROM raw.pit
  GROUP BY session_key, driver_number
)
SELECT
  sr.session_key,
  sr.meeting_key,
  sr.year,
  sr.session_name,
  sr.session_type,
  sr.country_name,
  sr.location,
  sr.driver_number,
  sr.driver_name,
  sr.team_name,
  sr.total_stints,
  GREATEST(sr.total_stints - 1, 0) AS pit_stop_count,
  COALESCE(pr.pit_stop_count_raw, 0) AS pit_event_rows,
  sr.compounds_used,
  sr.opening_stint_laps,
  sr.closing_stint_laps,
  sr.shortest_stint_laps,
  sr.longest_stint_laps,
  COALESCE(pr.total_pit_duration_seconds, 0::numeric) AS total_pit_duration_seconds,
  pr.pit_laps,
  CASE
    WHEN GREATEST(sr.total_stints - 1, 0) = 0 THEN 'No-stop strategy'
    WHEN GREATEST(sr.total_stints - 1, 0) = 1 THEN 'One-stop strategy'
    WHEN GREATEST(sr.total_stints - 1, 0) = 2 THEN 'Two-stop strategy'
    ELSE GREATEST(sr.total_stints - 1, 0)::text || '-stop strategy'
  END AS strategy_type
FROM stint_rollup sr
LEFT JOIN pit_rollup pr
  ON pr.session_key = sr.session_key
 AND pr.driver_number = sr.driver_number;

-- 5. core_build.race_progression_summary -- depends on core_build.laps_enriched.
CREATE OR REPLACE VIEW core_build.race_progression_summary AS
WITH lap_positions AS (
  SELECT
    le.session_key,
    le.meeting_key,
    le.year,
    le.session_name,
    le.session_type,
    le.country_name,
    le.location,
    le.driver_number,
    COALESCE(le.driver_name, sd.full_name) AS driver_name,
    COALESCE(le.team_name, sd.team_name) AS team_name,
    le.lap_number,
    le.lap_end_ts AS frame_time,
    le.position_end_of_lap
  FROM core_build.laps_enriched le
  LEFT JOIN core.session_drivers sd
    ON sd.session_key = le.session_key
   AND sd.driver_number = le.driver_number
  WHERE le.lap_number IS NOT NULL
    AND le.position_end_of_lap IS NOT NULL
    AND LOWER(COALESCE(le.session_type, le.session_name, '')) LIKE '%race%'
),
progression AS (
  SELECT
    lp.*,
    LAG(lp.position_end_of_lap) OVER (
      PARTITION BY lp.session_key, lp.driver_number
      ORDER BY lp.lap_number
    ) AS previous_position
  FROM lap_positions lp
)
SELECT
  p.session_key,
  p.meeting_key,
  p.year,
  p.session_name,
  p.session_type,
  p.country_name,
  p.location,
  p.driver_number,
  p.driver_name,
  p.team_name,
  p.lap_number,
  p.frame_time,
  p.position_end_of_lap,
  p.previous_position,
  CASE
    WHEN p.previous_position IS NULL THEN NULL
    ELSE p.previous_position - p.position_end_of_lap
  END AS positions_gained_this_lap,
  FIRST_VALUE(p.position_end_of_lap) OVER (
    PARTITION BY p.session_key, p.driver_number
    ORDER BY p.lap_number
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS opening_position,
  LAST_VALUE(p.position_end_of_lap) OVER (
    PARTITION BY p.session_key, p.driver_number
    ORDER BY p.lap_number
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS latest_position,
  MIN(p.position_end_of_lap) OVER (PARTITION BY p.session_key, p.driver_number) AS best_position,
  MAX(p.position_end_of_lap) OVER (PARTITION BY p.session_key, p.driver_number) AS worst_position
FROM progression p;

-- 6. core_build.lap_phase_summary -- depends on core_build.laps_enriched.
CREATE OR REPLACE VIEW core_build.lap_phase_summary AS
WITH session_extent AS (
  SELECT
    session_key,
    MAX(lap_number) AS max_lap_number
  FROM core_build.laps_enriched
  GROUP BY session_key
)
SELECT
  le.session_key,
  le.meeting_key,
  le.year,
  le.session_name,
  le.session_type,
  le.driver_number,
  le.driver_name,
  le.team_name,
  le.lap_number,
  le.stint_number,
  le.compound_name,
  le.tyre_age_on_lap,
  le.lap_duration,
  le.is_valid,
  CASE
    WHEN sx.max_lap_number IS NULL OR le.lap_number IS NULL THEN NULL
    WHEN le.lap_number <= CEIL(sx.max_lap_number / 3.0) THEN 'opening_third'
    WHEN le.lap_number <= FLOOR((sx.max_lap_number * 2.0) / 3.0) THEN 'middle_third'
    ELSE 'final_third'
  END AS lap_phase,
  CASE
    WHEN COALESCE(le.tyre_age_on_lap, 0) <= 3 THEN 'fresh'
    ELSE 'used'
  END AS tyre_state
FROM core_build.laps_enriched le
LEFT JOIN session_extent sx
  ON sx.session_key = le.session_key;

-- 7. core_build.lap_context_summary -- depends on core_build.laps_enriched.
CREATE OR REPLACE VIEW core_build.lap_context_summary AS
SELECT
  le.session_key,
  le.meeting_key,
  le.year,
  le.session_name,
  le.session_type,
  le.country_name,
  le.location,
  le.lap_number,
  COUNT(*) FILTER (WHERE le.is_valid) AS valid_driver_count,
  ROUND(MIN(le.lap_duration) FILTER (WHERE le.is_valid)::numeric, 3) AS fastest_valid_lap_on_number,
  ROUND(AVG(le.lap_duration) FILTER (WHERE le.is_valid)::numeric, 3) AS avg_valid_lap_on_number,
  ROUND(
    percentile_cont(0.5) WITHIN GROUP (ORDER BY le.lap_duration) FILTER (WHERE le.is_valid)::numeric,
    3
  ) AS rep_valid_lap_on_number
FROM core_build.laps_enriched le
WHERE le.lap_number IS NOT NULL
GROUP BY
  le.session_key,
  le.meeting_key,
  le.year,
  le.session_name,
  le.session_type,
  le.country_name,
  le.location,
  le.lap_number;

-- 8. core_build.telemetry_lap_bridge -- depends on core_build.laps_enriched.
CREATE OR REPLACE VIEW core_build.telemetry_lap_bridge AS
WITH lap_windows AS (
  SELECT
    le.session_key,
    le.meeting_key,
    le.year,
    le.session_name,
    le.session_type,
    le.driver_number,
    le.driver_name,
    le.team_name,
    le.lap_number,
    le.lap_start_ts,
    le.lap_end_ts
  FROM core_build.laps_enriched le
  WHERE le.lap_start_ts IS NOT NULL
    AND le.lap_end_ts IS NOT NULL
    AND le.lap_end_ts > le.lap_start_ts
)
SELECT
  lw.session_key,
  lw.meeting_key,
  lw.year,
  lw.session_name,
  lw.session_type,
  lw.driver_number,
  lw.driver_name,
  lw.team_name,
  lw.lap_number,
  lw.lap_start_ts,
  lw.lap_end_ts,
  cd.sample_count AS car_samples,
  cd.max_speed,
  cd.avg_speed,
  cd.max_throttle,
  cd.avg_throttle,
  cd.brake_samples,
  cd.first_brake_time_sec,
  loc.sample_count AS location_samples
FROM lap_windows lw
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS sample_count,
    MAX(cd.speed) AS max_speed,
    ROUND(AVG(cd.speed)::numeric, 3) AS avg_speed,
    ROUND(MAX(cd.throttle)::numeric, 3) AS max_throttle,
    ROUND(AVG(cd.throttle)::numeric, 3) AS avg_throttle,
    COUNT(*) FILTER (WHERE cd.brake > 0) AS brake_samples,
    ROUND(
      MIN(EXTRACT(EPOCH FROM (cd.date - lw.lap_start_ts))) FILTER (WHERE cd.brake > 0)::numeric,
      3
    ) AS first_brake_time_sec
  FROM raw.car_data cd
  WHERE cd.session_key = lw.session_key
    AND cd.driver_number = lw.driver_number
    AND cd.date >= lw.lap_start_ts
    AND cd.date < lw.lap_end_ts
) cd ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS sample_count
  FROM raw.location loc
  WHERE loc.session_key = lw.session_key
    AND loc.driver_number = lw.driver_number
    AND loc.date >= lw.lap_start_ts
    AND loc.date < lw.lap_end_ts
) loc ON TRUE;

-- 9. core_build.driver_session_summary -- depends on core_build.laps_enriched,
--    core_build.strategy_summary, core_build.grid_vs_finish.
CREATE OR REPLACE VIEW core_build.driver_session_summary AS
WITH lap_rollup AS (
  SELECT
    le.session_key,
    le.meeting_key,
    le.year,
    le.session_name,
    le.session_type,
    le.country_name,
    le.location,
    le.circuit_short_name,
    le.driver_number,
    MAX(le.driver_name) AS driver_name,
    MAX(le.team_name) AS team_name,
    COUNT(*) FILTER (WHERE le.lap_duration IS NOT NULL AND le.lap_duration > 0) AS lap_count,
    COUNT(*) FILTER (WHERE le.is_valid) AS valid_lap_count,
    ROUND(MIN(le.lap_duration)::numeric, 3) AS best_lap,
    ROUND(AVG(le.lap_duration)::numeric, 3) AS avg_lap,
    ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY le.lap_duration)::numeric, 3) AS median_lap,
    ROUND(STDDEV_POP(le.lap_duration)::numeric, 3) AS lap_stddev,
    ROUND(MIN(le.lap_duration) FILTER (WHERE le.is_valid)::numeric, 3) AS best_valid_lap,
    ROUND(AVG(le.lap_duration) FILTER (WHERE le.is_valid)::numeric, 3) AS avg_valid_lap,
    ROUND(
      percentile_cont(0.5) WITHIN GROUP (ORDER BY le.lap_duration) FILTER (WHERE le.is_valid)::numeric,
      3
    ) AS median_valid_lap,
    ROUND(STDDEV_POP(le.lap_duration) FILTER (WHERE le.is_valid)::numeric, 3) AS valid_lap_stddev,
    ROUND(MIN(le.duration_sector_1) FILTER (WHERE le.is_valid)::numeric, 3) AS best_s1,
    ROUND(MIN(le.duration_sector_2) FILTER (WHERE le.is_valid)::numeric, 3) AS best_s2,
    ROUND(MIN(le.duration_sector_3) FILTER (WHERE le.is_valid)::numeric, 3) AS best_s3,
    ROUND(AVG(le.duration_sector_1) FILTER (WHERE le.is_valid)::numeric, 3) AS avg_s1,
    ROUND(AVG(le.duration_sector_2) FILTER (WHERE le.is_valid)::numeric, 3) AS avg_s2,
    ROUND(AVG(le.duration_sector_3) FILTER (WHERE le.is_valid)::numeric, 3) AS avg_s3
  FROM core_build.laps_enriched le
  WHERE le.lap_duration IS NOT NULL
    AND le.lap_duration > 0
  GROUP BY
    le.session_key,
    le.meeting_key,
    le.year,
    le.session_name,
    le.session_type,
    le.country_name,
    le.location,
    le.circuit_short_name,
    le.driver_number
)
SELECT
  lr.session_key,
  lr.meeting_key,
  lr.year,
  lr.session_name,
  lr.session_type,
  lr.country_name,
  lr.location,
  lr.circuit_short_name,
  lr.driver_number,
  lr.driver_name,
  lr.team_name,
  lr.lap_count,
  lr.valid_lap_count,
  lr.best_lap,
  lr.avg_lap,
  lr.median_lap,
  lr.lap_stddev,
  lr.best_valid_lap,
  lr.avg_valid_lap,
  lr.median_valid_lap,
  lr.valid_lap_stddev,
  lr.best_s1,
  lr.best_s2,
  lr.best_s3,
  lr.avg_s1,
  lr.avg_s2,
  lr.avg_s3,
  ss.total_stints,
  ss.pit_stop_count,
  ss.strategy_type,
  ss.compounds_used,
  ss.total_pit_duration_seconds,
  gvf.grid_position,
  gvf.finish_position,
  gvf.positions_gained,
  gvf.grid_source,
  gvf.finish_source
FROM lap_rollup lr
LEFT JOIN core_build.strategy_summary ss
  ON ss.session_key = lr.session_key
 AND ss.driver_number = lr.driver_number
LEFT JOIN core_build.grid_vs_finish gvf
  ON gvf.session_key = lr.session_key
 AND gvf.driver_number = lr.driver_number;

-- 10. core_build.pit_cycle_summary -- depends on core_build.strategy_summary,
--     core_build.race_progression_summary, core_build.laps_enriched.
CREATE OR REPLACE VIEW core_build.pit_cycle_summary AS
WITH pit_events AS (
  SELECT
    ss.session_key,
    ss.meeting_key,
    ss.year,
    ss.session_name,
    ss.session_type,
    ss.country_name,
    ss.location,
    ss.driver_number,
    ss.driver_name AS full_name,
    ss.team_name,
    pl.lap_number AS pit_lap,
    ROW_NUMBER() OVER (
      PARTITION BY ss.session_key, ss.driver_number
      ORDER BY pl.lap_number
    ) AS pit_sequence
  FROM core_build.strategy_summary ss
  JOIN LATERAL UNNEST(COALESCE(ss.pit_laps, ARRAY[]::integer[])) AS pl(lap_number)
    ON TRUE
),
position_pairs AS (
  SELECT
    pe.session_key,
    pe.driver_number,
    pe.pit_lap,
    MAX(CASE WHEN rp.lap_number = pe.pit_lap - 1 THEN rp.position_end_of_lap END) AS pre_pit_position,
    MAX(CASE WHEN rp.lap_number = pe.pit_lap + 1 THEN rp.position_end_of_lap END) AS post_pit_position
  FROM pit_events pe
  LEFT JOIN core_build.race_progression_summary rp
    ON rp.session_key = pe.session_key
   AND rp.driver_number = pe.driver_number
  GROUP BY
    pe.session_key,
    pe.driver_number,
    pe.pit_lap
),
pace_windows AS (
  SELECT
    pe.session_key,
    pe.driver_number,
    pe.pit_lap,
    COUNT(*) FILTER (
      WHERE le.lap_number BETWEEN pe.pit_lap - 3 AND pe.pit_lap - 1
        AND le.lap_duration IS NOT NULL
        AND le.lap_duration > 0
        AND COALESCE(le.is_valid, TRUE) = TRUE
    ) AS pre_window_lap_count,
    ROUND(
      AVG(le.lap_duration) FILTER (
        WHERE le.lap_number BETWEEN pe.pit_lap - 3 AND pe.pit_lap - 1
          AND le.lap_duration IS NOT NULL
          AND le.lap_duration > 0
          AND COALESCE(le.is_valid, TRUE) = TRUE
      )::numeric,
      3
    ) AS pre_window_avg_lap,
    COUNT(*) FILTER (
      WHERE le.lap_number BETWEEN pe.pit_lap + 1 AND pe.pit_lap + 3
        AND le.lap_duration IS NOT NULL
        AND le.lap_duration > 0
        AND COALESCE(le.is_valid, TRUE) = TRUE
    ) AS post_window_lap_count,
    ROUND(
      AVG(le.lap_duration) FILTER (
        WHERE le.lap_number BETWEEN pe.pit_lap + 1 AND pe.pit_lap + 3
          AND le.lap_duration IS NOT NULL
          AND le.lap_duration > 0
          AND COALESCE(le.is_valid, TRUE) = TRUE
      )::numeric,
      3
    ) AS post_window_avg_lap
  FROM pit_events pe
  LEFT JOIN core_build.laps_enriched le
    ON le.session_key = pe.session_key
   AND le.driver_number = pe.driver_number
   AND le.lap_number BETWEEN pe.pit_lap - 3 AND pe.pit_lap + 3
  GROUP BY
    pe.session_key,
    pe.driver_number,
    pe.pit_lap
),
pit_meta AS (
  SELECT
    p.session_key,
    p.driver_number,
    p.lap_number AS pit_lap,
    ROUND(MIN(p.pit_duration)::numeric, 3) AS pit_duration_seconds,
    MIN(p.date) AS pit_timestamp
  FROM raw.pit p
  GROUP BY
    p.session_key,
    p.driver_number,
    p.lap_number
)
SELECT
  pe.session_key,
  pe.meeting_key,
  pe.year,
  pe.session_name,
  pe.session_type,
  pe.country_name,
  pe.location,
  pe.driver_number,
  pe.full_name,
  pe.team_name,
  pe.pit_sequence,
  pe.pit_lap,
  pm.pit_timestamp,
  pm.pit_duration_seconds,
  pp.pre_pit_position,
  pp.post_pit_position,
  CASE
    WHEN pp.pre_pit_position IS NULL OR pp.post_pit_position IS NULL THEN NULL
    ELSE pp.pre_pit_position - pp.post_pit_position
  END AS positions_gained_after_pit,
  pw.pre_window_lap_count,
  pw.pre_window_avg_lap,
  pw.post_window_lap_count,
  pw.post_window_avg_lap,
  CASE
    WHEN pw.pre_window_avg_lap IS NULL OR pw.post_window_avg_lap IS NULL THEN NULL
    ELSE ROUND((pw.post_window_avg_lap - pw.pre_window_avg_lap)::numeric, 3)
  END AS post_minus_pre_lap_delta,
  (pp.pre_pit_position IS NOT NULL AND pp.post_pit_position IS NOT NULL) AS position_evidence_sufficient,
  (COALESCE(pw.pre_window_lap_count, 0) > 0 AND COALESCE(pw.post_window_lap_count, 0) > 0)
    AS pace_window_evidence_sufficient,
  (pp.pre_pit_position IS NOT NULL AND pp.post_pit_position IS NOT NULL)
    AS evidence_sufficient_for_pit_cycle_claim,
  (
    pp.pre_pit_position IS NOT NULL
    AND pp.post_pit_position IS NOT NULL
    AND COALESCE(pw.pre_window_lap_count, 0) > 0
    AND COALESCE(pw.post_window_lap_count, 0) > 0
  ) AS evidence_sufficient_for_strategy_claim
FROM pit_events pe
LEFT JOIN position_pairs pp
  ON pp.session_key = pe.session_key
 AND pp.driver_number = pe.driver_number
 AND pp.pit_lap = pe.pit_lap
LEFT JOIN pace_windows pw
  ON pw.session_key = pe.session_key
 AND pw.driver_number = pe.driver_number
 AND pw.pit_lap = pe.pit_lap
LEFT JOIN pit_meta pm
  ON pm.session_key = pe.session_key
 AND pm.driver_number = pe.driver_number
 AND pm.pit_lap = pe.pit_lap;

-- 11. core_build.strategy_evidence_summary -- depends on core_build.pit_cycle_summary.
CREATE OR REPLACE VIEW core_build.strategy_evidence_summary AS
WITH pit_cycle AS (
  SELECT *
  FROM core_build.pit_cycle_summary
),
rival_candidates AS (
  SELECT
    a.session_key,
    a.meeting_key,
    a.year,
    a.session_name,
    a.session_type,
    a.country_name,
    a.location,
    a.driver_number,
    a.full_name,
    a.team_name,
    a.pit_sequence,
    a.pit_lap,
    a.pit_timestamp,
    a.pit_duration_seconds,
    a.pre_pit_position,
    a.post_pit_position,
    a.positions_gained_after_pit,
    a.pre_window_lap_count,
    a.pre_window_avg_lap,
    a.post_window_lap_count,
    a.post_window_avg_lap,
    a.post_minus_pre_lap_delta,
    a.position_evidence_sufficient,
    a.pace_window_evidence_sufficient,
    a.evidence_sufficient_for_pit_cycle_claim,
    a.evidence_sufficient_for_strategy_claim,
    b.driver_number AS rival_driver_number,
    b.full_name AS rival_full_name,
    b.team_name AS rival_team_name,
    b.pit_sequence AS rival_pit_sequence,
    b.pit_lap AS rival_pit_lap,
    b.pre_pit_position AS rival_pre_pit_position,
    b.post_pit_position AS rival_post_pit_position,
    b.positions_gained_after_pit AS rival_positions_gained_after_pit,
    b.pre_window_lap_count AS rival_pre_window_lap_count,
    b.pre_window_avg_lap AS rival_pre_window_avg_lap,
    b.post_window_lap_count AS rival_post_window_lap_count,
    b.post_window_avg_lap AS rival_post_window_avg_lap,
    b.post_minus_pre_lap_delta AS rival_post_minus_pre_lap_delta,
    b.position_evidence_sufficient AS rival_position_evidence_sufficient,
    b.pace_window_evidence_sufficient AS rival_pace_window_evidence_sufficient,
    ABS(a.pit_lap - b.pit_lap) AS rival_pit_lap_gap,
    ABS(COALESCE(a.pre_pit_position, 999) - COALESCE(b.pre_pit_position, 999)) AS rival_pre_position_gap,
    ROW_NUMBER() OVER (
      PARTITION BY a.session_key, a.driver_number, a.pit_lap
      ORDER BY
        ABS(a.pit_lap - b.pit_lap) ASC,
        ABS(COALESCE(a.pre_pit_position, 999) - COALESCE(b.pre_pit_position, 999)) ASC,
        b.driver_number ASC
    ) AS rival_rank
  FROM pit_cycle a
  LEFT JOIN pit_cycle b
    ON b.session_key = a.session_key
   AND b.driver_number <> a.driver_number
   AND ABS(a.pit_lap - b.pit_lap) <= 5
),
best_rival AS (
  SELECT *
  FROM rival_candidates
  WHERE rival_rank = 1
),
evidence AS (
  SELECT
    br.*,
    (br.rival_driver_number IS NOT NULL) AS rival_context_present,
    (
      br.rival_driver_number IS NOT NULL
      AND br.pre_pit_position IS NOT NULL
      AND br.post_pit_position IS NOT NULL
      AND br.rival_pre_pit_position IS NOT NULL
      AND br.rival_post_pit_position IS NOT NULL
    ) AS relative_position_evidence_sufficient
  FROM best_rival br
)
SELECT
  e.session_key,
  e.meeting_key,
  e.year,
  e.session_name,
  e.session_type,
  e.country_name,
  e.location,
  e.driver_number,
  e.full_name,
  e.team_name,
  e.pit_sequence,
  e.pit_lap,
  e.pit_timestamp,
  e.pit_duration_seconds,
  e.pre_pit_position,
  e.post_pit_position,
  e.positions_gained_after_pit,
  e.pre_window_lap_count,
  e.pre_window_avg_lap,
  e.post_window_lap_count,
  e.post_window_avg_lap,
  e.post_minus_pre_lap_delta,
  e.rival_driver_number,
  e.rival_full_name,
  e.rival_team_name,
  e.rival_pit_sequence,
  e.rival_pit_lap,
  e.rival_pre_pit_position,
  e.rival_post_pit_position,
  e.rival_positions_gained_after_pit,
  e.rival_pre_window_lap_count,
  e.rival_pre_window_avg_lap,
  e.rival_post_window_lap_count,
  e.rival_post_window_avg_lap,
  e.rival_post_minus_pre_lap_delta,
  e.rival_pit_lap_gap,
  e.rival_context_present,
  e.relative_position_evidence_sufficient,
  CASE
    WHEN NOT e.relative_position_evidence_sufficient THEN NULL
    ELSE e.pre_pit_position - e.rival_pre_pit_position
  END AS relative_position_delta_pre,
  CASE
    WHEN NOT e.relative_position_evidence_sufficient THEN NULL
    ELSE e.post_pit_position - e.rival_post_pit_position
  END AS relative_position_delta_post,
  CASE
    WHEN NOT e.relative_position_evidence_sufficient THEN NULL
    ELSE (e.pre_pit_position - e.rival_pre_pit_position) - (e.post_pit_position - e.rival_post_pit_position)
  END AS relative_positions_gained_vs_rival,
  (
    e.relative_position_evidence_sufficient
    AND COALESCE(e.pre_window_lap_count, 0) > 0
    AND COALESCE(e.post_window_lap_count, 0) > 0
    AND COALESCE(e.rival_pre_window_lap_count, 0) > 0
    AND COALESCE(e.rival_post_window_lap_count, 0) > 0
  ) AS evidence_sufficient_for_undercut_overcut_claim,
  CASE
    WHEN NOT (
      e.relative_position_evidence_sufficient
      AND COALESCE(e.pre_window_lap_count, 0) > 0
      AND COALESCE(e.post_window_lap_count, 0) > 0
      AND COALESCE(e.rival_pre_window_lap_count, 0) > 0
      AND COALESCE(e.rival_post_window_lap_count, 0) > 0
    ) THEN 'insufficient_evidence'
    WHEN e.pit_lap < e.rival_pit_lap
      AND ((e.pre_pit_position - e.rival_pre_pit_position) - (e.post_pit_position - e.rival_post_pit_position)) > 0
      THEN 'undercut_supported'
    WHEN e.pit_lap > e.rival_pit_lap
      AND ((e.pre_pit_position - e.rival_pre_pit_position) - (e.post_pit_position - e.rival_post_pit_position)) > 0
      THEN 'overcut_supported'
    WHEN ((e.pre_pit_position - e.rival_pre_pit_position) - (e.post_pit_position - e.rival_post_pit_position)) < 0
      THEN 'counter_evidence'
    ELSE 'no_clear_evidence'
  END AS undercut_overcut_signal,
  CASE
    WHEN NOT (
      e.relative_position_evidence_sufficient
      AND COALESCE(e.pre_window_lap_count, 0) > 0
      AND COALESCE(e.post_window_lap_count, 0) > 0
      AND COALESCE(e.rival_pre_window_lap_count, 0) > 0
      AND COALESCE(e.rival_post_window_lap_count, 0) > 0
    ) THEN 'low'
    WHEN ABS((e.pre_pit_position - e.rival_pre_pit_position) - (e.post_pit_position - e.rival_post_pit_position)) >= 2
      THEN 'high'
    ELSE 'medium'
  END AS evidence_confidence
FROM evidence e;

COMMIT;
