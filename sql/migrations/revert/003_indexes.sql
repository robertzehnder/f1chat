-- Revert openf1:003_indexes from pg

BEGIN;

DROP INDEX IF EXISTS raw.idx_position_history_session_driver_date;
DROP INDEX IF EXISTS raw.idx_intervals_session_driver_date;
DROP INDEX IF EXISTS raw.idx_location_session_driver_date;
DROP INDEX IF EXISTS raw.idx_car_data_session_driver_date;
DROP INDEX IF EXISTS raw.idx_championship_teams_session;
DROP INDEX IF EXISTS raw.idx_championship_drivers_session;
DROP INDEX IF EXISTS raw.idx_overtakes_session;
DROP INDEX IF EXISTS raw.idx_starting_grid_session;
DROP INDEX IF EXISTS raw.idx_session_result_session;
DROP INDEX IF EXISTS raw.idx_weather_session_date;
DROP INDEX IF EXISTS raw.idx_race_control_session_date;
DROP INDEX IF EXISTS raw.idx_team_radio_session_driver_date;
DROP INDEX IF EXISTS raw.idx_stints_session_driver;
DROP INDEX IF EXISTS raw.idx_pit_session_driver;
DROP INDEX IF EXISTS raw.idx_laps_session_lap;
DROP INDEX IF EXISTS raw.idx_laps_session_driver;
DROP INDEX IF EXISTS raw.idx_laps_session_key;
DROP INDEX IF EXISTS raw.idx_drivers_driver_number;
DROP INDEX IF EXISTS raw.idx_drivers_session_key;
DROP INDEX IF EXISTS raw.idx_sessions_meeting_key;

COMMIT;
