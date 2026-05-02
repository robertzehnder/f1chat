BEGIN;

-- Phase 3 scale-out: materialize core.race_progression_summary into a real heap
-- storage table and replace the public view with a thin SELECT * facade over
-- that table. Column list, types, and ordering mirror the public view as
-- defined at sql/007_semantic_summary_contracts.sql:333 ff. Gate #0's pre-flight
-- probe over core_build.race_progression_summary on
-- (session_key, driver_number, lap_number) confirmed
-- total=17864 / distinct_triple=17690 / duplicate=174 on 2026-04-27, so the
-- triple is non-unique and the table is declared with NO PRIMARY KEY (heap-with-
-- indexes pattern, mirroring sql/010_laps_enriched_mat.sql). The 174 surviving
-- duplicates are residual from the 7,379 duplicates documented in
-- diagnostic/notes/03-laps-enriched-grain.md on the underlying
-- core_build.laps_enriched, after the canonical view's three-predicate WHERE
-- clause filters down to race-only rows with non-null lap_number and
-- position_end_of_lap. Refresh strategy is delete-then-insert per session_key
-- (deferred to a later slice); the indexes below support that pattern.
CREATE TABLE IF NOT EXISTS core.race_progression_summary_mat (
  session_key                BIGINT,
  meeting_key                BIGINT,
  year                       INTEGER,
  session_name               TEXT,
  session_type               TEXT,
  country_name               TEXT,
  location                   TEXT,
  driver_number              INTEGER,
  driver_name                TEXT,
  team_name                  TEXT,
  lap_number                 INTEGER,
  frame_time                 TIMESTAMPTZ,
  position_end_of_lap        INTEGER,
  previous_position          INTEGER,
  positions_gained_this_lap  INTEGER,
  opening_position           INTEGER,
  latest_position            INTEGER,
  best_position              INTEGER,
  worst_position             INTEGER
);

-- Non-unique btree on the natural query key (closest-to-canonical grain).
CREATE INDEX IF NOT EXISTS race_progression_summary_mat_session_driver_lap_idx
  ON core.race_progression_summary_mat (session_key, driver_number, lap_number);

-- Non-unique btree to support deferred delete-then-insert refresh per session_key.
CREATE INDEX IF NOT EXISTS race_progression_summary_mat_session_idx
  ON core.race_progression_summary_mat (session_key);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; duplicate-row
-- multiplicity from the source view is preserved verbatim because the table
-- has no PRIMARY KEY and the indexes are non-unique.
TRUNCATE core.race_progression_summary_mat;
INSERT INTO core.race_progression_summary_mat
SELECT * FROM core_build.race_progression_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- Must be CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW): the public
-- view core.pit_cycle_summary (sql/007_semantic_summary_contracts.sql:401 ff.,
-- specifically `LEFT JOIN core.race_progression_summary rp` at line 431)
-- depends on core.race_progression_summary, and a DROP would fail with
-- "cannot drop view core.race_progression_summary because other objects
-- depend on it" even inside this transaction. CREATE OR REPLACE VIEW is
-- dependency-safe because the storage table above is declared with the same
-- column names, types, and ordering as the original view's projection.
CREATE OR REPLACE VIEW core.race_progression_summary AS
SELECT * FROM core.race_progression_summary_mat;

COMMIT;
