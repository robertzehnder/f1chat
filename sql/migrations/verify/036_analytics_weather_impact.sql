-- Verify openf1:036_analytics_weather_impact on pg

BEGIN;

DO $$
DECLARE
  matview_count int;
  view_count int;
  expected_columns text[] := ARRAY[
    'session_key', 'driver_number', 'driver_name', 'team_name',
    'lap_number', 'compound_name', 'lap_duration_s',
    'is_wet_lap', 'is_valid',
    'driver_dry_baseline_s', 'wet_pace_delta_s',
    'slick_to_inter_crossover_lap', 'inter_to_slick_crossover_lap',
    'crossover_lap'
  ];
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO matview_count
  FROM pg_matviews
  WHERE schemaname='analytics' AND matviewname='weather_impact_data';
  IF matview_count = 0 THEN
    RAISE EXCEPTION 'analytics.weather_impact_data matview missing';
  END IF;

  SELECT COUNT(*) INTO view_count
  FROM pg_views
  WHERE schemaname='analytics' AND viewname='weather_impact';
  IF view_count = 0 THEN
    RAISE EXCEPTION 'analytics.weather_impact facade view missing';
  END IF;

  FOR missing_column IN
    SELECT unnest(expected_columns) AS col
    EXCEPT
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='analytics' AND table_name='weather_impact'
  LOOP
    RAISE EXCEPTION 'analytics.weather_impact missing column: %', missing_column;
  END LOOP;
END $$;

ROLLBACK;
