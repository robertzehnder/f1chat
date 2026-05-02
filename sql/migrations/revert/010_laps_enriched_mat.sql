-- Revert openf1:010_laps_enriched_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql. The
-- predecessor 006_semantic_lap_layer creates VIEW core.laps_enriched as a
-- semantic-layer transformation; this revert drops the matview-backed
-- replacement so re-deploy of 006 (or `sqitch deploy --to
-- 006_semantic_lap_layer`) is required to restore the original VIEW.
DROP VIEW IF EXISTS core.laps_enriched;
DROP INDEX IF EXISTS core.laps_enriched_mat_session_driver_lap_idx;
DROP INDEX IF EXISTS core.laps_enriched_mat_session_idx;
DROP TABLE IF EXISTS core.laps_enriched_mat;

COMMIT;
