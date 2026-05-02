-- Revert openf1:018_lap_context_summary_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql.
DROP VIEW IF EXISTS core.lap_context_summary;
DROP TABLE IF EXISTS core.lap_context_summary_mat;

COMMIT;
