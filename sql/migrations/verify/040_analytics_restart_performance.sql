-- Verify openf1:040_analytics_restart_performance on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'restart_lap', 'restart_kind',
    'position_before', 'position_after', 'position_delta'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='restart_performance_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.restart_performance_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='restart_performance';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.restart_performance facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='restart_performance'
  LOOP
    RAISE EXCEPTION 'analytics.restart_performance missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
