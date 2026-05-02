BEGIN;

-- Phase 3 scale-out: materialize core.laps_enriched into a real heap storage
-- table and replace the public view with a thin SELECT * facade over that
-- table. Column list, types, and ordering mirror the public view as defined
-- at sql/006_semantic_lap_layer.sql:358 ff. (the projection list of the
-- final SELECT against the candidate / session_stats / lap_number_stats /
-- session_extent CTEs). Per diagnostic/notes/03-laps-enriched-grain.md, no
-- candidate column tuple is fully unique, so this table is declared with
-- NO PRIMARY KEY. Refresh strategy is delete-then-insert per session_key
-- (deferred to a later slice); the indexes below support that pattern.
CREATE TABLE IF NOT EXISTS core.laps_enriched_mat (
  session_key            BIGINT,
  meeting_key            BIGINT,
  year                   INTEGER,
  session_name           TEXT,
  session_type           TEXT,
  country_name           TEXT,
  location               TEXT,
  circuit_short_name     TEXT,
  driver_number          INTEGER,
  driver_name            TEXT,
  team_name              TEXT,
  lap_number             INTEGER,
  lap_start_ts           TIMESTAMPTZ,
  lap_end_ts             TIMESTAMPTZ,
  lap_duration           DOUBLE PRECISION,
  duration_sector_1      DOUBLE PRECISION,
  duration_sector_2      DOUBLE PRECISION,
  duration_sector_3      DOUBLE PRECISION,
  stint_number           INTEGER,
  compound_raw           TEXT,
  compound_name          TEXT,
  is_slick               BOOLEAN,
  tyre_age_at_start      INTEGER,
  tyre_age_on_lap        INTEGER,
  is_pit_out_lap         BOOLEAN,
  is_pit_lap             BOOLEAN,
  pit_duration           DOUBLE PRECISION,
  position_end_of_lap    INTEGER,
  track_flag             TEXT,
  is_personal_best_proxy BOOLEAN,
  validity_policy_key    TEXT,
  validity_rule_version  INTEGER,
  is_valid               BOOLEAN,
  invalid_reason         TEXT,
  rep_lap_session        DOUBLE PRECISION,
  fastest_valid_lap      DOUBLE PRECISION,
  lap_rep_time           DOUBLE PRECISION,
  delta_to_rep           DOUBLE PRECISION,
  pct_from_rep           DOUBLE PRECISION,
  delta_to_fastest       DOUBLE PRECISION,
  pct_from_fastest       DOUBLE PRECISION,
  delta_to_lap_rep       DOUBLE PRECISION,
  pct_from_lap_rep       DOUBLE PRECISION,
  fuel_adj_lap_time      DOUBLE PRECISION
);

-- Non-unique btree on the natural query key (closest-to-canonical grain).
CREATE INDEX IF NOT EXISTS laps_enriched_mat_session_driver_lap_idx
  ON core.laps_enriched_mat (session_key, driver_number, lap_number);

-- Non-unique btree to support deferred delete-then-insert refresh per session_key.
CREATE INDEX IF NOT EXISTS laps_enriched_mat_session_idx
  ON core.laps_enriched_mat (session_key);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; duplicate-row
-- multiplicity from the source view is preserved verbatim because the table
-- has no PRIMARY KEY and the indexes are non-unique.
TRUNCATE core.laps_enriched_mat;
INSERT INTO core.laps_enriched_mat
SELECT * FROM core_build.laps_enriched;

-- Replace the public aggregating view with a facade over the storage table.
-- Must be CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW): ten public
-- views in sql/007_semantic_summary_contracts.sql depend on core.laps_enriched
-- and a DROP would fail with "cannot drop view ... because other objects
-- depend on it". CREATE OR REPLACE VIEW is dependency-safe because the
-- storage table above is declared with the same column names, types, and
-- ordering as the original view's projection.
CREATE OR REPLACE VIEW core.laps_enriched AS
SELECT * FROM core.laps_enriched_mat;

COMMIT;
