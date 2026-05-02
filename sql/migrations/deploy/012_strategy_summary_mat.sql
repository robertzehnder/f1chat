BEGIN;

-- Phase 3 scale-out: materialize core.strategy_summary into a real heap storage
-- table and replace the public view with a thin SELECT * facade over that
-- table. Column list, types, and ordering mirror the public view as defined
-- at sql/007_semantic_summary_contracts.sql:159 ff. Grain
-- (session_key, driver_number) matches the canonical view's stint_rollup +
-- pit_rollup join identity and is enforced as a real PRIMARY KEY; a non-unique
-- grain would abort the bulk INSERT below with a clean PK-violation error and
-- roll back the whole transaction.
CREATE TABLE IF NOT EXISTS core.strategy_summary_mat (
  session_key                 BIGINT  NOT NULL,
  meeting_key                 BIGINT,
  year                        INTEGER,
  session_name                TEXT,
  session_type                TEXT,
  country_name                TEXT,
  location                    TEXT,
  driver_number               INTEGER NOT NULL,
  driver_name                 TEXT,
  team_name                   TEXT,
  total_stints                BIGINT,
  pit_stop_count              BIGINT,
  pit_event_rows              BIGINT,
  compounds_used              TEXT[],
  opening_stint_laps          INTEGER,
  closing_stint_laps          INTEGER,
  shortest_stint_laps         INTEGER,
  longest_stint_laps          INTEGER,
  total_pit_duration_seconds  NUMERIC,
  pit_laps                    INTEGER[],
  strategy_type               TEXT,
  PRIMARY KEY (session_key, driver_number)
);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; the bulk INSERT
-- doubles as a grain assertion via the PRIMARY KEY constraint above.
TRUNCATE core.strategy_summary_mat;
INSERT INTO core.strategy_summary_mat
SELECT * FROM core_build.strategy_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- Must be CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW): the public
-- view core.pit_cycle_summary (sql/007_semantic_summary_contracts.sql:401 ff.,
-- specifically `FROM core.strategy_summary ss` at line 419) depends on
-- core.strategy_summary, and a DROP would fail with "cannot drop view
-- core.strategy_summary because other objects depend on it" even inside this
-- transaction. CREATE OR REPLACE VIEW is dependency-safe because the storage
-- table above is declared with the same column names, types, and ordering as
-- the original view's projection.
CREATE OR REPLACE VIEW core.strategy_summary AS
SELECT * FROM core.strategy_summary_mat;

COMMIT;
