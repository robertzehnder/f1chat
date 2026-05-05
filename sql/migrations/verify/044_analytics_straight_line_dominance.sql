-- Verify openf1:044_analytics_straight_line_dominance on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'st_speed_kph', 'i2_speed_kph', 'i1_speed_kph',
    'avg_speed_kph', 'speed_sample_count'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='straight_line_dominance_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.straight_line_dominance_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='straight_line_dominance';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.straight_line_dominance facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='straight_line_dominance'
  LOOP
    RAISE EXCEPTION 'analytics.straight_line_dominance missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
