-- Verify openf1:041_analytics_drs_effectiveness on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'drs_active', 'drs_active_samples', 'total_drs_samples', 'drs_active_pct',
    'gap_at_detection_s', 'drs_zone_index'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='drs_effectiveness_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.drs_effectiveness_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='drs_effectiveness';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.drs_effectiveness facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='drs_effectiveness'
  LOOP
    RAISE EXCEPTION 'analytics.drs_effectiveness missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
