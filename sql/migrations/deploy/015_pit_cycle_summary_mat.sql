BEGIN;

-- Phase 3 scale-out: materialize core.pit_cycle_summary into a real storage
-- table and replace the public view with a thin SELECT * facade over that
-- table. Column list, types, and ordering mirror the public view as defined at
-- sql/007_semantic_summary_contracts.sql:401 ff. Grain
-- (session_key, driver_number, pit_sequence) is verified by gate #0's
-- pre-flight probe over core_build.pit_cycle_summary; pit_sequence is
-- ROW_NUMBER() over each (session_key, driver_number) partition in
-- core_build.strategy_summary's pit_laps, so the triple is unique by
-- construction. The PRIMARY KEY enforces that invariant; a non-unique grain
-- would also abort the bulk INSERT below with a clean PK-violation error and
-- roll back the whole transaction.
CREATE TABLE IF NOT EXISTS core.pit_cycle_summary_mat (
  session_key                              BIGINT  NOT NULL,
  meeting_key                              BIGINT,
  year                                     INTEGER,
  session_name                             TEXT,
  session_type                             TEXT,
  country_name                             TEXT,
  location                                 TEXT,
  driver_number                            INTEGER NOT NULL,
  full_name                                TEXT,
  team_name                                TEXT,
  pit_sequence                             BIGINT  NOT NULL,
  pit_lap                                  INTEGER,
  pit_timestamp                            TIMESTAMPTZ,
  pit_duration_seconds                     NUMERIC,
  pre_pit_position                         INTEGER,
  post_pit_position                        INTEGER,
  positions_gained_after_pit               INTEGER,
  pre_window_lap_count                     BIGINT,
  pre_window_avg_lap                       NUMERIC,
  post_window_lap_count                    BIGINT,
  post_window_avg_lap                      NUMERIC,
  post_minus_pre_lap_delta                 NUMERIC,
  position_evidence_sufficient             BOOLEAN,
  pace_window_evidence_sufficient          BOOLEAN,
  evidence_sufficient_for_pit_cycle_claim  BOOLEAN,
  evidence_sufficient_for_strategy_claim   BOOLEAN,
  PRIMARY KEY (session_key, driver_number, pit_sequence)
);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; the bulk INSERT
-- doubles as a grain assertion via the PRIMARY KEY constraint above.
TRUNCATE core.pit_cycle_summary_mat;
INSERT INTO core.pit_cycle_summary_mat
SELECT * FROM core_build.pit_cycle_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- Must be CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW): the public
-- view core.strategy_evidence_summary (sql/007_semantic_summary_contracts.sql:553
-- ff., specifically `WITH pit_cycle AS (SELECT * FROM core.pit_cycle_summary)`
-- at line 556) depends on core.pit_cycle_summary, and a DROP would fail with
-- "cannot drop view core.pit_cycle_summary because other objects depend on it"
-- even inside this transaction. CREATE OR REPLACE VIEW is dependency-safe
-- because the storage table above is declared with the same column names,
-- types, and ordering as the original view's projection.
CREATE OR REPLACE VIEW core.pit_cycle_summary AS
SELECT * FROM core.pit_cycle_summary_mat;

COMMIT;
