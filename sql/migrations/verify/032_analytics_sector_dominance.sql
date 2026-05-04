-- Verify openf1:032_analytics_sector_dominance on pg

BEGIN;

DO $$
DECLARE
  schema_count int;
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'sector_index', 'valid_lap_count', 'dominant_count',
    'avg_sector_duration', 'best_sector_duration'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO schema_count
  FROM information_schema.schemata WHERE schema_name='analytics';
  IF schema_count = 0 THEN RAISE EXCEPTION 'analytics schema missing'; END IF;

  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='sector_dominance_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.sector_dominance_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='sector_dominance';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.sector_dominance facade view missing';
  END IF;

  -- Column-shape verify on the facade.
  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='sector_dominance'
  LOOP
    RAISE EXCEPTION 'analytics.sector_dominance missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
