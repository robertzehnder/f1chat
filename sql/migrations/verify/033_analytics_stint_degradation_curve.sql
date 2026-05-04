-- Verify openf1:033_analytics_stint_degradation_curve on pg

BEGIN;

DO $$
DECLARE
  schema_count int;
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'stint_number', 'compound_name',
    'lap_start', 'lap_end', 'stint_length_laps', 'valid_lap_count',
    'degradation_per_lap_s', 'intercept_lap_s', 'regression_r2',
    'fuel_corrected_degradation_per_lap_s',
    'best_lap_s', 'worst_lap_s', 'avg_lap_s'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO schema_count
  FROM information_schema.schemata WHERE schema_name='analytics';
  IF schema_count = 0 THEN RAISE EXCEPTION 'analytics schema missing'; END IF;

  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='stint_degradation_curve_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.stint_degradation_curve_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='stint_degradation_curve';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.stint_degradation_curve facade view missing';
  END IF;

  -- Column-shape verify on the facade.
  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='stint_degradation_curve'
  LOOP
    RAISE EXCEPTION 'analytics.stint_degradation_curve missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
