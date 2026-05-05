-- Verify openf1:038_analytics_tyre_warmup on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'stint_number', 'compound_name',
    'stint_length_laps', 'valid_lap_count', 'best_non_warmup_lap_s',
    'warmup_laps_to_target', 'lap_start', 'lap_end'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='tyre_warmup_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.tyre_warmup_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='tyre_warmup';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.tyre_warmup facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='tyre_warmup'
  LOOP
    RAISE EXCEPTION 'analytics.tyre_warmup missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
