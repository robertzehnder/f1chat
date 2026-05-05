-- Verify openf1:048_analytics_corner_analysis on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key','driver_number','driver_name','team_name',
    'lap_number','corner_id','corner_number','corner_label',
    'start_normalized','end_normalized',
    'entry_speed_kph','apex_min_speed_kph','exit_speed_kph','sample_count'
  ];
  missing text;
BEGIN
  SELECT COUNT(*) INTO matview_count FROM pg_matviews
   WHERE schemaname='analytics' AND matviewname='corner_analysis_data';
  IF matview_count = 0 THEN RAISE EXCEPTION 'analytics.corner_analysis_data matview missing'; END IF;

  SELECT COUNT(*) INTO view_count FROM pg_views
   WHERE schemaname='analytics' AND viewname='corner_analysis';
  IF view_count = 0 THEN RAISE EXCEPTION 'analytics.corner_analysis facade view missing'; END IF;

  FOR missing IN
    SELECT unnest(expected_columns) EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='corner_analysis'
  LOOP
    RAISE EXCEPTION 'analytics.corner_analysis missing column: %', missing;
  END LOOP;
END $$;

ROLLBACK;
