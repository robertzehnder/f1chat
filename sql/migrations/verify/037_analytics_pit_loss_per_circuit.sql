-- Verify openf1:037_analytics_pit_loss_per_circuit on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'stop_number', 'pit_in_lap_number', 'out_lap_number',
    'pit_in_lap_s', 'pit_out_lap_s',
    'new_compound_name', 'new_stint_number',
    'baseline_lap_s', 'pit_loss_s'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='pit_loss_per_circuit_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.pit_loss_per_circuit_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='pit_loss_per_circuit';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.pit_loss_per_circuit facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='pit_loss_per_circuit'
  LOOP
    RAISE EXCEPTION 'analytics.pit_loss_per_circuit missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
