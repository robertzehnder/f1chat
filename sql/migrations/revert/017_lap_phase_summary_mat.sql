-- Revert openf1:017_lap_phase_summary_mat from pg

BEGIN;

-- See deep-revert note in revert/019_telemetry_lap_bridge_mat.sql.
DROP VIEW IF EXISTS core.lap_phase_summary;
DROP INDEX IF EXISTS core.lap_phase_summary_mat_session_driver_lap_idx;
DROP INDEX IF EXISTS core.lap_phase_summary_mat_session_idx;
DROP TABLE IF EXISTS core.lap_phase_summary_mat;

COMMIT;
