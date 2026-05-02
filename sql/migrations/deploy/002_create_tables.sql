BEGIN;

-- Dimension-like entities
CREATE TABLE IF NOT EXISTS raw.meetings (
  meeting_key BIGINT PRIMARY KEY,
  meeting_name TEXT,
  meeting_official_name TEXT,
  year INTEGER,
  country_key INTEGER,
  country_code TEXT,
  country_name TEXT,
  location TEXT,
  circuit_key INTEGER,
  circuit_short_name TEXT,
  date_start TIMESTAMPTZ,
  gmt_offset TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.sessions (
  session_key BIGINT PRIMARY KEY,
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  session_name TEXT,
  session_type TEXT,
  session_number INTEGER,
  date_start TIMESTAMPTZ,
  date_end TIMESTAMPTZ,
  gmt_offset TEXT,
  year INTEGER,
  country_name TEXT,
  location TEXT,
  circuit_short_name TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.drivers (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  broadcast_name TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  name_acronym TEXT,
  team_name TEXT,
  team_colour TEXT,
  country_code TEXT,
  headshot_url TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Event/race tables
CREATE TABLE IF NOT EXISTS raw.laps (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  lap_number INTEGER,
  i1_speed INTEGER,
  i2_speed INTEGER,
  st_speed INTEGER,
  is_pit_out_lap BOOLEAN,
  duration_sector_1 DOUBLE PRECISION,
  duration_sector_2 DOUBLE PRECISION,
  duration_sector_3 DOUBLE PRECISION,
  lap_duration DOUBLE PRECISION,
  date_start TIMESTAMPTZ,
  segments_sector_1 TEXT,
  segments_sector_2 TEXT,
  segments_sector_3 TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.pit (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  lap_number INTEGER,
  pit_duration DOUBLE PRECISION,
  date TIMESTAMPTZ,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.stints (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  stint_number INTEGER,
  lap_start INTEGER,
  lap_end INTEGER,
  compound TEXT,
  tyre_age_at_start INTEGER,
  fresh_tyre BOOLEAN,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.team_radio (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  date TIMESTAMPTZ,
  recording_url TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.race_control (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  date TIMESTAMPTZ,
  category TEXT,
  flag TEXT,
  scope TEXT,
  sector INTEGER,
  lap_number INTEGER,
  driver_number INTEGER,
  message TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.weather (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  date TIMESTAMPTZ,
  air_temperature DOUBLE PRECISION,
  track_temperature DOUBLE PRECISION,
  humidity DOUBLE PRECISION,
  pressure DOUBLE PRECISION,
  rainfall BOOLEAN,
  wind_direction INTEGER,
  wind_speed DOUBLE PRECISION,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.session_result (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  position INTEGER,
  points DOUBLE PRECISION,
  status TEXT,
  classified BOOLEAN,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.starting_grid (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  grid_position INTEGER,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.overtakes (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  date TIMESTAMPTZ,
  lap_number INTEGER,
  overtaker_driver_number INTEGER,
  overtaken_driver_number INTEGER,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.championship_drivers (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  position INTEGER,
  points DOUBLE PRECISION,
  wins INTEGER,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.championship_teams (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  team_name TEXT,
  position INTEGER,
  points DOUBLE PRECISION,
  wins INTEGER,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- High-volume telemetry/history tables
CREATE TABLE IF NOT EXISTS raw.car_data (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  date TIMESTAMPTZ,
  rpm INTEGER,
  speed INTEGER,
  n_gear INTEGER,
  throttle DOUBLE PRECISION,
  brake INTEGER,
  drs INTEGER,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.location (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  date TIMESTAMPTZ,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  z DOUBLE PRECISION,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.intervals (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  date TIMESTAMPTZ,
  interval TEXT,
  gap_to_leader TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.position_history (
  id BIGSERIAL PRIMARY KEY,
  session_key BIGINT REFERENCES raw.sessions(session_key),
  meeting_key BIGINT REFERENCES raw.meetings(meeting_key),
  driver_number INTEGER,
  date TIMESTAMPTZ,
  position INTEGER,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ingestion audit
CREATE TABLE IF NOT EXISTS raw.ingestion_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  mode TEXT NOT NULL,
  data_dir TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS raw.ingestion_files (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES raw.ingestion_runs(run_id),
  table_name TEXT NOT NULL,
  source_file TEXT NOT NULL,
  rows_loaded BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
