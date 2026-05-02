-- Verify openf1:003_indexes on pg

BEGIN;

DO $$
DECLARE
  expected text[] := ARRAY[
    'idx_sessions_meeting_key',
    'idx_drivers_session_key',
    'idx_drivers_driver_number',
    'idx_laps_session_key',
    'idx_laps_session_driver',
    'idx_laps_session_lap',
    'idx_pit_session_driver',
    'idx_stints_session_driver',
    'idx_team_radio_session_driver_date',
    'idx_race_control_session_date',
    'idx_weather_session_date',
    'idx_session_result_session',
    'idx_starting_grid_session',
    'idx_overtakes_session',
    'idx_championship_drivers_session',
    'idx_championship_teams_session',
    'idx_car_data_session_driver_date',
    'idx_location_session_driver_date',
    'idx_intervals_session_driver_date',
    'idx_position_history_session_driver_date'
  ];
  missing text[];
BEGIN
  SELECT array_agg(x) INTO missing
    FROM unnest(expected) AS x
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'raw'
        AND c.relname = x
        AND c.relkind = 'i'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '003_indexes: missing indexes on raw.*: %', missing;
  END IF;
END $$;

ROLLBACK;
