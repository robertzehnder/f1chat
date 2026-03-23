BEGIN;

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
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_uid, driver_number, lap_number)
);

CREATE TABLE IF NOT EXISTS fastf1_raw.weather (
    row_id BIGSERIAL PRIMARY KEY,
    session_uid TEXT NOT NULL,
    time_seconds DOUBLE PRECISION,
    air_temp DOUBLE PRECISION,
    humidity DOUBLE PRECISION,
    pressure DOUBLE PRECISION,
    rainfall BOOLEAN,
    track_temp DOUBLE PRECISION,
    wind_direction DOUBLE PRECISION,
    wind_speed DOUBLE PRECISION,
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fastf1_raw.telemetry (
    row_id BIGSERIAL PRIMARY KEY,
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
    z DOUBLE PRECISION,
    loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fastf1_core.extraction_runs (
    run_id BIGSERIAL PRIMARY KEY,
    years_csv TEXT NOT NULL,
    session_types_csv TEXT NOT NULL,
    include_telemetry BOOLEAN NOT NULL,
    telemetry_mode TEXT NOT NULL,
    resume_mode BOOLEAN NOT NULL,
    max_sessions INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    total_tasks INTEGER NOT NULL DEFAULT 0,
    completed_tasks INTEGER NOT NULL DEFAULT 0,
    skipped_tasks INTEGER NOT NULL DEFAULT 0,
    failed_tasks INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fastf1_core.extraction_session_log (
    log_id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES fastf1_core.extraction_runs(run_id),
    session_uid TEXT NOT NULL,
    year INTEGER,
    round_number INTEGER,
    event_name TEXT,
    session_name TEXT,
    status TEXT NOT NULL,
    message TEXT,
    row_counts_json JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fastf1_core.source_comparison_tests (
    report_generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    theme TEXT NOT NULL,
    test_name TEXT NOT NULL,
    year INTEGER,
    session_key_or_equivalent TEXT,
    event_name TEXT,
    session_type TEXT,
    openf1_result TEXT,
    fastf1_result TEXT,
    match_status TEXT,
    severity TEXT,
    notes TEXT,
    recommended_source TEXT
);

CREATE TABLE IF NOT EXISTS fastf1_core.source_comparison_theme_summary (
    report_generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    theme TEXT NOT NULL,
    openf1_score DOUBLE PRECISION,
    fastf1_score DOUBLE PRECISION,
    winner TEXT,
    rationale TEXT,
    recommended_action TEXT
);

CREATE TABLE IF NOT EXISTS fastf1_core.benchmark_audit_summary (
    report_generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    question_family TEXT NOT NULL,
    question_type TEXT,
    benchmark_count INTEGER,
    openf1_above_c_rate DOUBLE PRECISION,
    related_themes TEXT,
    theme_winner TEXT,
    likely_issue_driver TEXT,
    recommendation TEXT
);

CREATE TABLE IF NOT EXISTS fastf1_core.source_recommendation_summary (
    report_generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    use_case TEXT NOT NULL,
    preferred_source TEXT,
    confidence TEXT,
    rationale TEXT,
    recommended_action TEXT
);

CREATE INDEX IF NOT EXISTS idx_fastf1_sessions_year ON fastf1_raw.sessions(year);
CREATE INDEX IF NOT EXISTS idx_fastf1_sessions_round ON fastf1_raw.sessions(year, round_number);
CREATE INDEX IF NOT EXISTS idx_fastf1_sessions_name ON fastf1_raw.sessions(event_name, session_name);
CREATE INDEX IF NOT EXISTS idx_fastf1_drivers_session ON fastf1_raw.drivers(session_uid);
CREATE INDEX IF NOT EXISTS idx_fastf1_results_session ON fastf1_raw.results(session_uid);
CREATE INDEX IF NOT EXISTS idx_fastf1_laps_session ON fastf1_raw.laps(session_uid);
CREATE INDEX IF NOT EXISTS idx_fastf1_laps_session_driver ON fastf1_raw.laps(session_uid, driver_number);
CREATE INDEX IF NOT EXISTS idx_fastf1_weather_session ON fastf1_raw.weather(session_uid);
CREATE INDEX IF NOT EXISTS idx_fastf1_telemetry_session_driver ON fastf1_raw.telemetry(session_uid, driver_number);
CREATE INDEX IF NOT EXISTS idx_fastf1_extraction_session_log_run ON fastf1_core.extraction_session_log(run_id);
CREATE INDEX IF NOT EXISTS idx_fastf1_extraction_session_log_session ON fastf1_core.extraction_session_log(session_uid, status);

COMMIT;
