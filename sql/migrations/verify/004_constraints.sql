-- Verify openf1:004_constraints on pg

BEGIN;

DO $$
DECLARE
  expected_uq text[] := ARRAY[
    'uq_drivers_session_driver',
    'uq_laps_session_driver_lap',
    'uq_stints_session_driver_stint',
    'uq_starting_grid_session_driver',
    'uq_session_result_session_driver',
    'uq_champ_drivers_session_driver',
    'uq_champ_teams_session_team',
    'uq_car_data_session_driver_date',
    'uq_location_session_driver_date',
    'uq_position_session_driver_date',
    'uq_intervals_session_driver_date',
    'uq_weather_session_date',
    'uq_pit_session_driver_lap_date',
    'uq_team_radio_session_driver_date_url',
    'uq_race_control_session_date_category_driver_message',
    'uq_overtakes_session_date_overtaker_overtaken'
  ];
  expected_views text[] := ARRAY['meetings','sessions','session_drivers','driver_dim'];
  missing_uq text[];
  missing_views text[];
BEGIN
  SELECT array_agg(x) INTO missing_uq
    FROM unnest(expected_uq) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'raw'
        AND c.relname = x
        AND c.relkind = 'i'
    );
  IF missing_uq IS NOT NULL THEN
    RAISE EXCEPTION '004_constraints: missing unique indexes on raw.*: %', missing_uq;
  END IF;

  SELECT array_agg(x) INTO missing_views
    FROM unnest(expected_views) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core'
        AND c.relname = x
        AND c.relkind = 'v'
    );
  IF missing_views IS NOT NULL THEN
    RAISE EXCEPTION '004_constraints: missing core views: %', missing_views;
  END IF;
END $$;

ROLLBACK;
