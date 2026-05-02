-- Revert openf1:002_create_tables from pg

BEGIN;

DROP TABLE IF EXISTS raw.ingestion_files;
DROP TABLE IF EXISTS raw.ingestion_runs;
DROP TABLE IF EXISTS raw.position_history;
DROP TABLE IF EXISTS raw.intervals;
DROP TABLE IF EXISTS raw.location;
DROP TABLE IF EXISTS raw.car_data;
DROP TABLE IF EXISTS raw.championship_teams;
DROP TABLE IF EXISTS raw.championship_drivers;
DROP TABLE IF EXISTS raw.overtakes;
DROP TABLE IF EXISTS raw.starting_grid;
DROP TABLE IF EXISTS raw.session_result;
DROP TABLE IF EXISTS raw.weather;
DROP TABLE IF EXISTS raw.race_control;
DROP TABLE IF EXISTS raw.team_radio;
DROP TABLE IF EXISTS raw.stints;
DROP TABLE IF EXISTS raw.pit;
DROP TABLE IF EXISTS raw.laps;
DROP TABLE IF EXISTS raw.drivers;
DROP TABLE IF EXISTS raw.sessions;
DROP TABLE IF EXISTS raw.meetings;

COMMIT;
