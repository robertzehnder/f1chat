-- Minimal offline snapshot consumed by web/src/lib/db/driver.ts:bootPglite
-- when OPENF1_LOCAL_FALLBACK=1 and the Neon probe fails.
--
-- This is a hand-authored, human-readable subset of the prod schema. It is
-- intentionally narrow: just enough rows in just enough tables for the chat
-- runtime to answer at least one question offline. A follow-up slice will
-- add an `pg_dump`-driven regeneration script.

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS contract;

-- -----------------------------------------------------------------------
-- core.driver — drivers visible to the chat runtime resolver.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.driver (
    driver_number  integer PRIMARY KEY,
    full_name      text    NOT NULL,
    name_acronym   text,
    team_name      text
);

INSERT INTO core.driver (driver_number, full_name, name_acronym, team_name)
VALUES (1, 'Max Verstappen', 'VER', 'Red Bull Racing')
ON CONFLICT (driver_number) DO NOTHING;

-- -----------------------------------------------------------------------
-- core.session — minimal session metadata.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.session (
    session_key      integer PRIMARY KEY,
    meeting_key      integer,
    session_name     text,
    session_type     text,
    year             integer,
    country_name     text,
    location         text,
    meeting_name     text,
    date_start       timestamptz
);

INSERT INTO core.session (
    session_key, meeting_key, session_name, session_type, year,
    country_name, location, meeting_name, date_start
)
VALUES (
    9999, 999, 'Race', 'Race', 2025,
    'Snapshot', 'snapshot-circuit', 'Snapshot Grand Prix',
    '2025-01-01T00:00:00Z'
)
ON CONFLICT (session_key) DO NOTHING;

-- -----------------------------------------------------------------------
-- Lookup tables — each with one canonical row.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract.compound_alias_lookup (
    alias    text PRIMARY KEY,
    compound text NOT NULL
);
INSERT INTO contract.compound_alias_lookup (alias, compound)
VALUES ('soft', 'SOFT')
ON CONFLICT (alias) DO NOTHING;

CREATE TABLE IF NOT EXISTS contract.metric_registry (
    metric_key   text PRIMARY KEY,
    description  text NOT NULL
);
INSERT INTO contract.metric_registry (metric_key, description)
VALUES ('lap_time_seconds', 'Lap time in seconds')
ON CONFLICT (metric_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS contract.valid_lap_policy (
    policy_key  text PRIMARY KEY,
    rule        text NOT NULL
);
INSERT INTO contract.valid_lap_policy (policy_key, rule)
VALUES ('default', 'COALESCE(is_valid, TRUE) = TRUE')
ON CONFLICT (policy_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS contract.replay_contract_registry (
    contract_key text PRIMARY KEY,
    is_default   boolean NOT NULL DEFAULT false,
    description  text
);
INSERT INTO contract.replay_contract_registry (contract_key, is_default, description)
VALUES ('replay_lap_frames_default', true, 'Default replay contract')
ON CONFLICT (contract_key) DO NOTHING;

-- -----------------------------------------------------------------------
-- Summary contracts — one row each so chat-runtime probes succeed.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract.pit_cycle_summary (
    session_key    integer NOT NULL,
    driver_number  integer NOT NULL,
    pit_count      integer NOT NULL,
    avg_pit_loss_s numeric,
    PRIMARY KEY (session_key, driver_number)
);
INSERT INTO contract.pit_cycle_summary (session_key, driver_number, pit_count, avg_pit_loss_s)
VALUES (9999, 1, 1, 22.3)
ON CONFLICT (session_key, driver_number) DO NOTHING;

CREATE TABLE IF NOT EXISTS contract.lap_phase_summary (
    session_key    integer NOT NULL,
    driver_number  integer NOT NULL,
    phase          text    NOT NULL,
    laps           integer NOT NULL,
    PRIMARY KEY (session_key, driver_number, phase)
);
INSERT INTO contract.lap_phase_summary (session_key, driver_number, phase, laps)
VALUES (9999, 1, 'green', 50)
ON CONFLICT (session_key, driver_number, phase) DO NOTHING;

CREATE TABLE IF NOT EXISTS contract.strategy_evidence_summary (
    session_key    integer NOT NULL,
    driver_number  integer NOT NULL,
    evidence       text,
    PRIMARY KEY (session_key, driver_number)
);
INSERT INTO contract.strategy_evidence_summary (session_key, driver_number, evidence)
VALUES (9999, 1, 'one-stop')
ON CONFLICT (session_key, driver_number) DO NOTHING;

CREATE TABLE IF NOT EXISTS contract.lap_context_summary (
    session_key    integer NOT NULL,
    driver_number  integer NOT NULL,
    lap_number     integer NOT NULL,
    context        text,
    PRIMARY KEY (session_key, driver_number, lap_number)
);
INSERT INTO contract.lap_context_summary (session_key, driver_number, lap_number, context)
VALUES (9999, 1, 1, 'green-flag')
ON CONFLICT (session_key, driver_number, lap_number) DO NOTHING;
