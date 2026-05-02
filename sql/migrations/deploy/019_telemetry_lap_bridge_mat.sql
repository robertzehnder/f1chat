BEGIN;

-- Phase 3 scale-out: materialize core.telemetry_lap_bridge into a real heap
-- storage table sourced from core_build.telemetry_lap_bridge, and replace the
-- public view with a thin SELECT * facade over that table. Column list,
-- types, and ordering mirror the public view as defined at
-- sql/007_semantic_summary_contracts.sql:792 ff. The grain inherited from
-- core_build.laps_enriched is non-unique (per
-- diagnostic/notes/03-laps-enriched-grain.md), so this table is declared
-- with NO PRIMARY KEY. Refresh strategy is delete-then-insert per
-- session_key (deferred to a later slice); the indexes below support that
-- pattern.
CREATE TABLE IF NOT EXISTS core.telemetry_lap_bridge_mat (
  session_key            BIGINT,
  meeting_key            BIGINT,
  year                   INTEGER,
  session_name           TEXT,
  session_type           TEXT,
  driver_number          INTEGER,
  driver_name            TEXT,
  team_name              TEXT,
  lap_number             INTEGER,
  lap_start_ts           TIMESTAMPTZ,
  lap_end_ts             TIMESTAMPTZ,
  car_samples            BIGINT,
  max_speed              INTEGER,
  avg_speed              NUMERIC,
  max_throttle           NUMERIC,
  avg_throttle           NUMERIC,
  brake_samples          BIGINT,
  first_brake_time_sec   NUMERIC,
  location_samples       BIGINT
);

-- Non-unique btree on the natural query key (closest-to-canonical grain).
CREATE INDEX IF NOT EXISTS telemetry_lap_bridge_mat_session_driver_lap_idx
  ON core.telemetry_lap_bridge_mat (session_key, driver_number, lap_number);

-- Non-unique btree to support deferred delete-then-insert refresh per session_key.
CREATE INDEX IF NOT EXISTS telemetry_lap_bridge_mat_session_idx
  ON core.telemetry_lap_bridge_mat (session_key);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; duplicate-row
-- multiplicity from the source view is preserved verbatim because the table
-- has no PRIMARY KEY and the indexes are non-unique.
TRUNCATE core.telemetry_lap_bridge_mat;
INSERT INTO core.telemetry_lap_bridge_mat
SELECT * FROM core_build.telemetry_lap_bridge;

-- Replace the public aggregating view with a facade over the storage table.
-- CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW) for pattern
-- consistency with prior Phase 3 materialization slices and to remain robust
-- against any future SQL view that depends on core.telemetry_lap_bridge.
-- CREATE OR REPLACE VIEW is dependency-safe because the storage table above
-- is declared with the same column names, types, and ordering as the
-- original view's projection.
CREATE OR REPLACE VIEW core.telemetry_lap_bridge AS
SELECT * FROM core.telemetry_lap_bridge_mat;

COMMIT;
