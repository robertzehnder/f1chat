-- Revert openf1:028_session_completeness_data_matview from pg

BEGIN;

-- drop dependents + facade + storage matview
DROP VIEW IF EXISTS core.source_anomaly_tracking;
DROP VIEW IF EXISTS core.weekend_session_expectation_audit;
DROP VIEW IF EXISTS core.weekend_session_coverage;
DROP VIEW IF EXISTS core.session_completeness CASCADE;
DROP MATERIALIZED VIEW IF EXISTS core.session_completeness_data;

-- recreate core.session_completeness as the ORIGINAL 005 plain view
CREATE OR REPLACE VIEW core.session_completeness AS
WITH drivers_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.drivers
  GROUP BY session_key
),
laps_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.laps
  GROUP BY session_key
),
pit_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.pit
  GROUP BY session_key
),
stints_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.stints
  GROUP BY session_key
),
weather_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.weather
  GROUP BY session_key
),
team_radio_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.team_radio
  GROUP BY session_key
),
position_history_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.position_history
  GROUP BY session_key
),
intervals_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.intervals
  GROUP BY session_key
),
car_data_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.car_data
  GROUP BY session_key
),
location_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.location
  GROUP BY session_key
),
session_result_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.session_result
  GROUP BY session_key
),
starting_grid_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.starting_grid
  GROUP BY session_key
),
race_control_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.race_control
  GROUP BY session_key
),
overtakes_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.overtakes
  GROUP BY session_key
),
base AS (
  SELECT
    s.session_key,
    s.meeting_key,
    s.year,
    s.meeting_name,
    s.session_name,
    s.session_type,
    CASE
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%sprint qualifying%'
        OR LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%sprint shootout%' THEN 'Sprint Qualifying'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%sprint%' THEN 'Sprint'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%qualif%' THEN 'Qualifying'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%practice%'
        OR LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE 'fp%' THEN 'Practice'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%race%' THEN 'Race'
      ELSE COALESCE(NULLIF(BTRIM(s.session_type), ''), NULLIF(BTRIM(s.session_name), ''), 'Other')
    END AS normalized_session_type,
    s.country_name,
    s.location,
    s.circuit_short_name,
    s.date_start,
    COALESCE(drivers_count.rows_count, 0) AS drivers_rows,
    COALESCE(laps_count.rows_count, 0) AS laps_rows,
    COALESCE(pit_count.rows_count, 0) AS pit_rows,
    COALESCE(stints_count.rows_count, 0) AS stints_rows,
    COALESCE(weather_count.rows_count, 0) AS weather_rows,
    COALESCE(team_radio_count.rows_count, 0) AS team_radio_rows,
    COALESCE(position_history_count.rows_count, 0) AS position_history_rows,
    COALESCE(intervals_count.rows_count, 0) AS intervals_rows,
    COALESCE(car_data_count.rows_count, 0) AS car_data_rows,
    COALESCE(location_count.rows_count, 0) AS location_rows,
    COALESCE(session_result_count.rows_count, 0) AS session_result_rows,
    COALESCE(starting_grid_count.rows_count, 0) AS starting_grid_rows,
    COALESCE(race_control_count.rows_count, 0) AS race_control_rows,
    COALESCE(overtakes_count.rows_count, 0) AS overtakes_rows,
    (COALESCE(drivers_count.rows_count, 0) > 0) AS has_drivers,
    (COALESCE(laps_count.rows_count, 0) > 0) AS has_laps,
    (COALESCE(pit_count.rows_count, 0) > 0) AS has_pit,
    (COALESCE(stints_count.rows_count, 0) > 0) AS has_stints,
    (COALESCE(weather_count.rows_count, 0) > 0) AS has_weather,
    (COALESCE(team_radio_count.rows_count, 0) > 0) AS has_team_radio,
    (COALESCE(position_history_count.rows_count, 0) > 0) AS has_position_history,
    (COALESCE(intervals_count.rows_count, 0) > 0) AS has_intervals,
    (COALESCE(car_data_count.rows_count, 0) > 0) AS has_car_data,
    (COALESCE(location_count.rows_count, 0) > 0) AS has_location,
    (COALESCE(session_result_count.rows_count, 0) > 0) AS has_session_result,
    (COALESCE(starting_grid_count.rows_count, 0) > 0) AS has_starting_grid,
    (COALESCE(race_control_count.rows_count, 0) > 0) AS has_race_control,
    (COALESCE(overtakes_count.rows_count, 0) > 0) AS has_overtakes,
    (
      (CASE WHEN COALESCE(laps_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(pit_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(stints_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(weather_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(team_radio_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(position_history_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(intervals_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(car_data_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(location_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(session_result_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(starting_grid_count.rows_count, 0) > 0 THEN 1 ELSE 0 END)
    )::INTEGER AS completeness_score,
    (
      COALESCE(laps_count.rows_count, 0) > 0 AND
      COALESCE(stints_count.rows_count, 0) > 0 AND
      COALESCE(pit_count.rows_count, 0) > 0 AND
      COALESCE(car_data_count.rows_count, 0) > 0 AND
      COALESCE(position_history_count.rows_count, 0) > 0
    ) AS has_core_analysis_pack,
    (COALESCE(NULLIF(BTRIM(s.meeting_name), ''), NULL) IS NOT NULL) AS has_meeting_name,
    (
      (s.date_start IS NOT NULL AND s.date_start > NOW()) OR
      (s.date_start IS NULL AND COALESCE(s.year, 0) > EXTRACT(YEAR FROM NOW())::INTEGER)
    ) AS is_future_session
  FROM core.sessions s
  LEFT JOIN drivers_count ON drivers_count.session_key = s.session_key
  LEFT JOIN laps_count ON laps_count.session_key = s.session_key
  LEFT JOIN pit_count ON pit_count.session_key = s.session_key
  LEFT JOIN stints_count ON stints_count.session_key = s.session_key
  LEFT JOIN weather_count ON weather_count.session_key = s.session_key
  LEFT JOIN team_radio_count ON team_radio_count.session_key = s.session_key
  LEFT JOIN position_history_count ON position_history_count.session_key = s.session_key
  LEFT JOIN intervals_count ON intervals_count.session_key = s.session_key
  LEFT JOIN car_data_count ON car_data_count.session_key = s.session_key
  LEFT JOIN location_count ON location_count.session_key = s.session_key
  LEFT JOIN session_result_count ON session_result_count.session_key = s.session_key
  LEFT JOIN starting_grid_count ON starting_grid_count.session_key = s.session_key
  LEFT JOIN race_control_count ON race_control_count.session_key = s.session_key
  LEFT JOIN overtakes_count ON overtakes_count.session_key = s.session_key
),
classified AS (
  SELECT
    b.*,
    (
      (
        NOT b.has_meeting_name
        AND NOT (
          b.has_drivers OR
          b.has_laps OR
          b.has_car_data OR
          b.has_weather OR
          b.has_team_radio OR
          b.has_pit OR
          b.has_session_result OR
          b.has_starting_grid
        )
      )
      OR (
        b.is_future_session
        AND NOT b.has_laps
        AND NOT b.has_car_data
        AND NOT b.has_pit
        AND NOT b.has_session_result
      )
    ) AS is_placeholder
  FROM base b
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
  c.date_start,
  c.drivers_rows,
  c.laps_rows,
  c.pit_rows,
  c.stints_rows,
  c.weather_rows,
  c.team_radio_rows,
  c.position_history_rows,
  c.intervals_rows,
  c.car_data_rows,
  c.location_rows,
  c.session_result_rows,
  c.starting_grid_rows,
  c.race_control_rows,
  c.overtakes_rows,
  c.has_laps,
  c.has_pit,
  c.has_stints,
  c.has_weather,
  c.has_team_radio,
  c.has_position_history,
  c.has_intervals,
  c.has_car_data,
  c.has_location,
  c.has_session_result,
  c.has_starting_grid,
  c.has_race_control,
  c.has_overtakes,
  c.completeness_score,
  c.has_core_analysis_pack,
  c.has_drivers,
  c.meeting_name,
  c.normalized_session_type,
  c.is_future_session,
  c.is_placeholder,
  c.has_meeting_name,
  CASE
    WHEN c.is_future_session AND c.is_placeholder THEN 'future_placeholder'
    WHEN c.has_core_analysis_pack AND NOT c.is_future_session THEN 'analytic_ready'
    WHEN c.completeness_score >= 4 THEN 'partially_loaded'
    ELSE 'metadata_only'
  END AS completeness_status
FROM classified c;

-- recreate the 3 dependent views from their 005 bodies
-- (copied verbatim from deploy/028_session_completeness_data_matview.sql)

-- weekend_session_coverage (005:702)
CREATE OR REPLACE VIEW core.weekend_session_coverage AS
WITH session_rows AS (
  SELECT
    COALESCE(sc.meeting_key, -sc.session_key) AS coverage_meeting_key,
    sc.meeting_key,
    sc.year,
    COALESCE(
      NULLIF(BTRIM(sc.meeting_name), ''),
      NULLIF(BTRIM(sc.location), ''),
      NULLIF(BTRIM(sc.country_name), ''),
      CONCAT('session_', sc.session_key::TEXT)
    ) AS weekend_label,
    sc.date_start,
    sc.normalized_session_type,
    sc.is_placeholder,
    sc.is_future_session
  FROM core.session_completeness sc
)
SELECT
  coverage_meeting_key,
  meeting_key,
  year,
  weekend_label,
  MIN(date_start) AS earliest_session_start,
  MAX(date_start) AS latest_session_start,
  COUNT(*) AS total_sessions,
  COUNT(*) FILTER (WHERE NOT is_placeholder) AS real_sessions,
  COUNT(*) FILTER (WHERE is_placeholder) AS placeholder_sessions,
  BOOL_OR(is_future_session) AS has_future_session,
  ARRAY_AGG(DISTINCT normalized_session_type ORDER BY normalized_session_type)
    FILTER (WHERE normalized_session_type IS NOT NULL AND NOT is_placeholder) AS session_types_present
FROM session_rows
GROUP BY coverage_meeting_key, meeting_key, year, weekend_label;

-- weekend_session_expectation_audit (005:772) — preserved verbatim from 005.
CREATE OR REPLACE VIEW core.weekend_session_expectation_audit AS
WITH expectations AS (
  SELECT 'Race'::TEXT AS expected_type
  UNION ALL SELECT 'Qualifying'
  UNION ALL SELECT 'Practice'
),
weekend_actuals AS (
  SELECT
    wsc.coverage_meeting_key,
    wsc.meeting_key,
    wsc.year,
    wsc.weekend_label,
    wsc.session_types_present,
    wsc.real_sessions,
    wsc.placeholder_sessions
  FROM core.weekend_session_coverage wsc
)
SELECT
  wa.coverage_meeting_key,
  wa.meeting_key,
  wa.year,
  wa.weekend_label,
  ex.expected_type,
  CASE
    WHEN wa.session_types_present IS NULL THEN false
    ELSE ex.expected_type = ANY (wa.session_types_present)
  END AS has_expected_type,
  wa.real_sessions,
  wa.placeholder_sessions
FROM weekend_actuals wa
CROSS JOIN expectations ex;

-- source_anomaly_tracking (005:845) — preserved verbatim from 005.
CREATE OR REPLACE VIEW core.source_anomaly_tracking AS
WITH placeholder_sessions AS (
  SELECT
    sc.session_key,
    sc.meeting_key,
    sc.year,
    sc.meeting_name,
    sc.country_name,
    sc.location,
    sc.session_name,
    sc.session_type,
    sc.normalized_session_type,
    sc.date_start,
    sc.has_meeting_name,
    sc.completeness_status,
    sc.is_future_session,
    sc.is_placeholder
  FROM core.session_completeness sc
  WHERE sc.is_placeholder
),
missing_session_types AS (
  SELECT
    wea.coverage_meeting_key,
    wea.meeting_key,
    wea.year,
    wea.weekend_label,
    wea.expected_type,
    wea.has_expected_type
  FROM core.weekend_session_expectation_audit wea
  WHERE NOT wea.has_expected_type
)
SELECT
  'placeholder_session'::TEXT AS anomaly_kind,
  ps.session_key,
  ps.meeting_key,
  ps.year,
  ps.meeting_name,
  ps.country_name,
  ps.location,
  ps.session_name,
  ps.session_type,
  ps.normalized_session_type,
  ps.date_start,
  NULL::TEXT AS missing_expected_type,
  ps.completeness_status,
  ps.is_future_session,
  'core.session_completeness'::TEXT AS evidence_ref,
  CASE
    WHEN ps.is_future_session THEN 'future_session_skeleton_row'
    WHEN NOT ps.has_meeting_name THEN 'missing_meeting_name_only_metadata'
    ELSE 'metadata_only_with_no_data'
  END AS evidence_summary
FROM placeholder_sessions ps
UNION ALL
SELECT
  'missing_expected_session_type'::TEXT AS anomaly_kind,
  NULL::BIGINT AS session_key,
  mst.meeting_key,
  mst.year,
  NULL::TEXT AS meeting_name,
  NULL::TEXT AS country_name,
  NULL::TEXT AS location,
  NULL::TEXT AS session_name,
  NULL::TEXT AS session_type,
  NULL::TEXT AS normalized_session_type,
  NULL::TIMESTAMPTZ AS date_start,
  mst.expected_type AS missing_expected_type,
  NULL::TEXT AS completeness_status,
  NULL::BOOLEAN AS is_future_session,
  'core.weekend_session_expectation_audit'::TEXT AS evidence_ref,
  CONCAT('weekend ', mst.weekend_label, ' (', mst.year, ') has no ', mst.expected_type, ' session') AS evidence_summary
FROM missing_session_types mst;

COMMIT;
