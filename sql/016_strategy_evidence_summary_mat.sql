BEGIN;

-- Phase 3 scale-out: materialize core.strategy_evidence_summary into a real
-- storage table and replace the public view with a thin SELECT * facade over
-- that table. Column list, types, and ordering mirror the public view as
-- defined at sql/007_semantic_summary_contracts.sql:553 ff. Grain
-- (session_key, driver_number, pit_sequence) is verified by gate #0's
-- pre-flight probe over core_build.strategy_evidence_summary. Each row in
-- core_build.strategy_evidence_summary corresponds to exactly one row of its
-- pit_cycle a input via the rival_rank = 1 filter, and core_build.pit_cycle_summary
-- itself has the verified unique grain (session_key, driver_number, pit_sequence),
-- so the triple is unique by construction. The PRIMARY KEY enforces that
-- invariant; a non-unique grain would also abort the bulk INSERT below with a
-- clean PK-violation error and roll back the whole transaction.
CREATE TABLE IF NOT EXISTS core.strategy_evidence_summary_mat (
  session_key                                    BIGINT  NOT NULL,
  meeting_key                                    BIGINT,
  year                                           INTEGER,
  session_name                                   TEXT,
  session_type                                   TEXT,
  country_name                                   TEXT,
  location                                       TEXT,
  driver_number                                  INTEGER NOT NULL,
  full_name                                      TEXT,
  team_name                                      TEXT,
  pit_sequence                                   BIGINT  NOT NULL,
  pit_lap                                        INTEGER,
  pit_timestamp                                  TIMESTAMPTZ,
  pit_duration_seconds                           NUMERIC,
  pre_pit_position                               INTEGER,
  post_pit_position                              INTEGER,
  positions_gained_after_pit                     INTEGER,
  pre_window_lap_count                           BIGINT,
  pre_window_avg_lap                             NUMERIC,
  post_window_lap_count                          BIGINT,
  post_window_avg_lap                            NUMERIC,
  post_minus_pre_lap_delta                       NUMERIC,
  rival_driver_number                            INTEGER,
  rival_full_name                                TEXT,
  rival_team_name                                TEXT,
  rival_pit_sequence                             BIGINT,
  rival_pit_lap                                  INTEGER,
  rival_pre_pit_position                         INTEGER,
  rival_post_pit_position                        INTEGER,
  rival_positions_gained_after_pit               INTEGER,
  rival_pre_window_lap_count                     BIGINT,
  rival_pre_window_avg_lap                       NUMERIC,
  rival_post_window_lap_count                    BIGINT,
  rival_post_window_avg_lap                      NUMERIC,
  rival_post_minus_pre_lap_delta                 NUMERIC,
  rival_pit_lap_gap                              INTEGER,
  rival_context_present                          BOOLEAN,
  relative_position_evidence_sufficient          BOOLEAN,
  relative_position_delta_pre                    INTEGER,
  relative_position_delta_post                   INTEGER,
  relative_positions_gained_vs_rival             INTEGER,
  evidence_sufficient_for_undercut_overcut_claim BOOLEAN,
  undercut_overcut_signal                        TEXT,
  evidence_confidence                            TEXT,
  PRIMARY KEY (session_key, driver_number, pit_sequence)
);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; the bulk INSERT
-- doubles as a grain assertion via the PRIMARY KEY constraint above.
TRUNCATE core.strategy_evidence_summary_mat;
INSERT INTO core.strategy_evidence_summary_mat
SELECT * FROM core_build.strategy_evidence_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW) for pattern consistency
-- with every preceding Phase 3 materialization slice and so any future SQL
-- view that comes to depend on this view is not disturbed. CREATE OR REPLACE
-- VIEW is dependency-safe because the storage table above is declared with
-- the same column names, types, and ordering as the original view's projection.
CREATE OR REPLACE VIEW core.strategy_evidence_summary AS
SELECT * FROM core.strategy_evidence_summary_mat;

COMMIT;
