-- Revert openf1:004_constraints from pg

BEGIN;

DROP VIEW IF EXISTS core.driver_dim;
DROP VIEW IF EXISTS core.session_drivers;
DROP VIEW IF EXISTS core.sessions;
DROP VIEW IF EXISTS core.meetings;

DROP INDEX IF EXISTS raw.uq_overtakes_session_date_overtaker_overtaken;
DROP INDEX IF EXISTS raw.uq_race_control_session_date_category_driver_message;
DROP INDEX IF EXISTS raw.uq_team_radio_session_driver_date_url;
DROP INDEX IF EXISTS raw.uq_pit_session_driver_lap_date;
DROP INDEX IF EXISTS raw.uq_weather_session_date;
DROP INDEX IF EXISTS raw.uq_intervals_session_driver_date;
DROP INDEX IF EXISTS raw.uq_position_session_driver_date;
DROP INDEX IF EXISTS raw.uq_location_session_driver_date;
DROP INDEX IF EXISTS raw.uq_car_data_session_driver_date;
DROP INDEX IF EXISTS raw.uq_champ_teams_session_team;
DROP INDEX IF EXISTS raw.uq_champ_drivers_session_driver;
DROP INDEX IF EXISTS raw.uq_session_result_session_driver;
DROP INDEX IF EXISTS raw.uq_starting_grid_session_driver;
DROP INDEX IF EXISTS raw.uq_stints_session_driver_stint;
DROP INDEX IF EXISTS raw.uq_laps_session_driver_lap;
DROP INDEX IF EXISTS raw.uq_drivers_session_driver;

COMMIT;
