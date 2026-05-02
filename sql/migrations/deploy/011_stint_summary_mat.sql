BEGIN;

-- Phase 3 scale-out: materialize core.stint_summary into a real heap storage
-- table and replace the public view with a thin SELECT * facade over that
-- table. Column list, types, and ordering mirror the public view as defined
-- at sql/007_semantic_summary_contracts.sql:98 ff. Grain
-- (session_key, driver_number, stint_number) matches the canonical view's
-- GROUP BY identity and is enforced as a real PRIMARY KEY; a non-unique grain
-- would abort the bulk INSERT below with a clean PK-violation error and roll
-- back the whole transaction.
CREATE TABLE IF NOT EXISTS core.stint_summary_mat (
  session_key          BIGINT  NOT NULL,
  meeting_key          BIGINT,
  year                 INTEGER,
  session_name         TEXT,
  session_type         TEXT,
  country_name         TEXT,
  location             TEXT,
  driver_number        INTEGER NOT NULL,
  driver_name          TEXT,
  team_name            TEXT,
  stint_number         INTEGER NOT NULL,
  compound_name        TEXT,
  lap_start            INTEGER,
  lap_end              INTEGER,
  tyre_age_at_start    INTEGER,
  fresh_tyre           BOOLEAN,
  stint_length_laps    INTEGER,
  lap_count            BIGINT,
  valid_lap_count      BIGINT,
  avg_lap              NUMERIC,
  best_lap             NUMERIC,
  avg_valid_lap        NUMERIC,
  best_valid_lap       NUMERIC,
  degradation_per_lap  NUMERIC,
  PRIMARY KEY (session_key, driver_number, stint_number)
);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; the bulk INSERT
-- doubles as a grain assertion via the PRIMARY KEY constraint above.
TRUNCATE core.stint_summary_mat;
INSERT INTO core.stint_summary_mat
SELECT * FROM core_build.stint_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- Must be CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW): the public
-- view core.strategy_summary (sql/007_semantic_summary_contracts.sql:159 ff.)
-- depends on core.stint_summary, and a DROP would fail with "cannot drop view
-- core.stint_summary because other objects depend on it" even inside this
-- transaction. CREATE OR REPLACE VIEW is dependency-safe because the storage
-- table above is declared with the same column names, types, and ordering as
-- the original view's projection.
CREATE OR REPLACE VIEW core.stint_summary AS
SELECT * FROM core.stint_summary_mat;

COMMIT;
