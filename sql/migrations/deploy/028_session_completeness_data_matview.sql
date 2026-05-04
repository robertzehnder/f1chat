-- Deploy openf1:028_session_completeness_data_matview to pg
-- requires: 027_user_feedback
--
-- Phase 18-C: convert core.session_completeness from a view that re-runs
-- COUNT(*) GROUP BY session_key over every raw.* table on every query
-- (~166 s observed on Neon cold cache, 2.5M page reads — see Phase 17
-- close-out audit) into a refreshable storage matview underneath a thin
-- facade view. Dependents (weekend_session_coverage,
-- weekend_session_expectation_audit, source_anomaly_tracking) keep their
-- existing relkind contract (they still SELECT FROM core.session_completeness
-- as a view).
--
-- Idempotent on three states:
--   (A) fresh branch: core.session_completeness is the 005 view
--   (B) audited Neon: core.session_completeness is a matview from Phase 17
--                     troubleshooting + a stale view named
--                     core.session_completeness_view_old
--   (C) re-deploy: 028 already applied — no-op

BEGIN;

DROP VIEW IF EXISTS core.session_completeness_view_old;

CREATE MATERIALIZED VIEW IF NOT EXISTS core.session_completeness_data AS
WITH drivers_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.drivers GROUP BY session_key
),
laps_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.laps GROUP BY session_key
),
pit_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.pit GROUP BY session_key
),
stints_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.stints GROUP BY session_key
),
weather_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.weather GROUP BY session_key
),
team_radio_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.team_radio GROUP BY session_key
),
position_history_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.position_history GROUP BY session_key
),
intervals_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.intervals GROUP BY session_key
),
car_data_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.car_data GROUP BY session_key
),
location_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.location GROUP BY session_key
),
session_result_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.session_result GROUP BY session_key
),
starting_grid_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.starting_grid GROUP BY session_key
),
race_control_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.race_control GROUP BY session_key
),
overtakes_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.overtakes GROUP BY session_key
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

-- Column-shape verify (Phase 18 rev5): the canonical 45-column projection
-- captured from Neon pg_attribute on 2026-05-02. CREATE ... IF NOT EXISTS
-- skips the body when a relation exists; this verify catches a partial
-- prior deploy that left a wrong-shaped matview.
DO $$
DECLARE
  bad_count int;
  bad_summary text;
BEGIN
  WITH expected(attnum, attname, atttype) AS (
    VALUES
      ( 1, 'session_key',             'bigint'),
      ( 2, 'meeting_key',             'bigint'),
      ( 3, 'year',                    'integer'),
      ( 4, 'session_name',            'text'),
      ( 5, 'session_type',            'text'),
      ( 6, 'country_name',            'text'),
      ( 7, 'location',                'text'),
      ( 8, 'circuit_short_name',      'text'),
      ( 9, 'date_start',              'timestamp with time zone'),
      (10, 'drivers_rows',            'bigint'),
      (11, 'laps_rows',               'bigint'),
      (12, 'pit_rows',                'bigint'),
      (13, 'stints_rows',             'bigint'),
      (14, 'weather_rows',            'bigint'),
      (15, 'team_radio_rows',         'bigint'),
      (16, 'position_history_rows',   'bigint'),
      (17, 'intervals_rows',          'bigint'),
      (18, 'car_data_rows',           'bigint'),
      (19, 'location_rows',           'bigint'),
      (20, 'session_result_rows',     'bigint'),
      (21, 'starting_grid_rows',      'bigint'),
      (22, 'race_control_rows',       'bigint'),
      (23, 'overtakes_rows',          'bigint'),
      (24, 'has_laps',                'boolean'),
      (25, 'has_pit',                 'boolean'),
      (26, 'has_stints',              'boolean'),
      (27, 'has_weather',             'boolean'),
      (28, 'has_team_radio',          'boolean'),
      (29, 'has_position_history',    'boolean'),
      (30, 'has_intervals',           'boolean'),
      (31, 'has_car_data',            'boolean'),
      (32, 'has_location',            'boolean'),
      (33, 'has_session_result',      'boolean'),
      (34, 'has_starting_grid',       'boolean'),
      (35, 'has_race_control',        'boolean'),
      (36, 'has_overtakes',           'boolean'),
      (37, 'completeness_score',      'integer'),
      (38, 'has_core_analysis_pack',  'boolean'),
      (39, 'has_drivers',             'boolean'),
      (40, 'meeting_name',            'text'),
      (41, 'normalized_session_type', 'text'),
      (42, 'is_future_session',       'boolean'),
      (43, 'is_placeholder',          'boolean'),
      (44, 'has_meeting_name',        'boolean'),
      (45, 'completeness_status',     'text')
  ),
  actual AS (
    SELECT a.attnum::int AS attnum,
           a.attname::text AS attname,
           format_type(a.atttypid, a.atttypmod)::text AS atttype
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='core'
      AND c.relname='session_completeness_data'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ),
  diff AS (
    SELECT COALESCE(e.attnum, a.attnum) AS attnum,
           e.attname AS expected_name, a.attname AS actual_name,
           e.atttype AS expected_type, a.atttype AS actual_type,
           CASE
             WHEN e.attnum IS NULL THEN 'unexpected'
             WHEN a.attnum IS NULL THEN 'missing'
             WHEN e.attname <> a.attname THEN 'name_mismatch'
             WHEN e.atttype <> a.atttype THEN 'type_mismatch'
           END AS reason
    FROM expected e
    FULL OUTER JOIN actual a USING (attnum)
    WHERE e.attnum IS NULL
       OR a.attnum IS NULL
       OR e.attname <> a.attname
       OR e.atttype <> a.atttype
  )
  SELECT COUNT(*),
         string_agg(
           format('attnum=%s reason=%s expected=(%s,%s) actual=(%s,%s)',
                  attnum, reason,
                  COALESCE(expected_name,'<none>'),
                  COALESCE(expected_type,'<none>'),
                  COALESCE(actual_name,'<none>'),
                  COALESCE(actual_type,'<none>')),
           E'\n' ORDER BY attnum)
    INTO bad_count, bad_summary
  FROM diff;
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      '028: core.session_completeness_data column shape diverges from canonical 005 projection (% mismatches): %',
      bad_count, bad_summary;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_completeness_data_session_key
  ON core.session_completeness_data (session_key);

