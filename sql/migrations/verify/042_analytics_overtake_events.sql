-- Verify openf1:042_analytics_overtake_events on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'meeting_key', 'overtake_lap',
    'overtaking_driver_number', 'overtaken_driver_number',
    'overtake_count', 'position_change', 'date', 'location_corner'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='overtake_events_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.overtake_events_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='overtake_events';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.overtake_events facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='overtake_events'
  LOOP
    RAISE EXCEPTION 'analytics.overtake_events missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
