BEGIN;

-- Core lookup indexes
CREATE INDEX IF NOT EXISTS idx_sessions_meeting_key ON raw.sessions(meeting_key);
CREATE INDEX IF NOT EXISTS idx_drivers_session_key ON raw.drivers(session_key);
CREATE INDEX IF NOT EXISTS idx_drivers_driver_number ON raw.drivers(driver_number);

CREATE INDEX IF NOT EXISTS idx_laps_session_key ON raw.laps(session_key);
CREATE INDEX IF NOT EXISTS idx_laps_session_driver ON raw.laps(session_key, driver_number);
CREATE INDEX IF NOT EXISTS idx_laps_session_lap ON raw.laps(session_key, lap_number);

CREATE INDEX IF NOT EXISTS idx_pit_session_driver ON raw.pit(session_key, driver_number);
CREATE INDEX IF NOT EXISTS idx_stints_session_driver ON raw.stints(session_key, driver_number);
CREATE INDEX IF NOT EXISTS idx_team_radio_session_driver_date ON raw.team_radio(session_key, driver_number, date);
CREATE INDEX IF NOT EXISTS idx_race_control_session_date ON raw.race_control(session_key, date);
CREATE INDEX IF NOT EXISTS idx_weather_session_date ON raw.weather(session_key, date);

CREATE INDEX IF NOT EXISTS idx_session_result_session ON raw.session_result(session_key);
CREATE INDEX IF NOT EXISTS idx_starting_grid_session ON raw.starting_grid(session_key);
CREATE INDEX IF NOT EXISTS idx_overtakes_session ON raw.overtakes(session_key);
CREATE INDEX IF NOT EXISTS idx_championship_drivers_session ON raw.championship_drivers(session_key);
CREATE INDEX IF NOT EXISTS idx_championship_teams_session ON raw.championship_teams(session_key);

-- Telemetry-heavy indexes
CREATE INDEX IF NOT EXISTS idx_car_data_session_driver_date ON raw.car_data(session_key, driver_number, date);
CREATE INDEX IF NOT EXISTS idx_location_session_driver_date ON raw.location(session_key, driver_number, date);
CREATE INDEX IF NOT EXISTS idx_intervals_session_driver_date ON raw.intervals(session_key, driver_number, date);
CREATE INDEX IF NOT EXISTS idx_position_history_session_driver_date ON raw.position_history(session_key, driver_number, date);

COMMIT;