-- Convert core.session_completeness to a facade view that selects from the
-- storage matview, regardless of current relkind. Splits into:
--   relkind='v' (fresh branch from 005) → CREATE OR REPLACE VIEW (no CASCADE,
--                                          dependents pristine)
--   relkind='m' (Phase 17 hand-rolled) → DROP CASCADE, then explicit
--                                         re-create + dependent rebuild below.
DO $$
DECLARE
  rk char;
BEGIN
  SELECT c.relkind INTO rk
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'core' AND c.relname = 'session_completeness';

  IF rk IS NULL THEN
    EXECUTE 'CREATE VIEW core.session_completeness AS '
         || 'SELECT * FROM core.session_completeness_data';
  ELSIF rk = 'v' THEN
    EXECUTE 'CREATE OR REPLACE VIEW core.session_completeness AS '
         || 'SELECT * FROM core.session_completeness_data';
  ELSIF rk = 'm' THEN
    -- Phase 17 hand-rolled matview. CASCADE drops the three known
    -- dependent views (weekend_session_coverage,
    -- weekend_session_expectation_audit, source_anomaly_tracking);
    -- they're recreated by the CREATE OR REPLACE statements below.
    DROP MATERIALIZED VIEW core.session_completeness CASCADE;
    EXECUTE 'CREATE VIEW core.session_completeness AS '
         || 'SELECT * FROM core.session_completeness_data';
  ELSE
    RAISE EXCEPTION
      '028: unexpected relkind % on core.session_completeness', rk;
  END IF;
END $$;

-- Re-run dependent view bodies verbatim from 005 so a CASCADE drop above
-- on the audited-Neon path doesn't leave them missing. CREATE OR REPLACE
-- is a no-op on the fresh-branch path where they were never dropped.
-- Bodies sourced from sql/migrations/deploy/005_helper_tables.sql.

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
-- See sql/migrations/deploy/005_helper_tables.sql:772 for canonical body;
-- this CREATE OR REPLACE re-runs it so a CASCADE drop on the audited-Neon
-- path doesn't leave it absent.
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
-- See sql/migrations/deploy/005_helper_tables.sql:845 for canonical body;
-- this CREATE OR REPLACE re-runs it so a CASCADE drop on the audited-Neon
-- path doesn't leave it absent. The body chains through
-- weekend_session_expectation_audit (just rebuilt above) and references
-- session_completeness directly via the new facade.
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
