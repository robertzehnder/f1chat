-- Verify openf1:028_session_completeness_data_matview on pg
--
-- Schema-only checks: relkind, index, column shape, dependent compiles.
-- Data-dependent checks (row counts) live in scripts/phase17_neon_setup.py
-- under OPENF1_ASSUME_POPULATED gating; they don't fire here so the verify
-- file works on empty test branches.

BEGIN;

-- relkind: facade is a view, storage is a matview.
DO $$
DECLARE
  rk char;
BEGIN
  SELECT c.relkind INTO rk FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='core' AND c.relname='session_completeness';
  IF rk <> 'v' THEN
    RAISE EXCEPTION 'session_completeness facade must be relkind v, got %', rk;
  END IF;

  SELECT c.relkind INTO rk FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='core' AND c.relname='session_completeness_data';
  IF rk <> 'm' THEN
    RAISE EXCEPTION 'session_completeness_data must be relkind m, got %', rk;
  END IF;
END $$;

-- Unique index on the storage matview.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='core'
      AND indexname='idx_session_completeness_data_session_key'
  ) THEN
    RAISE EXCEPTION 'idx_session_completeness_data_session_key missing';
  END IF;
END $$;

-- Column-shape verify against the canonical 45-column projection.
-- Identical to the deploy block — runs in verify so a partial-deploy
-- state with a wrong-shaped matview is caught here too.
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
    SELECT a.attnum::int AS attnum, a.attname::text AS attname,
           format_type(a.atttypid, a.atttypmod)::text AS atttype
    FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='core' AND c.relname='session_completeness_data'
      AND a.attnum > 0 AND NOT a.attisdropped
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
    FROM expected e FULL OUTER JOIN actual a USING (attnum)
    WHERE e.attnum IS NULL OR a.attnum IS NULL
       OR e.attname <> a.attname OR e.atttype <> a.atttype
  )
  SELECT COUNT(*),
         string_agg(
           format('attnum=%s reason=%s expected=(%s,%s) actual=(%s,%s)',
                  attnum, reason,
                  COALESCE(expected_name,'<none>'), COALESCE(expected_type,'<none>'),
                  COALESCE(actual_name,'<none>'),   COALESCE(actual_type,'<none>')),
           E'\n' ORDER BY attnum)
    INTO bad_count, bad_summary
  FROM diff;
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'verify 028: session_completeness_data column shape diverges (% mismatches): %',
      bad_count, bad_summary;
  END IF;
END $$;

-- Compile checks: every dependent (and the facade) selects clean.
SELECT * FROM core.session_completeness LIMIT 0;
SELECT * FROM core.weekend_session_coverage LIMIT 0;
SELECT * FROM core.weekend_session_expectation_audit LIMIT 0;
SELECT * FROM core.source_anomaly_tracking LIMIT 0;

ROLLBACK;
