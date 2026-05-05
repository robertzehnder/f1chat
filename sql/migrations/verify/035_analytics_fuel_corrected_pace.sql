-- Verify openf1:035_analytics_fuel_corrected_pace on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'lap_number', 'stint_number', 'compound_name',
    'lap_s', 'fuel_corrected_lap_s',
    'is_valid', 'tyre_age_on_lap', 'is_pit_out_lap', 'is_pit_lap'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='fuel_corrected_pace_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.fuel_corrected_pace_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='fuel_corrected_pace';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.fuel_corrected_pace facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='fuel_corrected_pace'
  LOOP
    RAISE EXCEPTION 'analytics.fuel_corrected_pace missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
