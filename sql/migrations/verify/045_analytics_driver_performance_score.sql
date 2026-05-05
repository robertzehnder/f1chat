-- Verify openf1:045_analytics_driver_performance_score on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'season_year', 'driver_number', 'driver_name', 'team_name',
    'qualifying_axis', 'race_pace_axis', 'tyre_management_axis',
    'restart_axis', 'traffic_handling_axis',
    'overtake_difficulty_axis', 'error_rate_axis'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='driver_performance_score_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.driver_performance_score_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='driver_performance_score';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.driver_performance_score facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='driver_performance_score'
  LOOP
    RAISE EXCEPTION 'analytics.driver_performance_score missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
