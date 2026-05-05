-- Verify openf1:043_analytics_undercut_overcut_history on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'undercut_success_count', 'overcut_success_count', 'neutral_stop_count', 'total_stops'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='undercut_overcut_history_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.undercut_overcut_history_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='undercut_overcut_history';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.undercut_overcut_history facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='undercut_overcut_history'
  LOOP
    RAISE EXCEPTION 'analytics.undercut_overcut_history missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
