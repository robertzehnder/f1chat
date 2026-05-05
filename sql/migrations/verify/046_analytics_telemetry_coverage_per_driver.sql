-- Verify openf1:046_analytics_telemetry_coverage_per_driver on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'car_data_samples', 'median_samples_per_driver',
    'missing_pct_vs_median', 'missing_more_than_5pct', 'missing_more_than_10pct'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='telemetry_coverage_per_driver_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.telemetry_coverage_per_driver_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='telemetry_coverage_per_driver';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.telemetry_coverage_per_driver facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='telemetry_coverage_per_driver'
  LOOP
    RAISE EXCEPTION 'analytics.telemetry_coverage_per_driver missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
