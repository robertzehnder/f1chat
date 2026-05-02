BEGIN;

-- Phase 3 scale-out: materialize core.lap_phase_summary into a real heap
-- storage table sourced from core_build.lap_phase_summary, and replace the
-- public view with a thin SELECT * facade over that table. Column list,
-- types, and ordering mirror the public view as defined at
-- sql/007_semantic_summary_contracts.sql:725 ff. The grain inherited from
-- core_build.laps_enriched is non-unique (per
-- diagnostic/notes/03-laps-enriched-grain.md), so this table is declared
-- with NO PRIMARY KEY. Refresh strategy is delete-then-insert per
-- session_key (deferred to a later slice); the indexes below support that
-- pattern.
CREATE TABLE IF NOT EXISTS core.lap_phase_summary_mat (
  session_key       BIGINT,
  meeting_key       BIGINT,
  year              INTEGER,
  session_name      TEXT,
  session_type      TEXT,
  driver_number     INTEGER,
  driver_name       TEXT,
  team_name         TEXT,
  lap_number        INTEGER,
  stint_number      INTEGER,
  compound_name     TEXT,
  tyre_age_on_lap   INTEGER,
  lap_duration      DOUBLE PRECISION,
  is_valid          BOOLEAN,
  lap_phase         TEXT,
  tyre_state        TEXT
);

-- Non-unique btree on the natural query key (closest-to-canonical grain).
CREATE INDEX IF NOT EXISTS lap_phase_summary_mat_session_driver_lap_idx
  ON core.lap_phase_summary_mat (session_key, driver_number, lap_number);

-- Non-unique btree to support deferred delete-then-insert refresh per session_key.
CREATE INDEX IF NOT EXISTS lap_phase_summary_mat_session_idx
  ON core.lap_phase_summary_mat (session_key);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; duplicate-row
-- multiplicity from the source view is preserved verbatim because the table
-- has no PRIMARY KEY and the indexes are non-unique.
TRUNCATE core.lap_phase_summary_mat;
INSERT INTO core.lap_phase_summary_mat
SELECT * FROM core_build.lap_phase_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW) for pattern
-- consistency with prior Phase 3 materialization slices and to remain robust
-- against any future SQL view that depends on core.lap_phase_summary.
-- CREATE OR REPLACE VIEW is dependency-safe because the storage table above
-- is declared with the same column names, types, and ordering as the
-- original view's projection.
CREATE OR REPLACE VIEW core.lap_phase_summary AS
SELECT * FROM core.lap_phase_summary_mat;

COMMIT;
