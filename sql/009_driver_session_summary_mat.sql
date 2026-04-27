BEGIN;

-- Phase 3 prototype: materialize core.driver_session_summary into a real
-- storage table and replace the public view with a thin SELECT * facade
-- over that table. Column list, types, and ordering mirror the public view
-- as defined at sql/007_semantic_summary_contracts.sql:239 ff.
CREATE TABLE IF NOT EXISTS core.driver_session_summary_mat (
  session_key                 BIGINT  NOT NULL,
  meeting_key                 BIGINT,
  year                        INTEGER,
  session_name                TEXT,
  session_type                TEXT,
  country_name                TEXT,
  location                    TEXT,
  circuit_short_name          TEXT,
  driver_number               INTEGER NOT NULL,
  driver_name                 TEXT,
  team_name                   TEXT,
  lap_count                   BIGINT,
  valid_lap_count             BIGINT,
  best_lap                    NUMERIC,
  avg_lap                     NUMERIC,
  median_lap                  NUMERIC,
  lap_stddev                  NUMERIC,
  best_valid_lap              NUMERIC,
  avg_valid_lap               NUMERIC,
  median_valid_lap            NUMERIC,
  valid_lap_stddev            NUMERIC,
  best_s1                     NUMERIC,
  best_s2                     NUMERIC,
  best_s3                     NUMERIC,
  avg_s1                      NUMERIC,
  avg_s2                      NUMERIC,
  avg_s3                      NUMERIC,
  total_stints                BIGINT,
  pit_stop_count              BIGINT,
  strategy_type               TEXT,
  compounds_used              TEXT[],
  total_pit_duration_seconds  NUMERIC,
  grid_position               INTEGER,
  finish_position             INTEGER,
  positions_gained            INTEGER,
  grid_source                 TEXT,
  finish_source               TEXT,
  PRIMARY KEY (session_key, driver_number)
);

-- Idempotent re-population from the canonical source-definition view.
TRUNCATE core.driver_session_summary_mat;
INSERT INTO core.driver_session_summary_mat
SELECT * FROM core_build.driver_session_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- Column ordering is preserved by SELECT * because the table was declared in
-- the same order as the original view.
DROP VIEW IF EXISTS core.driver_session_summary;
CREATE VIEW core.driver_session_summary AS
SELECT * FROM core.driver_session_summary_mat;

COMMIT;
