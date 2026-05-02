-- Revert openf1:015_pit_cycle_summary_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql.
DROP VIEW IF EXISTS core.pit_cycle_summary;
DROP TABLE IF EXISTS core.pit_cycle_summary_mat;

COMMIT;
