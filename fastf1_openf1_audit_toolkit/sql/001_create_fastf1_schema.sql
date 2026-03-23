CREATE SCHEMA IF NOT EXISTS fastf1_raw;
CREATE SCHEMA IF NOT EXISTS fastf1_core;

CREATE TABLE IF NOT EXISTS fastf1_raw.sessions (
    session_uid TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    round_number INTEGER,
    country TEXT,
    location TEXT,
    event_name TEXT,
    official_event_name TEXT,
    session_name TEXT,
    session_type TEXT,
    event_date TIMESTAMPTZ,
    session_date TIMESTAMPTZ,
    loaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fastf1_raw.drivers (
    session_uid TEXT NOT NULL,
    driver_number INTEGER NOT NULL,
    driver_code TEXT,
    broadcast_name TEXT,
    full_name TEXT,
    team_name TEXT,
    team_color TEXT,
    country_code TEXT,
    PRIMARY KEY (session_uid, driver_number)
);

CREATE TABLE IF NOT EXISTS fastf1_raw.results (
    session_uid TEXT NOT NULL,
    driver_number INTEGER NOT NULL,
    position INTEGER,
    classified_position TEXT,
    points DOUBLE PRECISION,
    status TEXT,
    grid_position INTEGER,
    q1 DOUBLE PRECISION,
    q2 DOUBLE PRECISION,
    q3 DOUBLE PRECISION,
    time_seconds DOUBLE PRECISION,
    PRIMARY KEY (session_uid, driver_number)
);

CREATE TABLE IF NOT EXISTS fastf1_raw.laps (
    session_uid TEXT NOT NULL,
    driver_number INTEGER NOT NULL,
    lap_number DOUBLE PRECISION NOT NULL,
    stint DOUBLE PRECISION,
    lap_time_seconds DOUBLE PRECISION,
    sector1_time_seconds DOUBLE PRECISION,
    sector2_time_seconds DOUBLE PRECISION,
    sector3_time_seconds DOUBLE PRECISION,
    compound TEXT,
    tyre_life DOUBLE PRECISION,
    fresh_tyre TEXT,
    team TEXT,
    track_status TEXT,
    position DOUBLE PRECISION,
    is_accurate BOOLEAN,
    is_personal_best BOOLEAN,
    pit_in_time_seconds DOUBLE PRECISION,
    pit_out_time_seconds DOUBLE PRECISION,
    lap_start_time_seconds DOUBLE PRECISION,
    PRIMARY KEY (session_uid, driver_number, lap_number)
);

CREATE TABLE IF NOT EXISTS fastf1_raw.weather (
    session_uid TEXT NOT NULL,
    row_id BIGSERIAL PRIMARY KEY,
    time_seconds DOUBLE PRECISION,
    air_temp DOUBLE PRECISION,
    humidity DOUBLE PRECISION,
    pressure DOUBLE PRECISION,
    rainfall BOOLEAN,
    track_temp DOUBLE PRECISION,
    wind_direction DOUBLE PRECISION,
    wind_speed DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS fastf1_raw.telemetry (
    session_uid TEXT NOT NULL,
    driver_number INTEGER NOT NULL,
    lap_number DOUBLE PRECISION,
    sample_time_seconds DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    throttle DOUBLE PRECISION,
    brake BOOLEAN,
    n_gear DOUBLE PRECISION,
    rpm DOUBLE PRECISION,
    drs DOUBLE PRECISION,
    x DOUBLE PRECISION,
    y DOUBLE PRECISION,
    z DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_fastf1_sessions_year ON fastf1_raw.sessions(year);
CREATE INDEX IF NOT EXISTS idx_fastf1_sessions_event_name ON fastf1_raw.sessions(event_name);
CREATE INDEX IF NOT EXISTS idx_fastf1_drivers_session ON fastf1_raw.drivers(session_uid);
CREATE INDEX IF NOT EXISTS idx_fastf1_results_session ON fastf1_raw.results(session_uid);
CREATE INDEX IF NOT EXISTS idx_fastf1_laps_session_driver ON fastf1_raw.laps(session_uid, driver_number);
CREATE INDEX IF NOT EXISTS idx_fastf1_weather_session ON fastf1_raw.weather(session_uid);
CREATE INDEX IF NOT EXISTS idx_fastf1_telemetry_session_driver ON fastf1_raw.telemetry(session_uid, driver_number);
