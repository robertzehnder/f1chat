-- Revert openf1:019_telemetry_lap_bridge_mat from pg

BEGIN;

-- Drop the matview-backed VIEW first, then the storage table. The VIEW from
-- this change replaces the predecessor 007's CREATE OR REPLACE VIEW; deep
-- revert past this change therefore requires re-applying 007 (or running
-- `sqitch deploy --to 007_semantic_summary_contracts`) to restore the
-- semantic-layer view definition. See sql/migrations/README.md.
DROP VIEW IF EXISTS core.telemetry_lap_bridge;
DROP INDEX IF EXISTS core.telemetry_lap_bridge_mat_session_driver_lap_idx;
DROP INDEX IF EXISTS core.telemetry_lap_bridge_mat_session_idx;
DROP TABLE IF EXISTS core.telemetry_lap_bridge_mat;

COMMIT;
