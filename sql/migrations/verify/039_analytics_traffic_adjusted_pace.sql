-- Verify openf1:039_analytics_traffic_adjusted_pace on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'traffic_laps', 'clean_air_laps',
    'traffic_pace_s', 'clean_air_pace_s', 'traffic_pace_delta_s'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='traffic_adjusted_pace_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.traffic_adjusted_pace_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='traffic_adjusted_pace';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.traffic_adjusted_pace facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='traffic_adjusted_pace'
  LOOP
    RAISE EXCEPTION 'analytics.traffic_adjusted_pace missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
