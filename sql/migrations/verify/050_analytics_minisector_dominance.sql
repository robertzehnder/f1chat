-- Verify openf1:050_analytics_minisector_dominance on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key','driver_number','driver_name','team_name',
    'minisector_index','minisector_id',
    'valid_lap_count','dominant_count','avg_speed_kph','max_avg_speed_kph'
  ];
  missing text;
BEGIN
  SELECT COUNT(*) INTO matview_count FROM pg_matviews
   WHERE schemaname='analytics' AND matviewname='minisector_dominance_data';
  IF matview_count = 0 THEN RAISE EXCEPTION 'analytics.minisector_dominance_data matview missing'; END IF;

  SELECT COUNT(*) INTO view_count FROM pg_views
   WHERE schemaname='analytics' AND viewname='minisector_dominance';
  IF view_count = 0 THEN RAISE EXCEPTION 'analytics.minisector_dominance facade view missing'; END IF;

  FOR missing IN
    SELECT unnest(expected_columns) EXCEPT
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='minisector_dominance'
  LOOP
    RAISE EXCEPTION 'analytics.minisector_dominance missing column: %', missing;
  END LOOP;
END $$;

ROLLBACK;
