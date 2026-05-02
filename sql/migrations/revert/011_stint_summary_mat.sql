-- Revert openf1:011_stint_summary_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql.
DROP VIEW IF EXISTS core.stint_summary;
DROP TABLE IF EXISTS core.stint_summary_mat;

COMMIT;
