BEGIN;

-- Uniqueness for idempotent upserts (implemented as unique indexes for rerunnable migrations)
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_session_driver
  ON raw.drivers(session_key, driver_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_laps_session_driver_lap
  ON raw.laps(session_key, driver_number, lap_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stints_session_driver_stint
  ON raw.stints(session_key, driver_number, stint_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_starting_grid_session_driver
  ON raw.starting_grid(session_key, driver_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_result_session_driver
  ON raw.session_result(session_key, driver_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_champ_drivers_session_driver
  ON raw.championship_drivers(session_key, driver_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_champ_teams_session_team
  ON raw.championship_teams(session_key, team_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_car_data_session_driver_date
  ON raw.car_data(session_key, driver_number, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_location_session_driver_date
  ON raw.location(session_key, driver_number, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_position_session_driver_date
  ON raw.position_history(session_key, driver_number, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_intervals_session_driver_date
  ON raw.intervals(session_key, driver_number, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_session_date
  ON raw.weather(session_key, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pit_session_driver_lap_date
  ON raw.pit(session_key, driver_number, lap_number, date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_radio_session_driver_date_url
  ON raw.team_radio(session_key, driver_number, date, recording_url);

CREATE UNIQUE INDEX IF NOT EXISTS uq_race_control_session_date_category_driver_message
  ON raw.race_control(session_key, date, category, driver_number, message);

CREATE UNIQUE INDEX IF NOT EXISTS uq_overtakes_session_date_overtaker_overtaken
  ON raw.overtakes(session_key, date, overtaker_driver_number, overtaken_driver_number);

-- Core views for app-friendly relational access
CREATE OR REPLACE VIEW core.meetings AS
SELECT * FROM raw.meetings;

CREATE OR REPLACE VIEW core.sessions AS
SELECT
  s.*,
  m.meeting_name,
  m.country_name AS meeting_country_name,
  m.circuit_short_name AS meeting_circuit_short_name
FROM raw.sessions s
LEFT JOIN raw.meetings m USING (meeting_key);

CREATE OR REPLACE VIEW core.session_drivers AS
SELECT
  d.session_key,
  d.meeting_key,
  d.driver_number,
  d.full_name,
  d.team_name,
  d.country_code,
  d.broadcast_name
FROM raw.drivers d;

CREATE OR REPLACE VIEW core.driver_dim AS
SELECT DISTINCT ON (driver_number)
  driver_number,
  full_name,
  first_name,
  last_name,
  name_acronym,
  country_code
FROM raw.drivers
WHERE driver_number IS NOT NULL
ORDER BY driver_number, ingested_at DESC;

COMMIT;
