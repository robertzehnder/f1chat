BEGIN;

-- Phase 3 scale-out: materialize core.grid_vs_finish into a real storage table
-- and replace the public view with a thin SELECT * facade over that table.
-- Column list, types, and ordering mirror the public view as defined at
-- sql/007_semantic_summary_contracts.sql:4 ff. Grain (session_key,
-- driver_number) was confirmed unique by gate #0's pre-flight probe over
-- core_build.grid_vs_finish on 2026-04-27 (total=7581 / distinct_pair=7581 /
-- duplicate=0), so the table carries a real PRIMARY KEY; a non-unique grain
-- would also abort the bulk INSERT below with a clean PK-violation error and
-- roll back the whole transaction.
CREATE TABLE IF NOT EXISTS core.grid_vs_finish_mat (
  session_key       BIGINT  NOT NULL,
  meeting_key       BIGINT,
  year              INTEGER,
  session_name      TEXT,
  session_type      TEXT,
  country_name      TEXT,
  location          TEXT,
  driver_number     INTEGER NOT NULL,
  driver_name       TEXT,
  team_name         TEXT,
  grid_position     INTEGER,
  finish_position   INTEGER,
  positions_gained  INTEGER,
  grid_source       TEXT,
  finish_source     TEXT,
  PRIMARY KEY (session_key, driver_number)
);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; the bulk INSERT
-- doubles as a grain assertion via the PRIMARY KEY constraint above.
TRUNCATE core.grid_vs_finish_mat;
INSERT INTO core.grid_vs_finish_mat
SELECT * FROM core_build.grid_vs_finish;

-- Replace the public aggregating view with a facade over the storage table.
-- CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW) is preferred for
-- consistency with prior Phase 3 materialization slices and is dependency-safe
-- even if a future migration introduces a dependent on core.grid_vs_finish.
-- The rewrite is column-compatible because the storage table above declares
-- the same column names, types, and ordering as the original view's
-- projection (sql/007_semantic_summary_contracts.sql:50 ff.).
CREATE OR REPLACE VIEW core.grid_vs_finish AS
SELECT * FROM core.grid_vs_finish_mat;

COMMIT;
